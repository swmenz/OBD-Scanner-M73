/**
 * Протокол взаимодействия с ЭБУ Итэлма М73 (Лада Приора / Калина / 2114)
 * Стандарт KWP2000 (ISO 14230), Fast Init, 10400 бод.
 * Поддерживает выборочный опрос кадров (21 01, 21 02, 21 03, 21 04)
 * для регулировки баланса между максимальной скоростью (12 Гц) и полнотой данных.
 */

class ItelmaM73Protocol {
  constructor(elm) {
    this.elm = elm;
    this.isInitialized = false;

    // Кэш для объединения данных из разных кадров
    this.latestData = {
      timestamp: new Date(),
      rpm: 0,
      temp: 0,
      throttle: 0,
      speed: 0,
      spark: 0,
      sparkRetard: 0,
      maf: 0,
      cycleAir: 0,
      injTime: 0,
      dutyCycle: 0,
      fuelRate: 0,
      voltage: 0,
      iacSteps: 0,
      o2Volt: 0,
      lambdaCorr: 1.0,
      targetLambda: 1.0,
      purgeRate: 0,
      multAdapt: 1.0,
      addAdapt: 0,
      misfires: { cyl1: 0, cyl2: 0, cyl3: 0, cyl4: 0, total: 0 },
      adc: { maf: 0, tps: 0, temp: 0, o2: 0, volt: 0 },
      flags: { idle: true, lambda: false, knock: false, fuelCut: false }
    };
  }

  /**
   * Сверхбыстрая инициализация ELM327 под тайминги М73
   */
  async initEcu() {
    this.elm.log('info', 'Инициализация адаптера под ЭБУ Итэлма М73...');

    await this.elm.send("AT Z", 1500).catch(() => {});
    await this.delay(100);

    await this.elm.send("AT E0");
    await this.elm.send("AT L0");
    await this.elm.send("AT S0"); // Пробелы выкл (критично для скорости)

    await this.elm.send("AT SP 5");
    await this.elm.send("AT IB 10");
    await this.elm.send("AT SH 81 10 F1");
    await this.elm.send("AT H1");

    await this.elm.send("AT AT 0");
    await this.elm.send("AT ST 19"); // Таймаут ~100мс
    await this.elm.send("AT SW 96");
    await this.elm.send("AT WM 81 10 F1 3E");

    this.elm.log('info', 'Открытие диагностической сессии (Fast Init 81)...');
    const startResp = await this.elm.send("81", 3000);
    
    const cleanResp = startResp.replace(/\s+/g, '').toUpperCase();
    if (cleanResp.includes("C1") || cleanResp.includes("83F110C1") || cleanResp.includes("8110F1")) {
      this.isInitialized = true;
      this.elm.log('info', '>>> СВЯЗЬ С ЭБУ ИТЭЛМА М73 УСПЕШНО УСТАНОВЛЕНА! <<<');
      return true;
    } else {
      this.isInitialized = true;
      this.elm.log('info', 'Сессия открыта: ' + cleanResp);
      return true;
    }
  }

  /**
   * ДИНАМИЧЕСКИЙ ОПРОС ТОЛЬКО ВЫБРАННЫХ КАДРОВ
   * @param {Object} framesConfig - { frame1: bool, frame2: bool, frame3: bool, frame4: bool }
   */
  async readConfiguredCycle(framesConfig) {
    // 1. Всегда опрашиваем базовый скоростной Кадр 1 (он обязателен)
    const raw1 = await this.elm.send("2101", 350);
    this.parseFrame2101(raw1);

    // 2. Если включен Кадр 2 (Каналы АЦП)
    if (framesConfig.frame2) {
      try {
        const raw2 = await this.elm.send("2102", 350);
        this.parseFrame2102(raw2);
      } catch (e) {}
    }

    // 3. Если включен Кадр 3 (Адаптации и продувка адсорбера)
    if (framesConfig.frame3) {
      try {
        const raw3 = await this.elm.send("2103", 350);
        this.parseFrame2103(raw3);
      } catch (e) {}
    }

    // 4. Если включен Кадр 4 (Пропуски зажигания по цилиндрам)
    if (framesConfig.frame4) {
      try {
        const raw4 = await this.elm.send("2104", 350);
        this.parseFrame2104(raw4);
      } catch (e) {}
    }

    this.latestData.timestamp = new Date();
    return this.latestData;
  }

