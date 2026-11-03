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
      intakeTemp: 0,
      roughRoad: 0.0,
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

    // Последовательность, проверенная по реальному логу OpenDiag Mobile на этом же автомобиле
    await this.elm.send("AT E0");
    await this.elm.send("AT L0");
    await this.elm.send("AT AL");     // Разрешить длинные ответы (кадр 21 01 = 74 байта)
    await this.elm.send("AT AT 1");   // Адаптивный тайминг
    await this.elm.send("AT S0");     // Пробелы выкл
    await this.elm.send("AT ST 32");  // Таймаут ответа ~200 мс
    await this.elm.send("AT SH 81 10 F1");
    await this.elm.send("AT IIA 10"); // Адрес ЭБУ для Fast Init
    await this.elm.send("AT SP 5");
    await this.elm.send("AT SW 00");

    this.elm.log('info', 'Открытие диагностической сессии (AT FI)...');

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
      session = checkSession(await this.elm.send("AT FI", 3000));
    } catch (e) {}

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
   * ДИНАМИЧЕСКИЙ ОПРОС КАДРОВ (РАЗДЕЛЬНЫЙ ОПРОС КАК В OPENDIAG)
   * Поддерживает как передачу строкового идентификатора '2101'/'2103', так и объекта конфигурации
   */
  async readConfiguredCycle(configOrFrame = '2101') {
    let target = '2101';
    if (typeof configOrFrame === 'string') {
      target = configOrFrame;
    } else if (configOrFrame && typeof configOrFrame === 'object') {
      target = configOrFrame.targetFrame || (configOrFrame.frame2 ? '2103' : '2101');
    }

    if (target === '2103') {
      const rawAdc = await this.elm.send("2103", 1000);
      if (this.parseFrame2103(rawAdc)) {
        this.latestData.timestamp = new Date();
        return this.latestData;
      }
      return null;
    }

    // По умолчанию — базовый скоростной Кадр 1 (21 01)
    const raw1 = await this.elm.send("2101", 1000);
    if (!this.parseFrame2101(raw1)) return null;

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
    if (bytes.length < 64 || bytes.some(Number.isNaN)) return null;

    // Карта байт сверена с OpenDiag Mobile (декомпиляция hk.java) и с реальным логом
    // автомобиля: 2571 пакет, расхождения с экспортом OpenDiag в пределах округления.
    // Индексы ниже — позиции в payload после «61 01».
    const u8 = (i) => bytes[i];
    const u16 = (i) => (bytes[i] << 8) | bytes[i + 1];
    const s8 = (i) => (bytes[i] > 127 ? bytes[i] - 256 : bytes[i]);
    const s16 = (i) => {
      const v = (bytes[i] << 8) | bytes[i + 1];
      return v > 32767 ? v - 65536 : v;
    };
    const r1 = (v) => +v.toFixed(1);

    // Байт 2: Температура охлаждающей жидкости (°C)
    const temp = r1(u8(2) * 0.75 - 48);

    // Байт 3: Температура впускного воздуха (°C)
    const intakeTemp = r1(u8(3) * 0.75 - 48);

    // Байт 4: Напряжение бортовой сети (В)
    const voltage = +(u8(4) * 0.073765).toFixed(2);

    // Байт 5: Скорость автомобиля (км/ч)
    const speed = Math.round(u8(5) * 1.25);

    // Байт 6: Положение дроссельной заслонки (%)
    const throttle = r1(u8(6) * 100 / 256);

    // Байт 7: Обороты коленвала (шаг 40 об/мин)
    const rpm = u8(7) * 40;

    // Байты 8, 9: Массовый расход воздуха ДМРВ (кг/ч)
    const maf = r1(u16(8) / 10);

    // Байт 10: УОЗ (знаковый, шаг 0.75° ПКВ)
    const spark = +(s8(10) * 0.75).toFixed(2);

    // Байт 11: Отскок УОЗ по детонации (знаковый, шаг 0.75° ПКВ)
    const sparkRetard = +(0 - s8(11) * 0.75).toFixed(2);

    // Байты 16, 17: Время впрыска форсунок (мс)
    const injTime = +(u16(16) / 75).toFixed(2);

    // Байт 18: Желаемые обороты холостого хода (об/мин)
    const idleTarget = u8(18) * 10;

    // Байт 19: Позиция шагового двигателя РХХ (шаги)
    const iacSteps = u8(19);

    // Байт 24: Напряжение датчика кислорода ДК1 (В)
    const o2Volt = +(u8(24) / 192 - 0.2).toFixed(3);

    // Байты 25, 26: Текущий коэффициент коррекции времени впрыска
    const lambdaCorr = +(u16(25) / 32768).toFixed(3);

    // Байты 27, 28: Заданное значение лямбда
    const targetLambda = +(u16(27) / 4096).toFixed(3);

    // Байт 29: Коэффициент продувки адсорбера (%)
    const purgeRate = r1(u8(29) * 100 / 256);

    // Байты 55, 56: Аддитивная составляющая коррекции смеси самообучением (%)
    // Точная формула декомпилированного OpenDiag hk.java (Case 57: s16 * 100.0 / 32768.0)
    const addAdapt = bytes.length >= 57 ? +(s16(55) * 100 / 32768).toFixed(2) : 0.0;

    // Байты 57, 58: Мультипликативная составляющая коррекции смеси самообучением (-)
    // Точная формула декомпилированного OpenDiag hk.java (Case 59: u16 / 32768.0)
    const multAdapt = bytes.length >= 59 ? +(u16(57) / 32768).toFixed(3) : 1.0;

    // Байты 59, 60: Датчик неровной дороги ДНД (вертикальное ускорение кузова в g)
    // Точная формула декомпилированного OpenDiag hk.java (Case 61: s16 * 3.0 / 64.0)
    const roughRoad = bytes.length >= 61 ? +((s16(59) * 3.0) / 64.0).toFixed(2) : 0.0;

    // Счетчики пропусков воспламенения (16 бит). Порядок в пакете M73 (OpenDiag): цилиндры 1, 3, 4, 2
    this.latestData.misfires.cyl1 = u16(36);
    this.latestData.misfires.cyl3 = u16(38);
    this.latestData.misfires.cyl4 = u16(40);
    this.latestData.misfires.cyl2 = u16(42);
    // 5-й счетчик (байты 44-45 в payload / 46-47 в ответе): активные цикловые пропуски за последние 1000 об
    this.latestData.misfires.cycle = bytes.length >= 46 ? u16(44) : 0;
    this.latestData.misfires.total = this.latestData.misfires.cyl1 +
                                    this.latestData.misfires.cyl2 +
                                    this.latestData.misfires.cyl3 +
                                    this.latestData.misfires.cyl4;

    // Расчетные величины (физика двигателя Приоры 21126)
    // Цикловой расход воздуха: (maf * 8333.33) / rpm (мг/такт)
    const cycleAir = (rpm > 100 && maf > 0) ? +((maf * 8333.33) / rpm).toFixed(1) : 0.0;
    // Скважность форсунок (duty cycle): (injTime * rpm) / 1200 (%)
    const dutyCycle = (rpm > 100 && injTime > 0) ? +Math.min(100, Math.max(0, (injTime * rpm) / 1200)).toFixed(1) : 0.0;
    // Часовой расход топлива (л/ч): берётся из ЭБУ (байты 50, 51), как в OpenDiag
    const fuelRate = +(u16(50) * 0.00215).toFixed(2);

    // Флаги состояния: битовые маски найдены сопоставлением с логом OpenDiag (0 расхождений на 2571 пакете)
    const hasFlags = bytes.length >= 64;
    const flags = {
      idle: hasFlags ? (bytes[62] & 0x01) !== 0 : (throttle === 0 && rpm < 1050),
      lambda: hasFlags ? (bytes[63] & 0x08) !== 0 : false,
      fuelCut: hasFlags ? (bytes[63] & 0x10) !== 0 : false,
      knock: hasFlags ? ((bytes[63] & 0x01) !== 0 && sparkRetard < 0) : sparkRetard < 0
    };

    // Запись в latestData
    this.latestData.rpm = rpm;
    this.latestData.temp = temp;
    this.latestData.intakeTemp = intakeTemp;
    this.latestData.idleTarget = idleTarget;
    this.latestData.targetLambda = targetLambda;
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
    this.latestData.roughRoad = roughRoad;
    this.latestData.flags = flags;

    return this.latestData;
  }

  /**
   * Разбор Кадра АЦП (в М73 это 21 03, ответ 61 03)
   * Точные формулы декомпилированного OpenDiag (hk.java метод E1) для процессора ST10F273 (Итэлма М73)
   */
  parseFrame2103(rawStr) {
    const hex = rawStr.replace(/[\s\r\n]/g, '').toUpperCase();
    const idx = hex.indexOf("6103");
    if (idx === -1) return null;

    // Срез байтов, начиная с заголовка 61 03 (байт 0 = 61, байт 1 = 03)
    const frameHex = hex.substring(idx);
    const bytes = [];
    for (let i = 0; i < frameHex.length - 1; i += 2) {
      bytes.push(parseInt(frameHex.substr(i, 2), 16));
    }
    if (bytes.length < 12 || bytes.some(Number.isNaN)) return null;

    const u8 = (i) => bytes[i] || 0;
    const u16 = (i) => ((bytes[i] || 0) << 8) | (bytes[i + 1] || 0);

    // Точная карта регистров АЦП ЭБУ М73:
    // Байт 2-3: Бортовое напряжение ADC (16 бит) -> raw * 0.0176 В
    this.latestData.adc.volt = +(u16(2) * 0.0176).toFixed(2);
    // Байт 4: Температура ОЖ ТОЖ (8 бит) -> raw * 5.0 / 256.0 В
    this.latestData.adc.temp = +(u8(4) * (5.0 / 256.0)).toFixed(3);
    // Байт 5-6: Температура воздуха ДТВ (16 бит) -> raw * 5.0 / 1024.0 В
    this.latestData.adc.airTemp = +(u16(5) * (5.0 / 1024.0)).toFixed(3);
    // Байт 7-8: ДМРВ 16-бит АЦП (16 бит) -> raw * 1.25 / 16384.0 (Bosch HFM5: 0.996 - 1.020 В в покое)
    this.latestData.adc.maf = +(u16(7) * (5.0 / 65536.0)).toFixed(3);
    // Байт 9-10: Положение дросселя ДПДЗ (16 бит) -> raw * 5.0 / 1024.0 В
    this.latestData.adc.tps = +(u16(9) * (5.0 / 1024.0)).toFixed(3);
    // Байт 11: Управляющий датчик кислорода УДК ДК1 (8 бит) -> raw * 5.0 / 256.0 В
    this.latestData.adc.o2 = +(u8(11) * (5.0 / 256.0)).toFixed(3);
    // Байт 12-13: Диагностический датчик кислорода ДДК ДК2 (16 бит) -> raw * 5.0 / 1024.0 В
    this.latestData.adc.o2_2 = +(u16(12) * (5.0 / 1024.0)).toFixed(3);
    // Байт 17-18: Датчик неровной дороги ДНД (16 бит) -> raw * 5.0 / 1024.0 В
    if (bytes.length >= 19) {
      this.latestData.adc.roughRoad = +(u16(17) * (5.0 / 1024.0)).toFixed(3);
    }

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
    
    // Точные команды KWP2000 службы 0x30 из OpenDiag (m73_im_menu.xml) для Итэлма М73:
    // 0A - Реле вентилятора 1 (низкая скорость)
    // 0D - Реле вентилятора 2 (высокая скорость)
    // 09 - Реле бензонасоса
    // 0C - Контрольная лампа Check Engine (MIL)
    const map = {
      fan1_on: { id: "0A", duration: 4000, name: "Вентилятор 1" },
      fan2_on: { id: "0D", duration: 4000, name: "Вентилятор 2" },
      pump_on: { id: "09", duration: 3000, name: "Бензонасос" },
      mil_test: { id: "0C", duration: 3000, name: "Лампа Check Engine" }
    };

    const target = map[testType];
    if (!target) throw new Error("Неизвестный тест механизма: " + testType);

    // 1. Включение механизма (30 <ID> 01)
    const cmdOn = `30${target.id}01`;
    this.elm.log('info', `[Тест ИМ] Включение ${target.name}: ${cmdOn}`);
    const respOn = (await this.elm.send(cmdOn, 1500)).replace(/\s+/g, '').toUpperCase();
    
    if (respOn.includes("7F3022")) {
      throw new Error("ЭБУ отклонил тест: двигатель должен быть заглушен (обороты 0) и включено зажигание!");
    }
    if (respOn.startsWith("7F")) {
      throw new Error(`ЭБУ отклонил команду (код: ${respOn})`);
    }
    if (!respOn.startsWith("70")) {
      throw new Error(`Некорректный ответ ЭБУ: ${respOn || "нет ответа"}`);
    }

    // 2. Удержание в активном состоянии
    await new Promise(r => setTimeout(r, target.duration));

    // 3. Выключение механизма (30 <ID> 00)
    const cmdOff = `30${target.id}00`;
    this.elm.log('info', `[Тест ИМ] Выключение ${target.name}: ${cmdOff}`);
    try {
      await this.elm.send(cmdOff, 1500);
    } catch (e) {}

    return true;
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
      "P0136": "Неисправность цепи датчика кислорода 2 (после нейтрализатора)",
      "P0137": "Низкий уровень сигнала датчика кислорода 2",
      "P0138": "Высокий уровень сигнала датчика кислорода 2",
      "P0140": "Обрыв цепи сигнала датчика кислорода 2",
      "P0141": "Неисправность нагревателя датчика кислорода 2",
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
