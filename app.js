/**
 * Главный контроллер приложения Priora Diag M73 ProLog (Motorsport Edition)
 * Связывает спортивный интерфейс, Bluetooth-драйвер и протокол ЭБУ.
 */

class M73Application {
  constructor() {
    this.elm = new Elm327BLE();
    this.m73 = new ItelmaM73Protocol(this.elm);
    this.logger = new TripLogger();

    this.isPolling = false;
    this.currentTab = 'tab-dashboard';

    // Конфигурация активных кадров опроса
    this.currentMode = 'sport';
    this.framesConfig = {
      frame1: true,
      frame2: false,
      frame3: false,
      frame4: false
    };

    // Спортивная телеметрия
    this.peakRpm = 0;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.btnConnect = document.getElementById('btnConnect');
    this.btnConnectText = document.getElementById('btnConnectText');
    this.hzValue = document.getElementById('hzValue');
    this.msValue = document.getElementById('msValue');
    
    // Селектор режимов
    this.modeBadge = document.getElementById('modeBadge');
    this.customCheckboxesPanel = document.getElementById('customCheckboxesPanel');
    this.chkFrame1 = document.getElementById('chkFrame1');
    this.chkFrame2 = document.getElementById('chkFrame2');
    this.chkFrame3 = document.getElementById('chkFrame3');
    this.chkFrame4 = document.getElementById('chkFrame4');

    // Логгер
    this.btnToggleLog = document.getElementById('btnToggleLog');
    this.btnExportXlsx = document.getElementById('btnExportXlsx');
    this.loggerStatusDot = document.getElementById('loggerStatusDot');
    this.loggerStatsText = document.getElementById('loggerStatsText');
    this.recStateLabel = document.getElementById('recStateLabel');

    // Главные приборы
    this.valRpm = document.getElementById('valRpm');
    this.barRpm = document.getElementById('barRpm');
    this.valPeakRpm = document.getElementById('valPeakRpm');
    this.valSpeed = document.getElementById('valSpeed');
    this.valEstGear = document.getElementById('valEstGear');
    this.valThrottleSub = document.getElementById('valThrottleSub');

    // Светодиоды Shift Lights
    this.leds = document.querySelectorAll('.shift-lights-bar .led');

    // Сетка телеметрии
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

    // Терминал
    this.terminalLog = document.getElementById('terminalLog');
    this.terminalInput = document.getElementById('terminalInput');
  }