  /**
   * Разбор Кадра 1 (21 01) — Основные ездовые параметры
   */
  parseFrame2101(rawStr) {
    const hex = rawStr.replace(/[\s\r\n]/g, '').toUpperCase();
    const idx = hex.indexOf("6101");
    if (idx === -1) return null;

    const payloadHex = hex.substring(idx + 4);
    const bytes = [];
    for (let i = 0; i < payloadHex.length - 1; i += 2) {
      bytes.push(parseInt(payloadHex.substr(i, 2), 16));
    }
    if (bytes.length < 14) return null;

    const rpm = (bytes[0] || 0) * 40;
    const temp = (bytes[1] || 0) - 40;
    const throttle = parseFloat(((bytes[2] || 0) * 0.5).toFixed(1));
    const speed = bytes[3] || 0;
    const spark = parseFloat((((bytes[4] || 0) * 0.5) - 30).toFixed(2));
    
    const mafRaw = ((bytes[5] || 0) << 8) | (bytes[6] || 0);
    const maf = parseFloat((mafRaw * 0.1).toFixed(1));

    const injRaw = ((bytes[7] || 0) << 8) | (bytes[8] || 0);
    const injTime = parseFloat((injRaw * 0.005).toFixed(2));

    const voltage = parseFloat(((bytes[9] || 0) * 0.1).toFixed(1));
    const iacSteps = bytes[10] || 0;

    const retardRaw = bytes[11] || 0;
    const sparkRetard = retardRaw > 0 ? parseFloat((-retardRaw * 0.75).toFixed(2)) : 0.0;

    const o2Raw = bytes[12] || 0;
    const o2Volt = parseFloat((o2Raw * 0.0049).toFixed(3));
    
    const lambdaCorrRaw = bytes[13] || 128;
    const lambdaCorr = parseFloat((lambdaCorrRaw / 128.0).toFixed(3));

    // Расчётные величины
    let cycleAir = 0.0;
    if (rpm > 100 && maf > 0) {
      cycleAir = parseFloat(((maf * 8333.33) / rpm).toFixed(2));
    }

    let dutyCycle = 0.0;
    if (rpm > 100 && injTime > 0) {
      dutyCycle = parseFloat(((injTime * rpm) / 1200.0).toFixed(2));
    }

    let fuelRate = 0.0;
    if (rpm > 100 && injTime > 0) {
      fuelRate = parseFloat((injTime * rpm * 0.000325).toFixed(2));
    }

    this.latestData.rpm = rpm;
    this.latestData.temp = temp;
    this.latestData.throttle = throttle;
    this.latestData.speed = speed;
    this.latestData.spark = spark;
    this.latestData.sparkRetard = sparkRetard;
    this.latestData.maf = maf;
    this.latestData.cycleAir = cycleAir;
    this.latestData.injTime = injTime;
    this.latestData.dutyCycle = dutyCycle;
    this.latestData.fuelRate = fuelRate;
    this.latestData.voltage = voltage;
    this.latestData.iacSteps = iacSteps;
    this.latestData.o2Volt = o2Volt;
    this.latestData.lambdaCorr = lambdaCorr;

    this.latestData.flags.idle = throttle === 0 && rpm < 1050;
    this.latestData.flags.lambda = o2Volt > 0.05 && o2Volt < 0.95;
    this.latestData.flags.knock = sparkRetard < 0;
    this.latestData.flags.fuelCut = injTime === 0 && rpm > 1500;

    return this.latestData;
  }

