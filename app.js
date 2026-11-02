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

    // Конфигурация активных кадров опроса
    this.currentMode = 'sport'; // 'sport' | 'custom' | 'full'
    this.framesConfig = {
      frame1: true,  // База (Обороты, Скорость, Дроссель, ДМРВ, УОЗ, Впрыск, ТОЖ)
      frame2: false, // АЦП
      frame3: false, // Адаптации
      frame4: false  // Пропуски
    };

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.btnConnect = document.getElementById('btnConnect');
    this.btnConnectText = document.getElementById('btnConnectText');
    this.hzValue = document.getElementById('hzValue');
    this.msValue = document.getElementById('msValue');
    
    // Элементы режимов
    this.modeBadge = document.getElementById('modeBadge');
    this.customCheckboxesPanel = document.getElementById('customCheckboxesPanel');
    this.chkFrame1 = document.getElementById('chkFrame1');
    this.chkFrame2 = document.getElementById('chkFrame2');
    this.chkFrame3 = document.getElementById('chkFrame3');
    this.chkFrame4 = document.getElementById('chkFrame4');

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
    this.valCycleAir = document.getElementById('valCycleAir');
    this.valSpark = document.getElementById('valSpark');
    this.valRetard = document.getElementById('valRetard');
    this.valInjTime = document.getElementById('valInjTime');
    this.valDuty = document.getElementById('valDuty');
    this.valFuelRate = document.getElementById('valFuelRate');
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

    // Терминал
    this.terminalLog = document.getElementById('terminalLog');
    this.terminalInput = document.getElementById('terminalInput');
  }

  bindEvents() {
    this.btnConnect.addEventListener('click', () => this.toggleConnection());

    // Переключение режимов скорости опроса
    document.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setMode(btn.getAttribute('data-mode'));
      });
    });

    // Обработка чекбоксов
    const updateCheckboxes = () => {
      this.framesConfig.frame2 = this.chkFrame2.checked;
      this.framesConfig.frame3 = this.chkFrame3.checked;
      this.framesConfig.frame4 = this.chkFrame4.checked;
      this.updateModeBadge();
    };

    this.chkFrame2.addEventListener('change', updateCheckboxes);
    this.chkFrame3.addEventListener('change', updateCheckboxes);
    this.chkFrame4.addEventListener('change', updateCheckboxes);

    // Навигация
    document.querySelectorAll('.nav-tab').forEach(btn => {
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
        this.loggerStatsText.textContent = `Запись активна (${stats.count} точек) • ${stats.hz} Гц`;
      }
    };

    this.btnToggleLog.addEventListener('click', () => this.toggleLogging());
    this.btnExportXlsx.addEventListener('click', () => this.logger.exportToXlsx());

    this.btnReadDtc.addEventListener('click', () => this.readDtc());
    this.btnClearDtc.addEventListener('click', () => this.clearDtc());
  }

  /**
   * Установка режима опроса
   */
  setMode(mode) {
    this.currentMode = mode;
    if (mode === 'sport') {
      this.customCheckboxesPanel.style.display = 'none';
      this.framesConfig.frame2 = false;
      this.framesConfig.frame3 = false;
      this.framesConfig.frame4 = false;
      this.chkFrame2.checked = false;
      this.chkFrame3.checked = false;
      this.chkFrame4.checked = false;
      this.modeBadge.textContent = "⚡ Спорт (~0.08с / 12 Гц)";
      this.modeBadge.style.color = "#34d399";
    } else if (mode === 'full') {
      this.customCheckboxesPanel.style.display = 'none';
      this.framesConfig.frame2 = true;
      this.framesConfig.frame3 = true;
      this.framesConfig.frame4 = true;
      this.chkFrame2.checked = true;
      this.chkFrame3.checked = true;
      this.chkFrame4.checked = true;
      this.modeBadge.textContent = "🔍 Все 84 параметра (~0.34с)";
      this.modeBadge.style.color = "#38bdf8";
    } else if (mode === 'custom') {
      this.customCheckboxesPanel.style.display = 'flex';
      this.updateModeBadge();
    }
  }

  updateModeBadge() {
    let count = 1;
    if (this.framesConfig.frame2) count++;
    if (this.framesConfig.frame3) count++;
    if (this.framesConfig.frame4) count++;
    const estMs = count * 80;
    this.modeBadge.textContent = `⚙ Кадров: ${count} (~${estMs}мс)`;
    this.modeBadge.style.color = "#f59e0b";
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

      this.btnConnect.classList.add('connected');
      this.btnConnectText.textContent = "Отключить";
      this.btnToggleLog.disabled = false;

      this.startContinuousPolling();
    } catch (err) {
      const msg = err && err.message ? err.message : (typeof err === 'string' ? err : "Не удалось найти Bluetooth адаптер");
      alert(msg);
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
   * СВЕРХБЫСТРЫЙ КОНВЕЙЕРНЫЙ ЦИКЛ ОПРОСА
   */
  async startContinuousPolling() {
    if (this.isPolling) return;
    this.isPolling = true;

    while (this.isPolling && this.elm.isConnected) {
      try {
        // Опрашиваем в точности сконфигурированные кадры
        const data = await this.m73.readConfiguredCycle(this.framesConfig);
        if (data) {
          this.updateDashboardUI(data);
          this.logger.addPoint(data, this.framesConfig);
        }
      } catch (err) {
        console.warn("Пауза в цикле: ", err);
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
    if (this.valCycleAir) this.valCycleAir.textContent = data.cycleAir;
    
    this.valSpark.textContent = data.spark;
    if (this.valRetard) {
      this.valRetard.textContent = data.sparkRetard !== 0 ? `${data.sparkRetard}°` : `0°`;
      this.valRetard.style.color = data.sparkRetard < 0 ? '#ef4444' : '#94a3b8';
    }

    this.valInjTime.textContent = data.injTime;
    if (this.valDuty) this.valDuty.textContent = `${data.dutyCycle}%`;
    if (this.valFuelRate) this.valFuelRate.textContent = data.fuelRate;

    this.valVoltage.textContent = data.voltage;

    // Флаги
    this.setFlag(this.flagIdle, data.flags.idle);
    this.setFlag(this.flagLambda, data.flags.lambda);
    this.setFlag(this.flagKnock, data.flags.knock);
    this.setFlag(this.flagFuelCut, data.flags.fuelCut);

    // АЦП и пропуски (если опрашиваются)
    if (data.adc && this.adcMaf) {
      this.adcMaf.textContent = `${data.adc.maf} В`;
      this.adcThrottle.textContent = `${data.adc.tps} В`;
      this.adcTemp.textContent = `${data.adc.temp} В`;
      this.adcO2.textContent = `${data.adc.o2} В`;
      this.adcVolt.textContent = `${data.adc.volt} В`;
    }

    if (data.misfires && this.misCyl1) {
      this.updateMisfireBox(this.misCyl1, data.misfires.cyl1);
      this.updateMisfireBox(this.misCyl2, data.misfires.cyl2);
      this.updateMisfireBox(this.misCyl3, data.misfires.cyl3);
      this.updateMisfireBox(this.misCyl4, data.misfires.cyl4);
    }
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

  async readDtc() {
    if (!this.elm.isConnected) {
      alert("Сначала подключитесь к адаптеру");
      return;
    }
    this.dtcList.innerHTML = '<div class="empty-state">Опрос памяти ошибок ЭБУ...</div>';
    
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
    } catch (e) {}
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