  bindEvents() {
    this.btnConnect.addEventListener('click', () => this.toggleConnection());

    // Переключение режимов
    document.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setMode(btn.getAttribute('data-mode'));
      });
    });

    const updateCheckboxes = () => {
      this.framesConfig.frame2 = this.chkFrame2.checked;
      this.framesConfig.frame3 = this.chkFrame3.checked;
      this.framesConfig.frame4 = this.chkFrame4.checked;
      this.updateModeBadge();
    };

    this.chkFrame2.addEventListener('change', updateCheckboxes);
    this.chkFrame3.addEventListener('change', updateCheckboxes);
    this.chkFrame4.addEventListener('change', updateCheckboxes);

    // Нижняя навигация
    document.querySelectorAll('.dock-tab').forEach(btn => {
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
        this.loggerStatsText.textContent = `${stats.count} SAMPLES`;
      }
    };

    this.btnToggleLog.addEventListener('click', () => this.toggleLogging());
    this.btnExportXlsx.addEventListener('click', () => this.logger.exportToXlsx());

    this.btnReadDtc.addEventListener('click', () => this.readDtc());
    this.btnClearDtc.addEventListener('click', () => this.clearDtc());
  }

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
      this.modeBadge.textContent = "⚡ SPORT (0.08s / 12 Hz)";
      this.modeBadge.style.color = "var(--neon-green)";
    } else if (mode === 'full') {
      this.customCheckboxesPanel.style.display = 'none';
      this.framesConfig.frame2 = true;
      this.framesConfig.frame3 = true;
      this.framesConfig.frame4 = true;
      this.chkFrame2.checked = true;
      this.chkFrame3.checked = true;
      this.chkFrame4.checked = true;
      this.modeBadge.textContent = "🔍 FULL (0.34s / 84 PARAMS)";
      this.modeBadge.style.color = "var(--neon-cyan)";
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
    this.modeBadge.textContent = `⚙ CUSTOM: ${count} FRAMES (~${estMs}ms)`;
    this.modeBadge.style.color = "var(--racing-amber)";
  }

  async toggleConnection() {
    if (this.elm.isConnected) {
      this.isPolling = false;
      await this.elm.disconnect();
      this.handleDisconnectedState();
      return;
    }

    try {
      this.btnConnectText.textContent = "SEARCH...";
      await this.elm.requestAndConnect();
      
      this.btnConnectText.textContent = "INIT M73...";
      await this.m73.initEcu();

      this.btnConnect.classList.add('connected');
      this.btnConnectText.textContent = "ONLINE";
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
    this.btnConnectText.textContent = "CONNECT";
    this.btnToggleLog.disabled = true;
    this.btnExportXlsx.disabled = this.logger.records.length === 0;
    this.hzValue.textContent = "0.0";
    this.msValue.textContent = "0";
    this.resetShiftLights();
  }

  async startContinuousPolling() {
    if (this.isPolling) return;
    this.isPolling = true;

    while (this.isPolling && this.elm.isConnected) {
      try {
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
   * Отрисовка спортивной приборной панели
   */
  updateDashboardUI(data) {
    // 1. Обороты и пиковое значение
    this.valRpm.textContent = data.rpm;
    if (data.rpm > this.peakRpm) {
      this.peakRpm = data.rpm;
      this.valPeakRpm.textContent = `PEAK: ${this.peakRpm}`;
    }
    const rpmPercent = Math.min(100, (data.rpm / 6800) * 100);
    this.barRpm.style.width = `${rpmPercent}%`;

    // 2. Светодиоды Shift Lights (бленкеры переключения)
    this.updateShiftLights(data.rpm);

    // 3. Скорость, передача и дроссель
    this.valSpeed.textContent = data.speed;
    this.valThrottleSub.textContent = `${data.throttle}%`;
    this.valEstGear.textContent = this.estimateGear(data.rpm, data.speed);

    // 4. ДМРВ и цикловое наполнение
    this.valMaf.textContent = data.maf;
    if (this.valCycleAir) this.valCycleAir.textContent = data.cycleAir;

    // 5. УОЗ и предупреждение о детонации
    this.valSpark.textContent = data.spark;
    if (this.valRetard) {
      this.valRetard.textContent = data.sparkRetard !== 0 ? `${data.sparkRetard}°` : `0.0°`;
      if (data.sparkRetard < 0) {
        this.valRetard.style.color = "var(--racing-red)";
        this.cardSpark.classList.add('knock-alert');
      } else {
        this.valRetard.style.color = "#94a3b8";
        this.cardSpark.classList.remove('knock-alert');
      }
    }

    // 6. Форсунки
    this.valInjTime.textContent = data.injTime;
    if (this.valDuty) this.valDuty.textContent = `${data.dutyCycle}%`;
    if (this.valFuelRate) this.valFuelRate.textContent = data.fuelRate;
    if (this.valIac) this.valIac.textContent = data.iacSteps;

    // 7. Температура и вольтаж
    this.valThrottle.textContent = data.throttle;
    this.valTemp.textContent = data.temp;
    const tempPercent = Math.max(0, Math.min(100, ((data.temp - 40) / 75) * 100));
    this.barTemp.style.width = `${tempPercent}%`;
    this.valVoltage.textContent = data.voltage;

    // 8. Пины состояний
    this.setFlag(this.flagIdle, data.flags.idle);
    this.setFlag(this.flagLambda, data.flags.lambda);
    this.setFlag(this.flagKnock, data.flags.knock);
    this.setFlag(this.flagFuelCut, data.flags.fuelCut);

    // 9. АЦП и пропуски
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

  /**
   * Управление гоночными светодиодами Shift Lights
   */
  updateShiftLights(rpm) {
    const thresholds = [2200, 2800, 3400, 4000, 4600, 5200, 5800, 6200, 6500];
    this.leds.forEach((led, i) => {
      if (rpm >= thresholds[i]) {
        led.classList.add('active');
      } else {
        led.classList.remove('active');
      }
    });
  }

  resetShiftLights() {
    this.leds.forEach(led => led.classList.remove('active'));
  }

  /**
   * Расчет ориентировочной текущей передачи КПП 21126
   */
  estimateGear(rpm, speed) {
    if (speed < 5 || rpm < 700) return "N";
    const ratio = rpm / speed;
    if (ratio > 95) return "1";
    if (ratio > 58) return "2";
    if (ratio > 40) return "3";
    if (ratio > 30) return "4";
    if (ratio > 20) return "5";
    return "-";
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
      this.btnToggleLog.innerHTML = '<span class="rec-circle"></span> STOP LOG';
      this.loggerStatusDot.classList.add('recording');
      this.recStateLabel.textContent = "LOGGING ACTIVE";
      this.recStateLabel.style.color = "var(--racing-red)";
      this.btnExportXlsx.disabled = true;
    } else {
      this.logger.stop();
      this.btnToggleLog.classList.remove('active');
      this.btnToggleLog.innerHTML = '<span class="rec-circle"></span> REC TELEMETRY';
      this.loggerStatusDot.classList.remove('recording');
      this.recStateLabel.textContent = "REC COMPLETE";
      this.recStateLabel.style.color = "#94a3b8";
      this.loggerStatsText.textContent = `${this.logger.records.length} SAVED`;
      this.btnExportXlsx.disabled = false;
    }
  }

  async readDtc() {
    if (!this.elm.isConnected) {
      alert("Сначала подключитесь к адаптеру");
      return;
    }
    this.dtcList.innerHTML = '<div class="empty-stream-msg">Опрос памяти ошибок процессора М73...</div>';
    
    const prevPolling = this.isPolling;
    this.isPolling = false;
    await this.delay(100);

    try {
      const errors = await this.m73.readDtcCodes();
      if (errors.length === 0) {
        this.dtcList.innerHTML = '<div class="empty-stream-msg" style="color: var(--neon-green)">Ошибок в памяти ЭБУ не обнаружено! Система чиста.</div>';
      } else {
        this.dtcList.innerHTML = errors.map(e => `
          <div class="dtc-item">
            <div class="dtc-code">${e.code}</div>
            <div class="dtc-desc">${e.desc}</div>
          </div>
        `).join('');
      }
    } catch (err) {
      this.dtcList.innerHTML = `<div class="empty-stream-msg" style="color: var(--racing-red)">Ошибка чтения: ${err.message}</div>`;
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
      alert("Команда теста отправлена в ЭБУ!");
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
        alert("Команда выполнена (проверьте терминал).");
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
    document.querySelectorAll('.dock-tab').forEach(el => el.classList.remove('active'));

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

// Запуск приложения и регистрация оффлайн-кэша
window.addEventListener('DOMContentLoaded', () => {
  window.M73App = new M73Application();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.log('SW note:', err);
    });
  }
});
