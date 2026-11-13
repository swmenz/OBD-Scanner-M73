/**
 * Главный контроллер приложения «Диагностика М73» для Лада Приора
 * Полная русификация, строгая визуальная иерархия и эргономика интерфейса.
 */

/**
 * Менеджер удержания экрана активным (Screen Wake Lock API)
 * Предотвращает засыпание дисплея iPhone при установке в держатель на панели Приоры.
 */
class WakeLockManager {
  constructor() {
    this.wakeLock = null;
    this.isEnabled = false;
  }

  async request() {
    this.isEnabled = true;
    if (!('wakeLock' in navigator)) return;
    try {
      if (this.wakeLock && !this.wakeLock.released) return;
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch (err) {
      // Игнорируем ограничения батареи или неактивного экрана
    }
  }

  async release() {
    this.isEnabled = false;
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
      } catch (e) {}
      this.wakeLock = null;
    }
  }

  async reapplyIfNeeded() {
    if (this.isEnabled && (!this.wakeLock || this.wakeLock.released)) {
      await this.request();
    }
  }
}

/**
 * Фоновый хранитель активности WebKit на iOS (Silent Audio Loop + Ambient Audio Session)
 * Позволяет таймерам JS не засыпать при переключении на музыку или навигатор,
 * при этом НЕ заглушает и НЕ прерывает музыку пользователя (Яндекс Музыка, Apple Music, Spotify).
 */
class BackgroundKeeper {
  constructor() {
    this.audioElement = null;
    this.audioCtx = null;
    this.bufferSource = null;
    this.isActive = false;
    this._blobUrl = null;
  }

  _initAmbientAudioSession() {
    // Режим 'ambient' сообщает iOS WebKit: микшировать с другими приложениями, не глушить музыку
    if ('audioSession' in navigator) {
      try {
        navigator.audioSession.type = 'ambient';
      } catch (e) {}
    }
  }

  _createSilentAudioBlobUrl() {
    if (this._blobUrl) return this._blobUrl;
    // Генерируем валидный 2-секундный PCM WAV файл тишины (8 кГц, 8 бит моно = 16 КБ)
    const sampleRate = 8000;
    const durationSec = 2;
    const numSamples = sampleRate * durationSec;
    const buffer = new ArrayBuffer(44 + numSamples);
    const view = new DataView(buffer);

    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + numSamples, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // fmt subchunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);          // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);           // AudioFormat (1 = PCM)
    view.setUint16(22, 1, true);           // NumChannels (1 = mono)
    view.setUint32(24, sampleRate, true);  // SampleRate
    view.setUint32(28, sampleRate, true);  // ByteRate
    view.setUint16(32, 1, true);           // BlockAlign
    view.setUint16(34, 8, true);           // BitsPerSample (8 bit)

    // data subchunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, numSamples, true);

    // 8-bit PCM тишина — уровень 128 (0x80)
    const pcm = new Uint8Array(buffer, 44, numSamples);
    pcm.fill(128);

    const blob = new Blob([buffer], { type: 'audio/wav' });
    this._blobUrl = URL.createObjectURL(blob);
    return this._blobUrl;
  }

  start() {
    if (this.isActive) return;
    this.isActive = true;
    this._initAmbientAudioSession();

    // 1. Web Audio API фоновый генератор тишины (нативно микшируется на iOS)
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        if (!this.audioCtx) {
          this.audioCtx = new AudioContextClass();
        }
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
        }
        if (!this.bufferSource) {
          const silentBuffer = this.audioCtx.createBuffer(1, this.audioCtx.sampleRate * 2, this.audioCtx.sampleRate);
          this.bufferSource = this.audioCtx.createBufferSource();
          this.bufferSource.buffer = silentBuffer;
          this.bufferSource.loop = true;
          this.bufferSource.connect(this.audioCtx.destination);
          this.bufferSource.start();
        }
      }
    } catch (e) {}

    // 2. Фоновый HTML5 аудио-луп тишины для удержания процесса при скрытии вкладки
    try {
      if (!this.audioElement) {
        this.audioElement = new Audio();
        this.audioElement.src = this._createSilentAudioBlobUrl();
        this.audioElement.loop = true;
        this.audioElement.volume = 0.01;
        this.audioElement.setAttribute('playsinline', '');
        this.audioElement.setAttribute('webkit-playsinline', '');
      }
      this.audioElement.play().catch(() => {});
    } catch (e) {}
  }

  stop() {
    this.isActive = false;
    if (this.audioElement) {
      try {
        this.audioElement.pause();
      } catch (e) {}
    }
    if (this.bufferSource) {
      try {
        this.bufferSource.stop();
        this.bufferSource.disconnect();
      } catch (e) {}
      this.bufferSource = null;
    }
    if (this.audioCtx) {
      try {
        this.audioCtx.suspend().catch(() => {});
      } catch (e) {}
    }
  }

  resumeIfNeeded() {
    if (!this.isActive) return;
    this._initAmbientAudioSession();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    if (this.audioElement && this.audioElement.paused) {
      this.audioElement.play().catch(() => {});
    }
  }
}

class M73Application {
  constructor() {
    this.elm = new Elm327BLE();
    this.m73 = new ItelmaM73Protocol(this.elm);
    this.logger = new TripLogger();

    this.isPolling = false;
    this.currentTab = 'tab-dashboard';
    this.peakRpm = 0;

    // Состояние подключения и терминала
    this.connecting = false;
    this._connectSeq = 0;
    this.pollPromise = null;
    this.termBuffer = [];
    this.TERM_LIMIT = 300;

    // Фоновая устойчивость, WakeLock и авто-реконнект
    this.wakeLockMgr = new WakeLockManager();
    this.bgKeeper = new BackgroundKeeper();
    this.userExplicitDisconnect = false;
    this.isReconnecting = false;
    this.shouldBeConnected = false;
    this.needsReconnectOnVisible = false;

    // Состояние управления исполнительными механизмами и уставками (v54.6 Mutex)
    this.isActuatorBusy = false;
    this._cancelRegulatorRequested = false;
    this._forceRegulatorSend = false;
    this._pendingReleases = new Set(); // ID регуляторов, которые надо вернуть ЭБУ, когда канал освободится
    this.activeRegulator = null; // { key: 'rxx'|'idleRpm'|'purge', idHex: '41'|'42'|'43', rawByte: 0 }
    this.regulatorValues = {
      idleRpm: 880, // об/мин (ID 42, шаг 20/40, диапазон 600..1800)
      rxx: 60,      // шагов (ID 41, шаг 5, диапазон 10..200)
      purge: 20     // % (ID 43, шаг 10, диапазон 0..100)
    };
    this.lastAutoSavedTrip = null;
    this._o2AdcWindow = [];

    this.initElements();
    this.bindEvents();
    if (window.DashboardWidgetManager) {
      this.widgetManager = new DashboardWidgetManager(this);
      this.widgetManager.init();
    }
  }

  initElements() {
    this.btnConnect = document.getElementById('btnConnect');
    this.btnConnectText = document.getElementById('btnConnectText');
    this.connIndicator = document.getElementById('connIndicator');
    this.connStateText = document.getElementById('connStateText');
    this.hzValue = document.getElementById('hzValue');
    this.msValue = document.getElementById('msValue');

    // Логгер
    this.btnToggleLog = document.getElementById('btnToggleLog');
    this.btnExportCsv = document.getElementById('btnExportCsv');
    this.btnExportXlsx = document.getElementById('btnExportXlsx');
    this.loggerStatusDot = document.getElementById('loggerStatusDot');
    this.loggerStatsText = document.getElementById('loggerStatsText');
    this.recBtnLabel = document.getElementById('recBtnLabel');
    this.chkAutoRecord = document.getElementById('chkAutoRecord');
    this.btnOpenHistory = document.getElementById('btnOpenHistory');
    this.historyCount = document.getElementById('historyCount');
    this.tripSavedAlert = document.getElementById('tripSavedAlert');
    this.tripSavedDetails = document.getElementById('tripSavedDetails');
    this.btnQuickExport = document.getElementById('btnQuickExport');
    this.btnQuickExportXlsx = document.getElementById('btnQuickExportXlsx');
    this.historyModal = document.getElementById('historyModal');
    this.historyList = document.getElementById('historyList');
    this.btnCloseHistory = document.getElementById('btnCloseHistory');
    this.btnClearHistory = document.getElementById('btnClearHistory');

    // Главные приборы
    this.heroCardRpm = document.getElementById('heroCardRpm');
    this.valRpm = document.getElementById('valRpm');
    this.barRpm = document.getElementById('barRpm');
    this.valPeakRpm = document.getElementById('valPeakRpm');
    this.valSpeed = document.getElementById('valSpeed');
    this.valGearAux = document.getElementById('valGearAux');
    this.valThrottleSub = document.getElementById('valThrottleSub');

    // Сетка метрик
    this.valTemp = document.getElementById('valTemp');
    this.barTemp = document.getElementById('barTemp');
    this.valThrottle = document.getElementById('valThrottle');
    this.valMaf = document.getElementById('valMaf');
    this.valCycleAir = document.getElementById('valCycleAir');
    this.valSpark = document.getElementById('valSpark');
    this.valRetard = document.getElementById('valRetard');
    this.cardSpark = document.getElementById('cardSpark');
    this.valInjTime = document.getElementById('valInjTime');
    this.valDuty = document.getElementById('valDuty');
    this.valFuelRate = document.getElementById('valFuelRate');
    this.valIac = document.getElementById('valIac');
    this.valVoltage = document.getElementById('valVoltage');
    this.valMultAdapt = document.getElementById('valMultAdapt');
    this.valAddAdapt = document.getElementById('valAddAdapt');
    this.valIntakeTemp = document.getElementById('valIntakeTemp');
    this.valRoughRoad = document.getElementById('valRoughRoad');

    // Флаги
    this.flagIdle = document.getElementById('flagIdle');
    this.flagLambda = document.getElementById('flagLambda');
    this.flagKnock = document.getElementById('flagKnock');
    this.flagFuelCut = document.getElementById('flagFuelCut');

    // Новые метрики ReadLogs / OpenDiag v32
    this.valFrlLoad = document.getElementById('valFrlLoad');
    this.valCalcLoad = document.getElementById('valCalcLoad');
    this.valO2Volt = document.getElementById('valO2Volt');
    this.valO2Volt2 = document.getElementById('valO2Volt2');
    this.valLambdaCorr = document.getElementById('valLambdaCorr');
    this.valTargetLambda = document.getElementById('valTargetLambda');
    this.valPurgeRate = document.getElementById('valPurgeRate');
    this.valAltitude = document.getElementById('valAltitude');

    this.flagPump = document.getElementById('flagPump');
    this.flagFan1 = document.getElementById('flagFan1');
    this.flagFan2 = document.getElementById('flagFan2');
    this.flagMil = document.getElementById('flagMil');
    this.flagO2Ready = document.getElementById('flagO2Ready');
    this.flagAc = document.getElementById('flagAc');

    // Ошибки DTC
    this.dtcList = document.getElementById('dtcList');
    this.btnReadDtc = document.getElementById('btnReadDtc');
    this.btnClearDtc = document.getElementById('btnClearDtc');

    // АЦП и здоровье датчиков
    this.adcMaf = document.getElementById('adcMaf');
    this.adcThrottle = document.getElementById('adcThrottle');
    this.adcTemp = document.getElementById('adcTemp');
    this.adcAirTemp = document.getElementById('adcAirTemp');
    this.adcRoughRoad = document.getElementById('adcRoughRoad');
    this.adcO2 = document.getElementById('adcO2');
    this.adcO2_2 = document.getElementById('adcO2_2');
    this.adcVolt = document.getElementById('adcVolt');

    this.barAdcMaf = document.getElementById('barAdcMaf');
    this.barAdcThrottle = document.getElementById('barAdcThrottle');
    this.barAdcTemp = document.getElementById('barAdcTemp');
    this.barAdcAirTemp = document.getElementById('barAdcAirTemp');
    this.barAdcRoughRoad = document.getElementById('barAdcRoughRoad');
    this.barAdcO2 = document.getElementById('barAdcO2');
    this.barAdcO2_2 = document.getElementById('barAdcO2_2');
    this.barAdcVolt = document.getElementById('barAdcVolt');

    this.healthAdcMaf = document.getElementById('healthAdcMaf');
    this.healthAdcThrottle = document.getElementById('healthAdcThrottle');
    this.healthAdcTemp = document.getElementById('healthAdcTemp');
    this.healthAdcAirTemp = document.getElementById('healthAdcAirTemp');
    this.healthAdcRoughRoad = document.getElementById('healthAdcRoughRoad');
    this.healthAdcO2 = document.getElementById('healthAdcO2');
    this.healthAdcO2_2 = document.getElementById('healthAdcO2_2');
    this.healthAdcVolt = document.getElementById('healthAdcVolt');

    this.descAdcMaf = document.getElementById('descAdcMaf');
    this.descAdcThrottle = document.getElementById('descAdcThrottle');
    this.descAdcTemp = document.getElementById('descAdcTemp');
    this.descAdcAirTemp = document.getElementById('descAdcAirTemp');
    this.descAdcRoughRoad = document.getElementById('descAdcRoughRoad');
    this.descAdcO2 = document.getElementById('descAdcO2');
    this.descAdcO2_2 = document.getElementById('descAdcO2_2');
    this.descAdcVolt = document.getElementById('descAdcVolt');

    this.adcSummaryOrb = document.getElementById('adcSummaryOrb');
    this.adcSummaryText = document.getElementById('adcSummaryText');
    this.adcCountOk = document.getElementById('adcCountOk');
    this.adcCountWarn = document.getElementById('adcCountWarn');
    this.adcCountDanger = document.getElementById('adcCountDanger');

    this.modalAdcReference = document.getElementById('modalAdcReference');
    this.btnOpenAdcRefModal = document.getElementById('btnOpenAdcRefModal');
    this.btnCloseAdcRef = document.getElementById('btnCloseAdcRef');

    this.misCyl1 = document.getElementById('misCyl1');
    this.misCyl2 = document.getElementById('misCyl2');
    this.misCyl3 = document.getElementById('misCyl3');
    this.misCyl4 = document.getElementById('misCyl4');
    this.misCycle = document.getElementById('misCycle');

    // Живая мини-телеметрия во вкладке Тесты и элементы нижнего дока
    this.actLiveRpm = document.getElementById('actLiveRpm');
    this.actLiveTemp = document.getElementById('actLiveTemp');
    this.actLiveIac = document.getElementById('actLiveIac');
    this.actLiveVolt = document.getElementById('actLiveVolt');
    this.dockGlider = document.getElementById('dockGlider');
    this.dockDtcBadge = document.getElementById('dockDtcBadge');
    this.dockPeekHandle = document.getElementById('dockPeekHandle');

    // Терминал
    this.terminalLog = document.getElementById('terminalLog');
    this.terminalInput = document.getElementById('terminalInput');

    if (this.valPeakRpm && this.peakRpm > 0) {
      this._updateText(this.valPeakRpm, `Пик: ${this.peakRpm}`);
    }
  }

