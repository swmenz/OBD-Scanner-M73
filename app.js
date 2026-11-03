/**
 * Главный контроллер приложения «Диагностика М73» для Лада Приора
 * Полная русификация, строгая визуальная иерархия и эргономика интерфейса.
 */

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

    this.initElements();
    this.bindEvents();
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

    // Флаги
    this.flagIdle = document.getElementById('flagIdle');
    this.flagLambda = document.getElementById('flagLambda');
    this.flagKnock = document.getElementById('flagKnock');
    this.flagFuelCut = document.getElementById('flagFuelCut');

    // Ошибки DTC
    this.dtcList = document.getElementById('dtcList');
    this.btnReadDtc = document.getElementById('btnReadDtc');
    this.btnClearDtc = document.getElementById('btnClearDtc');

    // АЦП и пропуски
    this.adcMaf = document.getElementById('adcMaf');
    this.adcThrottle = document.getElementById('adcThrottle');
    this.adcTemp = document.getElementById('adcTemp');
    this.adcO2 = document.getElementById('adcO2');
    this.adcVolt = document.getElementById('adcVolt');
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

    // Навигация по вкладкам (iOS TabBar / Liquid Dock)
    document.querySelectorAll('.tabbar-item, .dock-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });

    this.elm.onLog = (type, msg) => this.appendTerminal(type, msg);
    this.elm.onDisconnect = () => this.handleDisconnectedState();

    this.logger.onStatsUpdate = (stats) => {
      this.hzValue.textContent = stats.hz.toFixed(1);
      this.msValue.textContent = stats.ms;
      if (this.logger.isRecording) {
        this.loggerStatsText.textContent = `Идёт запись • ${stats.count} точек (${stats.hz} Гц)`;
      }
    };

    this.btnToggleLog.addEventListener('click', () => this.toggleLogging());
    this.btnExportXlsx.addEventListener('click', () => this.logger.exportToXlsx());

    // Автозапись и история поездок
    if (this.chkAutoRecord) {
      const savedAutoRec = localStorage.getItem('m73_autorecord');
      this.chkAutoRecord.checked = savedAutoRec !== 'false';
      this.chkAutoRecord.addEventListener('change', () => {
        localStorage.setItem('m73_autorecord', this.chkAutoRecord.checked);
      });
    }

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
    if (this.btnQuickExport) {
      this.btnQuickExport.addEventListener('click', () => {
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
      this.btnConnect.disabled = false;
      this.btnConnectText.textContent = "Подключить";
      this.btnConnect.classList.remove('connected');
      this.connIndicator.classList.remove('connected');
      this.connStateText.textContent = "Не подключено";
      this.elm.log('info', 'Поиск отменён пользователем');
      try { await this.elm.disconnect(); } catch (e) {}
      return;
    }

    if (this.elm.isConnected) {
      await this.stopPolling();
      await this.elm.disconnect();
      this.handleDisconnectedState();
      return;
    }

    this.connecting = true;
    // Оставляем кнопку активной с текстом "Отмена", чтобы пользователь мог прервать поиск в любой момент
    this.btnConnect.disabled = false;
    this.btnConnectText.textContent = "Отмена";

    try {
      await this.elm.requestAndConnect();
      
      this.btnConnectText.textContent = "Связь...";
      await this.m73.initEcu();

      this.btnConnect.classList.add('connected');
      this.btnConnectText.textContent = "Отключить";
      this.connIndicator.classList.add('connected');
      this.connStateText.textContent = "Подключено к ЭБУ";
      this.btnToggleLog.disabled = false;
      this.peakRpm = 0;
      this.valPeakRpm.textContent = "Пик: 0";

      // Скрываем прошлый баннер о сохранённой поездке
      if (this.tripSavedAlert) this.tripSavedAlert.style.display = 'none';

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
      this.handleDisconnectedState();
    } finally {
      this.connecting = false;
      this.btnConnect.disabled = false;
      if (!this.elm.isConnected) {
        this.btnConnectText.textContent = "Подключить";
        this.btnConnect.classList.remove('connected');
        this.connIndicator.classList.remove('connected');
        this.connStateText.textContent = "Не подключено";
      }
    }
  }

  async handleDisconnectedState() {
    this.isPolling = false;
    // Обрыв связи или выключение зажигания: корректно завершаем запись и сохраняем поездку в IndexedDB
    if (this.logger.isRecording) {
      await this.stopLogging();
    }
    this.btnConnect.classList.remove('connected');
    this.btnConnectText.textContent = "Подключить";
    this.connIndicator.classList.remove('connected');
    this.connStateText.textContent = "Не подключено";
    this.btnToggleLog.disabled = true;
    this.btnExportXlsx.disabled = this.logger.records.length === 0;
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
          // Раз в 2 секунды отправляем легкий Tester Present (3E), чтобы сессия ЭБУ не закрылась по таймауту
          if (Date.now() - lastTesterPresent > 2000) {
            try {
              await this.elm.send("3E", 500);
              lastTesterPresent = Date.now();
            } catch (e) {}
          }
          await this.delay(250);
          continue;
        }

        // 2. Логика строго раздельного опроса (1 вкладка = 1 кадр):
        if (this.currentTab === 'tab-dashboard') {
          // Главная панель: опрашиваем ИСКЛЮЧИТЕЛЬНО Кадр 1 (21 01) на максимальной скорости K-Line
          const data = await this.m73.readConfiguredCycle('2101');
          if (data) {
            this.updateDashboardUI(data);
            this.logger.addPoint(data);
          } else {
            throw new Error("Пустой кадр 21 01");
          }
        } else if (this.currentTab === 'tab-adc') {
          // Вкладка АЦП: опрашиваем ИСКЛЮЧИТЕЛЬНО Кадр 3 (21 03) для оценки напряжений покоя датчиков
          const dataAdc = await this.m73.readConfiguredCycle('2103');
          if (dataAdc) {
            this.updateAdcUI(dataAdc);
            if (!this.logger.isRecording) {
              this.logger.addPoint(dataAdc);
            }
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
   * Отрисовка значений приборной панели
   */
  updateDashboardUI(data) {
    // Обороты (Аппаратное ускорение через transform: scaleX для 120 FPS)
    this.valRpm.textContent = data.rpm;
    if (data.rpm > this.peakRpm) {
      this.peakRpm = data.rpm;
      this.valPeakRpm.textContent = `Пик: ${this.peakRpm}`;
    }
    const rpmRatio = Math.min(1, Math.max(0, data.rpm / 6800));
    this.barRpm.style.transform = `scaleX(${rpmRatio})`;

    // Скорость и передача
    this.valSpeed.textContent = data.speed;
    this.valThrottleSub.textContent = `${data.throttle}%`;
    const gear = this.estimateGear(data.rpm, data.speed);
    this.valGearAux.textContent = `КПП: ${gear}`;

    // ДМРВ и цикловой расход
    this.valMaf.textContent = data.maf.toFixed(1);
    if (this.valCycleAir) this.valCycleAir.textContent = data.cycleAir.toFixed(1);

    // УОЗ и отскок детонации (Интеллектуальная тревожная подсветка)
    this.valSpark.textContent = data.spark.toFixed(1);
    if (this.valRetard) {
      this.valRetard.textContent = data.sparkRetard !== 0 ? `${data.sparkRetard}°` : `0.0°`;
      if (data.sparkRetard < 0) {
        this.valRetard.classList.add('active-knock');
      } else {
        this.valRetard.classList.remove('active-knock');
      }
    }
    if (this.cardSpark) {
      if (data.sparkRetard < 0) {
        this.cardSpark.classList.add('alert-knock');
      } else {
        this.cardSpark.classList.remove('alert-knock');
      }
    }

    // Впрыск и форсунки
    this.valInjTime.textContent = data.injTime.toFixed(2);
    if (this.valDuty) this.valDuty.textContent = `${data.dutyCycle.toFixed(1)}%`;
    if (this.valFuelRate) this.valFuelRate.textContent = data.fuelRate.toFixed(2);
    if (this.valIac) this.valIac.textContent = data.iacSteps;

    // Дроссель и температура ОЖ (Аппаратное ускорение + градация нормы/перегрева)
    this.valThrottle.textContent = data.throttle.toFixed(1);
    this.valTemp.textContent = data.temp;
    const tempRatio = Math.max(0, Math.min(1, (data.temp - 40) / 75));
    this.barTemp.style.transform = `scaleX(${tempRatio})`;
    if (data.temp >= 103) {
      this.barTemp.style.background = 'var(--apple-rose)';
    } else if (data.temp >= 96) {
      this.barTemp.style.background = 'var(--apple-amber)';
    } else {
      this.barTemp.style.background = 'linear-gradient(90deg, var(--apple-blue), var(--apple-green))';
    }
    this.valVoltage.textContent = data.voltage.toFixed(1);

    // Флаги состояния
    this.setFlag(this.flagIdle, data.flags.idle);
    this.setFlag(this.flagLambda, data.flags.lambda);
    this.setFlag(this.flagKnock, data.flags.knock);
    this.setFlag(this.flagFuelCut, data.flags.fuelCut);

    // Пропуски зажигания (Кадр 21 01)
    if (data.misfires && this.misCyl1) {
      this.updateMisfireBox(this.misCyl1, data.misfires.cyl1);
      this.updateMisfireBox(this.misCyl2, data.misfires.cyl2);
      this.updateMisfireBox(this.misCyl3, data.misfires.cyl3);
      this.updateMisfireBox(this.misCyl4, data.misfires.cyl4);
      if (this.misCycle && data.misfires.cycle !== undefined) {
        this.misCycle.textContent = data.misfires.cycle;
      }
    }
  }

  /**
   * Отрисовка напряжений каналов АЦП (Кадр 21 03)
   */
  updateAdcUI(data) {
    if (data && data.adc && this.adcMaf) {
      this.adcMaf.textContent = `${Number(data.adc.maf).toFixed(3)} В`;
      this.adcThrottle.textContent = `${Number(data.adc.tps).toFixed(3)} В`;
      this.adcTemp.textContent = `${Number(data.adc.temp).toFixed(3)} В`;
      this.adcO2.textContent = `${Number(data.adc.o2).toFixed(3)} В`;
      this.adcVolt.textContent = `${Number(data.adc.volt).toFixed(2)} В`;
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
    el.textContent = val;
    if (val > 0) el.classList.add('has-misfires');
    else el.classList.remove('has-misfires');
  }

  setFlag(element, isActive) {
    if (isActive) element.classList.add('active');
    else element.classList.remove('active');
  }

  startLogging() {
    this.logger.start();
    this.btnToggleLog.classList.add('active');
    this.recBtnLabel.textContent = "Остановить";
    this.loggerStatusDot.classList.add('recording');
    this.btnExportXlsx.disabled = true;
    if (this.tripSavedAlert) this.tripSavedAlert.style.display = 'none';
  }

  async stopLogging() {
    const saved = await this.logger.stop(this.peakRpm || 0);
    this.btnToggleLog.classList.remove('active');
    this.recBtnLabel.textContent = "Начать запись";
    this.loggerStatusDot.classList.remove('recording');
    this.loggerStatsText.textContent = `Запись завершена • ${this.logger.records.length} точек`;
    this.btnExportXlsx.disabled = this.logger.records.length === 0;
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
            <button class="glass-btn btn-primary-glass btn-compact" onclick="M73App.exportHistoryTrip(${t.id})">Скачать</button>
            <button class="glass-btn btn-glass-danger btn-compact" onclick="M73App.deleteHistoryTrip(${t.id})">&times;</button>
          </div>
        </div>
      `).join('');
    } catch (e) {
      if (this.historyList) {
        this.historyList.innerHTML = `<div class="empty-state-card" style="color: var(--apple-rose)">Ошибка: ${e.message}</div>`;
      }
    }
  }

  async exportHistoryTrip(id) {
    try {
      const trip = await this.logger.storage.getTrip(id);
      if (trip && trip.records) {
        await this.logger.exportToXlsx(trip.records, trip.fileName);
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
    this.dtcList.innerHTML = '<div class="empty-state-card">Опрос памяти ошибок ЭБУ...</div>';
    
    const prevPolling = this.isPolling;
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
      if (prevPolling) this.startContinuousPolling();
    }
  }

  async clearDtc() {
    if (!confirm("Вы действительно хотите сбросить ошибки в контроллере?")) return;
    
    const prevPolling = this.isPolling;
    await this.stopPolling();

    try {
      const ok = await this.m73.clearDtcCodes();
      if (ok) {
        alert("Ошибки успешно сброшены!");
        await this.readDtc();
      } else {
        alert("Контроллер отклонил команду сброса");
      }
    } catch (err) {
      alert("Ошибка сброса: " + err.message);
    } finally {
      if (prevPolling) this.startContinuousPolling();
    }
  }

  async testActuator(testType) {
    if (!this.elm.isConnected) return alert("Адаптер не подключен");

    const prevPolling = this.isPolling;
    await this.stopPolling();

    // Опрашиваем актуальный статус перед тестом (проверка заглушен ли мотор прямо сейчас)
    try {
      await this.m73.readConfiguredCycle('2101');
    } catch (e) {}

    // Проверка условий безопасности: тесты разрешены ТОЛЬКО при RPM == 0
    if (this.m73.latestData && this.m73.latestData.rpm > 0) {
      alert("Внимание! Тесты исполнительных механизмов разрешены только при ЗАГЛУШЕННОМ двигателе (обороты 0) и включенном зажигании!\n\nЭБУ M73 аппаратно блокирует тесты при заведённом моторе.");
      if (prevPolling) this.startContinuousPolling();
      return;
    }

    try {
      this.connStateText.textContent = "Выполняется тест...";
      await this.m73.runActuatorTest(testType);
      alert("Тест успешно выполнен!");
    } catch (err) {
      alert("Ошибка выполнения: " + err.message);
    } finally {
      this.connStateText.textContent = "Подключено к ЭБУ";
      if (prevPolling) this.startContinuousPolling();
    }
  }

  async resetWithInit() {
    if (!this.elm.isConnected) return alert("Адаптер не подключен");

    const prevPolling = this.isPolling;
    await this.stopPolling();

    // Опрашиваем актуальный статус перед сбросом (проверка заглушен ли мотор)
    try {
      await this.m73.readConfiguredCycle('2101');
    } catch (e) {}

    // Проверка условий безопасности: сброс ЭБУ разрешен ТОЛЬКО при RPM == 0
    if (this.m73.latestData && this.m73.latestData.rpm > 0) {
      alert("Внимание! Сброс ЭБУ с инициализацией разрешен только при ЗАГЛУШЕННОМ двигателе (обороты 0) и включенном зажигании!\n\nПерезапуск контроллера при заведённом двигателе или во время движения строго запрещен.");
      if (prevPolling) this.startContinuousPolling();
      return;
    }

    if (!confirm("Внимание! Будут сброшены таблицы самообучения топлива и угла зажигания М73 к заводским значениям. Двигатель должен быть заглушен, зажигание включено. Продолжить?")) {
      if (prevPolling) this.startContinuousPolling();
      return;
    }

    let sessionEnded = false;
    try {
      const ok = await this.m73.resetWithInit();
      if (ok) {
        // После сброса ЭБУ закрывает диагностическую сессию — опрос продолжать бессмысленно
        sessionEnded = true;
        await this.elm.disconnect();
        this.handleDisconnectedState();
        alert("Сброс с инициализацией выполнен! Выключите зажигание на 10 секунд, затем включите и подключитесь заново.");
      } else {
        alert("ЭБУ не подтвердил сброс (подробности во вкладке «Терминал»).");
      }
    } catch (err) {
      alert("Ошибка сброса: " + err.message);
    } finally {
      if (prevPolling && !sessionEnded) this.startContinuousPolling();
    }
  }

  switchTab(tabId) {
    this.currentTab = tabId;
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tabbar-item, .dock-item').forEach(el => el.classList.remove('active'));

    const targetContent = document.getElementById(tabId);
    const targetNav = document.querySelector(`[data-tab="${tabId}"]`);
    if (targetContent) targetContent.classList.add('active');
    if (targetNav) targetNav.classList.add('active');

    if (tabId === 'tab-terminal') this.renderTerminal();
  }

  /**
   * Терминал: хранит последние 300 записей в памяти и рисует их в DOM только
   * когда открыта вкладка «Терминал». На частоте 12 Гц это исключает бесконечный
   * рост DOM и просадки FPS на главной панели.
   */
  appendTerminal(type, msg) {
    const time = new Date().toLocaleTimeString('ru-RU');
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