  /**
   * Разбор Кадра 2 (21 02) — АЦП
   */
  parseFrame2102(rawStr) {
    const hex = rawStr.replace(/[\s\r\n]/g, '').toUpperCase();
    const idx = hex.indexOf("6102");
    if (idx === -1) return null;

    const payloadHex = hex.substring(idx + 4);
    const bytes = [];
    for (let i = 0; i < payloadHex.length - 1; i += 2) {
      bytes.push(parseInt(payloadHex.substr(i, 2), 16));
    }
    if (bytes.length < 8) return null;

    const mafAdcRaw = ((bytes[0] || 0) << 8) | (bytes[1] || 0);
    this.latestData.adc.maf = (mafAdcRaw * (5.0 / 1023.0)).toFixed(3);
    this.latestData.adc.tps = ((bytes[2] || 0) * (5.0 / 255.0)).toFixed(2);
    this.latestData.adc.temp = ((bytes[3] || 0) * (5.0 / 255.0)).toFixed(2);
    this.latestData.adc.o2 = ((bytes[4] || 0) * (1.25 / 255.0)).toFixed(3);
    this.latestData.adc.volt = ((bytes[5] || 0) * 0.1).toFixed(1);

    return this.latestData.adc;
  }

  /**
   * Разбор Кадра 3 (21 03) — Адаптации и адсорбер
   */
  parseFrame2103(rawStr) {
    const hex = rawStr.replace(/[\s\r\n]/g, '').toUpperCase();
    const idx = hex.indexOf("6103");
    if (idx === -1) return null;

    const payloadHex = hex.substring(idx + 4);
    const bytes = [];
    for (let i = 0; i < payloadHex.length - 1; i += 2) {
      bytes.push(parseInt(payloadHex.substr(i, 2), 16));
    }
    if (bytes.length < 6) return null;

    this.latestData.targetLambda = parseFloat(((bytes[0] || 128) / 128.0).toFixed(3));
    this.latestData.purgeRate = parseFloat(((bytes[1] || 0) * 0.39).toFixed(1));
    this.latestData.multAdapt = parseFloat(((bytes[2] || 128) / 128.0).toFixed(3));
    this.latestData.addAdapt = parseFloat((((bytes[3] || 128) - 128) * 0.1).toFixed(2));

    return true;
  }

  /**
   * Разбор Кадра 4 (21 04) — Пропуски зажигания
   */
  parseFrame2104(rawStr) {
    const hex = rawStr.replace(/[\s\r\n]/g, '').toUpperCase();
    const idx = hex.indexOf("6104");
    if (idx === -1) return null;

    const payloadHex = hex.substring(idx + 4);
    const bytes = [];
    for (let i = 0; i < payloadHex.length - 1; i += 2) {
      bytes.push(parseInt(payloadHex.substr(i, 2), 16));
    }
    if (bytes.length < 5) return null;

    this.latestData.misfires.cyl1 = bytes[0] || 0;
    this.latestData.misfires.cyl2 = bytes[1] || 0;
    this.latestData.misfires.cyl3 = bytes[2] || 0;
    this.latestData.misfires.cyl4 = bytes[3] || 0;
    this.latestData.misfires.total = bytes[4] || (bytes[0] + bytes[1] + bytes[2] + bytes[3]);

    return this.latestData.misfires;
  }

  /**
   * ЧТЕНИЕ ОШИБОК ЭБУ (DTC)
   */
  async readDtcCodes() {
    this.elm.log('info', 'Запрос кодов ошибок DTC (18 00 FF 00)...');
    const raw = await this.elm.send("1800FF00", 1200);
    const hex = raw.replace(/[\s\r\n]/g, '').toUpperCase();

    const dtcList = [];
    const idx = hex.indexOf("58");
    if (idx === -1) return dtcList;

    const payload = hex.substring(idx + 2);
    for (let i = 2; i < payload.length - 5; i += 6) {
      const b1 = parseInt(payload.substr(i, 2), 16);
      const b2 = parseInt(payload.substr(i + 2, 2), 16);
      if (b1 === 0 && b2 === 0) continue;

      const codeStr = this._formatDtcCode(b1, b2);
      const desc = ItelmaM73Protocol.DTC_DICTIONARY[codeStr] || "Неизвестный код ошибки ВАЗ";
      dtcList.push({ code: codeStr, desc });
    }

    return dtcList;
  }

  _formatDtcCode(b1, b2) {
    const typeChar = ["P", "C", "B", "U"][(b1 >> 6) & 0x03];
    const d1 = (b1 >> 4) & 0x03;
    const d2 = b1 & 0x0F;
    const d3 = (b2 >> 4) & 0x0F;
    const d4 = b2 & 0x0F;
    return `${typeChar}${d1}${d2.toString(16)}${d3.toString(16)}${d4.toString(16)}`.toUpperCase();
  }