  bindEvents() {
    this.btnConnect.addEventListener('click', () => this.toggleConnection());

    const badge = document.getElementById('appVersionBadge');
    if (badge) {
      badge.style.cursor = 'pointer';
      badge.title = 'Нажмите для проверки обновлений';
      badge.addEventListener('click', async () => {
        if (!this._swUpdateReady) {
          try {
            if ('serviceWorker' in navigator) {
              const reg = await navigator.serviceWorker.getRegistration();
              if (reg) {
                await reg.update();
                if (reg.waiting) {
                  reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                  this._swUpdateReady = true;
                }
              }
            }
          } catch (e) {}
        }
        if (this._swUpdateReady && !this.elm.isConnected && !this.connecting) {
          if (confirm("Доступна обновлённая версия приложения. Перезагрузить страницу сейчас?")) {
            window.location.reload();
            return;
          }
        }
        alert("Диагностика М73 — Версия v55.5\n\nОбновления:\n1) Чистый опрос главной панели: убран канал ДМРВ (АЦП) из осциллографа, поэтому на главном экране опрашивается строго кадр 21 01 без примеси 21 03\n2) Осциллограф: мёртвый канал сигнала детонации заменён на живой график отскока УОЗ (вверх от 0°); убрана лишняя плитка шума ДД\n3) Надёжность BLE и интерфейса: счётчик поколения очереди, живое питание АЦП-каналов в модалке и увеличенные зоны нажатия");
      });
    }

    // Интеллектуальное автоскрытие нижнего дока при отсутствии взаимодействия и скролле вниз
    this.initDockAutoHide();

    // Режим скорости опроса K-Line: Постоянный Турбо + Конвейер v55.5
    const cadencePill = document.querySelector('.cadence-pill');
    if (cadencePill) {
      cadencePill.title = 'Частота опроса K-Line: Турбо + Конвейер v55.5';

      cadencePill.addEventListener('click', () => {
        const suffixInfo = this.m73 && this.m73.singleFrameSuffixSupported === true
          ? "Включен (21011 / 21031, закрытие кадра 0 мс)"
          : (this.m73 && this.m73.singleFrameSuffixSupported === false ? "Отключен адаптером (стандартный 2101)" : "Определяется...");
        alert(
          `Режим опроса: Турбо + Конвейер (Релиз v55.5)\n\n` +
          `• Адаптивный тайминг: AT AT 2\n` +
          `• Таймаут шины: AT ST 10 (~64 мс, постоянный Турбо)\n` +
          `• Турбо-суффикс кадра: ${suffixInfo}\n` +
          `• Конвейер (Request Pipelining): Активен (BLE-запрос параллельно с рендером CPU)\n` +
          `• Главная панель (только 21011, 79 байт): до 4.1–4.5 Гц (~225–245 мс)\n` +
          `• Вкладка АЦП (только 21031, 27 байт): ~5.0–5.3 Гц (~190 мс)`
        );
      });
    }

    
    document.querySelectorAll('.dock-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });

    this.elm.onLog = (type, msg) => this.appendTerminal(type, msg);
    this.elm.onDisconnect = () => this.handleUnexpectedDisconnect();

    // Защита связи при сворачивании и переключении приложений (музыка, навигатор)
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
    window.addEventListener('focus', () => this.handleWindowFocus());
    window.addEventListener('pagehide', () => {
      if (this.logger && this.logger.isRecording) {
        this.logger.saveCheckpoint(this.peakRpm || 0).catch(() => {});
      }
    });

    if (this.terminalInput) {
      this.terminalInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.sendManualCommand();
        }
      });
    }

    this.logger.onStatsUpdate = (stats) => {
      this._updateText(this.hzValue, stats.hz.toFixed(1));
      this._updateText(this.msValue, stats.ms);
      if (this.logger.isRecording) {
        if (this.currentTab === 'tab-dashboard') {
          this._updateText(this.loggerStatsText, `Идёт запись • ${stats.count} точек (${stats.hz} Гц)`);
        } else {
          this._updateText(this.loggerStatsText, `Запись на паузе (откройте «Панель») • ${stats.count} точек`);
        }
      }
    };

    // Делегированные обработчики логгера (работают всегда, без задвоения вызовов)
    document.addEventListener('click', (e) => {
      if (e.target.closest('#btnToggleLog')) {
        this.toggleLogging();
      } else if (e.target.closest('#btnExportCsv')) {
        this.logger.exportToCsv();
      } else if (e.target.closest('#btnExportXlsx')) {
        this.logger.exportToXlsx();
      }
    });

    // Автозапись и история поездок
    if (this.chkAutoRecord) {
      let savedAutoRec = null;
      try {
        savedAutoRec = localStorage.getItem('m73_autorecord');
      } catch (e) {}
      this.chkAutoRecord.checked = savedAutoRec !== 'false' && savedAutoRec !== '0';
    }

    document.addEventListener('change', (e) => {
      const chk = e.target.closest('#chkAutoRecord');
      if (chk) {
        try {
          localStorage.setItem('m73_autorecord', String(chk.checked));
        } catch (err) {}
        if (chk.checked && this.elm.isConnected && !this.logger.isRecording) {
          this.startLogging();
        }
      }
    });

    if (this.btnOpenHistory) {
      this.btnOpenHistory.addEventListener('click', () => this.openHistoryModal());
    }
    if (this.btnCloseHistory) {
      this.btnCloseHistory.addEventListener('click', () => this.closeHistoryModal());
    }
    if (this.historyModal) {
      this.historyModal.addEventListener('click', (e) => {
        if (e.target === this.historyModal) this.closeHistoryModal();
      });
    }
    if (this.btnClearHistory) {
      this.btnClearHistory.addEventListener('click', async () => {
        if (confirm("Удалить всю историю сохранённых поездок?")) {
          await this.logger.storage.clearAll();
          await this.refreshHistory();
        }
      });
    }

    // Справочник допусков АЦП
    if (this.btnOpenAdcRefModal) {
      this.btnOpenAdcRefModal.addEventListener('click', () => {
        if (this.modalAdcReference) {
          this.modalAdcReference.classList.add('open');
        }
      });
    }
    if (this.btnCloseAdcRef) {
      this.btnCloseAdcRef.addEventListener('click', () => {
        if (this.modalAdcReference) {
          this.modalAdcReference.classList.remove('open');
        }
      });
    }
    if (this.modalAdcReference) {
      this.modalAdcReference.addEventListener('click', (e) => {
        if (e.target === this.modalAdcReference) {
          this.modalAdcReference.classList.remove('open');
        }
      });
    }
    if (this.btnQuickExport) {
      this.btnQuickExport.addEventListener('click', () => {
        if (this.lastAutoSavedTrip) {
          this.logger.exportToCsv(this.lastAutoSavedTrip.records, this.lastAutoSavedTrip.fileName);
        } else {
          this.logger.exportToCsv();
        }
      });
    }
    if (this.btnQuickExportXlsx) {
      this.btnQuickExportXlsx.addEventListener('click', () => {
        if (this.lastAutoSavedTrip) {
          this.logger.exportToXlsx(this.lastAutoSavedTrip.records, this.lastAutoSavedTrip.fileName);
        } else {
          this.logger.exportToXlsx();
        }
      });
    }
    this.refreshHistoryCount();

    this.btnReadDtc.addEventListener('click', () => this.readDtc());
    this.btnClearDtc.addEventListener('click', () => this.clearDtc());
  }

  async toggleConnection() {
    if (this.isReconnecting) {
      this.elm.log('info', 'Идёт автоматическое восстановление связи, подождите...');
      return;
    }

    // Если поиск уже идёт — повторное нажатие служит кнопкой быстрой отмены!
    if (this.connecting) {
      this._connectSeq++;
      this.connecting = false;
      this.userExplicitDisconnect = true;
      this.shouldBeConnected = false;
      this.btnConnect.disabled = false;
      this.btnConnectText.textContent = "Подключить";
      if (this.widgetManager) this.widgetManager.stopOscLoop();
      if (!this.logger.isRecording) this.bgKeeper.stop();
      this.btnConnect.classList.remove('connected');
      this.connIndicator.className = 'status-pulse';
      this.connStateText.textContent = "Не подключено";
      this.elm.log('info', 'Поиск отменён пользователем');
      try { await this.elm.disconnect(); } catch (e) {}
      return;
    }

    if (this.elm.isConnected) {
      // Осознанное отключение пользователем: перед разрывом BLE возвращаем управление регуляторами ЭБУ
      this._connectSeq++;
      this.userExplicitDisconnect = true;
      this.shouldBeConnected = false;
      await this.stopPolling();
      const releaseIds = new Set(this._pendingReleases || []);
      if (this.activeRegulator && this.activeRegulator.idHex) {
        releaseIds.add(this.activeRegulator.idHex);
      }
      if (this._pendingReleases) this._pendingReleases.clear();
      for (const id of releaseIds) {
        try { await this.m73.releaseActuatorControl(id); } catch (e) {}
      }
      await this.elm.disconnect();
      await this.handleDisconnectedState();
      return;
    }

    const seq = ++this._connectSeq;
    this.userExplicitDisconnect = false;
    this.connecting = true;

    // Активируем фоновый хранитель сразу по жесту клика пользователя (требование iOS WebKit)
    this.bgKeeper.start();

    // Оставляем кнопку активной с текстом "Отмена", чтобы пользователь мог прервать поиск в любой момент
    this.btnConnect.disabled = false;
    this.btnConnectText.textContent = "Отмена";

    try {
      await this.elm.requestAndConnect();

      if (seq !== this._connectSeq || !this.connecting || this.userExplicitDisconnect) {
        if (seq === this._connectSeq) {
          try { await this.elm.disconnect(); } catch (e) {}
        }
        return;
      }

      this.btnConnectText.textContent = "Связь...";
      await this.m73.initEcu();

      if (seq !== this._connectSeq || !this.connecting || this.userExplicitDisconnect || !this.elm.isConnected) {
        if (seq === this._connectSeq) {
          try { await this.elm.disconnect(); } catch (e) {}
        }
        return;
      }

      this.shouldBeConnected = true;
      this.btnConnect.classList.add('connected');
      this.btnConnectText.textContent = "Отключить";
      this.connIndicator.className = 'status-pulse connected';
      this.connStateText.textContent = "Подключено к ЭБУ";
      if (this.btnToggleLog) this.btnToggleLog.disabled = false;
      this.peakRpm = 0;
      this._updateText(this.valPeakRpm, "Пик: 0");

      // Скрываем прошлый баннер о сохранённой поездке
      if (this.tripSavedAlert) this.tripSavedAlert.style.display = 'none';

      // Активируем удержание экрана включенным на приборной панели
      await this.wakeLockMgr.request();

      if (seq !== this._connectSeq) return;
      this.startContinuousPolling();

      // Автозапись при подключении (если тумблер включен)
      if (this.chkAutoRecord && this.chkAutoRecord.checked && !this.logger.isRecording) {
        this.startLogging();
      }
    } catch (err) {
      if (seq !== this._connectSeq) {
        return;
      }
      // Проверяем, была ли это намеренная отмена или закрытие окна пользователем
      const isCancelled = this.userExplicitDisconnect ||
                          err.isCancelled ||
                          err.name === 'NotFoundError' ||
                          err.name === 'AbortError' ||
                          (err.message && /cancel|отмен|closed|dismiss|abort/i.test(err.message));

      if (!isCancelled) {
        alert(err && err.message ? err.message : "Не удалось найти Bluetooth адаптер");
      }
      this.elm.log('info', isCancelled ? 'Подключение отменено пользователем' : 'Ошибка подключения: ' + (err.message || err));

      // Если Bluetooth уже открыт, а ЭБУ не ответил — закрываем канал
      try { await this.elm.disconnect(); } catch (e) {}
      await this.handleDisconnectedState();
    } finally {
      if (seq !== this._connectSeq) {
        return;
      }
      this.connecting = false;
      this.btnConnect.disabled = false;
      if (!this.elm.isConnected) {
        this.btnConnectText.textContent = "Подключить";
        if (this.widgetManager) this.widgetManager.stopOscLoop();
        this.btnConnect.classList.remove('connected');
        this.connIndicator.className = 'status-pulse';
        this.connStateText.textContent = "Не подключено";
      }
    }
  }

  async handleUnexpectedDisconnect() {
    if (this.userExplicitDisconnect) {
      await this.handleDisconnectedState();
      return;
    }

    this.elm.log('err', 'Неожиданный разрыв BLE связи');

    if (document.visibilityState === 'hidden') {
      // Страница свёрнута: не сбрасываем поездку, взводим флаг для тихого восстановления при разворачивании
      this.needsReconnectOnVisible = true;
      this.connStateText.textContent = "Связь приостановлена (в фоне)";
      this.connIndicator.className = 'status-pulse reconnecting';
    } else {
      // Страница активна: пробуем тихо восстановить связь
      await this.performSilentReconnect();
    }
  }

  async handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      this.bgKeeper.resumeIfNeeded();

      if (this.shouldBeConnected) {
        await this.wakeLockMgr.reapplyIfNeeded();

        const bleLost = !this.elm.isConnected || (this.elm.device && !this.elm.device.gatt?.connected);
        if (bleLost || this.needsReconnectOnVisible) {
          this.needsReconnectOnVisible = false;
          await this.performSilentReconnect();
        } else {
          // Канал Bluetooth активен — возобновляем опрос только если шина не занята тестом или реконнектом
          if (!this.isPolling && !this.isActuatorBusy && !this.isReconnecting && !this.connecting) {
            this.elm.log('info', 'Возобновление опроса после возврата в приложение...');
            this.startContinuousPolling();
          }
        }
      }
    } else if (document.visibilityState === 'hidden') {
      // При сворачивании приложения на iOS мгновенно сохраняем контрольную точку записи в IndexedDB
      if (this.logger && this.logger.isRecording) {
        this.logger.saveCheckpoint(this.peakRpm || 0).catch(() => {});
      }
    }
  }

  async handleWindowFocus() {
    if (this.shouldBeConnected && !this.connecting && !this.userExplicitDisconnect) {
      const bleLost = !this.elm.isConnected || (this.elm.device && !this.elm.device.gatt?.connected);
      if (bleLost && !this.isReconnecting) {
        await this.performSilentReconnect();
      }
    }
  }

  /**
   * Бесшовный тихий авто-реконнект к адаптеру и перезапуск сессии ЭБУ
   * Сохраняет текущую поездку и продолжающуюся запись логов в один файл без разделения!
   */
  async performSilentReconnect(maxRetries = 3) {
    if (this.isReconnecting) return;
    if (!this.elm.device) {
      await this.handleDisconnectedState();
      return;
    }
    if (this.userExplicitDisconnect) return;

    this.isReconnecting = true;
    this.connStateText.textContent = "Восстановление связи...";
    this.connIndicator.className = 'status-pulse reconnecting';
    this.elm.log('info', 'Автоматическое восстановление связи с адаптером...');

    await this.stopPolling();

    let success = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.elm.log('info', `Попытка авто-реконнекта (${attempt}/${maxRetries})...`);

        // 1. Тихое переподключение BLE к сохраненному адаптеру
        await this.elm.silentReconnect();

        // 2. Инициализация протокола ЭБУ М73 (Fast Init K-Line)
        this.connStateText.textContent = "Инициализация ЭБУ...";
        await this.m73.initEcu();

        success = true;
        break;
      } catch (err) {
        this.elm.log('err', `Сбой попытки ${attempt}: ${err.message || err}`);
        if (attempt < maxRetries) {
          await this.delay(600);
        }
      }
    }

    this.isReconnecting = false;

    if (success) {
      this.shouldBeConnected = true;
      this.btnConnect.classList.add('connected');
      this.btnConnectText.textContent = "Отключить";
      this.connIndicator.className = 'status-pulse connected';
      this.connStateText.textContent = "Подключено к ЭБУ";
      if (this.btnToggleLog) this.btnToggleLog.disabled = false;
      this.elm.log('info', 'Связь с ЭБУ М73 успешно восстановлена! Логирование продолжается.');

      this.startContinuousPolling();
      await this.wakeLockMgr.request();
    } else {
      this.elm.log('err', 'Не удалось восстановить связь автоматически. Пожалуйста, нажмите "Подключить".');
      this.shouldBeConnected = false;
      try { await this.elm.disconnect(); } catch (e) {}
      await this.handleDisconnectedState();
    }
  }

  async handleDisconnectedState() {
    this.isPolling = false;
    this.shouldBeConnected = false;
    this.isReconnecting = false;
    this.needsReconnectOnVisible = false;
    this.isActuatorBusy = false;
    this._cancelRegulatorRequested = false;
    if (this._pendingReleases) this._pendingReleases.clear();

    if (this.activeRegulator) {
      this._updateRegulatorUI(this.activeRegulator.key, false);
      this.activeRegulator = null;
    }

    // Освобождаем блокировку экрана и фоновые процессы
    await this.wakeLockMgr.release();
    this.bgKeeper.stop();

    // Обрыв связи или выключение зажигания: корректно завершаем запись и сохраняем поездку в IndexedDB
    if (this.logger.isRecording) {
      await this.stopLogging();
    }
    this._o2AdcWindow = [];
    if (this.widgetManager) this.widgetManager.stopOscLoop();
    this.btnConnect.classList.remove('connected');
    this.btnConnectText.textContent = "Подключить";
    this.connIndicator.className = 'status-pulse';
    this.connStateText.textContent = "Не подключено";
    if (this.btnToggleLog) this.btnToggleLog.disabled = true;
    if (this.btnExportCsv) this.btnExportCsv.disabled = this.logger.records.length === 0;
    if (this.btnExportXlsx) this.btnExportXlsx.disabled = this.logger.records.length === 0;
    if (this.hzValue) this.hzValue.textContent = "0.0";
    if (this.msValue) this.msValue.textContent = "0";
    this.refreshHistoryCount();
  }

  startContinuousPolling() {
    if (this.isPolling || this.pollPromise) return this.pollPromise;
    this.isPolling = true;
    this.pollPromise = this._pollLoop().finally(() => { this.pollPromise = null; });
    return this.pollPromise;
  }

  /**
   * Надёжная остановка опроса: ждём, пока завершится текущий запрос в цикле.
   * Исключает ситуацию, когда после чтения ошибок запускается второй параллельный цикл.
   */
  async stopPolling() {
    this.isPolling = false;
    if (this.pollPromise) {
      try { await this.pollPromise; } catch (e) {}
    }
  }

  async _pollLoop() {
    let failures = 0;
    let lastTesterPresent = Date.now();
    this.adcCycleCounter = 0;
    this.regHoldCounter = 0;
    let prefetched = null; // { target: '2101' | '2103', promise: Promise<string> }

    const drainPrefetched = async () => {
      if (!prefetched) return;
      const pending = prefetched.promise;
      prefetched = null;
      try { await pending; } catch (e) {}
    };

    try {
      while (this.isPolling && this.elm.isConnected) {
        try {
          // РАЗДЕЛЬНЫЙ ОПРОС ЭКРАНОВ (КАК В OPENDIAG):
          // 1. На вкладках Ошибок, Тестов или Терминала фоновый циклический опрос 2101/2103 приостанавливается,
          // чтобы не занимать шину K-Line и исключить коллизии с ручными сервисными запросами.
          if (this.currentTab === 'tab-dtc' || this.currentTab === 'tab-actuators' || this.currentTab === 'tab-terminal') {
            if (prefetched) {
              await drainPrefetched();
            }
            if (this.currentTab === 'tab-actuators' && this.activeRegulator) {
              // Удержание активной уставки регулятора (обороты ХХ, РХХ, адсорбер) каждые 650 мс или мгновенно по кнопкам +/-
              if (this._forceRegulatorSend || Date.now() - lastTesterPresent > 650) {
                const forceNow = this._forceRegulatorSend;
                this._forceRegulatorSend = false;
                this.regHoldCounter = (this.regHoldCounter || 0) + 1;

                // Каждые 4 цикла удержания проверяем скорость по кадру 21 01 для защиты при начале движения
                if (!forceNow && this.regHoldCounter % 4 === 0 && this.activeRegulator) {
                  try {
                    const checkData = await this.m73.readConfiguredCycle('2101');
                    if (checkData) this.updateActuatorLiveBar(checkData);
                    if (checkData && checkData.speed > 0 && this.activeRegulator) {
                      const movingReg = this.activeRegulator;
                      this.activeRegulator = null;
                      this._updateRegulatorUI(movingReg.key, false);
                      await this.m73.releaseActuatorControl(movingReg.idHex);
                      this.elm.log('warn', 'Движение автомобиля (Speed > 0): удержание регулятора автоматически отключено');
                      lastTesterPresent = Date.now();
                      await this.delay(120);
                      continue;
                    }
                  } catch (e) {}
                }

                if (this.activeRegulator) {
                  try {
                    await this.m73.setActuatorSetpoint(this.activeRegulator.idHex, this.activeRegulator.rawByte);
                    lastTesterPresent = Date.now();
                  } catch (e) {
                    // Если ЭБУ отклонил удержание (например, 7F 30 22 при нажатии на педаль газа) — снимаем статус «Удерживается»
                    if (this.activeRegulator) {
                      const failedReg = this.activeRegulator;
                      this.activeRegulator = null;
                      this._updateRegulatorUI(failedReg.key, false);
                      try { await this.m73.releaseActuatorControl(failedReg.idHex); } catch (e2) {}
                      this.elm.log('warn', 'ЭБУ прекратил удержание регулятора: ' + (e.message || e));
                    }
                  }
                }
              }
            } else if (this.currentTab === 'tab-actuators' && Date.now() - lastTesterPresent > 1500) {
              // На вкладке Тесты (когда регулятор в режиме «Штатно (ЭБУ)») раз в 1.5 сек опрашиваем 21 01:
              // обновляет актуальные обороты/скорость и гарантирует выход М73 из режима 0x30 IOControl
              try {
                const actData = await this.m73.readConfiguredCycle('2101');
                if (!actData) throw new Error("Пустой кадр 21 01");
                this.updateActuatorLiveBar(actData);
                lastTesterPresent = Date.now();
                if (failures >= 3) {
                  this.connStateText.textContent = "Подключено к ЭБУ";
                  this.connIndicator.className = 'status-pulse connected';
                }
                failures = 0;
              } catch (e) {
                const alive = await this.m73.checkEcuAlive();
                if (!alive) throw new Error("Нет ответа ЭБУ на TesterPresent (3E)");
                lastTesterPresent = Date.now();
                if (failures >= 3) {
                  this.connStateText.textContent = "Подключено к ЭБУ";
                  this.connIndicator.className = 'status-pulse connected';
                }
                failures = 0;
              }
            } else if (Date.now() - lastTesterPresent > 2000) {
              // Раз в 2 секунды отправляем легкий Tester Present (3E), чтобы сессия ЭБУ не закрылась по таймауту
              const alive = await this.m73.checkEcuAlive();
              if (!alive) throw new Error("Нет ответа ЭБУ на TesterPresent (3E)");
              lastTesterPresent = Date.now();
              if (failures >= 3) {
                this.connStateText.textContent = "Подключено к ЭБУ";
                this.connIndicator.className = 'status-pulse connected';
              }
              failures = 0;
            }
            await this.delay(120);
            continue;
          }

          // 2. Логика строго раздельного опроса (1 вкладка = 1 кадр) с конвейерным предзапросом (Request Pipelining v55.2):
          if (this.currentTab === 'tab-dashboard') {
            // Главная панель: опрашиваем ИСКЛЮЧИТЕЛЬНО Кадр 1 (21 01) на максимальной скорости K-Line.
            // Как только байты текущего ответа приняты из BLE, мгновенно запускаем следующий запрос 21011,
            // чтобы адаптер ELM327 и ЭБУ М73 общались по K-Line параллельно с парсингом, рендерингом DOM/Canvas и записью лога на CPU iPhone!
            let raw1;
            if (prefetched && prefetched.target === '2101') {
              const p = prefetched.promise;
              prefetched = null;
              raw1 = await p;
            } else {
              await drainPrefetched();
              raw1 = await this.m73.sendRawFrame('2101');
            }

            if (
              this.isPolling &&
              this.elm.isConnected &&
              !this.isActuatorBusy &&
              this.currentTab === 'tab-dashboard' &&
              this.m73.isRawFrameValidForPipeline('2101', raw1)
            ) {
              const nextPromise = this.m73.sendRawFrame('2101');
              nextPromise.catch(() => {});
              prefetched = { target: '2101', promise: nextPromise };
            }

            const data = await this.m73.commitRawFrame('2101', raw1);
            if (data) {
              // Мгновенный микро-рендеринг с Dirty Checking (<0.3 мс) и фиксация в лог параллельно с K-Line запросом следующего кадра
              this.updateDashboardUI(data);
              this.logger.addPoint(data);
            } else {
              await drainPrefetched();
              throw new Error("Пустой кадр 21 01");
            }
          } else if (this.currentTab === 'tab-adc') {
            // Вкладка АЦП: опрашиваем СТРОГО короткий Кадр 3 (21 03 / 21031) с конвейерным предзапросом (Request Pipelining)
            let rawAdc;
            if (prefetched && prefetched.target === '2103') {
              const p = prefetched.promise;
              prefetched = null;
              rawAdc = await p;
            } else {
              await drainPrefetched();
              rawAdc = await this.m73.sendRawFrame('2103');
            }

            if (
              this.isPolling &&
              this.elm.isConnected &&
              !this.isActuatorBusy &&
              this.currentTab === 'tab-adc' &&
              this.m73.isRawFrameValidForPipeline('2103', rawAdc)
            ) {
              const nextPromise = this.m73.sendRawFrame('2103');
              nextPromise.catch(() => {});
              prefetched = { target: '2103', promise: nextPromise };
            }

            const dataAdc = await this.m73.commitRawFrame('2103', rawAdc);
            if (dataAdc) {
              this.updateAdcUI(dataAdc);
              const oscModalOpen = Boolean(
                this.widgetManager &&
                this.widgetManager.modalOsc &&
                this.widgetManager.modalOsc.classList.contains('open')
              );
              const adcCompatibleOsc = this.widgetManager && (
                this.widgetManager.oscChannel === 'o2Volt' ||
                this.widgetManager.oscChannel === 'o2Volt2' ||
                this.widgetManager.oscChannel === 'volt'
              );
              if (oscModalOpen && adcCompatibleOsc) {
                this.widgetManager.feedOscilloscope({ adc: dataAdc.adc });
              }
              // Всегда обновляем частоту опроса (Гц / мс) и таймер кадра без записи пустых точек в лог
              this.logger.updateCadenceOnly();
            } else {
              await drainPrefetched();
              throw new Error("Пустой кадр АЦП 21 03");
            }
          }

          if (failures >= 3) {
            this.connStateText.textContent = "Подключено к ЭБУ";
            this.connIndicator.className = 'status-pulse connected';
          }
          failures = 0;
          lastTesterPresent = Date.now();
        } catch (err) {
          await drainPrefetched();
          failures++;
          if (failures === 3) {
            this.connStateText.textContent = "ЭБУ не отвечает";
            this.connIndicator.className = 'status-pulse reconnecting';
            this._updateText(this.hzValue, "0.0");
            this._updateText(this.msValue, "0");
            if (this.logger && typeof this.logger.resetCadence === 'function') {
              this.logger.resetCadence();
            }
          }

          // В Ладе Приоре разъём OBD-II запитан от постоянных +12В АКБ, поэтому при выключении зажигания
          // Bluetooth-адаптер остаётся подключённым, а ЭБУ перестаёт отвечать. Сохраняем контрольную точку лога поездки!
          if ((failures === 3 || failures === 8) && this.logger.isRecording && this.logger.records.length >= 2) {
            try {
              const saved = await this.logger.saveCheckpoint(this.peakRpm || 0);
              if (saved) {
                this.lastAutoSavedTrip = saved;
                this.refreshHistoryCount();
              }
            } catch (e) {}
          }

          // Автовосстановление K-Line сессии при серии сбоев:
          if (failures === 6) {
            try { await this.elm.send("3E", 500); } catch (e) {}
          } else if (failures >= 10 && failures % 10 === 0) {
            try {
              this.elm.log('info', 'Попытка автовосстановления сессии K-Line (AT FI)...');
              const fiResp = await this.elm.send("ATFI", 2000);
              if (this.m73.isFastInitResponseOk(fiResp)) {
                await this.elm.send("ATH0", 1000); // Обязательно выключаем заголовки после реконнекта
              } else {
                this.elm.log('warn', `AT FI не восстановил сессию: ${fiResp || 'нет ответа'}`);
              }
            } catch (e) {}
          }
          await this.delay(failures < 5 ? 80 : 250);
        }
      }
    } finally {
      await drainPrefetched();
      // Цикл завершён (обрыв связи или остановка)
      this.isPolling = false;
    }
  }

  /**
   * Вспомогательные методы ультра-быстрого обновления DOM с Dirty Checking (v54.5):
   * Исключают холостые мутации DOM (70-80% экономии процессорного времени)
   */
  _updateText(el, val) {
    if (!el || val === undefined || val === null) return;
    const str = typeof val === 'string' ? val : String(val);
    if (el.textContent !== str) {
      el.textContent = str;
    }
  }

  _setStyle(el, prop, val) {
    if (!el) return;
    if (el['_lastStyle_' + prop] !== val) {
      el['_lastStyle_' + prop] = val;
      el.style[prop] = val;
    }
  }

  _setClass(el, className, condition) {
    if (!el) return;
    const has = Boolean(condition);
    if (el.classList.contains(className) !== has) {
      if (has) el.classList.add(className);
      else el.classList.remove(className);
    }
  }

  /**
   * Обновление живой мини-панели телеметрии во вкладке Тесты
   */
  updateActuatorLiveBar(data) {
    if (!data) return;
    if (this.actLiveRpm && data.rpm !== undefined) this._updateText(this.actLiveRpm, `${data.rpm} об/мин`);
    if (this.actLiveTemp && data.temp !== undefined) this._updateText(this.actLiveTemp, `${data.temp} °C`);
    if (this.actLiveIac && data.iacSteps !== undefined) this._updateText(this.actLiveIac, `${data.iacSteps} ш.`);
    if (this.actLiveVolt && data.voltage !== undefined) this._updateText(this.actLiveVolt, `${data.voltage.toFixed(1)} В`);
  }

  /**
   * Обновление счётчика ошибок DTC на иконке нижнего дока
   */
  updateDockDtcBadge(count) {
    if (!this.dockDtcBadge) return;
    const num = Number(count) || 0;
    if (num > 0) {
      this._updateText(this.dockDtcBadge, String(num));
      this._setStyle(this.dockDtcBadge, 'display', 'inline-block');
    } else {
      this._setStyle(this.dockDtcBadge, 'display', 'none');
    }
  }

  /**
   * Отрисовка значений приборной панели (с поддержкой Dirty Checking v54.7)
   */
  updateDashboardUI(data) {
    if (!data) return;

    // Обороты (Аппаратное ускорение через transform: scaleX для 120 FPS + реактивное свечение зоны оборотов)
    this._updateText(this.valRpm, data.rpm);
    if (data.rpm > this.peakRpm) {
      this.peakRpm = data.rpm;
      if (this.valPeakRpm) {
        this._updateText(this.valPeakRpm, `Пик: ${this.peakRpm}`);
      }
    }
    if (this.barRpm) {
      const rpmRatio = Math.min(1, Math.max(0, data.rpm / 6800));
      this._setStyle(this.barRpm, 'transform', `scaleX(${rpmRatio})`);
    }
    if (this.heroCardRpm) {
      this._setClass(this.heroCardRpm, 'rpm-zone-power', data.rpm >= 2800 && data.rpm < 5200);
      this._setClass(this.heroCardRpm, 'rpm-zone-redline', data.rpm >= 5200);
    }

    // Скорость и передача
    this._updateText(this.valSpeed, data.speed);
    this._updateText(this.valThrottleSub, `${data.throttle}%`);
    const gear = this.estimateGear(data.rpm, data.speed);
    this._updateText(this.valGearAux, `КПП: ${gear}`);

    // ДМРВ и цикловой расход
    this._updateText(this.valMaf, data.maf.toFixed(1));
    this._updateText(this.valCycleAir, data.cycleAir.toFixed(1));

    // УОЗ и отскок детонации (симметричный сплит-виджет v49)
    this._updateText(this.valSpark, `${data.spark.toFixed(1)}°`);
    if (this.valRetard) {
      const isKnock = Math.abs(data.sparkRetard) > 0.05;
      this._updateText(this.valRetard, isKnock ? `-${Math.abs(data.sparkRetard).toFixed(1)}°` : `0.0°`);
      this._setClass(this.valRetard, 'active-knock', isKnock);
    }
    if (this.cardSpark) {
      const isKnock = Math.abs(data.sparkRetard) > 0.05;
      this._setClass(this.cardSpark, 'alert-knock', isKnock);
    }

    // Впрыск и форсунки (с цветовой индикацией высокой нагрузки)
    this._updateText(this.valInjTime, data.injTime.toFixed(2));
    this._updateText(this.valDuty, `${data.dutyCycle.toFixed(1)}%`);
    if (this.valDuty) {
      const dutyColor = data.dutyCycle >= 85
        ? 'var(--apple-rose)'
        : (data.dutyCycle >= 70 ? 'var(--apple-amber)' : 'var(--text-primary)');
      this._setStyle(this.valDuty, 'color', dutyColor);
    }
    this._updateText(this.valFuelRate, data.fuelRate.toFixed(2));
    this._updateText(this.valIac, data.iacSteps);

    // Топливные адаптации смеси (Мультипликатив и Аддитив, Кадр 21 01)
    if (this.valMultAdapt && data.multAdapt !== undefined && data.multAdapt !== null) {
      this._updateText(this.valMultAdapt, data.multAdapt.toFixed(3));
      const color = (data.multAdapt >= 0.95 && data.multAdapt <= 1.05)
        ? 'var(--apple-green)'
        : ((data.multAdapt >= 0.88 && data.multAdapt <= 1.12) ? 'var(--apple-amber)' : 'var(--apple-rose)');
      this._setStyle(this.valMultAdapt, 'color', color);
    }
    if (this.valAddAdapt && data.addAdapt !== undefined && data.addAdapt !== null) {
      const sign = data.addAdapt > 0 ? '+' : '';
      this._updateText(this.valAddAdapt, `${sign}${data.addAdapt.toFixed(2)}%`);
      const absAdd = Math.abs(data.addAdapt);
      const color = absAdd <= 3.0 ? 'var(--apple-green)' : (absAdd <= 7.0 ? 'var(--apple-amber)' : 'var(--apple-rose)');
      this._setStyle(this.valAddAdapt, 'color', color);
    }

    // Дроссель и температура ОЖ (Аппаратное ускорение + градация нормы/перегрева)
    this._updateText(this.valThrottle, data.throttle.toFixed(1));
    this._updateText(this.valTemp, data.temp);
    if (this.valTemp) {
      const tempCol = data.temp >= 103
        ? 'var(--apple-rose)'
        : (data.temp >= 97 ? 'var(--apple-amber)' : (data.temp < 60 && data.rpm > 300 ? '#64D2FF' : 'var(--text-primary)'));
      this._setStyle(this.valTemp, 'color', tempCol);
    }
    if (this.barTemp) {
      const tempRatio = Math.max(0, Math.min(1, (data.temp - 40) / 75));
      this._setStyle(this.barTemp, 'transform', `scaleX(${tempRatio})`);
      const bg = data.temp >= 103
        ? 'var(--apple-rose)'
        : (data.temp >= 96 ? 'var(--apple-amber)' : 'linear-gradient(90deg, var(--apple-blue), var(--apple-green))');
      this._setStyle(this.barTemp, 'background', bg);
    }
    this._updateText(this.valVoltage, data.voltage.toFixed(1));
    if (this.valVoltage) {
      const voltCol = data.rpm > 300
        ? (data.voltage >= 13.8 && data.voltage <= 14.7
          ? 'var(--apple-green)'
          : (data.voltage < 13.2 || data.voltage > 14.8 ? 'var(--apple-rose)' : 'var(--apple-amber)'))
        : (data.voltage >= 12.2 ? 'var(--text-primary)' : 'var(--apple-amber)');
      this._setStyle(this.valVoltage, 'color', voltCol);
    }

    // ДТВ (Температура впускного воздуха)
    if (data.intakeTemp !== undefined && data.intakeTemp !== null) {
      this._updateText(this.valIntakeTemp, data.intakeTemp.toFixed(1));
      if (this.valIntakeTemp) {
        const intakeCol = data.intakeTemp >= 75
          ? 'var(--apple-rose)'
          : (data.intakeTemp >= 55 ? 'var(--apple-amber)' : (data.intakeTemp < -25 ? '#64D2FF' : 'var(--text-primary)'));
        this._setStyle(this.valIntakeTemp, 'color', intakeCol);
      }
    }

    // ДНД (Датчик неровной дороги, вертикальное ускорение кузова)
    if (data.roughRoad !== undefined && data.roughRoad !== null) {
      const gVal = data.roughRoad;
      const sign = gVal > 0 ? '+' : '';
      this._updateText(this.valRoughRoad, `${sign}${gVal.toFixed(2)}g`);
      this._setStyle(this.valRoughRoad, 'color', Math.abs(gVal) >= 0.5 ? 'var(--apple-amber)' : 'var(--text-primary)');
    }

    // Новые параметры v32
    if (data.frlLoad !== undefined) this._updateText(this.valFrlLoad, data.frlLoad.toFixed(1));
    if (data.calcLoad !== undefined) this._updateText(this.valCalcLoad, data.calcLoad.toFixed(1));
    const isO2OscActive = !this.widgetManager || this.widgetManager.oscChannel === 'o2Volt';
    if (data.o2Volt !== undefined && isO2OscActive) {
      this._updateText(this.valO2Volt, data.o2Volt.toFixed(3));
      const col = data.o2Volt >= 0.6 ? 'var(--apple-green)' : (data.o2Volt <= 0.3 ? 'var(--apple-blue)' : 'var(--text-primary)');
      this._setStyle(this.valO2Volt, 'color', col);
    }
    if (data.o2Volt2 !== undefined) {
      this._updateText(this.valO2Volt2, data.o2Volt2.toFixed(3));
      if (this.valO2Volt2) {
        const o2Col2 = (data.o2Volt2 < 0.05 || data.o2Volt2 > 0.95)
          ? 'var(--apple-rose)'
          : ((data.o2Volt2 >= 0.55 && data.o2Volt2 <= 0.78)
            ? 'var(--apple-green)'
            : ((data.o2Volt2 >= 0.40 && data.o2Volt2 < 0.55) ? 'var(--apple-amber)' : 'var(--text-primary)'));
        this._setStyle(this.valO2Volt2, 'color', o2Col2);
      }
    }
    if (data.lambdaCorr !== undefined) this._updateText(this.valLambdaCorr, data.lambdaCorr.toFixed(3));
    if (data.targetLambda !== undefined) this._updateText(this.valTargetLambda, data.targetLambda.toFixed(3));
    if (data.purgeRate !== undefined) this._updateText(this.valPurgeRate, data.purgeRate.toFixed(1));
    if (data.altitudeFactor !== undefined) this._updateText(this.valAltitude, data.altitudeFactor.toFixed(3));

    // Флаги состояния (быстрый dirty check)
    if (data.flags) {
      this.setFlag(this.flagIdle, data.flags.idle);
      this.setFlag(this.flagLambda, data.flags.lambda);
      this.setFlag(this.flagKnock, data.flags.knock);
      this.setFlag(this.flagFuelCut, data.flags.fuelCut);
      if (this.flagPump) this.setFlag(this.flagPump, data.flags.fuelPump);
      if (this.flagFan1) this.setFlag(this.flagFan1, data.flags.fan1);
      if (this.flagFan2) this.setFlag(this.flagFan2, data.flags.fan2);
      if (this.flagMil) this.setFlag(this.flagMil, data.flags.mil);
      if (this.flagO2Ready) this.setFlag(this.flagO2Ready, data.flags.o2Ready);
      if (this.flagAc) this.setFlag(this.flagAc, data.flags.acRequest || data.flags.acAllowed);
    }

    if (data.dtcCount !== undefined) {
      this.updateDockDtcBadge(data.dtcCount);
    }
    this.updateActuatorLiveBar(data);

    // Пропуски зажигания (Кадр 21 01)
    if (data.misfires && this.misCyl1) {
      this.updateMisfireBox(this.misCyl1, data.misfires.cyl1);
      this.updateMisfireBox(this.misCyl2, data.misfires.cyl2);
      this.updateMisfireBox(this.misCyl3, data.misfires.cyl3);
      this.updateMisfireBox(this.misCyl4, data.misfires.cyl4);
      if (this.misCycle && (data.misfires.total !== undefined || data.misfires.cycle !== undefined)) {
        this._updateText(this.misCycle, data.misfires.total !== undefined ? data.misfires.total : data.misfires.cycle);
      }
    }

    // Обновление модульной системы виджетов и осциллографа ДК1
    if (this.widgetManager) {
      this.widgetManager.updateDynamicWidgets(data);
    }
  }

  /**
   * Отрисовка напряжений каналов АЦП (Кадр 21 03) и оценка здоровья датчиков
   */
  updateAdcUI(data) {
    if (!data || !data.adc) return;
    const adc = data.adc;

    const mafV = Number(adc.maf);
    const tpsV = Number(adc.tps);
    const tempV = Number(adc.temp);
    const airV = adc.airTemp !== undefined ? Number(adc.airTemp) : null;
    const roughV = adc.roughRoad !== undefined ? Number(adc.roughRoad) : null;
    const o2V = Number(adc.o2);
    const o2_2V = adc.o2_2 !== undefined ? Number(adc.o2_2) : null;
    const voltV = Number(adc.volt);

    this._updateText(this.adcMaf, `${mafV.toFixed(3)} В`);
    this._updateText(this.adcThrottle, `${tpsV.toFixed(3)} В`);
    this._updateText(this.adcTemp, `${tempV.toFixed(3)} В`);
    if (airV !== null) this._updateText(this.adcAirTemp, `${airV.toFixed(3)} В`);
    if (roughV !== null) this._updateText(this.adcRoughRoad, `${roughV.toFixed(3)} В`);
    this._updateText(this.adcO2, `${o2V.toFixed(3)} В`);
    if (o2_2V !== null) this._updateText(this.adcO2_2, `${o2_2V.toFixed(3)} В`);
    this._updateText(this.adcVolt, `${voltV.toFixed(2)} В`);

    // Вычисляем здоровье каждого датчика и обновляем бейджи со сводкой
    this.evaluateAdcHealth(data);
  }

  evaluateAdcHealth(data) {
    if (!data || !data.adc) return;
    const adc = data.adc;
    const mafV = Number(adc.maf);
    const voltV = Number(adc.volt);
    // Приоритет — свежие обороты из 21 01 (если кадр моложе 4 с), иначе оценка по АЦП с допуском просадки генератора (>= 11.2 В при активном ДМРВ)
    const hasFresh2101 = Boolean(this.m73 && this.m73._lastFrame2101At && (Date.now() - this.m73._lastFrame2101At <= 4000));
    const isRunning = hasFresh2101
      ? (Number(this.m73.latestData.rpm) > 300)
      : (voltV >= 13.35 || (mafV >= 1.22 && mafV <= 4.50 && voltV >= 11.2));

    let countOk = 0;
    let countWarn = 0;
    let countDanger = 0;

    const setBadge = (badgeEl, descEl, status, badgeText, descText, barEl = null, ratio = 0) => {
      if (!badgeEl) return;
      const nextClass = `badge-health badge-health-${status}`;
      if (badgeEl.className !== nextClass) badgeEl.className = nextClass;
      const nextHtml = `<span class="badge-dot"></span>${badgeText}`;
      if (badgeEl._lastHtml !== nextHtml) {
        badgeEl._lastHtml = nextHtml;
        badgeEl.innerHTML = nextHtml;
      }
      if (descEl && descText) this._updateText(descEl, descText);
      if (barEl) {
        const clamped = status === 'neutral' ? 0 : Math.max(0.04, Math.min(1, ratio));
        this._setStyle(barEl, 'transform', `scaleX(${clamped.toFixed(3)})`);
        const fillClass = `adc-mini-fill fill-${status === 'neutral' ? 'info' : status}`;
        if (barEl.className !== fillClass) barEl.className = fillClass;
      }
      if (status === 'ok') countOk++;
      else if (status === 'warn') countWarn++;
      else if (status === 'danger') countDanger++;
    };

    // 1. ДМРВ (Bosch HFM5 0 280 218 116)
    const mafRatio = isRunning ? (mafV / 5.0) : Math.min(1, Math.max(0, (mafV - 0.95) / 0.15));
    if (!isRunning) {
      if (mafV >= 0.996 && mafV <= 1.020) {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'ok', 'Идеал', 'Покой: Новый датчик (0.996 ... 1.020 В)', this.barAdcMaf, mafRatio);
        this._setStyle(this.adcMaf, 'color', 'var(--apple-green)');
      } else if (mafV >= 1.021 && mafV <= 1.035) {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'ok', 'Норма', 'Покой: Рабочий датчик (1.021 ... 1.035 В)', this.barAdcMaf, mafRatio);
        this._setStyle(this.adcMaf, 'color', 'var(--apple-green)');
      } else if (mafV >= 1.036 && mafV <= 1.050) {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'warn', 'Износ', 'Покой: Износ кристалла. Повышенный расход топлива', this.barAdcMaf, mafRatio);
        this._setStyle(this.adcMaf, 'color', 'var(--apple-amber)');
      } else if (mafV > 1.050) {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'danger', 'Неисправен', 'Покой: Критический дрейф нуля (>1.050В). Требуется замена', this.barAdcMaf, mafRatio);
        this._setStyle(this.adcMaf, 'color', 'var(--apple-rose)');
      } else {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'danger', 'Ошибка нуля', 'Покой: Напряжение ниже нормы (<0.996В). Проверьте массы', this.barAdcMaf, mafRatio);
        this._setStyle(this.adcMaf, 'color', 'var(--apple-rose)');
      }
    } else {
      if (mafV >= 1.01 && mafV <= 4.80) {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'ok', 'Активен', 'Двигатель запущен: динамический отклик расхода воздуха', this.barAdcMaf, mafRatio);
        this._setStyle(this.adcMaf, 'color', 'var(--apple-green)');
      } else {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'danger', 'Выход за пределы', 'Напряжение вне рабочего диапазона', this.barAdcMaf, mafRatio);
        this._setStyle(this.adcMaf, 'color', 'var(--apple-rose)');
      }
    }

    // 2. ДПДЗ (Датчик положения дроссельной заслонки)
    const tpsV = Number(adc.tps);
    const tpsRatio = tpsV / 5.0;
    if (tpsV >= 0.35 && tpsV <= 0.65) {
      setBadge(this.healthAdcThrottle, this.descAdcThrottle, 'ok', 'Закрыта (0%)', 'Калибровка нуля заслонки в норме (0.35 ... 0.65 В)', this.barAdcThrottle, tpsRatio);
    } else if (tpsV > 0.65 && tpsV <= 0.75) {
      setBadge(this.healthAdcThrottle, this.descAdcThrottle, 'warn', 'Смещение нуля', 'Возможен перетяг троса газа или нагар на упоре дросселя', this.barAdcThrottle, tpsRatio);
    } else if (tpsV > 0.75 && tpsV <= 4.70) {
      const openPct = Math.min(100, Math.max(0, ((tpsV - 0.5) / 4.0) * 100)).toFixed(0);
      setBadge(this.healthAdcThrottle, this.descAdcThrottle, 'info', `Открыта (~${openPct}%)`, 'Дроссельная заслонка открыта, сигнал изменяется плавно', this.barAdcThrottle, tpsRatio);
    } else if (tpsV < 0.35) {
      setBadge(this.healthAdcThrottle, this.descAdcThrottle, 'danger', 'КЗ на массу', 'Напряжение < 0.35 В. Замыкание сигнального провода на корпус', this.barAdcThrottle, tpsRatio);
    } else {
      setBadge(this.healthAdcThrottle, this.descAdcThrottle, 'danger', 'Обрыв цепи', 'Напряжение > 4.70 В. Обрыв сигнального провода или массы', this.barAdcThrottle, tpsRatio);
    }

    // 3. Бортовая сеть (АКБ / Генератор)
    const voltRatio = Math.max(0, Math.min(1, (voltV - 10.0) / 5.5));
    if (!isRunning) {
      if (voltV >= 12.4) {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'ok', 'АКБ заряжен', 'Покой: Напряжение батареи в норме (80-100% заряда)', this.barAdcVolt, voltRatio);
      } else if (voltV >= 12.0) {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'warn', 'Разряжен АКБ', 'Покой: Низкое напряжение батареи (требуется подзарядка)', this.barAdcVolt, voltRatio);
      } else {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'danger', 'Глубокий разряд', 'Покой: Напряжение АКБ < 12.0 В. Риск отказа запуска', this.barAdcVolt, voltRatio);
      }
    } else {
      if (voltV >= 13.8 && voltV <= 14.7) {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'ok', 'Зарядка ОК', 'Работа: Генератор выдает стабильные 13.8 ... 14.7 В', this.barAdcVolt, voltRatio);
      } else if (voltV >= 13.2 && voltV < 13.8) {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'warn', 'Под нагрузкой', 'Работа: Небольшая просадка напряжения генератора', this.barAdcVolt, voltRatio);
      } else if (voltV < 13.2) {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'danger', 'Недозаряд', 'Работа: Генератор не справляется (<13.2В). Проверьте ремень/щетки', this.barAdcVolt, voltRatio);
      } else {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'danger', 'Перезаряд', 'Работа: Опасное перенапряжение (>14.7В). Пробит реле-регулятор', this.barAdcVolt, voltRatio);
      }
    }

    // 4. ДТОЖ (Охлаждающая жидкость)
    const tempV = Number(adc.temp);
    const tempRatio = tempV / 5.0;
    if (tempV >= 0.20 && tempV <= 4.80) {
      setBadge(this.healthAdcTemp, this.descAdcTemp, 'ok', 'Цепь исправна', 'Терморезистор ДТОЖ в пределах рабочего диапазона', this.barAdcTemp, tempRatio);
    } else if (tempV > 4.80) {
      setBadge(this.healthAdcTemp, this.descAdcTemp, 'danger', 'Обрыв цепи (5В)', 'Опорное напряжение 5.0 В. Обрыв провода датчика', this.barAdcTemp, tempRatio);
    } else {
      setBadge(this.healthAdcTemp, this.descAdcTemp, 'danger', 'КЗ на массу (0В)', 'Замыкание сигнальной цепи ДТОЖ на массу автомобиля', this.barAdcTemp, tempRatio);
    }

    // 5. ДТВ (Температура впускного воздуха)
    if (adc.airTemp === undefined || adc.airTemp === null) {
      setBadge(this.healthAdcAirTemp, this.descAdcAirTemp, 'neutral', 'Нет данных', 'Канал ДТВ не передан в ответе ЭБУ', this.barAdcAirTemp, 0);
    } else {
      const airV = Number(adc.airTemp);
      const airRatio = airV / 5.0;
      if (airV >= 0.20 && airV <= 4.80) {
        setBadge(this.healthAdcAirTemp, this.descAdcAirTemp, 'ok', 'Цепь исправна', 'Терморезистор воздуха в рабочем диапазоне', this.barAdcAirTemp, airRatio);
      } else if (airV > 4.80) {
        setBadge(this.healthAdcAirTemp, this.descAdcAirTemp, 'danger', 'Обрыв цепи (5В)', 'Опорные 5.0 В. Обрыв проводки ДТВ', this.barAdcAirTemp, airRatio);
      } else {
        setBadge(this.healthAdcAirTemp, this.descAdcAirTemp, 'danger', 'КЗ на массу (0В)', 'Замыкание цепи датчика температуры воздуха на массу', this.barAdcAirTemp, airRatio);
      }
    }

    // 6. ДК1 (Управляющий лямбда-зонд с анализом амплитуды скользящего окна)
    const o2V = Number(adc.o2);
    const o2Ratio = o2V / 1.0;
    if (!this._o2AdcWindow) this._o2AdcWindow = [];
    if (!Number.isNaN(o2V)) {
      this._o2AdcWindow.push(o2V);
      if (this._o2AdcWindow.length > 15) this._o2AdcWindow.shift();
    }
    let o2Min = o2V;
    let o2Max = o2V;
    for (let i = 0; i < this._o2AdcWindow.length; i++) {
      const v = this._o2AdcWindow[i];
      if (v < o2Min) o2Min = v;
      if (v > o2Max) o2Max = v;
    }
    const isO2Oscillating = this._o2AdcWindow.length >= 4 && (o2Max - o2Min) >= 0.25;

    if (o2V >= 0.42 && o2V <= 0.48) {
      if (isO2Oscillating) {
        setBadge(this.healthAdcO2, this.descAdcO2, 'ok', 'Регулирование', 'Активное переключение лямбда-зонда (0.1 ... 0.9 В)', this.barAdcO2, o2Ratio);
      } else {
        setBadge(this.healthAdcO2, this.descAdcO2, 'warn', 'Прогрев / Опорное', 'Опорные ~0.45 В. Зонд прогревается или смесь разомкнута', this.barAdcO2, o2Ratio);
      }
    } else if (o2V >= 0.05 && o2V < 0.42) {
      setBadge(this.healthAdcO2, this.descAdcO2, 'ok', 'Бедная смесь', 'Сигнал ДК1 в диапазоне бедной смеси (0.1 ... 0.4 В)', this.barAdcO2, o2Ratio);
    } else if (o2V > 0.48 && o2V <= 0.95) {
      setBadge(this.healthAdcO2, this.descAdcO2, 'ok', 'Богатая смесь', 'Сигнал ДК1 в диапазоне богатой смеси (0.5 ... 0.9 В)', this.barAdcO2, o2Ratio);
    } else {
      setBadge(this.healthAdcO2, this.descAdcO2, 'danger', 'Залипание сигнала', 'Выход сигнала за пределы рабочего диапазона 0.05-0.95В', this.barAdcO2, o2Ratio);
    }

    // 7. ДК2 (Диагностический лямбда-зонд)
    if (adc.o2_2 === undefined || adc.o2_2 === null) {
      setBadge(this.healthAdcO2_2, this.descAdcO2_2, 'neutral', 'Нет данных', 'Канал ДК2 не передан в ответе ЭБУ', this.barAdcO2_2, 0);
    } else {
      const o2_2V = Number(adc.o2_2);
      const o2_2Ratio = o2_2V / 1.0;
      if (o2_2V >= 0.55 && o2_2V <= 0.78) {
        setBadge(this.healthAdcO2_2, this.descAdcO2_2, 'ok', 'Катализатор ОК', 'Стабильный уровень напряжения после исправного нейтрализатора', this.barAdcO2_2, o2_2Ratio);
      } else if (o2_2V >= 0.42 && o2_2V <= 0.48) {
        setBadge(this.healthAdcO2_2, this.descAdcO2_2, 'warn', 'Прогрев / Опорное', 'Опорное напряжение ненагретого зонда', this.barAdcO2_2, o2_2Ratio);
      } else if (o2_2V >= 0.05 && o2_2V < 0.55) {
        setBadge(this.healthAdcO2_2, this.descAdcO2_2, 'warn', 'Бедный отклик', 'Напряжение ниже нормы для нейтрализатора', this.barAdcO2_2, o2_2Ratio);
      } else if (o2_2V > 0.78 && o2_2V <= 0.95) {
        setBadge(this.healthAdcO2_2, this.descAdcO2_2, 'warn', 'Богатый отклик', 'Повышенный уровень напряжения ДК2', this.barAdcO2_2, o2_2Ratio);
      } else {
        setBadge(this.healthAdcO2_2, this.descAdcO2_2, 'danger', 'Ошибка сигнала', 'Выход за допустимые пределы', this.barAdcO2_2, o2_2Ratio);
      }
    }

    // 8. ДНД (Датчик неровной дороги)
    if (adc.roughRoad === undefined || adc.roughRoad === null) {
      setBadge(this.healthAdcRoughRoad, this.descAdcRoughRoad, 'neutral', 'Нет данных', 'Канал ДНД не передан в ответе ЭБУ', this.barAdcRoughRoad, 0);
    } else {
      const roughV = Number(adc.roughRoad);
      const roughRatio = roughV / 5.0;
      if (roughV >= 2.20 && roughV <= 2.80) {
        setBadge(this.healthAdcRoughRoad, this.descAdcRoughRoad, 'ok', 'Покой (~2.5 В)', 'Опорное напряжение акселерометра в норме (2.5 В)', this.barAdcRoughRoad, roughRatio);
      } else if (roughV >= 0.50 && roughV <= 4.50) {
        setBadge(this.healthAdcRoughRoad, this.descAdcRoughRoad, 'info', 'Динамика дороги', 'Акселерометр фиксирует ускорения и вибрации подвески', this.barAdcRoughRoad, roughRatio);
      } else {
        setBadge(this.healthAdcRoughRoad, this.descAdcRoughRoad, 'danger', 'Ошибка ДНД', 'Выход опорного напряжения за физический предел датчика', this.barAdcRoughRoad, roughRatio);
      }
    }

    // Обновление счетчиков
    this._updateText(this.adcCountOk, countOk);
    this._updateText(this.adcCountWarn, countWarn);
    this._updateText(this.adcCountDanger, countDanger);

    // Обновление верхнего статусного орба и подзаголовка
    if (this.adcSummaryOrb && this.adcSummaryText) {
      if (countDanger > 0) {
        if (this.adcSummaryOrb.className !== 'adc-status-orb status-orb-danger') {
          this.adcSummaryOrb.className = 'adc-status-orb status-orb-danger';
        }
        this._updateText(this.adcSummaryText, `Обнаружены неисправности цепей: ${countDanger} датч.`);
      } else if (countWarn > 0) {
        if (this.adcSummaryOrb.className !== 'adc-status-orb status-orb-warn') {
          this.adcSummaryOrb.className = 'adc-status-orb status-orb-warn';
        }
        this._updateText(this.adcSummaryText, `Есть предупреждения по датчикам: ${countWarn} откл.`);
      } else {
        if (this.adcSummaryOrb.className !== 'adc-status-orb status-orb-ok') {
          this.adcSummaryOrb.className = 'adc-status-orb status-orb-ok';
        }
        this._updateText(this.adcSummaryText, 'Все электрические цепи датчиков соответствуют норме М73');
      }
    }
  }

  estimateGear(rpm, speed) {
    if (speed < 5 || rpm < 700) return "нейтраль";
    const ratio = rpm / speed;
    if (ratio > 175 || ratio < 21) return "нейтраль";
    if (ratio > 95) return "1";
    if (ratio > 58) return "2";
    if (ratio > 40) return "3";
    if (ratio > 28.5) return "4";
    return "5";
  }

  updateMisfireBox(el, val) {
    if (!el || val === undefined || val === null) return;
    const str = String(val);
    if (el.textContent !== str) {
      el.textContent = str;
      if (Number(val) > 0) el.classList.add('has-misfires');
      else el.classList.remove('has-misfires');
    }
  }

  setFlag(element, isActive) {
    if (!element) return;
    const activeBool = Boolean(isActive);
    if (element.classList.contains('active') !== activeBool) {
      if (activeBool) element.classList.add('active');
      else element.classList.remove('active');
    }
  }

  startLogging() {
    this.logger.start();
    if (this.btnToggleLog) this.btnToggleLog.classList.add('active');
    if (this.recBtnLabel) this.recBtnLabel.textContent = "Остановить";
    if (this.loggerStatusDot) this.loggerStatusDot.classList.add('recording');
    if (this.btnExportCsv) this.btnExportCsv.disabled = true;
    if (this.btnExportXlsx) this.btnExportXlsx.disabled = true;
    if (this.tripSavedAlert) this.tripSavedAlert.style.display = 'none';
  }

  async stopLogging() {
    const saved = await this.logger.stop(this.peakRpm || 0);
    if (this.btnToggleLog) this.btnToggleLog.classList.remove('active');
    if (this.recBtnLabel) this.recBtnLabel.textContent = "Начать запись";
    if (this.loggerStatusDot) this.loggerStatusDot.classList.remove('recording');
    if (this.loggerStatsText) this.loggerStatsText.textContent = `Запись завершена • ${this.logger.records.length} точек`;
    if (this.btnExportCsv) this.btnExportCsv.disabled = this.logger.records.length === 0;
    if (this.btnExportXlsx) this.btnExportXlsx.disabled = this.logger.records.length === 0;
    if (saved) {
      this.lastAutoSavedTrip = saved;
      this.showTripSavedBanner(saved);
      this.refreshHistoryCount();
    }
    return saved;
  }

  async toggleLogging() {
    if (!this.logger.isRecording) {
      if (this.logger.records && this.logger.records.length > 0) {
        if (!confirm(`Предыдущая сессия содержит ${this.logger.records.length} точек. Начать новую запись? Предыдущий лог будет очищен.`)) {
          return;
        }
      }
      this.startLogging();
    } else {
      await this.stopLogging();
    }
  }

  showTripSavedBanner(trip) {
    if (!this.tripSavedAlert) return;
    this.tripSavedDetails.textContent = `${trip.pointCount} точек • ${trip.dateStr} (Пик: ${trip.maxRpm || 0} об/мин)`;
    this.tripSavedAlert.style.display = 'flex';
  }

  async refreshHistoryCount() {
    try {
      const trips = await this.logger.storage.getAllTripsMeta();
      if (this.historyCount) this.historyCount.textContent = trips.length;
    } catch (e) {}
  }

  async openHistoryModal() {
    if (this.historyModal) this.historyModal.classList.add('open');
    await this.refreshHistory();
  }

  closeHistoryModal() {
    if (this.historyModal) this.historyModal.classList.remove('open');
  }

  async refreshHistory() {
    try {
      const trips = await this.logger.storage.getAllTripsMeta();
      if (this.historyCount) this.historyCount.textContent = trips.length;

      if (!this.historyList) return;

      if (trips.length === 0) {
        this.historyList.innerHTML = '<div class="empty-state-card">История поездок пуста</div>';
        if (this.btnClearHistory) this.btnClearHistory.style.display = 'none';
        return;
      }

      if (this.btnClearHistory) this.btnClearHistory.style.display = 'block';
      this.historyList.innerHTML = trips.map(t => `
        <div class="history-item">
          <div class="history-info">
            <span class="history-date">${t.dateStr}</span>
            <span class="history-meta">${t.pointCount} точек • Пик: ${t.maxRpm || 0} об/мин</span>
          </div>
          <div class="history-actions">
            <button class="glass-btn btn-primary-glass btn-compact" onclick="M73App.exportHistoryTrip(${t.id}, 'csv')" title="Скачать компактный CSV">CSV</button>
            <button class="glass-btn btn-glass-secondary btn-compact" onclick="M73App.exportHistoryTrip(${t.id}, 'xlsx')" title="Скачать таблицу Excel">XLSX</button>
            <button class="glass-btn btn-glass-danger btn-compact" onclick="M73App.deleteHistoryTrip(${t.id})" title="Удалить">&times;</button>
          </div>
        </div>
      `).join('');
    } catch (e) {
      if (this.historyList) {
        const errDiv = document.createElement('div');
        errDiv.className = 'empty-state-card';
        errDiv.style.color = 'var(--apple-rose)';
        errDiv.textContent = 'Ошибка: ' + (e && e.message ? e.message : e);
        this.historyList.innerHTML = '';
        this.historyList.appendChild(errDiv);
      }
    }
  }

  async exportHistoryTrip(id, format = 'csv') {
    try {
      const trip = await this.logger.storage.getTrip(id);
      if (trip && trip.records) {
        if (format === 'xlsx') {
          await this.logger.exportToXlsx(trip.records, trip.fileName);
        } else {
          await this.logger.exportToCsv(trip.records, trip.fileName);
        }
      }
    } catch (e) {
      alert("Ошибка экспорта: " + e.message);
    }
  }

  async deleteHistoryTrip(id) {
    if (confirm("Удалить эту поездку из памяти?")) {
      await this.logger.storage.deleteTrip(id);
      await this.refreshHistory();
    }
  }

  async readDtc() {
    if (!this.elm.isConnected) {
      alert("Сначала подключитесь к адаптеру");
      return;
    }
    if (this.isActuatorBusy) {
      alert("Шина K-Line занята завершением предыдущей команды, подождите");
      return;
    }

    this.isActuatorBusy = true;
    this.dtcList.innerHTML = '<div class="empty-state-card">Опрос памяти ошибок ЭБУ...</div>';
    
    const prevPolling = this.isPolling || this.shouldBeConnected;
    await this.stopPolling();

    try {
      const errors = await this.m73.readDtcCodes();
      this.updateDockDtcBadge(errors.length);
      if (errors.length === 0) {
        const hrs = this.m73.latestData && this.m73.latestData.timeSinceResetHours !== undefined
          ? `Время наработки после сброса: ${Number(this.m73.latestData.timeSinceResetHours).toFixed(1)} ч`
          : 'Память неисправностей чиста, все цепи исправны';
        this.dtcList.innerHTML = `
          <div class="dtc-clean-card">
            <div class="dtc-clean-shield" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
            </div>
            <div class="dtc-clean-body">
              <strong>Ошибок в ЭБУ не обнаружено</strong>
              <span>${hrs}</span>
            </div>
          </div>
        `;
      } else {
        this.dtcList.innerHTML = errors.map(e => {
          const badgeClass = e.isActive ? 'badge-health-danger' : 'badge-health-warn';
          const itemClass = e.isActive ? 'dtc-item dtc-item-active' : 'dtc-item dtc-item-stored';
          const statusLabel = e.statusText || 'Сохранённая';
          return `
          <div class="${itemClass}">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
              <div class="dtc-code" style="margin-bottom: 0;">${e.code}</div>
              <span class="badge-health ${badgeClass}">${statusLabel}</span>
            </div>
            <div class="dtc-desc">${e.desc}</div>
          </div>
        `;
        }).join('');
      }
    } catch (err) {
      const errDiv = document.createElement('div');
      errDiv.className = 'empty-state-card';
      errDiv.style.color = 'var(--apple-rose)';
      errDiv.textContent = 'Ошибка чтения: ' + (err && err.message ? err.message : err);
      this.dtcList.innerHTML = '';
      this.dtcList.appendChild(errDiv);
    } finally {
      await this._finishBusy(prevPolling);
    }
  }

  async clearDtc() {
    if (!this.elm.isConnected) {
      alert("Сначала подключитесь к адаптеру");
      return;
    }
    if (this.isActuatorBusy) {
      alert("Шина K-Line занята завершением предыдущей команды, подождите");
      return;
    }
    if (!confirm("Вы действительно хотите сбросить ошибки в контроллере?")) return;
    
    this.isActuatorBusy = true;
    const prevPolling = this.isPolling || this.shouldBeConnected;
    await this.stopPolling();

    let clearedOk = false;
    try {
      const ok = await this.m73.clearDtcCodes();
      if (ok) {
        clearedOk = true;
        this.updateDockDtcBadge(0);
      } else {
        alert("Контроллер отклонил команду сброса");
      }
    } catch (err) {
      alert("Ошибка сброса: " + err.message);
    } finally {
      await this._finishBusy(prevPolling && !clearedOk);
    }

    if (clearedOk && this.elm.isConnected) {
      await this.readDtc();
      alert("Ошибки успешно сброшены!");
    }
  }
  adjustRegulator(key, delta) {
    const limits = {
      idleRpm: { min: 600, max: 1800, unit: 'об/мин', elId: 'regValIdleRpm', toRaw: (v) => Math.round(v / 10) },
      rxx:     { min: 10,  max: 200,  unit: 'шагов',  elId: 'regValRxx',     toRaw: (v) => Math.round(v) },
      purge:   { min: 0,   max: 100,  unit: '%',      elId: 'regValPurge',   toRaw: (v) => Math.round(v) }
    };
    const cfg = limits[key];
    if (!cfg) return;

    this.regulatorValues[key] = Math.max(cfg.min, Math.min(cfg.max, this.regulatorValues[key] + delta));
    const el = document.getElementById(cfg.elId);
    if (el) el.textContent = `${this.regulatorValues[key]} ${cfg.unit}`;

    // Если этот регулятор уже удерживается — сразу обновляем целевой байт и взводим флаг мгновенной отправки в _pollLoop
    // без блокировки isActuatorBusy, чтобы кнопка «Штатно (ЭБУ)» срабатывала мгновенно в любую долю секунды!
    if (this.activeRegulator && this.activeRegulator.key === key) {
      this.activeRegulator.rawByte = cfg.toRaw(this.regulatorValues[key]);
      this._forceRegulatorSend = true;
    }
  }

  async applyRegulator(key, skipConfirm = false) {
    if (!this.elm.isConnected) return alert("Адаптер не подключен к ЭБУ");
    if (this.isActuatorBusy) return;

    const map = {
      idleRpm: { idHex: '42', toRaw: (v) => Math.round(v / 10), statusId: 'regStatusIdleRpm', cardId: 'regCardIdleRpm' },
      rxx:     { idHex: '41', toRaw: (v) => Math.round(v),      statusId: 'regStatusRxx',     cardId: 'regCardRxx' },
      purge:   { idHex: '43', toRaw: (v) => Math.round(v),      statusId: 'regStatusPurge',   cardId: 'regCardPurge' }
    };
    const cfg = map[key];
    if (!cfg) return;

    // 1. Запрашиваем подтверждение пользователя ДО остановки опроса и блокировки канала,
    // чтобы пока открыт системный диалог confirm(), цикл продолжал поддерживать K-Line сессию!
    if (!skipConfirm) {
      if (!confirm("Внимание! Ручное управление уставками разрешено выполнять только на стоянке автомобиля. Применить выбранное значение?")) {
        return;
      }
      if (!this.elm.isConnected || this.isActuatorBusy) return;
    }

    this.isActuatorBusy = true;
    this._cancelRegulatorRequested = false;
    const prevPolling = this.isPolling || this.shouldBeConnected;
    await this.stopPolling();

    try {
      // 2. Опрашиваем свежий кадр 21 01 и убеждаемся, что автомобиль стоит на месте
      if (!skipConfirm) {
        let freshData = null;
        try {
          freshData = await this.m73.readConfiguredCycle('2101');
          if (freshData) this.updateActuatorLiveBar(freshData);
        } catch (e) {}

        if (!freshData) {
          alert("Не удалось проверить текущую скорость автомобиля (ЭБУ не ответил на запрос 21 01). Проверьте зажигание.");
          return;
        }
        if (freshData.speed > 0) {
          alert("Внимание! Ручное управление уставками разрешено только на стоянке (скорость 0 км/ч). При движении автомобиля управление блокируется в целях безопасности.");
          return;
        }
      } else if (this.m73.latestData && this.m73.latestData.speed > 0) {
        return;
      }

      // Если во время проверки пользователь переключил вкладку или нажал «Штатно (ЭБУ)» — выходим
      if (this._cancelRegulatorRequested) {
        this.activeRegulator = null;
        this._updateRegulatorUI(key, false);
        return;
      }

      // Если был активен другой регулятор — сначала отпускаем его
      if (this.activeRegulator && this.activeRegulator.key !== key) {
        await this.m73.releaseActuatorControl(this.activeRegulator.idHex);
        this._updateRegulatorUI(this.activeRegulator.key, false);
        this.activeRegulator = null;
      }

      const rawByte = cfg.toRaw(this.regulatorValues[key]);
      await this.m73.setActuatorSetpoint(cfg.idHex, rawByte);

      // Если во время ожидания ответа пользователь нажал «Штатно (ЭБУ)» или сменил вкладку — немедленно возвращаем управление ЭБУ
      if (this._cancelRegulatorRequested) {
        this._pendingReleases.add(cfg.idHex); // уставка уже ушла — вернуть управление в _finishBusy()
        this.activeRegulator = null;
        this._updateRegulatorUI(key, false);
      } else {
        const latestByte = cfg.toRaw(this.regulatorValues[key]);
        this.activeRegulator = { key, idHex: cfg.idHex, rawByte: latestByte };
        this._updateRegulatorUI(key, true);
      }
    } catch (err) {
      alert("Ошибка установки параметра: " + err.message);
    } finally {
      await this._finishBusy(prevPolling);
    }
  }

  // Отправляет отложенные «30 <ID> 00» (отмена пришла, пока канал был занят) и освобождает канал
  async _finishBusy(prevPolling) {
    try {
      const ids = [...this._pendingReleases];
      this._pendingReleases.clear();
      if (this.elm.isConnected) {
        for (const id of ids) {
          try { await this.m73.releaseActuatorControl(id); } catch (e) {}
        }
      }
    } finally {
      this.isActuatorBusy = false;
      if (prevPolling && this.elm.isConnected) {
        this.startContinuousPolling();
      }
    }
  }

  async releaseRegulator(key) {
    const idMap = { idleRpm: '42', rxx: '41', purge: '43' };
    const idHex = idMap[key];
    if (!idHex) return;

    // Взводим флаг отмены на случай, если applyRegulator сейчас находится в процессе отправки
    this._cancelRegulatorRequested = true;
    this._forceRegulatorSend = false;
    if (this.activeRegulator && this.activeRegulator.key === key) {
      this.activeRegulator = null;
    }
    this._updateRegulatorUI(key, false);

    // Канал занят: запоминаем возврат управления, его гарантированно отправит _finishBusy() владельца канала
    if (this.isActuatorBusy) {
      this._pendingReleases.add(idHex);
      return;
    }
    this.isActuatorBusy = true;

    const prevPolling = this.isPolling || this.shouldBeConnected;
    await this.stopPolling();

    try {
      if (this.elm.isConnected) {
        await this.m73.releaseActuatorControl(idHex);
      }
    } catch (e) {} finally {
      await this._finishBusy(prevPolling);
    }
  }

  _updateRegulatorUI(key, isActive) {
    const uiMap = {
      idleRpm: { statusId: 'regStatusIdleRpm', cardId: 'regCardIdleRpm' },
      rxx:     { statusId: 'regStatusRxx',     cardId: 'regCardRxx' },
      purge:   { statusId: 'regStatusPurge',   cardId: 'regCardPurge' }
    };
    const cfg = uiMap[key];
    if (!cfg) return;
    const statusEl = document.getElementById(cfg.statusId);
    const cardEl = document.getElementById(cfg.cardId);
    if (statusEl) {
      statusEl.innerHTML = isActive ? '<span class="badge-dot"></span>Удерживается' : '<span class="badge-dot"></span>Штатно (ЭБУ)';
      statusEl.className = `badge-health ${isActive ? 'badge-health-ok' : 'badge-health-neutral'}`;
    }
    if (cardEl) {
      cardEl.classList.toggle('regulator-active', isActive);
    }
  }

  async testActuator(testType, btnEl = null) {
    if (!this.elm.isConnected) return alert("Адаптер не подключен к ЭБУ");
    if (this.isActuatorBusy) {
      alert("Идёт тест механизма, подождите");
      return;
    }

    // Вентиляторы 1 и 2 скорости и лампа Check Engine безопасны и разрешены в том числе на заведённом двигателе (на стоянке)
    const ALLOWED_ON_RUNNING_ENGINE = new Set(['fan1_on', 'fan2_on', 'mil_test']);
    const allowRunning = ALLOWED_ON_RUNNING_ENGINE.has(testType);

    // 1. Запрашиваем подтверждение пользователя ДО остановки опроса и блокировки шины
    const confirmMsg = allowRunning
      ? "Внимание! Тест механизма разрешено выполнять на стоянке автомобиля (скорость 0 км/ч). Запустить проверку?"
      : "Внимание! Тест этого механизма разрешено выполнять только на стоянке при заглушенном двигателе (0 об/мин) и включенном зажигании. Запустить тест?";
    if (!confirm(confirmMsg)) {
      return;
    }
    if (!this.elm.isConnected || this.isActuatorBusy) return;

    this.isActuatorBusy = true;
    const prevPolling = this.isPolling || this.shouldBeConnected;
    await this.stopPolling();

    try {
      // Если был активен плавный регулятор — сначала отпускаем его
      if (this.activeRegulator) {
        const prevKey = this.activeRegulator.key;
        const prevIdHex = this.activeRegulator.idHex;
        this.activeRegulator = null;
        this._updateRegulatorUI(prevKey, false);
        try { await this.m73.releaseActuatorControl(prevIdHex); } catch (e) {}
      }

      // 2. Сразу после подтверждения опрашиваем свежий кадр 21 01 (обязательная проверка реальных оборотов и скорости)
      let freshData = null;
      try {
        freshData = await this.m73.readConfiguredCycle('2101');
        if (freshData) this.updateActuatorLiveBar(freshData);
      } catch (e) {}

      if (!freshData) {
        alert("Не удалось считать текущее состояние двигателя (ЭБУ не ответил на запрос 21 01). Проверьте, включено ли зажигание.");
        return;
      }

      // 3. Проверка условий безопасности:
      // - Для всех тестов обязательна стоянка автомобиля (speed === 0)
      // - Для форсунок, катушек, бензонасоса, кондиционера и стартера двигатель должен быть заглушен (rpm === 0)
      if (freshData.speed > 0) {
        alert("Внимание! Любые тесты исполнительных механизмов разрешены только на СТОЯНКЕ автомобиля (скорость 0 км/ч)!");
        return;
      }
      if (!allowRunning && freshData.rpm > 0) {
        alert("Внимание! Тесты форсунок, катушек зажигания, бензонасоса, кондиционера и стартера разрешены только при ЗАГЛУШЕННОМ двигателе (0 об/мин) и включенном зажигании!\n\nНа заведённом моторе разрешены тесты Вентиляторов 1/2 и Лампы Check Engine.");
        return;
      }

      // 4. Даем шине 150 мс тишины для исключения коллизий пакетов
      await this.delay(150);

      const origBtnHtml = btnEl ? btnEl.innerHTML : '';
      const itemCard = btnEl ? btnEl.closest('.actuator-item-glass, .actuator-card-compact') : null;
      if (btnEl) {
        btnEl.disabled = true;
        const isCompact = btnEl.classList.contains('btn-sm');
        btnEl.innerHTML = isCompact ? '<span class="act-spinner" style="margin: 0;"></span>' : '<span class="act-spinner"></span>Активно...';
        btnEl.classList.add('actuator-btn-running');
      }
      if (itemCard) itemCard.classList.add('actuator-item-running');

      try {
        if (this.connStateText) this.connStateText.textContent = "Выполняется тест...";
        await this.m73.runActuatorTest(testType);
      } catch (err) {
        alert("Ошибка выполнения теста: " + err.message);
      } finally {
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.innerHTML = origBtnHtml;
          btnEl.classList.remove('actuator-btn-running');
        }
        if (itemCard) itemCard.classList.remove('actuator-item-running');
        if (this.elm.isConnected && this.connStateText) {
          this.connStateText.textContent = "Подключено к ЭБУ";
        }
      }
    } finally {
      await this._finishBusy(prevPolling);
    }
  }


  async resetWithInit() {
    if (!this.elm.isConnected) return alert("Адаптер не подключен");
    if (this.isActuatorBusy) {
      alert("Идёт тест механизма, подождите");
      return;
    }

    // 1. Запрашиваем подтверждение пользователя ДО остановки шины и блокировки канала
    if (!confirm("Внимание! Будут сброшены таблицы самообучения топлива и угла зажигания М73 к заводским значениям. Двигатель должен быть заглушен, зажигание включено. Продолжить?")) {
      return;
    }
    if (!this.elm.isConnected || this.isActuatorBusy) return;

    this.isActuatorBusy = true;
    const prevPolling = this.isPolling || this.shouldBeConnected;
    await this.stopPolling();

    let sessionEnded = false;
    try {
      // 2. Опрашиваем актуальный статус перед сбросом (проверка заглушен ли мотор и стоит ли машина)
      let freshData = null;
      try {
        freshData = await this.m73.readConfiguredCycle('2101');
      } catch (e) {}

      if (!freshData) {
        alert("Не удалось проверить состояние двигателя (нет ответа от ЭБУ). Проверьте, включено ли зажигание.");
        return;
      }

      // 3. Проверка условий безопасности: сброс ЭБУ разрешен ТОЛЬКО при RPM == 0 и SPEED == 0
      if (freshData.rpm > 0 || freshData.speed > 0) {
        alert("Внимание! Сброс ЭБУ с инициализацией разрешен только на СТОЯНКЕ (скорость 0 км/ч) при ЗАГЛУШЕННОМ двигателе (обороты 0) и включенном зажигании!\n\nПерезапуск контроллера при заведённом двигателе или во время движения строго запрещен.");
        return;
      }

      const ok = await this.m73.resetWithInit();
      if (ok) {
        // После сброса ЭБУ закрывает диагностическую сессию — опрос продолжать бессмысленно
        sessionEnded = true;
        this.userExplicitDisconnect = true;
        await this.elm.disconnect();
        await this.handleDisconnectedState();
        alert("Сброс с инициализацией выполнен! Выключите зажигание на 10 секунд, затем включите и подключитесь заново.");
      } else {
        alert("ЭБУ не подтвердил сброс (подробности во вкладке «Терминал»).");
      }
    } catch (err) {
      alert("Ошибка сброса: " + err.message);
    } finally {
      if (sessionEnded) {
        this._pendingReleases.clear();
        this.isActuatorBusy = false;
      } else {
        await this._finishBusy(prevPolling);
      }
    }
  }

  switchTab(tabId) {
    const prevTab = this.currentTab;
    if (prevTab === 'tab-actuators' && tabId !== 'tab-actuators') {
      if (this.activeRegulator) {
        this.releaseRegulator(this.activeRegulator.key);
      } else if (this.isActuatorBusy) {
        this._cancelRegulatorRequested = true;
      }
    }
    this.currentTab = tabId;
    if (tabId === 'tab-adc') {
      this._o2AdcWindow = [];
    }
    const isTelemetryTab = tabId === 'tab-dashboard' || tabId === 'tab-adc';
    if (prevTab !== tabId && this.logger) {
      if (!isTelemetryTab) {
        this.logger.resetCadence();
        this._updateText(this.hzValue, "0.0");
        this._updateText(this.msValue, "0");
      } else if (prevTab !== 'tab-dashboard' && prevTab !== 'tab-adc') {
        this.logger.resetCadence();
      }
    }
    if (this.logger && this.logger.isRecording) {
      if (tabId === 'tab-dashboard') {
        this._updateText(this.loggerStatsText, `Идёт запись • ${this.logger.records.length} точек (${this.logger.currentHz} Гц)`);
      } else {
        this._updateText(this.loggerStatsText, `Запись на паузе (откройте «Панель») • ${this.logger.records.length} точек`);
      }
    }
    if (tabId === 'tab-dashboard') {
      if (this.widgetManager) this.widgetManager.ensureOscLoop();
      if (this.m73 && this.m73.latestData) this.updateDashboardUI(this.m73.latestData);
    } else {
      if (this.widgetManager) this.widgetManager.stopOscLoop();
      if (tabId === 'tab-actuators' && this.m73 && this.m73.latestData) {
        this.updateActuatorLiveBar(this.m73.latestData);
      }
    }
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.dock-item').forEach(el => el.classList.remove('active'));

    const targetContent = document.getElementById(tabId);
    const targetNav = document.querySelector(`[data-tab="${tabId}"]`);
    if (targetContent) targetContent.classList.add('active');
    if (targetNav) targetNav.classList.add('active');

    // Обновляем позицию скользящей стеклянной капсулы (Liquid Glider) в нижнем доке
    const dock = document.querySelector('.liquid-dock');
    const tabOrder = ['tab-dashboard', 'tab-dtc', 'tab-adc', 'tab-actuators', 'tab-terminal'];
    const tabIdx = tabOrder.indexOf(tabId);
    if (dock && tabIdx !== -1) {
      dock.style.setProperty('--dock-active-index', String(tabIdx));
    }

    // Гарантированно открываем док при переключении вкладки и перезапускаем таймер
    if (this.resetDockTimer) {
      this.resetDockTimer();
    } else if (dock) {
      dock.classList.remove('dock-hidden');
    }

    // Кнопка настройки виджетов в шапке доступна только на приборной панели
    const btnCustomize = document.getElementById('btnCustomizeDash');
    if (btnCustomize) {
      btnCustomize.style.display = tabId === 'tab-dashboard' ? 'inline-flex' : 'none';
    }
    if (tabId !== 'tab-dashboard' && this.widgetManager && this.widgetManager.isEditMode) {
      this.widgetManager.exitEditMode();
    }

    if (tabId === 'tab-terminal') this.renderTerminal();
  }

  /**
   * Интеллектуальное автоскрытие нижнего парящего дока (v54.7):
   * 1) При скролле вниз док мгновенно и мягко прячется, чтобы не перекрывать нижние карточки и кнопки.
   * 2) При скролле вверх, тапе по экрану или нажатии на нижний стеклянный хэндл (#dockPeekHandle) — мгновенно всплывает.
   * 3) Через 4 секунды покоя в режиме HUD плавно уезжает вниз.
   */
  initDockAutoHide() {
    const dock = document.querySelector('.liquid-dock');
    if (!dock) return;

    let hideTimer = null;
    let lastScrollTop = 0;
    const INACTIVITY_MS = 4000;

    const showDock = () => {
      dock.classList.remove('dock-hidden');
    };

    const hideDock = () => {
      if (this.widgetManager && this.widgetManager.isEditMode) return;
      const modalOpen = document.querySelector('.modal-backdrop.open');
      if (modalOpen) return;

      dock.classList.add('dock-hidden');
    };

    const resetTimer = () => {
      showDock();
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(hideDock, INACTIVITY_MS);
    };

    // Слушаем касания и клики пользователя
    const events = ['pointerdown', 'touchstart', 'click', 'keydown'];
    events.forEach(ev => {
      window.addEventListener(ev, resetTimer, { passive: true, capture: true });
    });

    const scrollView = document.querySelector('.app-scroll-view');
    if (scrollView) {
      scrollView.addEventListener('scroll', () => {
        const st = scrollView.scrollTop || 0;
        if (st > lastScrollTop + 12 && st > 48) {
          // Скролл вниз — сразу прячем док, чтобы не загораживал нижние карточки
          if (hideTimer) clearTimeout(hideTimer);
          hideDock();
        } else if (st < lastScrollTop - 8 || st <= 20) {
          // Скролл вверх или возврат к началу — показываем док
          resetTimer();
        }
        lastScrollTop = Math.max(0, st);
      }, { passive: true });
    }

    if (this.dockPeekHandle) {
      this.dockPeekHandle.addEventListener('click', (e) => {
        e.stopPropagation();
        resetTimer();
      });
    }

    dock.addEventListener('mouseenter', () => {
      if (hideTimer) clearTimeout(hideTimer);
      showDock();
    });
    dock.addEventListener('mouseleave', () => {
      resetTimer();
    });

    resetTimer();

    this.resetDockTimer = resetTimer;
    this.showDock = showDock;
    this.hideDock = hideDock;
  }

  /**
   * Терминал: хранит последние 300 записей в памяти и форматирует строку времени
   * лениво (только при открытии вкладки «Терминал»). Это полностью убирает аллокации
   * new Date() и строковые операции из высокочастотного цикла опроса (v55.2).
   */
  appendTerminal(type, msg) {
    this.termBuffer.push({ type, msg, ts: Date.now(), text: null });
    if (this.termBuffer.length > this.TERM_LIMIT) this.termBuffer.shift();

    if (this.currentTab !== 'tab-terminal' || !this.terminalLog) return;
    this._appendTerminalNode(this.termBuffer[this.termBuffer.length - 1]);
    while (this.terminalLog.childElementCount > this.TERM_LIMIT) {
      this.terminalLog.removeChild(this.terminalLog.firstElementChild);
    }
    this.terminalLog.scrollTop = this.terminalLog.scrollHeight;
  }

  _appendTerminalNode(entry) {
    if (!entry.text) {
      const d = new Date(entry.ts || Date.now());
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      entry.text = `[${time}] ${entry.msg}`;
    }
    const div = document.createElement('div');
    div.className = `log-entry ${entry.type}`;
    div.textContent = entry.text;
    this.terminalLog.appendChild(div);
  }

  renderTerminal() {
    if (!this.terminalLog) return;
    this.terminalLog.innerHTML = "";
    this.termBuffer.forEach(entry => this._appendTerminalNode(entry));
    this.terminalLog.scrollTop = this.terminalLog.scrollHeight;
  }

  clearTerminal() {
    this.termBuffer = [];
    this.terminalLog.innerHTML = "";
  }

  async sendManualCommand() {
    const cmd = this.terminalInput.value.trim();
    if (!cmd) return;
    this.terminalInput.value = "";
    try {
      await this.elm.send(cmd);
      // Ответ автоматически отобразится через callback this.elm.onLog
    } catch (err) {
      this.appendTerminal('err', 'Ошибка отправки: ' + err.message);
    }
  }

  delay(ms) {
    return new Promise(res => setTimeout(res, ms));
  }
}

// Запуск приложения и регистрация оффлайн-кэша
window.addEventListener('DOMContentLoaded', () => {
  const app = new M73Application();
  window.M73App = app;

  // Фоновый прогрев тяжёлой библиотеки SheetJS после первого кадра без задержки старта
  setTimeout(() => {
    if (app.logger && typeof app.logger.ensureXlsxLoaded === 'function') {
      app.logger.ensureXlsxLoaded().catch(() => {});
    }
  }, 1500);

  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const markUpdateReady = () => {
      app._swUpdateReady = true;
      const badgeEl = document.getElementById('appVersionBadge');
      if (badgeEl) {
        badgeEl.classList.add('has-update');
        badgeEl.title = 'Доступно обновление — нажмите для перезагрузки';
      }
    };

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) markUpdateReady();
    });

    navigator.serviceWorker.register('./sw.js').then((reg) => {
      if (reg.waiting && hadController) markUpdateReady();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && (hadController || navigator.serviceWorker.controller)) {
            markUpdateReady();
          }
        });
      });
    }).catch(err => {
      console.log('SW note:', err);
    });
  }
});
