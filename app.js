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

    // Конфигурация активных кадров
    this.currentMode = 'sport';
    this.framesConfig = {
      frame1: true,
      frame2: false
    };

    this.peakRpm = 0;

    // Состояние подключения и терминала
    this.connecting = false;
    this.isPolling = false;
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
    
    // Селектор режимов
    this.modeBadge = document.getElementById('modeBadge');
    this.customCheckboxesPanel = document.getElementById('customCheckboxesPanel');
    this.chkFrame1 = document.getElementById('chkFrame1');
    this.chkFrame2 = document.getElementById('chkFrame2');

    // Логгер
    this.btnToggleLog = document.getElementById('btnToggleLog');
    this.btnExportXlsx = document.getElementById('btnExportXlsx');
    this.loggerStatusDot = document.getElementById('loggerStatusDot');
    this.loggerStatsText = document.getElementById('loggerStatsText');
    this.recBtnLabel = document.getElementById('recBtnLabel');

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

    // Терминал
    this.terminalLog = document.getElementById('terminalLog');
    this.terminalInput = document.getElementById('terminalInput');
  }

  bindEvents() {
    this.btnConnect.addEventListener('click', () => this.toggleConnection());

    // Переключение режимов
    document.querySelectorAll('.segment-btn, .liquid-seg-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.segment-btn, .liquid-seg-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setMode(btn.getAttribute('data-mode'));
      });
    });

    const updateCheckboxes = () => {
      this.framesConfig.frame2 = this.chkFrame2.checked;
      this.updateModeBadge();
    };

    this.chkFrame2.addEventListener('change', updateCheckboxes);

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

    this.btnReadDtc.addEventListener('click', () => this.readDtc());
    this.btnClearDtc.addEventListener('click', () => this.clearDtc());
  }

  setMode(mode) {
    this.currentMode = mode;
    if (mode === 'sport') {
      this.customCheckboxesPanel.style.display = 'none';
      this.framesConfig.frame2 = false;
      this.chkFrame2.checked = false;
      this.modeBadge.textContent = "Спорт (макс. скорость ~0.08 с)";
      this.modeBadge.style.color = "var(--apple-green)";
    } else if (mode === 'full') {
      this.customCheckboxesPanel.style.display = 'none';
      this.framesConfig.frame2 = true;
      this.chkFrame2.checked = true;
      this.modeBadge.textContent = "Все датчики + АЦП (~0.16 с)";
      this.modeBadge.style.color = "var(--apple-blue)";
    } else if (mode === 'custom') {
      this.customCheckboxesPanel.style.display = 'flex';
      this.updateModeBadge();
    }
  }

  updateModeBadge() {
    const count = this.framesConfig.frame2 ? 2 : 1;
    const estTime = count === 1 ? "0.08" : "0.16";
    this.modeBadge.textContent = `Выбрано блоков: ${count} (~${estTime} с)`;
    this.modeBadge.style.color = "var(--apple-amber)";
  }

  async toggleConnection() {
    if (this.connecting) return;

    if (this.elm.isConnected) {
      await this.stopPolling();
      await this.elm.disconnect();
      this.handleDisconnectedState();
      return;
    }

    this.connecting = true;
    this.btnConnect.disabled = true;
    try {
      this.btnConnectText.textContent = "Поиск...";
      await this.elm.requestAndConnect();
      
      this.btnConnectText.textContent = "Связь...";
      await this.m73.initEcu();

      this.btnConnect.classList.add('connected');
      this.btnConnectText.textContent = "Отключить";
      this.connIndicator.classList.add('connected');
      this.connStateText.textContent = "Подключено к ЭБУ";
      this.btnToggleLog.disabled = false;
      this.peakRpm = 0;
      this.valPeakRpm.textContent = "Пик: 0 об/мин";

      this.startContinuousPolling();
    } catch (err) {
      const msg = err && err.message ? err.message : (typeof err === 'string' ? err : "Не удалось найти Bluetooth адаптер");
      alert(msg);
      // Если Bluetooth уже открыт, а ЭБУ не ответил — обязательно закрываем канал,
      // иначе кнопка «Подключить» превратится в «Отключить» без реальной связи
      try { await this.elm.disconnect(); } catch (e) {}
      this.handleDisconnectedState();
    } finally {
      this.connecting = false;
      this.btnConnect.disabled = false;
    }
  }

  handleDisconnectedState() {
    this.isPolling = false;
    // Обрыв связи во время записи: корректно завершаем запись, чтобы данные можно было выгрузить
    if (this.logger.isRecording) this.toggleLogging();
    this.btnConnect.classList.remove('connected');
    this.btnConnectText.textContent = "Подключить";
    this.connIndicator.classList.remove('connected');
    this.connStateText.textContent = "Не подключено";
    this.btnToggleLog.disabled = true;
    this.btnExportXlsx.disabled = this.logger.records.length === 0;
    this.hzValue.textContent = "0.0";
    this.msValue.textContent = "0";
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

    while (this.isPolling && this.elm.isConnected) {
      try {
        const activeConfig = {
          ...this.framesConfig,
          frame2: this.framesConfig.frame2 || this.currentTab === 'tab-adc'
        };
        const data = await this.m73.readConfiguredCycle(activeConfig);
        if (data) {
          if (failures >= 10) this.connStateText.textContent = "Подключено к ЭБУ";
          failures = 0;
          this.updateDashboardUI(data);
          this.logger.addPoint(data, activeConfig);
        } else {
          throw new Error("Пустой кадр");
        }
      } catch (err) {
        failures++;
        if (failures === 10) this.connStateText.textContent = "ЭБУ не отвечает";
        await this.delay(failures < 10 ? 30 : 250);
      }
    }

    // Цикл завершён (обрыв связи или остановка) — сбрасываем флаг, иначе повторный запуск после переподключения будет заблокирован
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
      this.valPeakRpm.textContent = `Пик: ${this.peakRpm} об/мин`;
    }
    const rpmRatio = Math.min(1, Math.max(0, data.rpm / 6800));
    this.barRpm.style.transform = `scaleX(${rpmRatio})`;

    // Скорость и передача
    this.valSpeed.textContent = data.speed;
    this.valThrottleSub.textContent = `${data.throttle}%`;
    const gear = this.estimateGear(data.rpm, data.speed);
    this.valGearAux.textContent = `Передача: ${gear}`;

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

    // АЦП и пропуски
    if (data.adc && this.adcMaf) {
      this.adcMaf.textContent = `${Number(data.adc.maf).toFixed(3)} В`;
      this.adcThrottle.textContent = `${Number(data.adc.tps).toFixed(3)} В`;
      this.adcTemp.textContent = `${Number(data.adc.temp).toFixed(3)} В`;
      this.adcO2.textContent = `${Number(data.adc.o2).toFixed(3)} В`;
      this.adcVolt.textContent = `${Number(data.adc.volt).toFixed(1)} В`;
    }

    if (data.misfires && this.misCyl1) {
      this.updateMisfireBox(this.misCyl1, data.misfires.cyl1);
      this.updateMisfireBox(this.misCyl2, data.misfires.cyl2);
      this.updateMisfireBox(this.misCyl3, data.misfires.cyl3);
      this.updateMisfireBox(this.misCyl4, data.misfires.cyl4);
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

  toggleLogging() {
    if (!this.logger.isRecording) {
      this.logger.start();
      this.btnToggleLog.classList.add('active');
      this.recBtnLabel.textContent = "Остановить";
      this.loggerStatusDot.classList.add('recording');
      this.btnExportXlsx.disabled = true;
    } else {
      this.logger.stop();
      this.btnToggleLog.classList.remove('active');
      this.recBtnLabel.textContent = "Начать запись";
      this.loggerStatusDot.classList.remove('recording');
      this.loggerStatsText.textContent = `Запись завершена • ${this.logger.records.length} точек`;
      this.btnExportXlsx.disabled = false;
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

    try {
      await this.m73.runActuatorTest(testType);
      alert("Команда теста отправлена в блок управления!");
    } catch (err) {
      alert("Ошибка выполнения: " + err.message);
    } finally {
      if (prevPolling) this.startContinuousPolling();
    }
  }

  async resetWithInit() {
    if (!confirm("Внимание! Будут сброшены таблицы самообучения топлива и угла зажигания М73 к заводским значениям. Двигатель должен быть заглушен, зажигание включено. Продолжить?")) return;

    const prevPolling = this.isPolling;
    await this.stopPolling();

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
