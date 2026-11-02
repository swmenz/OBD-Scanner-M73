/**
 * Главный контроллер приложения Priora Diag M73 ProLog
 * Связывает пользовательский интерфейс, Bluetooth-драйвер и протокол ЭБУ.
 */

class M73Application {
  constructor() {
    this.elm = new Elm327BLE();
    this.m73 = new ItelmaM73Protocol(this.elm);
    this.logger = new TripLogger();

    this.isPolling = false;
    this.currentTab = 'tab-dashboard';

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.btnConnect = document.getElementById('btnConnect');
    this.btnConnectText = document.getElementById('btnConnectText');
    this.hzValue = document.getElementById('hzValue');
    this.msValue = document.getElementById('msValue');
    
    // Элементы логгера
    this.btnToggleLog = document.getElementById('btnToggleLog');
    this.btnExportXlsx = document.getElementById('btnExportXlsx');
    this.loggerStatusDot = document.getElementById('loggerStatusDot');
    this.loggerStatsText = document.getElementById('loggerStatsText');

    // Датчики приборки
    this.valRpm = document.getElementById('valRpm');
    this.barRpm = document.getElementById('barRpm');
    this.valSpeed = document.getElementById('valSpeed');
    this.valTemp = document.getElementById('valTemp');
    this.barTemp = document.getElementById('barTemp');
    this.valThrottle = document.getElementById('valThrottle');
    this.valMaf = document.getElementById('valMaf');
    this.valSpark = document.getElementById('valSpark');
    this.valInjTime = document.getElementById('valInjTime');
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

    // АЦП
    this.adcMaf = document.getElementById('adcMaf');
    this.adcThrottle = document.getElementById('adcThrottle');
    this.adcTemp = document.getElementById('adcTemp');
    this.adcO2 = document.getElementById('adcO2');
    this.adcVolt = document.getElementById('adcVolt');

    // Терминал
    this.terminalLog = document.getElementById('terminalLog');
    this.terminalInput = document.getElementById('terminalInput');
  }

