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

    await this.elm.send("AT AT 0");
    await this.elm.send("AT ST 19"); // Таймаут ~100мс
    await this.elm.send("AT SW 96");
    await this.elm.send("AT WM 81 10 F1 3E");

    this.elm.log('info', 'Открытие диагностической сессии (Fast Init 81)...');

    const checkSession = (resp) => {
      const clean = (resp || "").replace(/\s+/g, '').toUpperCase();
      const hasError = /ERROR|NODATA|UNABLE|\?|CANBUS|BUSBUSY|FBERROR|DATAERROR/.test(clean);
      return {
        clean,
        ok: !hasError && clean.length > 0 && (
          clean.includes("C1") ||
          clean.includes("8110F1") ||
          clean.includes("BUSINIT:OK") ||
          clean.includes("OK"))
      };
    };

    let session = { clean: "", ok: false };
    try {
      session = checkSession(await this.elm.send("81", 2500));
    } catch (e) {}

    // Если «81» не открыл сессию (ошибка, NO DATA или таймаут) — пробуем встроенный Fast Init адаптера
    if (!session.ok) {
      this.elm.log('info', 'Пробуем встроенный Fast Init (AT FI)...');
      try {
        session = checkSession(await this.elm.send("AT FI", 3000));
      } catch (e) {}
    }

    if (!session.ok) {
      this.elm.log('err', 'Не удалось открыть сессию с ЭБУ М73: ' + session.clean);
      throw new Error("ЭБУ М73 не отвечает на Fast Init. Проверьте, включено ли зажигание!");
    }

    // Отключаем заголовки (AT H0), чтобы ELM отдавал чистый payload без 83 F1 10 и контрольной суммы
    await this.elm.send("AT H0");

    // Проверяем живой отклик тестовым запросом кадра 21 01
    this.elm.log('info', 'Тестовый опрос кадра 21 01...');
    const testResp = await this.elm.send("2101", 1000);
    const cleanTest = testResp.replace(/\s+/g, '').toUpperCase();
    if (!cleanTest.includes("6101")) {
      throw new Error("ЭБУ открыл сессию, но не отдает кадр 21 01: " + testResp);
    }

    this.isInitialized = true;
    this.elm.log('info', '>>> СВЯЗЬ С ЭБУ ИТЭЛМА М73 УСПЕШНО УСТАНОВЛЕНА И ПРОВЕРЕНА! <<<');
    return true;
  }

  /**
   * ДИНАМИЧЕСКИЙ ОПРОС ВЫБРАННЫХ КАДРОВ
   * @param {Object} framesConfig - { frame1: bool, frame2: bool, frame3: bool, frame4: bool }
   */
  async readConfiguredCycle(framesConfig) {
    // 1. Всегда опрашиваем базовый скоростной Кадр 1 (содержит параметры двигателя, смесь и пропуски)
    const raw1 = await this.elm.send("2101", 350);
    // Если ЭБУ не вернул корректный кадр (NO DATA, обрыв K-Line), не выдаём устаревшие данные за свежие
    if (!this.parseFrame2101(raw1)) return null;

    // 2. Если включен Кадр 2 (Каналы АЦП - в М73 это кадр 21 03)
    if (framesConfig.frame2) {
      try {
        const rawAdc = await this.elm.send("2103", 350);
        this.parseFrame2103(rawAdc);
      } catch (e) {}
    }

    this.latestData.timestamp = new Date();
    return this.latestData;
  }

  /**
   * Разбор Кадра 1 (21 01, ответ 61 01) — Полная карта параметров М73 (32+ байта)
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
    if (bytes.length < 22 || bytes.some(Number.isNaN)) return null;

    // Флаги состояния (байты 0..3)
    const b1 = bytes[1] || 0;
    const b2 = bytes[2] || 0;

    // Байт 4: Температура охлаждающей жидкости (°C)
    const temp = bytes[4] - 40;

    // Байт 5: Положение дроссельной заслонки (%)
    const throttle = +(bytes[5] * 0.5).toFixed(1);

    // Байты 6, 7: Обороты коленвала (16 бит, шаг 0.25 об/мин)
    const rawRpm = ((bytes[6] << 8) | bytes[7]);
    const rpm = Math.round(rawRpm * 0.25);

    // Байт 8: Скорость автомобиля (км/ч)
    const speed = bytes[8];

    // Байт 9: УОЗ (знаковый, шаг 0.5° ПКВ)
    const rawSpark = bytes[9] > 127 ? bytes[9] - 256 : bytes[9];
    const spark = +(rawSpark * 0.5).toFixed(1);

    // Байты 10, 11: Массовый расход воздуха ДМРВ (16 бит, шаг 0.1 кг/ч)
    const rawMaf = ((bytes[10] << 8) | bytes[11]);
    const maf = +(rawMaf * 0.1).toFixed(1);

    // Байты 12, 13: Время впрыска форсунок (16 бит, шаг 0.005 мс)
    const rawInj = ((bytes[12] << 8) | bytes[13]);
    const injTime = +(rawInj * 0.005).toFixed(2);

    // Байт 14: Шаги РХХ
    const iacSteps = bytes[14];

    // Байт 15: Коэффициент коррекции времени впрыска по ДК
    const lambdaCorr = +((bytes[15] || 128) / 128.0).toFixed(3);

    // Байт 16: Бортовое напряжение (В)
    const rawVolt = bytes[16];
    const voltage = +(rawVolt > 160 ? 5.2 + rawVolt * 0.05 : rawVolt * 0.1).toFixed(1);

    // Байт 17: Напряжение датчика кислорода ДК1 (В)
    const o2Volt = +((bytes[17] * 1.25) / 256.0).toFixed(3);

    // Байт 18: Отскок УОЗ по детонации (°ПКВ)
    const sparkRetard = bytes[18] > 0 ? +(-bytes[18] * 0.5).toFixed(1) : 0.0;

    // Байт 19: Степень продувки адсорбера (%)
    const purgeRate = +(bytes[19] * 0.392).toFixed(1);

    // Байт 20: Мультипликативная коррекция смеси
    const multAdapt = +((bytes[20] || 128) / 128.0).toFixed(3);

    // Байт 21: Аддитивная коррекция смеси (%)
    const addAdapt = +(((bytes[21] || 128) - 128) * 0.078).toFixed(2);

    // Байты 28..31: Счетчики пропусков воспламенения по цилиндрам 1, 2, 3, 4
    if (bytes.length >= 32) {
      this.latestData.misfires.cyl1 = bytes[28] || 0;
      this.latestData.misfires.cyl2 = bytes[29] || 0;
      this.latestData.misfires.cyl3 = bytes[30] || 0;
      this.latestData.misfires.cyl4 = bytes[31] || 0;
      this.latestData.misfires.total = this.latestData.misfires.cyl1 + 
                                      this.latestData.misfires.cyl2 + 
                                      this.latestData.misfires.cyl3 + 
                                      this.latestData.misfires.cyl4;
    }

    // Расчетные величины (физика двигателя Приоры 21126)
    // Цикловой расход воздуха: (maf * 8333.33) / rpm (мг/такт)
    const cycleAir = (rpm > 100 && maf > 0) ? +((maf * 8333.33) / rpm).toFixed(1) : 0.0;
    // Скважность форсунок (duty cycle): (injTime * rpm) / 1200 (%)
    const dutyCycle = (rpm > 100 && injTime > 0) ? +Math.min(100, Math.max(0, (injTime * rpm) / 1200)).toFixed(1) : 0.0;
    // Часовой расход топлива: л/ч
    const fuelRate = (rpm > 100 && injTime > 0) ? +((injTime * rpm * 0.000325)).toFixed(2) : 0.0;

    // Флаги состояния
    const flags = {
      idle: (b1 & 0x01) !== 0 || (throttle === 0 && rpm < 1050),
      lambda: (b1 & 0x08) !== 0,
      fuelCut: (b1 & 0x02) !== 0 || (injTime === 0 && rpm > 1500),
      knock: (b2 & 0x04) !== 0 || sparkRetard < 0
    };

    // Запись в latestData
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
    this.latestData.purgeRate = purgeRate;
    this.latestData.multAdapt = multAdapt;
    this.latestData.addAdapt = addAdapt;
    this.latestData.flags = flags;

    return this.latestData;
  }

  /**
   * Разбор Кадра АЦП (в М73 это 21 03, ответ 61 03)
   * Квантование 8-битного АЦП процессора ST10F273: V = Byte * (5.0 / 256.0)
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
    if (bytes.length < 5 || bytes.some(Number.isNaN)) return null;

    this.latestData.adc.temp = +(bytes[0] * 0.01953).toFixed(3);
    this.latestData.adc.maf = +(bytes[1] * 0.01953).toFixed(3);
    this.latestData.adc.tps = +(bytes[2] * 0.01953).toFixed(3);
    this.latestData.adc.o2 = +(bytes[3] * 0.01953).toFixed(3);
    this.latestData.adc.volt = +(bytes[4] * 0.1).toFixed(1);

    return this.latestData.adc;
  }

  /**
   * ЧТЕНИЕ ОШИБОК ЭБУ (DTC)
   * KWP2000 Service 0x18: 18 00 FF 00 (ответ 58 [count] [DTC1] [Status1] ...)
   */
  async readDtcCodes() {
    this.elm.log('info', 'Запрос кодов неисправностей DTC (18 00 FF 00)...');
    const raw = await this.elm.send("1800FF00", 1500);
    const hex = raw.replace(/[\s\r\n]/g, '').toUpperCase();

    const dtcList = [];
    if (hex.startsWith("7F")) throw new Error("ЭБУ отклонил запрос чтения ошибок (отрицательный ответ " + hex.substring(0, 6) + ")");
    if (/NODATA|ERROR|UNABLE|\?/.test(hex)) throw new Error("ЭБУ не ответил на запрос ошибок");
    const idx = hex.indexOf("58");
    if (idx === -1) throw new Error("Некорректный ответ ЭБУ: " + (hex || "пусто"));

    const payload = hex.substring(idx + 2);
    if (payload.length < 2) return dtcList;

    const count = parseInt(payload.substr(0, 2), 16);
    if (isNaN(count) || count === 0) return dtcList;

    for (let i = 2; i + 4 <= payload.length && dtcList.length < count; i += 6) {
      const b1 = parseInt(payload.substr(i, 2), 16);
      const b2 = parseInt(payload.substr(i + 2, 2), 16);
      if (isNaN(b1) || isNaN(b2) || (b1 === 0 && b2 === 0)) continue;

      const codeStr = this._formatDtcCode(b1, b2);
      const desc = ItelmaM73Protocol.DTC_DICTIONARY[codeStr] || "Неизвестный код ошибки контроллера ВАЗ";
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
    const resp = (await this.elm.send("14FF00", 1500)).replace(/\s+/g, '').toUpperCase();
    return resp.startsWith("54") || resp.includes("OK");
  }

  async runActuatorTest(testType) {
    this.elm.log('info', `Запуск теста механизма: ${testType}`);
    const commands = {
      fan1_on: "300107",
      fan2_on: "300207",
      pump_on: "300307",
      mil_test: "300407"
    };
    const cmd = commands[testType];
    if (!cmd) throw new Error("Неизвестный тест механизма");

    const resp = (await this.elm.send(cmd, 1000)).replace(/\s+/g, '').toUpperCase();
    // Положительный ответ сервиса 0x30 начинается с 0x70; всё остальное — отказ ЭБУ
    if (!resp.startsWith("70")) {
      throw new Error("ЭБУ не принял команду теста (ответ: " + (resp || "пусто") + ")");
    }
    return resp;
  }

  async resetWithInit() {
    this.elm.log('info', 'Выполнение сброса ЭБУ с инициализацией (KWP2000 Reset 11 01)...');
    try {
      const resp = await this.elm.send("1101", 2000);
      const clean = resp.replace(/\s+/g, '').toUpperCase();
      if (clean.startsWith("5101") || clean.includes("OK")) {
        return true;
      }
    } catch (e) {}

    // Резервная попытка через старт процедуры 31 01 00
    this.elm.log('info', 'Резервная попытка сброса через 31 01 00...');
    const resp2 = (await this.elm.send("310100", 2000)).replace(/\s+/g, '').toUpperCase();
    return resp2.startsWith("71") || resp2.includes("OK");
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
