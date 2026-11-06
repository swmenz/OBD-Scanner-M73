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

    // Состояние управления исполнительными механизмами и уставками (v51.3 Mutex)
    this.isActuatorBusy = false;
    this._cancelRegulatorRequested = false;
    this._pendingReleases = new Set(); // ID регуляторов, которые надо вернуть ЭБУ, когда канал освободится
    this.activeRegulator = null; // { key: 'rxx'|'idleRpm'|'purge', idHex: '41'|'42'|'43', rawByte: 0 }
    this.regulatorValues = {
      idleRpm: 880, // об/мин (ID 42, шаг 20/40, диапазон 600..1800)
      rxx: 60,      // шагов (ID 41, шаг 5, диапазон 10..200)
      purge: 20     // % (ID 43, шаг 10, диапазон 0..100)
    };

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
    this.lastAutoSavedTrip = null;

    // Главные приборы
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
    this.valKnockVolt = document.getElementById('valKnockVolt');
    this.valO2Volt = document.getElementById('valO2Volt');
    this.valO2Volt2 = document.getElementById('valO2Volt2');
    this.valLambdaCorr = document.getElementById('valLambdaCorr');
    this.valTargetLambda = document.getElementById('valTargetLambda');
    this.valPurgeRate = document.getElementById('valPurgeRate');
    this.valIdleTarget = document.getElementById('valIdleTarget');
    this.valPower = document.getElementById('valPower');
    this.valTorque = document.getElementById('valTorque');
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

    // Терминал
    this.terminalLog = document.getElementById('terminalLog');
    this.terminalInput = document.getElementById('terminalInput');
  }

  bindEvents() {
    this.btnConnect.addEventListener('click', () => this.toggleConnection());

    const badge = document.getElementById('appVersionBadge');
    if (badge) {
      badge.style.cursor = 'pointer';
      badge.title = 'Нажмите для проверки обновлений';
      badge.addEventListener('click', async () => {
        try {
          if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) await reg.update();
          }
        } catch (e) {}
        alert("Диагностика М73 — Версия v54.3\n\nОбновления:\n1) Исправлена ошибка подключения: устранен сбой 'valPeakRpm is null' при удаленных виджетах приборной панели\n2) Чистый постоянный Турбо-режим AT ST 10 (~64 мс): медленный таймаут AT ST 20 полностью удален из кода\n3) Устранено замедление при сворачивании: сворачивание приложения или переключение на музыку/навигатор больше никогда не переключает адаптер в медленный режим\n4) Максимальная скорость K-Line: стабильные 4.6–4.8 Гц на приборной панели и до 5.1 Гц на вкладке АЦП");
      });
    }

    // Интеллектуальное автоскрытие нижнего дока при отсутствии взаимодействия (HUD режим в поездке)
    this.initDockAutoHide();

    // Режим скорости опроса K-Line: Постоянный Турбо v54.3
    const cadencePill = document.querySelector('.cadence-pill');
    if (cadencePill) {
      cadencePill.title = 'Частота опроса K-Line: Турбо v54.3';
      this.currentSpeedProfile = 'extreme';

      cadencePill.addEventListener('click', () => {
        const suffixInfo = this.m73 && this.m73.singleFrameSuffixSupported === true
          ? "Включен (21011 / 21031, закрытие кадра 0 мс)"
          : (this.m73 && this.m73.singleFrameSuffixSupported === false ? "Отключен адаптером (стандартный 2101)" : "Определяется...");
        alert(
          `⚡ Режим опроса: Постоянный Турбо (Релиз v54.3)\n\n` +
          `• Адаптивный тайминг: AT AT 2\n` +
          `• Таймаут шины: AT ST 10 (~64 мс, постоянный Турбо)\n` +
          `• Замедленный режим AT ST 20: Полностью отключен\n` +
          `• Турбо-суффикс кадра: ${suffixInfo}\n` +
          `• Прямой микро-рендеринг: Dirty Checking (<0.3 мс)\n` +
          `• Частота опроса: 4.6–4.8 Гц (до 5.1 Гц на АЦП)`
        );
      });
    }

    
    document.querySelectorAll('.tabbar-item, .dock-item').forEach(btn => {
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

    this.logger.onStatsUpdate = (stats) => {
      this.hzValue.textContent = stats.hz.toFixed(1);
      this.msValue.textContent = stats.ms;
      if (this.logger.isRecording) {
        this.loggerStatsText.textContent = `Идёт запись • ${stats.count} точек (${stats.hz} Гц)`;
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
      const savedAutoRec = localStorage.getItem('m73_autorecord');
      this.chkAutoRecord.checked = savedAutoRec !== 'false' && savedAutoRec !== '0';
    }

    document.addEventListener('change', (e) => {
      const chk = e.target.closest('#chkAutoRecord');
      if (chk) {
        localStorage.setItem('m73_autorecord', String(chk.checked));
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
          this.modalAdcReference.style.display = 'flex';
          this.modalAdcReference.classList.add('open');
        }
      });
    }
    if (this.btnCloseAdcRef) {
      this.btnCloseAdcRef.addEventListener('click', () => {
        if (this.modalAdcReference) {
          this.modalAdcReference.classList.remove('open');
          this.modalAdcReference.style.display = 'none';
        }
      });
    }
    if (this.modalAdcReference) {
      this.modalAdcReference.addEventListener('click', (e) => {
        if (e.target === this.modalAdcReference) {
          this.modalAdcReference.classList.remove('open');
          this.modalAdcReference.style.display = 'none';
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
    // Если поиск уже идёт — повторное нажатие служит кнопкой быстрой отмены!
    if (this.connecting) {
      this.connecting = false;
      this.userExplicitDisconnect = true;
      this.shouldBeConnected = false;
      this.btnConnect.disabled = false;
      this.btnConnectText.textContent = "Подключить";
      if (this.widgetManager) this.widgetManager.stopOscLoop();
    this.btnConnect.classList.remove('connected');
      this.connIndicator.className = 'status-pulse';
      this.connStateText.textContent = "Не подключено";
      this.elm.log('info', 'Поиск отменён пользователем');
      try { await this.elm.disconnect(); } catch (e) {}
      return;
    }

    if (this.elm.isConnected) {
      // Осознанное отключение пользователем
      this.userExplicitDisconnect = true;
      this.shouldBeConnected = false;
      await this.stopPolling();
      await this.elm.disconnect();
      await this.handleDisconnectedState();
      return;
    }

    this.userExplicitDisconnect = false;
    this.connecting = true;

    // Активируем фоновый хранитель сразу по жесту клика пользователя (требование iOS WebKit)
    this.bgKeeper.start();

    // Оставляем кнопку активной с текстом "Отмена", чтобы пользователь мог прервать поиск в любой момент
    this.btnConnect.disabled = false;
    this.btnConnectText.textContent = "Отмена";

    try {
      await this.elm.requestAndConnect();

      if (!this.connecting || this.userExplicitDisconnect) {
        await this.elm.disconnect();
        return;
      }
      
      this.btnConnectText.textContent = "Связь...";
      await this.m73.initEcu();

      this.shouldBeConnected = true;
      this.btnConnect.classList.add('connected');
      this.btnConnectText.textContent = "Отключить";
      this.connIndicator.className = 'status-pulse connected';
      this.connStateText.textContent = "Подключено к ЭБУ";
      this.btnToggleLog.disabled = false;
      this.peakRpm = 0;
      if (this.valPeakRpm) this.valPeakRpm.textContent = "Пик: 0";

      // Скрываем прошлый баннер о сохранённой поездке
      if (this.tripSavedAlert) this.tripSavedAlert.style.display = 'none';

      // Активируем удержание экрана включенным на приборной панели
      await this.wakeLockMgr.request();

      this.startContinuousPolling();

      // Автозапись при подключении (если тумблер включен)
      if (this.chkAutoRecord && this.chkAutoRecord.checked && !this.logger.isRecording) {
        this.startLogging();
      }
    } catch (err) {
      // Проверяем, была ли это намеренная отмена или закрытие окна пользователем
      const isCancelled = err.isCancelled ||
                          err.name === 'NotFoundError' ||
                          err.name === 'AbortError' ||
                          (err.message && /cancel|отмен|closed|dismiss|abort/i.test(err.message));

      if (!isCancelled) {
        alert(err && err.message ? err.message : "Не удалось найти Bluetooth адаптер");
      }
      this.elm.log('info', isCancelled ? 'Выбор устройства отменен пользователем' : 'Ошибка подключения: ' + (err.message || err));

      // Если Bluetooth уже открыт, а ЭБУ не ответил — закрываем канал
      try { await this.elm.disconnect(); } catch (e) {}
      await this.handleDisconnectedState();
    } finally {
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
          // Канал Bluetooth активен — убеждаемся, что цикл опроса крутится
          if (!this.isPolling) {
            this.elm.log('info', 'Возобновление опроса после возврата в приложение...');
            this.startContinuousPolling();
          }
        }
      }
    }
  }

  async handleWindowFocus() {
    if (this.shouldBeConnected) {
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

    this.isPolling = false;

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
      this.btnToggleLog.disabled = false;
      this.elm.log('info', 'Связь с ЭБУ М73 успешно восстановлена! Логирование продолжается.');

      this.startContinuousPolling();
      await this.wakeLockMgr.request();
    } else {
      this.elm.log('err', 'Не удалось восстановить связь автоматически. Пожалуйста, нажмите "Подключить".');
      this.shouldBeConnected = false;
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
    if (this.widgetManager) this.widgetManager.stopOscLoop();
    this.btnConnect.classList.remove('connected');
    this.btnConnectText.textContent = "Подключить";
    this.connIndicator.className = 'status-pulse';
    this.connStateText.textContent = "Не подключено";
    this.btnToggleLog.disabled = true;
    if (this.btnExportCsv) this.btnExportCsv.disabled = this.logger.records.length === 0;
    if (this.btnExportXlsx) this.btnExportXlsx.disabled = this.logger.records.length === 0;
    this.hzValue.textContent = "0.0";
    this.msValue.textContent = "0";
    this.refreshHistoryCount();
  }

  startContinuousPolling() {
    if (this.isPolling) return this.pollPromise;
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

    while (this.isPolling && this.elm.isConnected) {
      try {
        // РАЗДЕЛЬНЫЙ ОПРОС ЭКРАНОВ (КАК В OPENDIAG):
        // 1. На вкладках Ошибок, Тестов или Терминала фоновый циклический опрос 2101/2103 приостанавливается,
        // чтобы не занимать шину K-Line и исключить коллизии с ручными сервисными запросами.
        if (this.currentTab === 'tab-dtc' || this.currentTab === 'tab-actuators' || this.currentTab === 'tab-terminal') {
          if (this.currentTab === 'tab-actuators' && this.activeRegulator) {
            // Удержание активной уставки регулятора (обороты ХХ, РХХ, адсорбер) каждые 700 мс
            if (Date.now() - lastTesterPresent > 700) {
              try {
                await this.m73.setActuatorSetpoint(this.activeRegulator.idHex, this.activeRegulator.rawByte);
                lastTesterPresent = Date.now();
              } catch (e) {}
            }
          } else if (Date.now() - lastTesterPresent > 2000) {
            // Раз в 2 секунды отправляем легкий Tester Present (3E), чтобы сессия ЭБУ не закрылась по таймауту
            try {
              await this.elm.send("3E", 500);
              lastTesterPresent = Date.now();
            } catch (e) {}
          }
          await this.delay(200);
          continue;
        }

        // 2. Логика строго раздельного опроса (1 вкладка = 1 кадр):
        if (this.currentTab === 'tab-dashboard') {
          // Главная панель: опрашиваем ИСКЛЮЧИТЕЛЬНО Кадр 1 (21 01) на максимальной скорости K-Line
          const data = await this.m73.readConfiguredCycle('2101');
          if (this.widgetManager && this.widgetManager.oscChannel === 'mafAdc') {
            try { await this.m73.readConfiguredCycle('2103'); } catch (e) {}
          }
          if (data) {
            // Мгновенный микро-рендеринг с Dirty Checking (<0.3 мс) и фиксация в лог
            this.updateDashboardUI(data);
            this.logger.addPoint(data);
          } else {
            throw new Error("Пустой кадр 21 01");
          }
        } else if (this.currentTab === 'tab-adc') {
          // Вкладка АЦП: опрашиваем Кадр 3 (21 03) для оценки напряжений датчиков
          // Каждые 4 цикла также быстро считываем 21 01, чтобы обновить RPM и записать полную точку в лог
          if ((this.adcCycleCounter || 0) % 4 === 0) {
            try {
              const data2101 = await this.m73.readConfiguredCycle('2101');
              if (data2101 && this.logger.isRecording) {
                this.logger.addPoint(data2101);
              }
            } catch (e) {}
          }
          this.adcCycleCounter = (this.adcCycleCounter || 0) + 1;
          const dataAdc = await this.m73.readConfiguredCycle('2103');
          if (dataAdc) {
            this.updateAdcUI(dataAdc);
            if (this.widgetManager) {
              this.widgetManager.updateDynamicWidgets(dataAdc);
            }
            // Всегда обновляем частоту опроса (Гц / мс) и таймер кадра без записи пустых точек в лог
            this.logger.updateCadenceOnly();
          } else {
            throw new Error("Пустой кадр АЦП 21 03");
          }
        }

        if (failures >= 5) this.connStateText.textContent = "Подключено к ЭБУ";
        failures = 0;
        lastTesterPresent = Date.now();
      } catch (err) {
        failures++;
        if (failures === 5) this.connStateText.textContent = "ЭБУ не отвечает";

        // Автовосстановление K-Line сессии при серии сбоев:
        if (failures === 6) {
          try { await this.elm.send("3E", 500); } catch (e) {}
        } else if (failures >= 10 && failures % 10 === 0) {
          try {
            this.elm.log('info', 'Попытка автовосстановления сессии K-Line (AT FI)...');
            await this.elm.send("ATFI", 2000);
            await this.elm.send("ATH0", 1000); // Обязательно выключаем заголовки после реконнекта
          } catch (e) {}
        }
        await this.delay(failures < 5 ? 80 : 250);
      }
    }

    // Цикл завершён (обрыв связи или остановка)
    this.isPolling = false;
  }

  /**
   * Вспомогательные методы ультра-быстрого обновления DOM с Dirty Checking (v54):
   * Исключают холостые мутации DOM (70-80% экономии процессорного времени)
   */
  _updateText(el, val) {
    if (!el || val === undefined || val === null) return;
    const str = typeof val === 'string' ? val : String(val);
    if (el._lastVal !== str) {
      el._lastVal = str;
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
    if (el['_lastClass_' + className] !== has) {
      el['_lastClass_' + className] = has;
      if (has) el.classList.add(className);
      else el.classList.remove(className);
    }
  }

  /**
   * Отрисовка значений приборной панели (с поддержкой Dirty Checking v54.3)
   */
  updateDashboardUI(data) {
    if (!data) return;

    // Обороты (Аппаратное ускорение через transform: scaleX для 120 FPS)
    this._updateText(this.valRpm, data.rpm);
    if (this.valPeakRpm && data.rpm > this.peakRpm) {
      this.peakRpm = data.rpm;
      this._updateText(this.valPeakRpm, `Пик: ${this.peakRpm}`);
    }
    if (this.barRpm) {
      const rpmRatio = Math.min(1, Math.max(0, data.rpm / 6800));
      this._setStyle(this.barRpm, 'transform', `scaleX(${rpmRatio})`);
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

    // Впрыск и форсунки
    this._updateText(this.valInjTime, data.injTime.toFixed(2));
    this._updateText(this.valDuty, `${data.dutyCycle.toFixed(1)}%`);
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
    if (this.barTemp) {
      const tempRatio = Math.max(0, Math.min(1, (data.temp - 40) / 75));
      this._setStyle(this.barTemp, 'transform', `scaleX(${tempRatio})`);
      const bg = data.temp >= 103
        ? 'var(--apple-rose)'
        : (data.temp >= 96 ? 'var(--apple-amber)' : 'linear-gradient(90deg, var(--apple-blue), var(--apple-green))');
      this._setStyle(this.barTemp, 'background', bg);
    }
    this._updateText(this.valVoltage, data.voltage.toFixed(1));

    // ДТВ (Температура впускного воздуха)
    if (data.intakeTemp !== undefined && data.intakeTemp !== null) {
      this._updateText(this.valIntakeTemp, data.intakeTemp.toFixed(1));
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
    if (data.knockVolt !== undefined) {
      this._updateText(this.valKnockVolt, data.knockVolt.toFixed(3));
      const col = data.knockVolt > 1.2 ? 'var(--apple-rose)' : (data.knockVolt > 0.7 ? 'var(--apple-amber)' : 'var(--text-primary)');
      this._setStyle(this.valKnockVolt, 'color', col);
    }
    const isO2OscActive = !this.widgetManager || this.widgetManager.oscChannel === 'o2Volt';
    if (data.o2Volt !== undefined && isO2OscActive) {
      this._updateText(this.valO2Volt, data.o2Volt.toFixed(3));
      const col = data.o2Volt >= 0.6 ? 'var(--apple-green)' : (data.o2Volt <= 0.3 ? 'var(--apple-blue)' : 'var(--text-primary)');
      this._setStyle(this.valO2Volt, 'color', col);
    }
    if (data.o2Volt2 !== undefined) this._updateText(this.valO2Volt2, data.o2Volt2.toFixed(3));
    if (data.lambdaCorr !== undefined) this._updateText(this.valLambdaCorr, data.lambdaCorr.toFixed(3));
    if (data.targetLambda !== undefined) this._updateText(this.valTargetLambda, data.targetLambda.toFixed(3));
    if (data.purgeRate !== undefined) this._updateText(this.valPurgeRate, data.purgeRate.toFixed(1));
    if (data.idleTarget !== undefined) this._updateText(this.valIdleTarget, data.idleTarget);
    if (data.enginePower !== undefined) this._updateText(this.valPower, data.enginePower.toFixed(1));
    if (data.engineTorque !== undefined) this._updateText(this.valTorque, data.engineTorque.toFixed(1));
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

    if (this.adcMaf) this.adcMaf.textContent = `${mafV.toFixed(3)} В`;
    if (this.adcThrottle) this.adcThrottle.textContent = `${tpsV.toFixed(3)} В`;
    if (this.adcTemp) this.adcTemp.textContent = `${tempV.toFixed(3)} В`;
    if (this.adcAirTemp && airV !== null) this.adcAirTemp.textContent = `${airV.toFixed(3)} В`;
    if (this.adcRoughRoad && roughV !== null) this.adcRoughRoad.textContent = `${roughV.toFixed(3)} В`;
    if (this.adcO2) this.adcO2.textContent = `${o2V.toFixed(3)} В`;
    if (this.adcO2_2 && o2_2V !== null) this.adcO2_2.textContent = `${o2_2V.toFixed(3)} В`;
    if (this.adcVolt) this.adcVolt.textContent = `${voltV.toFixed(2)} В`;

    // Вычисляем здоровье каждого датчика и обновляем бейджи со сводкой
    this.evaluateAdcHealth(data);
  }

  evaluateAdcHealth(data) {
    if (!data || !data.adc) return;
    const adc = data.adc;
    const rpm = (this.m73.latestData && this.m73.latestData.rpm) || 0;
    const volt = Number(adc.volt) || 0;
    const isRunning = rpm > 300;

    let countOk = 0;
    let countWarn = 0;
    let countDanger = 0;

    const setBadge = (badgeEl, descEl, status, badgeText, descText) => {
      if (!badgeEl) return;
      badgeEl.className = `badge-health badge-health-${status}`;
      badgeEl.textContent = badgeText;
      if (descEl && descText) descEl.textContent = descText;
      if (status === 'ok') countOk++;
      else if (status === 'warn') countWarn++;
      else if (status === 'danger') countDanger++;
    };

    // 1. ДМРВ (Bosch HFM5 0 280 218 116)
    const mafV = Number(adc.maf);
    if (!isRunning) {
      if (mafV >= 0.996 && mafV <= 1.020) {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'ok', '🟢 Идеал', 'Покой: Новый датчик (0.996 ... 1.020 В)');
        if (this.adcMaf) this.adcMaf.style.color = 'var(--apple-green)';
      } else if (mafV >= 1.021 && mafV <= 1.035) {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'ok', '🟢 Норма', 'Покой: Рабочий датчик (1.021 ... 1.035 В)');
        if (this.adcMaf) this.adcMaf.style.color = 'var(--apple-green)';
      } else if (mafV >= 1.036 && mafV <= 1.050) {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'warn', '🟡 Износ', 'Покой: Износ кристалла. Повышенный расход топлива');
        if (this.adcMaf) this.adcMaf.style.color = 'var(--apple-amber)';
      } else if (mafV > 1.050) {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'danger', '🔴 Неисправен', 'Покой: Критический дрейф нуля (>1.050В). Требуется замена');
        if (this.adcMaf) this.adcMaf.style.color = 'var(--apple-rose)';
      } else {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'danger', '🔴 Ошибка нуля', 'Покой: Напряжение ниже нормы (<0.996В). Проверьте массы');
        if (this.adcMaf) this.adcMaf.style.color = 'var(--apple-rose)';
      }
    } else {
      if (mafV >= 1.01 && mafV <= 4.80) {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'ok', '🟢 Активен', 'Двигатель запущен: динамический отклик расхода воздуха');
        if (this.adcMaf) this.adcMaf.style.color = 'var(--apple-green)';
      } else {
        setBadge(this.healthAdcMaf, this.descAdcMaf, 'danger', '🔴 Выход за пределы', 'Напряжение вне рабочего диапазона');
        if (this.adcMaf) this.adcMaf.style.color = 'var(--apple-rose)';
      }
    }

    // 2. ДПДЗ (Датчик положения дроссельной заслонки)
    const tpsV = Number(adc.tps);
    if (tpsV >= 0.45 && tpsV <= 0.65) {
      setBadge(this.healthAdcThrottle, this.descAdcThrottle, 'ok', '🟢 Закрыта (0%)', 'Калибровка нуля заслонки в норме (0.45 ... 0.65 В)');
    } else if (tpsV > 0.65 && tpsV <= 0.75) {
      setBadge(this.healthAdcThrottle, this.descAdcThrottle, 'warn', '🟡 Смещение нуля', 'Возможен перетяг троса газа или нагар на упоре дросселя');
    } else if (tpsV > 0.75 && tpsV <= 4.60) {
      const openPct = Math.min(100, Math.max(0, ((tpsV - 0.5) / 4.0) * 100)).toFixed(0);
      setBadge(this.healthAdcThrottle, this.descAdcThrottle, 'info', `🔵 Открыта (~${openPct}%)`, 'Дроссельная заслонка открыта, сигнал изменяется плавно');
    } else if (tpsV < 0.35) {
      setBadge(this.healthAdcThrottle, this.descAdcThrottle, 'danger', '🔴 КЗ на массу', 'Напряжение < 0.35 В. Замыкание сигнального провода на корпус');
    } else {
      setBadge(this.healthAdcThrottle, this.descAdcThrottle, 'danger', '🔴 Обрыв цепи', 'Напряжение > 4.70 В. Обрыв сигнального провода или массы');
    }

    // 3. Бортовая сеть (АКБ / Генератор)
    const voltV = Number(adc.volt);
    if (!isRunning) {
      if (voltV >= 12.4) {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'ok', '🟢 АКБ заряжен', 'Покой: Напряжение батареи в норме (80-100% заряда)');
      } else if (voltV >= 12.0) {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'warn', '🟡 Разряжен АКБ', 'Покой: Низкое напряжение батареи (требуется подзарядка)');
      } else {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'danger', '🔴 Глубокий разряд', 'Покой: Напряжение АКБ < 12.0 В. Риск отказа запуска');
      }
    } else {
      if (voltV >= 13.8 && voltV <= 14.6) {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'ok', '🟢 Зарядка ОК', 'Работа: Генератор выдает стабильные 13.8 ... 14.6 В');
      } else if (voltV >= 13.2 && voltV < 13.8) {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'warn', '🟡 Под нагрузкой', 'Работа: Небольшая просадка напряжения генератора');
      } else if (voltV < 13.2) {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'danger', '🔴 Недозаряд', 'Работа: Генератор не справляется (<13.2В). Проверьте ремень/щетки');
      } else {
        setBadge(this.healthAdcVolt, this.descAdcVolt, 'danger', '🔴 Перезаряд', 'Работа: Опасное перенапряжение (>14.7В). Пробит реле-регулятор');
      }
    }

    // 4. ДТОЖ (Охлаждающая жидкость)
    const tempV = Number(adc.temp);
    if (tempV >= 0.20 && tempV <= 4.80) {
      setBadge(this.healthAdcTemp, this.descAdcTemp, 'ok', '🟢 Цепь исправна', 'Терморезистор ДТОЖ в пределах рабочего диапазона');
    } else if (tempV > 4.80) {
      setBadge(this.healthAdcTemp, this.descAdcTemp, 'danger', '🔴 Обрыв цепи (5В)', 'Опорное напряжение 5.0 В. Обрыв провода датчика');
    } else {
      setBadge(this.healthAdcTemp, this.descAdcTemp, 'danger', '🔴 КЗ на массу (0В)', 'Замыкание сигнальной цепи ДТОЖ на массу автомобиля');
    }

    // 5. ДТВ (Температура впускного воздуха)
    const airV = adc.airTemp !== undefined ? Number(adc.airTemp) : 3.5;
    if (airV >= 0.20 && airV <= 4.80) {
      setBadge(this.healthAdcAirTemp, this.descAdcAirTemp, 'ok', '🟢 Цепь исправна', 'Терморезистор воздуха в рабочем диапазоне');
    } else if (airV > 4.80) {
      setBadge(this.healthAdcAirTemp, this.descAdcAirTemp, 'danger', '🔴 Обрыв цепи (5В)', 'Опорные 5.0 В. Обрыв проводки ДТВ');
    } else {
      setBadge(this.healthAdcAirTemp, this.descAdcAirTemp, 'danger', '🔴 КЗ на массу (0В)', 'Замыкание цепи датчика температуры воздуха на массу');
    }

    // 6. ДК1 (Управляющий лямбда-зонд)
    const o2V = Number(adc.o2);
    if (o2V >= 0.42 && o2V <= 0.48) {
      setBadge(this.healthAdcO2, this.descAdcO2, 'warn', '🟡 Прогрев / Опорное', 'Опорные ~0.45 В. Зонд прогревается или смесь разомкнута');
    } else if (o2V >= 0.05 && o2V < 0.42) {
      setBadge(this.healthAdcO2, this.descAdcO2, 'ok', '🟢 Бедная смесь', 'Сигнал ДК1 в диапазоне бедной смеси (0.1 ... 0.4 В)');
    } else if (o2V > 0.48 && o2V <= 0.95) {
      setBadge(this.healthAdcO2, this.descAdcO2, 'ok', '🟢 Богатая смесь', 'Сигнал ДК1 в диапазоне богатой смеси (0.5 ... 0.9 В)');
    } else {
      setBadge(this.healthAdcO2, this.descAdcO2, 'danger', '🔴 Залипание сигнала', 'Выход сигнала за пределы рабочего диапазона 0.05-0.95В');
    }

    // 7. ДК2 (Диагностический лямбда-зонд)
    const o2_2V = adc.o2_2 !== undefined ? Number(adc.o2_2) : 0.65;
    if (o2_2V >= 0.55 && o2_2V <= 0.78) {
      setBadge(this.healthAdcO2_2, this.descAdcO2_2, 'ok', '🟢 Катализатор ОК', 'Стабильный уровень напряжения после исправного нейтрализатора');
    } else if (o2_2V >= 0.42 && o2_2V <= 0.48) {
      setBadge(this.healthAdcO2_2, this.descAdcO2_2, 'warn', '🟡 Прогрев / Опорное', 'Опорное напряжение ненагретого зонда');
    } else if (o2_2V >= 0.05 && o2_2V < 0.55) {
      setBadge(this.healthAdcO2_2, this.descAdcO2_2, 'warn', '🟡 Бедный отклик', 'Напряжение ниже нормы для нейтрализатора');
    } else if (o2_2V > 0.78 && o2_2V <= 0.95) {
      setBadge(this.healthAdcO2_2, this.descAdcO2_2, 'warn', '🟡 Богатый отклик', 'Повышенный уровень напряжения ДК2');
    } else {
      setBadge(this.healthAdcO2_2, this.descAdcO2_2, 'danger', '🔴 Ошибка сигнала', 'Выход за допустимые пределы');
    }

    // 8. ДНД (Датчик неровной дороги)
    const roughV = adc.roughRoad !== undefined ? Number(adc.roughRoad) : 2.5;
    if (roughV >= 2.20 && roughV <= 2.80) {
      setBadge(this.healthAdcRoughRoad, this.descAdcRoughRoad, 'ok', '🟢 Покой (~2.5 В)', 'Опорное напряжение акселерометра в норме (2.5 В)');
    } else if (roughV >= 0.50 && roughV <= 4.50) {
      setBadge(this.healthAdcRoughRoad, this.descAdcRoughRoad, 'info', '🔵 Динамика дороги', 'Акселерометр фиксирует ускорения и вибрации подвески');
    } else {
      setBadge(this.healthAdcRoughRoad, this.descAdcRoughRoad, 'danger', '🔴 Ошибка ДНД', 'Выход опорного напряжения за физический предел датчика');
    }

    // Обновление счетчиков
    if (this.adcCountOk) this.adcCountOk.textContent = countOk;
    if (this.adcCountWarn) this.adcCountWarn.textContent = countWarn;
    if (this.adcCountDanger) this.adcCountDanger.textContent = countDanger;

    // Обновление верхнего статусного орба и подзаголовка
    if (this.adcSummaryOrb && this.adcSummaryText) {
      this.adcSummaryOrb.className = 'adc-status-orb';
      if (countDanger > 0) {
        this.adcSummaryOrb.classList.add('status-orb-danger');
        this.adcSummaryText.textContent = `Обнаружены неисправности цепей: ${countDanger} датч.`;
      } else if (countWarn > 0) {
        this.adcSummaryOrb.classList.add('status-orb-warn');
        this.adcSummaryText.textContent = `Есть предупреждения по датчикам: ${countWarn} откл.`;
      } else {
        this.adcSummaryOrb.classList.add('status-orb-ok');
        this.adcSummaryText.textContent = 'Все электрические цепи датчиков соответствуют норме М73';
      }
    }
  }

  estimateGear(rpm, speed) {
    if (speed < 5 || rpm < 700) return "нейтраль";
    const ratio = rpm / speed;
    if (ratio > 95) return "1";
    if (ratio > 58) return "2";
    if (ratio > 40) return "3";
    if (ratio > 30) return "4";
    if (ratio > 20) return "5";
    return "—";
  }

  updateMisfireBox(el, val) {
    if (!el || val === undefined || val === null) return;
    const str = String(val);
    if (el._lastVal !== str) {
      el._lastVal = str;
      el.textContent = str;
      if (Number(val) > 0) el.classList.add('has-misfires');
      else el.classList.remove('has-misfires');
    }
  }

  setFlag(element, isActive) {
    if (!element) return;
    const activeBool = Boolean(isActive);
    if (element._lastActive !== activeBool) {
      element._lastActive = activeBool;
      if (activeBool) element.classList.add('active');
      else element.classList.remove('active');
    }
  }

  startLogging() {
    this.logger.start();
    this.btnToggleLog.classList.add('active');
    this.recBtnLabel.textContent = "Остановить";
    this.loggerStatusDot.classList.add('recording');
    if (this.btnExportCsv) this.btnExportCsv.disabled = true;
    if (this.btnExportXlsx) this.btnExportXlsx.disabled = true;
    if (this.tripSavedAlert) this.tripSavedAlert.style.display = 'none';
  }

  async stopLogging() {
    const saved = await this.logger.stop(this.peakRpm || 0);
    this.btnToggleLog.classList.remove('active');
    this.recBtnLabel.textContent = "Начать запись";
    this.loggerStatusDot.classList.remove('recording');
    this.loggerStatsText.textContent = `Запись завершена • ${this.logger.records.length} точек`;
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
        this.historyList.innerHTML = `<div class="empty-state-card" style="color: var(--apple-rose)">Ошибка: ${e.message}</div>`;
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
      alert("Идёт тест механизма, подождите");
      return;
    }

    this.isActuatorBusy = true;
    this.dtcList.innerHTML = '<div class="empty-state-card">Опрос памяти ошибок ЭБУ...</div>';
    
    const prevPolling = this.isPolling || this.shouldBeConnected;
    await this.stopPolling();

    try {
      const errors = await this.m73.readDtcCodes();
      if (errors.length === 0) {
        this.dtcList.innerHTML = '<div class="empty-state-card" style="color: var(--apple-green)">Ошибок в памяти контроллера не обнаружено. Система исправна.</div>';
      } else {
        this.dtcList.innerHTML = errors.map(e => `
          <div class="dtc-item">
            <div class="dtc-code">${e.code}</div>
            <div class="dtc-desc">${e.desc}</div>
          </div>
        `).join('');
      }
    } catch (err) {
      this.dtcList.innerHTML = `<div class="empty-state-card" style="color: var(--apple-rose)">Ошибка чтения: ${err.message}</div>`;
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
      alert("Идёт тест механизма, подождите");
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
        alert("Ошибки успешно сброшены!");
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

    // Если этот регулятор уже удерживается — сразу обновляем целевой байт для цикла _pollLoop
    // и отправляем команду в ЭБУ только если канал сейчас не занят
    if (this.activeRegulator && this.activeRegulator.key === key) {
      this.activeRegulator.rawByte = cfg.toRaw(this.regulatorValues[key]);
      if (!this.isActuatorBusy) {
        this.applyRegulator(key, true);
      }
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

    this.isActuatorBusy = true;
    this._cancelRegulatorRequested = false;
    const prevPolling = this.isPolling || this.shouldBeConnected;
    await this.stopPolling();

    try {
      // При первичном включении (!skipConfirm) опрашиваем свежий кадр 21 01 для проверки стоянки (speed == 0)
      if (!skipConfirm) {
        try {
          await this.m73.readConfiguredCycle('2101');
        } catch (e) {}

        if (this.m73.latestData && this.m73.latestData.speed > 0) {
          alert("Внимание! Ручное управление уставками разрешено только на стоянке (скорость 0 км/ч). При движении автомобиля управление блокируется в целях безопасности.");
          return;
        }

        if (!confirm("Внимание! Ручное управление уставками разрешено выполнять только на стоянке автомобиля. Применить выбранное значение?")) {
          return;
        }
      } else if (this.m73.latestData && this.m73.latestData.speed > 0) {
        return;
      }

      // Если во время подтверждения пользователь переключил вкладку или нажал сброс — выходим
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

  async releaseRegulator(key, silent = false) {
    const idMap = { idleRpm: '42', rxx: '41', purge: '43' };
    const idHex = idMap[key];
    if (!idHex) return;

    // Взводим флаг отмены на случай, если applyRegulator сейчас находится в процессе отправки
    this._cancelRegulatorRequested = true;
    if (this.activeRegulator && this.activeRegulator.key === key) {
      this.activeRegulator = null;
    }
    this._updateRegulatorUI(key, false);

    // Канал занят: запоминаем возврат управления, его отправит _finishBusy() владельца канала
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

      // 1. Опрашиваем актуальный статус перед тестом (проверка заглушен ли мотор)
      try {
        await this.m73.readConfiguredCycle('2101');
      } catch (e) {}

      // 2. Проверка условий безопасности: дискретные тесты разрешены ТОЛЬКО при RPM == 0 и SPEED == 0
      if (this.m73.latestData && (this.m73.latestData.rpm > 0 || this.m73.latestData.speed > 0)) {
        alert("Внимание! Тесты реле, форсунок и катушек зажигания разрешены только на СТОЯНКЕ (скорость 0 км/ч) при ЗАГЛУШЕННОМ двигателе (обороты 0) и включенном зажигании!\n\nЭБУ M73 аппаратно блокирует тесты при движении или заведённом моторе.");
        return;
      }

      if (!confirm("Внимание! Тест исполнительного механизма разрешено выполнять только на стоянке при заглушенном двигателе и включенном зажигании. Запустить тест?")) {
        return;
      }

      // 3. Даем шине 150 мс тишины для исключения коллизий пакетов
      await this.delay(150);

      const origBtnHtml = btnEl ? btnEl.innerHTML : '';
      if (btnEl) {
        btnEl.disabled = true;
        const isCompact = btnEl.classList.contains('btn-sm');
        btnEl.innerHTML = isCompact ? '<span class="act-spinner" style="margin: 0;"></span>' : '<span class="act-spinner"></span>Активно...';
        btnEl.classList.add('actuator-btn-running');
      }

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

    this.isActuatorBusy = true;
    const prevPolling = this.isPolling || this.shouldBeConnected;
    await this.stopPolling();

    let sessionEnded = false;
    try {
      // Опрашиваем актуальный статус перед сбросом (проверка заглушен ли мотор и стоит ли машина)
      try {
        await this.m73.readConfiguredCycle('2101');
      } catch (e) {}

      // Проверка условий безопасности: сброс ЭБУ разрешен ТОЛЬКО при RPM == 0 и SPEED == 0
      if (this.m73.latestData && (this.m73.latestData.rpm > 0 || this.m73.latestData.speed > 0)) {
        alert("Внимание! Сброс ЭБУ с инициализацией разрешен только на СТОЯНКЕ (скорость 0 км/ч) при ЗАГЛУШЕННОМ двигателе (обороты 0) и включенном зажигании!\n\nПерезапуск контроллера при заведённом двигателе или во время движения строго запрещен.");
        return;
      }

      if (!confirm("Внимание! Будут сброшены таблицы самообучения топлива и угла зажигания М73 к заводским значениям. Двигатель должен быть заглушен, зажигание включено. Продолжить?")) {
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
    if (this.currentTab === 'tab-actuators' && tabId !== 'tab-actuators') {
      if (this.activeRegulator) {
        this.releaseRegulator(this.activeRegulator.key, true);
      } else if (this.isActuatorBusy) {
        this._cancelRegulatorRequested = true;
      }
    }
    this.currentTab = tabId;
    if (this.m73) {
      this.m73.consecutiveTimeouts = 0;
    }
    if (tabId === 'tab-dashboard') {
      if (this.widgetManager) this.widgetManager.ensureOscLoop();
      if (this.m73 && this.m73.latestData) this.updateDashboardUI(this.m73.latestData);
    } else if (this.widgetManager) {
      this.widgetManager.stopOscLoop();
    }
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tabbar-item, .dock-item').forEach(el => el.classList.remove('active'));

    const targetContent = document.getElementById(tabId);
    const targetNav = document.querySelector(`[data-tab="${tabId}"]`);
    if (targetContent) targetContent.classList.add('active');
    if (targetNav) targetNav.classList.add('active');

    // Гарантированно открываем док при переключении вкладки и перезапускаем таймер
    if (this.resetDockTimer) {
      this.resetDockTimer();
    } else {
      const dock = document.querySelector('.liquid-dock');
      if (dock) dock.classList.remove('dock-hidden');
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
   * Интеллектуальное автоскрытие нижнего парящего дока при отсутствии взаимодействия (HUD режим в поездке):
   * Телефон в держателе -> через 4 секунды без касаний док плавно и красиво уезжает за нижний край экрана.
   * Любое касание экрана, тап, клик или скролл моментально возвращает док.
   */
  initDockAutoHide() {
    const dock = document.querySelector('.liquid-dock');
    if (!dock) return;

    let hideTimer = null;
    const INACTIVITY_MS = 4000; // 4 секунды неактивности до плавного скрытия

    const showDock = () => {
      dock.classList.remove('dock-hidden');
    };

    const hideDock = () => {
      // Не прячем, если включен режим настройки виджетов или открыты модальные окна
      if (this.widgetManager && this.widgetManager.isEditMode) return;
      const modalOpen = document.querySelector('.modal-backdrop.open, .history-modal.open, .adc-ref-sheet.open, [style*="display: flex"].modal-backdrop');
      if (modalOpen) return;

      dock.classList.add('dock-hidden');
    };

    const resetTimer = () => {
      showDock();
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(hideDock, INACTIVITY_MS);
    };

    // Слушаем любые события взаимодействия пользователя с экраном (тап, клик, скролл, жест)
    const events = ['pointerdown', 'touchstart', 'scroll', 'click', 'keydown'];
    events.forEach(ev => {
      window.addEventListener(ev, resetTimer, { passive: true, capture: true });
    });

    const scrollView = document.querySelector('.app-scroll-view');
    if (scrollView) {
      scrollView.addEventListener('scroll', resetTimer, { passive: true });
    }

    // Если палец или курсор находится прямо на доке — удерживаем его открытым
    dock.addEventListener('mouseenter', () => {
      if (hideTimer) clearTimeout(hideTimer);
      showDock();
    });
    dock.addEventListener('mouseleave', () => {
      resetTimer();
    });

    // Запускаем таймер при старте приложения
    resetTimer();

    this.resetDockTimer = resetTimer;
    this.showDock = showDock;
    this.hideDock = hideDock;
  }

  /**
   * Терминал: хранит последние 300 записей в памяти и рисует их в DOM только
   * когда открыта вкладка «Терминал». На частоте 12 Гц это исключает бесконечный
   * рост DOM и просадки FPS на главной панели.
   */
  appendTerminal(type, msg) {
    const d = new Date();
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    this.termBuffer.push({ type, text: `[${time}] ${msg}` });
    if (this.termBuffer.length > this.TERM_LIMIT) this.termBuffer.shift();

    if (this.currentTab !== 'tab-terminal' || !this.terminalLog) return;
    this._appendTerminalNode(this.termBuffer[this.termBuffer.length - 1]);
    while (this.terminalLog.childElementCount > this.TERM_LIMIT) {
      this.terminalLog.removeChild(this.terminalLog.firstElementChild);
    }
    this.terminalLog.scrollTop = this.terminalLog.scrollHeight;
  }

  _appendTerminalNode(entry) {
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
  window.M73App = new M73Application();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.log('SW note:', err);
    });
  }
});