  bindEvents() {
    // Подключение / Отключение
    this.btnConnect.addEventListener('click', () => this.toggleConnection());

    // Переключение вкладок
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = btn.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });

    // Логирование терминала
    this.elm.onLog = (type, msg) => this.appendTerminal(type, msg);
    this.elm.onDisconnect = () => this.handleDisconnectedState();

    // Обновление счетчика логгера
    this.logger.onStatsUpdate = (stats) => {
      this.hzValue.textContent = stats.hz.toFixed(1);
      this.msValue.textContent = stats.ms;
      if (this.logger.isRecording) {
        this.loggerStatsText.textContent = `Запись активна (${stats.count} точек) • ${stats.hz} Гц`;
      }
    };

    // Кнопки записи лога
    this.btnToggleLog.addEventListener('click', () => this.toggleLogging());
    this.btnExportXlsx.addEventListener('click', () => this.logger.exportToXlsx());

    // Кнопки DTC
    this.btnReadDtc.addEventListener('click', () => this.readDtc());
    this.btnClearDtc.addEventListener('click', () => this.clearDtc());
  }

  /**
   * Подключение к адаптеру и запуск связи
   */
  async toggleConnection() {
    if (this.elm.isConnected) {
      this.isPolling = false;
      await this.elm.disconnect();
      this.handleDisconnectedState();
      return;
    }

    try {
      this.btnConnectText.textContent = "Поиск...";
      await this.elm.requestAndConnect();
      
      this.btnConnectText.textContent = "Связь с М73...";
      await this.m73.initEcu();

      // Успешно подключено
      this.btnConnect.classList.add('connected');
      this.btnConnectText.textContent = "Отключить";
      this.btnToggleLog.disabled = false;

      // Запуск высокоскоростного цикла опроса датчиков
      this.startContinuousPolling();
    } catch (err) {
      alert("Ошибка подключения: " + err.message);
      this.handleDisconnectedState();
    }
  }

  handleDisconnectedState() {
    this.isPolling = false;
    this.btnConnect.classList.remove('connected');
    this.btnConnectText.textContent = "Подключить";
    this.btnToggleLog.disabled = true;
    this.btnExportXlsx.disabled = this.logger.records.length === 0;
    this.hzValue.textContent = "0.0";
    this.msValue.textContent = "0";
  }

  /**
   * СВЕРХБЫСТРЫЙ КОНВЕЙЕРНЫЙ ЦИКЛ ОПРОСА М73
   */
  async startContinuousPolling() {
    if (this.isPolling) return;
    this.isPolling = true;

    while (this.isPolling && this.elm.isConnected) {
      try {
        // Если открыта вкладка "Панель" или активна запись лога в файл:
        if (this.currentTab === 'tab-dashboard' || this.logger.isRecording) {
          const params = await this.m73.readLiveParams();
          if (params) {
            this.updateDashboardUI(params);
            this.logger.addPoint(params);
          }
        } 
        // Если открыта вкладка "АЦП"
        else if (this.currentTab === 'tab-adc') {
          const adc = await this.m73.readAdcParams();
          if (adc) this.updateAdcUI(adc);
          await this.delay(100);
        } else {
          // На других вкладках делаем небольшую паузу
          await this.delay(200);
        }
      } catch (err) {
        // При единичной ошибке кадра не рвем связь, продолжаем цикл
        console.warn("Ошибка в цикле опроса: ", err);
        await this.delay(30);
      }
    }
  }

  /**
   * Отрисовка значений датчиков в интерфейсе
   */
  updateDashboardUI(data) {
    this.valRpm.textContent = data.rpm;
    const rpmPercent = Math.min(100, (data.rpm / 7000) * 100);
    this.barRpm.style.width = `${rpmPercent}%`;

    this.valSpeed.textContent = data.speed;
    this.valTemp.textContent = data.temp;
    const tempPercent = Math.max(0, Math.min(100, ((data.temp - 40) / 90) * 100));
    this.barTemp.style.width = `${tempPercent}%`;

    this.valThrottle.textContent = data.throttle;
    this.valMaf.textContent = data.maf;
    this.valSpark.textContent = data.spark;
    this.valInjTime.textContent = data.injTime;
    this.valVoltage.textContent = data.voltage;

    // Флаги
    this.setFlag(this.flagIdle, data.flags.idle);
    this.setFlag(this.flagLambda, data.flags.lambda);
    this.setFlag(this.flagKnock, data.flags.knock);
    this.setFlag(this.flagFuelCut, data.flags.fuelCut);
  }

  setFlag(element, isActive) {
    if (isActive) element.classList.add('active');
    else element.classList.remove('active');
  }

  updateAdcUI(adc) {
    this.adcMaf.textContent = `${adc.mafVolts} В`;
    this.adcThrottle.textContent = `${adc.tpsVolts} В`;
    this.adcTemp.textContent = `${adc.tempVolts} В`;
    this.adcO2.textContent = `${adc.o2Volts} В`;
    this.adcVolt.textContent = `${adc.volt} В`;
  }

  /**
   * Включение / Остановка записи лога
   */
  toggleLogging() {
    if (!this.logger.isRecording) {
      this.logger.start();
      this.btnToggleLog.classList.add('active');
      this.btnToggleLog.textContent = "⏹ Остановить лог";
      this.loggerStatusDot.classList.add('recording');
      this.btnExportXlsx.disabled = true;
    } else {
      this.logger.stop();
      this.btnToggleLog.classList.remove('active');
      this.btnToggleLog.textContent = "⏺ Начать запись";
      this.loggerStatusDot.classList.remove('recording');
      this.loggerStatsText.textContent = `Запись завершена (${this.logger.records.length} точек)`;
      this.btnExportXlsx.disabled = false;
    }
  }

  /**
   * Чтение ошибок DTC
   */
  async readDtc() {
    if (!this.elm.isConnected) {
      alert("Сначала подключитесь к адаптеру");
      return;
    }
    this.dtcList.innerHTML = '<div class="empty-state">Опрос памяти ошибок ЭБУ...</div>';
    
    // Временно приостанавливаем фоновый опрос датчиков, чтобы не мешать ответу DTC
    const prevPolling = this.isPolling;
    this.isPolling = false;
    await this.delay(100);

    try {
      const errors = await this.m73.readDtcCodes();
      if (errors.length === 0) {
        this.dtcList.innerHTML = '<div class="empty-state" style="color: #34d399">Ошибок в памяти ЭБУ не обнаружено!</div>';
      } else {
        this.dtcList.innerHTML = errors.map(e => `
          <div class="dtc-item">
            <div class="dtc-code">${e.code}</div>
            <div class="dtc-desc">${e.desc}</div>
          </div>
        `).join('');
      }
    } catch (err) {
      this.dtcList.innerHTML = `<div class="empty-state" style="color: #f87171">Ошибка чтения: ${err.message}</div>`;
    } finally {
      if (prevPolling) this.startContinuousPolling();
    }
  }

  /**
   * Сброс ошибок DTC
   */
  async clearDtc() {
    if (!confirm("Вы действительно хотите сбросить ошибки в ЭБУ?")) return;
    
    const prevPolling = this.isPolling;
    this.isPolling = false;
    await this.delay(100);

    try {
      const ok = await this.m73.clearDtcCodes();
      if (ok) {
        alert("Ошибки успешно сброшены!");
        this.readDtc();
      } else {
        alert("ЭБУ отклонил команду сброса");
      }
    } catch (err) {
      alert("Ошибка сброса: " + err.message);
    } finally {
      if (prevPolling) this.startContinuousPolling();
    }
  }

  /**
   * Управление механизмами
   */
  async testActuator(testType) {
    if (!this.elm.isConnected) return alert("Адаптер не подключен");
    
    const prevPolling = this.isPolling;
    this.isPolling = false;
    await this.delay(100);

    try {
      await this.m73.runActuatorTest(testType);
      alert("Команда теста успешно отправлена в ЭБУ!");
    } catch (err) {
      alert("Ошибка выполнения: " + err.message);
    } finally {
      if (prevPolling) this.startContinuousPolling();
    }
  }

  /**
   * Сброс с инициализацией
   */
  async resetWithInit() {
    if (!confirm("Внимание! Будут сброшены все таблицы самообучения и адаптаций ЭБУ М73 к заводским. Двигатель должен быть заглушен, зажигание включено. Продолжить?")) return;

    const prevPolling = this.isPolling;
    this.isPolling = false;
    await this.delay(100);

    try {
      const ok = await this.m73.resetWithInit();
      if (ok) {
        alert("Сброс с инициализацией успешно завершен! Выключите зажигание на 10 секунд.");
      } else {
        alert("Команда выполнена (проверьте лог обмена в терминале).");
      }
    } catch (err) {
      alert("Ошибка сброса: " + err.message);
    } finally {
      if (prevPolling) this.startContinuousPolling();
    }
  }

  /**
   * Переключение экрана вкладок
   */
  switchTab(tabId) {
    this.currentTab = tabId;
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));

    const targetContent = document.getElementById(tabId);
    const targetNav = document.querySelector(`[data-tab="${tabId}"]`);
    if (targetContent) targetContent.classList.add('active');
    if (targetNav) targetNav.classList.add('active');
  }

  appendTerminal(type, msg) {
    if (!this.terminalLog) return;
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    this.terminalLog.appendChild(div);
    this.terminalLog.scrollTop = this.terminalLog.scrollHeight;
  }

  clearTerminal() {
    this.terminalLog.innerHTML = "";
  }

  async sendManualCommand() {
    const cmd = this.terminalInput.value.trim();
    if (!cmd) return;
    this.terminalInput.value = "";
    try {
      await this.elm.send(cmd);
    } catch (e) {
      // ошибка отобразится в логе
    }
  }

  delay(ms) {
    return new Promise(res => setTimeout(res, ms));
  }
}

// Запуск приложения и регистрация оффлайн-кэша (Service Worker)
window.addEventListener('DOMContentLoaded', () => {
  window.M73App = new M73Application();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.log('SW registration note:', err);
    });
  }
});