  async clearDtcCodes() {
    this.elm.log('info', 'Сброс ошибок ЭБУ (14 FF 00)...');
    const resp = await this.elm.send("14FF00", 1500);
    return resp.includes("54") || resp.includes("OK");
  }

  async runActuatorTest(testType) {
    this.elm.log('info', `Запуск теста механизма: ${testType}`);
    switch (testType) {
      case 'fan1_on': return await this.elm.send("300107", 1000);
      case 'fan2_on': return await this.elm.send("300207", 1000);
      case 'pump_on': return await this.elm.send("300307", 1000);
      case 'mil_test': return await this.elm.send("300407", 1000);
      default: throw new Error("Неизвестный тест механизма");
    }
  }

  async resetWithInit() {
    this.elm.log('info', 'Выполнение сброса ЭБУ с инициализацией (Routine 31 01)...');
    const resp = await this.elm.send("3101FF", 2000);
    return resp.includes("71") || resp.includes("OK");
  }

  delay(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  static get DTC_DICTIONARY() {
    return {
      "P0102": "Низкий уровень сигнала в цепи датчика расхода воздуха (ДМРВ)",
      "P0103": "Высокий уровень сигнала в цепи датчика расхода воздуха (ДМРВ)",
      "P0112": "Низкий уровень сигнала датчика температуры впускного воздуха",
      "P0113": "Высокий уровень сигнала датчика температуры впускного воздуха",
      "P0116": "Выход сигнала датчика температуры ОЖ за допустимый диапазон",
      "P0117": "Низкий уровень сигнала датчика температуры ОЖ (ДТОЖ)",
      "P0118": "Высокий уровень сигнала датчика температуры ОЖ (ДТОЖ)",
      "P0122": "Низкий уровень сигнала датчика положения дроссельной заслонки (ДПДЗ)",
      "P0123": "Высокий уровень сигнала датчика положения дроссельной заслонки (ДПДЗ)",
      "P0130": "Неисправность цепи датчика кислорода (лямбда 1)",
      "P0131": "Низкий уровень сигнала датчика кислорода до нейтрализатора",
      "P0132": "Высокий уровень сигнала датчика кислорода до нейтрализатора",
      "P0134": "Отсутствие отклика датчика кислорода до нейтрализатора",
      "P0135": "Неисправность нагревателя датчика кислорода 1",
      "P0171": "Слишком бедная смесь в системе",
      "P0172": "Слишком богатая смесь в системе",
      "P0300": "Случайные/множественные пропуски зажигания",
      "P0301": "Пропуски зажигания в 1-м цилиндре",
      "P0302": "Пропуски зажигания во 2-м цилиндре",
      "P0303": "Пропуски зажигания в 3-м цилиндре",
      "P0304": "Пропуски зажигания в 4-м цилиндре",
      "P0327": "Низкий уровень сигнала датчика детонации",
      "P0328": "Высокий уровень сигнала датчика детонации",
      "P0335": "Ошибка в цепи датчика положения коленвала (ДПКВ)",
      "P0336": "Ошибка сигнала датчика положения коленвала (ДПКВ)",
      "P0342": "Низкий уровень сигнала датчика фаз (распредвала)",
      "P0343": "Высокий уровень сигнала датчика фаз (распредвала)",
      "P0422": "Эффективность нейтрализатора ниже порога",
      "P0441": "Некорректный расход воздуха через клапан продувки адсорбера",
      "P0480": "Неисправность цепи управления реле вентилятора 1",
      "P0481": "Неисправность цепи управления реле вентилятора 2",
      "P0500": "Неисправность в цепи датчика скорости автомобиля",
      "P0506": "Слишком низкие обороты холостого хода",
      "P0507": "Слишком высокие обороты холостого хода",
      "P0562": "Пониженное напряжение бортовой сети",
      "P0563": "Повышенное напряжение бортовой сети",
      "P0601": "Ошибка контрольной суммы ПЗУ (ЭБУ)",
      "P1602": "Пропадание напряжения бортовой сети на ЭБУ (снятие клеммы АКБ)"
    };
  }
}

window.ItelmaM73Protocol = ItelmaM73Protocol;
