/**
 * Протокол взаимодействия с ЭБУ Итэлма М73 (Лада Приора / Калина / 2114)
 * Стандарт KWP2000 (ISO 14230), Fast Init, 10400 бод.
 * Полный эталонный набор параметров OpenDiag Mobile и ReadLogs (83 канала).
 */

class ItelmaM73Protocol {
  constructor(elm) {
    this.elm = elm;
    this.isInitialized = false;

    // Кэш для объединения данных из всех параметров ЭБУ (Кадр 21 01 и 21 03)
    // Полный эталонный набор параметров OpenDiag Mobile и ReadLogs (83 канала)
    this.latestData = {
      timestamp: new Date(),

      // 1. Ошибки и пуск
      dtcCount: 0,
      tempAtStart: 0,

      // 2. Базовые датчики двигателя
      rpm: 0,
      temp: 0,
      intakeTemp: 0,
      voltage: 0,
      speed: 0,
      throttle: 0,
      maf: 0,
      spark: 0,
      sparkRetard: 0,

      // 3. Нагрузка и воздух
      frlLoad: 0,           // Параметр нагрузки FRL (%)
      calcLoad: 0,          // Расчётная нагрузка (%)
      altitudeFactor: 1.0,  // Фактор высотной коррекции / барокоррекция (-)
      cycleAir: 0,          // Цикловой расход воздуха (мг/такт)
      airTargetIdle: 0,     // Желаемый расход воздуха на ХХ (кг/ч)

      // 4. Топливоподача и впрыск
      injTime: 0,           // Длительность впрыска (мс)
      dutyCycle: 0,         // Загрузка форсунок (%)
      fuelRate: 0,          // Расход топлива (л/ч)
      lambdaCorr: 1.0,      // Коэффициент коррекции времени впрыска
      targetLambda: 1.0,    // Заданное значение лямбда
      purgeRate: 0,         // Коэффициент продувки адсорбера (%)
      multAdapt: 1.0,       // Мультипликативная составляющая коррекции (FRA)
      addAdapt: 0.0,        // Аддитивная составляющая коррекции (TRA / ХХ, %)

      // 5. Холостой ход
      idleTarget: 0,        // Желаемые обороты холостого хода (об/мин)
      iacSteps: 0,          // Позиция шагового двигателя РХХ (шаги)
      idleAdapt: 0,         // Параметр адаптации регулировки ХХ (%)
      idleTorqueI: 0,       // Потребность в моменте для ХХ: I-часть (%)
      idleTorquePD: 0,      // Потребность в моменте для ХХ: PD-часть (%)
      idleRpm: 0,           // Обороты на холостом ходу (об/мин)

      // 6. Датчики кислорода (Лямбда)
      o2Volt: 0,            // Сигнал ДК1 до нейтрализатора (В)
      o2Volt2: 0,           // Сигнал ДК2 после нейтрализатора (В)
      o2Period: 0,          // Период сигнала ДК1 (с)
      o2_2_integralDelay: 0,// Интегральная задержка ОС по второму датчику (с)
      o2_2_amplitude: 0,    // Корректированная амплитуда ДК2 (-)

      // 7. Детонация, неравномерность и динамика
      knockVolt: 0,         // Нормализованный уровень сигнала датчика детонации (В)
      unbalanceRpm: 0,      // Среднее значение неравномерности вращения коленвала (об/с²)
      damperAdapt: 0,       // Адаптация угловой погрешности зубьев венца демпфера (об/с²)
      roughRoad: 0.0,       // Сигнал датчика неровной дороги (ускорение кузова в g)
      enginePower: 0,       // Расчётная мощность по ДМРВ (л.с.)
      engineTorque: 0,      // Расчётный крутящий момент по ДМРВ (Н·м)

      // 8. Пропуски воспламенения и сброс
      misfires: { cyl1: 0, cyl2: 0, cyl3: 0, cyl4: 0, total: 0, cycle: 0 },
      timeSinceReset: 0,    // Время с момента последнего сброса ЭБУ (мин)
      timeSinceResetHours: 0, // Время с момента последнего сброса ЭБУ (ч)
      ecuChecksum: 0,

      // 9. Каналы АЦП (Кадр 21 03)
      adc: {
        volt: 0, temp: 0, maf: 0, tps: 0, o2: 0,
        airTemp: 0, o2_2: 0, o2Resist1: 0, roughRoad: 0,
        valvePurge: 0, o2Resist2: 0
      },

      // 10. Флаги готовности и режимов работы
      readiness: {
        cat: false,
        purge: false,
        o2: false,
        o2Heater: false
      },
      flags: {
        idle: true,
        fullLoad: false,
        acRequest: false,
        acAllowed: false,
        fuelPump: false,
        fan1: false,
        fan2: false,
        mil: false,

        knock: false,
        chassis: false,
        startChar: false,
        lambda: false,
        fuelCut: false,
        o2Ready: false,
        baseAdapt: false,
        purgeActive: false,

        misfirePaused: false,
        roughRoadFlag: false,
        o2_2_loop: false,
        o2_2_ready: false
      }
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
    await this.elm.send("AT AT 2");   // Агрессивный адаптивный тайминг (разгон)
    await this.elm.send("AT S0");     // Пробелы выкл
    await this.elm.send("AT ST 20");  // Режим Экстрим (~128 мс таймаут, защита от NO DATA на 74 байтах)
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
    const maxFiAttempts = 3;
    for (let attempt = 1; attempt <= maxFiAttempts; attempt++) {
      try {
        const resp = await this.elm.send("AT FI", 3000);
        session = checkSession(resp);
        if (session.ok) break;
      } catch (e) {
        session = { clean: (e && e.message) || "", ok: false };
      }
      if (attempt < maxFiAttempts) {
        this.elm.log('warn', `Fast Init попытка ${attempt} не ответила (${session.clean}), повтор через 200мс...`);
        await this.delay(200);
      }
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
    this.currentSpeedProfile = 'extreme';
    this.elm.log('info', '>>> СВЯЗЬ С ЭБУ ИТЭЛМА М73 УСПЕШНО УСТАНОВЛЕНА И ПРОВЕРЕНА! <<<');
    return true;
  }

  /**
   * Профиль скорости опроса K-Line (Режим Экстрим по умолчанию)
   */
  async setSpeedProfile(profile = 'extreme') {
    if (!this.elm || !this.elm.isConnected) return false;
    try {
      await this.elm.send("AT AT 2");
      await this.elm.send("AT ST 20"); // ~128 мс (защита от ложных NO DATA при длинных пакетах)
      this.currentSpeedProfile = 'extreme';
      this.elm.log('info', 'Режим скорости: Экстрим (AT AT 2, AT ST 20, ~128мс)');
      return true;
    } catch (e) {
      this.elm.log('warn', 'Ошибка установки профиля скорости: ' + (e.message || e));
      return false;
    }
  }

  /**
   * ДИНАМИЧЕСКИЙ ОПРОС КАДРОВ (РАЗДЕЛЬНЫЙ ОПРОС КАК В OPENDIAG)
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
   * Разбор Кадра 1 (21 01, ответ 61 01) — Полная карта всех 72 параметров М73
   * Выверена до последнего бита по эталонам ReadLogs 3.3.5.1 и OpenDiag Mobile (hk.java)
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

    const u8 = (i) => bytes[i] !== undefined ? bytes[i] : 0;
    const u16 = (i) => (bytes[i] !== undefined && bytes[i + 1] !== undefined) ? ((bytes[i] << 8) | bytes[i + 1]) : 0;
    const s8 = (i) => {
      const v = u8(i);
      return v > 127 ? v - 256 : v;
    };
    const s16 = (i) => {
      const v = u16(i);
      return v > 32767 ? v - 65536 : v;
    };
    const r1 = (v) => +v.toFixed(1);
    const r2 = (v) => +v.toFixed(2);
    const r3 = (v) => +v.toFixed(3);

    // 0: Количество ошибок DTC
    const dtcCount = u8(0);
    // 1: Температура ОЖ при пуске (°C)
    const tempAtStart = r1(u8(1) * 0.75 - 48);
    // 2: Температура охлаждающей жидкости (°C)
    const temp = r1(u8(2) * 0.75 - 48);
    // 3: Температура впускного воздуха (°C)
    const intakeTemp = r1(u8(3) * 0.75 - 48);
    // 4: Напряжение бортовой сети (В)
    const voltage = r2(u8(4) * 0.073765);
    // 5: Скорость автомобиля (км/ч)
    const speed = Math.round(u8(5) * 1.25);
    // 6: Положение дроссельной заслонки (%)
    const throttle = r1(u8(6) * 100 / 255);
    // 7: Обороты коленвала (шаг 40 об/мин)
        const rpm = u8(7) * 40;
    // 8-9: ÐÐ°ÑÑÐ¾Ð²ÑÐ¹ ÑÐ°ÑÑÐ¾Ð´ Ð²Ð¾Ð·Ð´ÑÑÐ° ÐÐÐ Ð (ÐºÐ³/Ñ)
    const rawMaf = u16(8);
    let maf = r1(rawMaf / 10.0);
    if (rawMaf >= 0xFF00 || rawMaf === 0xFFFE || (rpm < 300 && maf > 100)) {
      maf = 0;
    }
    // 10: УОЗ (°ПКВ, знаковый)
    const spark = r2(s8(10) * 0.75);
    // 11: Отскок УОЗ по детонации (°ПКВ)
    const sparkRetard = r2(0 - s8(11) * 0.75);

    // 12-13: Параметр нагрузки FRL (%)
    const frlLoad = r2(u16(12) * 75.0 / 3200.0);
    // 14: Расчётная нагрузка (%)
    const calcLoad = r1(u8(14) * 0.75);
    // 15: Фактор высотной коррекции / барокоррекция (-)
    const altitudeFactor = r3(u8(15) / 64.0);

    // 16-17: Длительность впрыска форсунок (мс)
    const injTime = r2(u16(16) / 75.0);
    // 18: Желаемые обороты холостого хода (об/мин)
    const idleTarget = u8(18) * 10;
    // 19: Позиция шагового двигателя РХХ (шаги)
    const iacSteps = u8(19);
    // 20-21: Желаемый расход воздуха на ХХ (кг/ч)
    const airTargetIdle = r2(u16(20) / 640.0);
    // 22-23: Параметр адаптации регулировки ХХ (%)
    const idleAdapt = r2(s16(22) * 100.0 / 32768.0);

    // 24: Сигнал датчика кислорода ДК1 (В)
    const o2Volt = r3(u8(24) / 192.0 - 0.2);
    // 25-26: Текущий коэффициент коррекции времени впрыска (-)
    const lambdaCorr = r3(u16(25) / 32768.0);
    // 27-28: Заданное значение лямбда (-)
    const targetLambda = r3(u16(27) / 4096.0);
    // 29: Коэффициент продувки адсорбера (%)
    const purgeRate = r1(u8(29) * 100.0 / 256.0);

    // 30-31: Нормализованный уровень сигнала датчика детонации (В)
    const knockVolt = r3(u16(30) / 256.0);
    // 32-33: Среднее значение неравномерности вращения коленвала (об/с²)
    const unbalanceRpm = r1(u16(32) * 0.57554);
    // 34-35: Адаптация зубьев венца демпфера (об/с²)
    const damperAdapt = r1(s16(34) * 0.57554);

    // 36-43: Счетчики пропусков воспламенения (порядок в М73: 1, 3, 4, 2)
    this.latestData.misfires.cyl1 = u16(36);
    this.latestData.misfires.cyl3 = u16(38);
    this.latestData.misfires.cyl4 = u16(40);
    this.latestData.misfires.cyl2 = u16(42);
    // 44-45: Активные цикловые пропуски за 1000 об (5-й счетчик ЭБУ М73)
    this.latestData.misfires.cycle = u16(44);
    this.latestData.misfires.total = this.latestData.misfires.cyl1 +
                                    this.latestData.misfires.cyl2 +
                                    this.latestData.misfires.cyl3 +
                                    this.latestData.misfires.cyl4;

    // 46-47 (байты 48-49 пакета 61 01): Время с момента последнего сброса контроллера
    // В OpenDiag (param_152): u16(46) / 10.0 (ч) с шагом 0.1 ч (= 6 мин).
    // В ReadLogs: в минутах = (u16(46) / 10.0) * 60 = u16(46) * 6 (мин).
    const timeSinceResetHours = r1(u16(46) / 10.0);
    const timeSinceReset = Math.round(u16(46) * 6);
    // 48-49: Контрольная сумма ЭБУ
    const ecuChecksum = u16(48);
    // 50-51: Часовой расход топлива (л/ч)
    const fuelRate = r2(u16(50) * 0.00215);

    // 52: Флаги завершения тестов OBD-II
    const b52 = u8(52);
    this.latestData.readiness = {
      cat: (b52 & 0x01) !== 0,
      purge: (b52 & 0x04) !== 0,
      o2: (b52 & 0x10) !== 0 || (b52 & 0x20) !== 0,
      o2Heater: (b52 & 0x40) !== 0
    };

    // 53-54 (байты 55-56 ответа 61 01): Аддитивная составляющая коррекции смеси FRA (%) (норма = 0.00%)
    // В OpenDiag (hk.java, case 55): (s16(55) * 100.0) / 32768.0 (формат %.2f)
    const addAdapt = r2(s16(53) * 100.0 / 32768.0);
    // 55-56 (байты 57-58 ответа 61 01): Коррекция Bank 2 (в 1-банковых моторах Priora = 0)
    const addAdaptBank2 = r2(s16(55) * 100.0 / 32768.0);
    // 57-58 (байты 59-60 ответа 61 01): Мультипликативная составляющая коррекции смеси FR (-) (норма = 1.000)
    // В OpenDiag (hk.java, case 59): u16(59) / 32768.0 (формат %.3f)
    const multAdapt = r3(u16(57) / 32768.0);
    // 59-60 (байты 61-62 ответа 61 01): Смещение уставки расхода воздуха ХХ (кг/ч)
    // В OpenDiag (hk.java, case 61): (s16(61) * 3.0) / 64.0 (формат %.1f)
    const idleAirOffset = r1(s16(59) * 3.0 / 64.0);
    const idleTorqueI = 0;
    const idleTorquePD = 0;

    // 62, 63, 64: Битовые флаги состояния
    const b62 = u8(62);
    const b63 = u8(63);
    const b64 = u8(64);

    const flags = {
      idle: (b62 & 0x01) !== 0,
      fullLoad: (b62 & 0x02) !== 0,
      acRequest: (b62 & 0x04) !== 0,
      acAllowed: (b62 & 0x08) !== 0,
      fuelPump: (b62 & 0x10) !== 0,
      fan1: (b62 & 0x20) !== 0,
      fan2: (b62 & 0x40) !== 0,
      mil: (b62 & 0x80) !== 0,

      knock: (b63 & 0x01) !== 0,
      chassis: (b63 & 0x02) !== 0,
      startChar: (b63 & 0x04) !== 0,
      lambda: (b63 & 0x08) !== 0,
      fuelCut: (b63 & 0x10) !== 0,
      o2Ready: (b63 & 0x20) !== 0,
      baseAdapt: (b63 & 0x40) !== 0,
      purgeActive: (b63 & 0x80) !== 0,

      misfirePaused: (b64 & 0x01) !== 0,
      roughRoadFlag: (b64 & 0x02) !== 0,
      o2_2_loop: (b64 & 0x04) !== 0,
      o2_2_ready: (b64 & 0x08) !== 0
    };

    // 65: Обороты двигателя на холостом ходу (об/мин)
    const idleRpm = bytes.length >= 66 ? u8(65) * 10 : idleTarget;
    // 66: Сигнал датчика кислорода ДК2 после нейтрализатора (В)
    const o2Volt2 = bytes.length >= 67 ? r3(u8(66) / 192.0 - 0.2) : 0.0;
    // 67: Период сигнала ДК1 до нейтрализатора (с)
    const o2Period = bytes.length >= 68 ? r2(u8(67) / 25.0) : 0.0;
    // 68: Интегральная часть задержки ОС по второму датчику (с)
    const o2_2_integralDelay = bytes.length >= 69 ? r2(s8(68) / 100.0) : 0.0;
    // 69: Корректированное среднее значение амплитуды ДК2 (-)
    const o2_2_amplitude = bytes.length >= 70 ? r3(s8(69) / 256.0) : 0.0;
    // 70-71: Сигнал датчика неровной дороги ДНД (ускорение в g)
    const roughRoad = bytes.length >= 72 ? r3((u16(70) * 6.25 / 32768.0) - 6.25) : 0.0;

    // Расчетные величины (физика мотора Приоры ВАЗ 21126 16V)
    const cycleAir = (rpm > 100 && maf > 0) ? r1((maf * 8333.33) / rpm) : 0.0;
    const dutyCycle = (rpm > 100 && injTime > 0) ? r1(Math.min(100, Math.max(0, (injTime * rpm) / 1200))) : 0.0;
    const enginePower = (maf > 0) ? r1(maf / 3.1) : 0.0;
    const engineTorque = (rpm > 200 && maf > 0) ? r1((maf / 3.1) * 7120 / rpm) : 0.0;

    // Запись в latestData
    this.latestData.dtcCount = dtcCount;
    this.latestData.tempAtStart = tempAtStart;
    this.latestData.temp = temp;
    this.latestData.intakeTemp = intakeTemp;
    this.latestData.voltage = voltage;
    this.latestData.speed = speed;
    this.latestData.throttle = throttle;
    this.latestData.rpm = rpm;
    this.latestData.maf = maf;
    this.latestData.spark = spark;
    this.latestData.sparkRetard = sparkRetard;

    this.latestData.frlLoad = frlLoad;
    this.latestData.calcLoad = calcLoad;
    this.latestData.altitudeFactor = altitudeFactor;
    this.latestData.cycleAir = cycleAir;
    this.latestData.airTargetIdle = airTargetIdle;

    this.latestData.injTime = injTime;
    this.latestData.dutyCycle = dutyCycle;
    this.latestData.fuelRate = fuelRate;
    this.latestData.lambdaCorr = lambdaCorr;
    this.latestData.targetLambda = targetLambda;
    this.latestData.purgeRate = purgeRate;
    this.latestData.multAdapt = multAdapt;
    this.latestData.addAdapt = addAdapt;

    this.latestData.idleTarget = idleTarget;
    this.latestData.iacSteps = iacSteps;
    this.latestData.idleAdapt = idleAdapt;
    this.latestData.idleTorqueI = idleTorqueI;
    this.latestData.idleTorquePD = idleTorquePD;
    this.latestData.idleRpm = idleRpm;

    this.latestData.o2Volt = o2Volt;
    this.latestData.o2Volt2 = o2Volt2;
    this.latestData.o2Period = o2Period;
    this.latestData.o2_2_integralDelay = o2_2_integralDelay;
    this.latestData.o2_2_amplitude = o2_2_amplitude;

    this.latestData.knockVolt = knockVolt;
    this.latestData.unbalanceRpm = unbalanceRpm;
    this.latestData.damperAdapt = damperAdapt;
    this.latestData.roughRoad = roughRoad;
    this.latestData.enginePower = enginePower;
    this.latestData.engineTorque = engineTorque;

    this.latestData.timeSinceReset = timeSinceReset;
    this.latestData.timeSinceResetHours = timeSinceResetHours;
    this.latestData.addAdaptBank2 = addAdaptBank2;
    this.latestData.idleAirOffset = idleAirOffset;
    this.latestData.ecuChecksum = ecuChecksum;
    this.latestData.flags = flags;

    return this.latestData;
  }

  /**
   * Разбор Кадра АЦП (в М73 это 21 03, ответ 61 03)
   * Точная калибровка ReadLogs (b797) и OpenDiag для процессора ST10F273 (Итэлма М73 / Bosch 7.9.7)
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
    const s8 = (i) => {
      const v = u8(i);
      return v > 127 ? v - 256 : v;
    };

    // Точная калибровка каналов АЦП из b797/Powertrain/pids.ini:
    // Байт 2-3 (payload 0-1): Бортовое напряжение (b7, 16 бит) -> raw * 0.0176 В
    this.latestData.adc.volt = +(u16(2) * 0.0176).toFixed(2);

    // Байт 4 (payload 2): ДТОЖ (VA, 8 бит) -> raw * 5.0 / 256.0 В (181 -> 3.535 В)
    this.latestData.adc.temp = +(u8(4) * (5.0 / 256.0)).toFixed(3);

    // Байт 5-6 (payload 3-4): ДМРВ (bJ, 10-бит АЦП 0..1023) -> raw * 5.0 / 1024.0 В
    // При покое дает эталонные 0.991 ... 1.012 В
    let mafAdcV = u16(5) * (5.0 / 1024.0);
    if (mafAdcV < 0.5 || mafAdcV > 2.0) {
      const raw7 = u16(7);
      if (raw7 >= 8000 && raw7 <= 15000) {
        mafAdcV = raw7 / 10000.0;
      }
    }
    this.latestData.adc.maf = +mafAdcV.toFixed(3);

        // ÐÐ°Ð¹Ñ 7 (payload 5): ÐÐÐÐ (8-Ð±Ð¸Ñ ÐÐ¦Ð) -> raw * 5.0 / 256.0 Ð (Ð¿Ð¾ÐºÐ¾Ð¹ 0.454 ... 0.74 Ð)
    this.latestData.adc.tps = +(u8(7) * (5.0 / 256.0)).toFixed(3);

    // Байт 9-10 (payload 7-8): ДК1 Управляющий лямбда-зонд (10-бит АЦП) -> raw * 5.0 / 1024.0 В (опорное 0.454 В)
    this.latestData.adc.o2 = +(u16(9) * (5.0 / 1024.0)).toFixed(3);

    // Байт 11 (payload 9): ДТВ Температура воздуха во впускном коллекторе (VA, 8 бит) -> raw * 5.0 / 256.0 В (3.867 В)
    this.latestData.adc.airTemp = +(u8(11) * (5.0 / 256.0)).toFixed(3);

    // Байт 12-13 (payload 10-11): ДК2 Диагностический зонд (10-бит АЦП) -> raw * 5.0 / 1024.0 В
    this.latestData.adc.o2_2 = +(u16(12) * (5.0 / 1024.0)).toFixed(3);

    // Байт 14-15 (payload 12-13): Сопротивление ДК1 (bN) -> raw * 2.0 Ом
    if (bytes.length >= 16) {
      this.latestData.adc.o2Resist1 = u16(14) * 2;
    }

        // ÐÐ°Ð¹Ñ 16 (payload 14): ÐÐÐ ÐÐ¿Ð¾ÑÐ½Ð¾Ðµ Ð½Ð°Ð¿ÑÑÐ¶ÐµÐ½Ð¸Ðµ Ð°ÐºÑÐµÐ»ÐµÑÐ¾Ð¼ÐµÑÑÐ° -> raw * 5.0 / 256.0 Ð (Ð¿Ð¾ÐºÐ¾Ð¹ 2.500 Ð)
    if (bytes.length >= 17) {
      this.latestData.adc.roughRoad = +(u8(16) * (5.0 / 256.0)).toFixed(3);
    }

    // Байт 17-18 (payload 15-16): Напряжение клапана продувки адсорбера -> raw * 5.0 / 1024.0 В
    if (bytes.length >= 19) {
      this.latestData.adc.valvePurge = +(u16(17) * (5.0 / 1024.0)).toFixed(3);
    }

    // Байт 19-20 (payload 17-18): Сопротивление ДК2 (bN) -> raw * 2.0 Ом
    if (bytes.length >= 21) {
      this.latestData.adc.o2Resist2 = u16(19) * 2;
    }

    return this.latestData.adc;
  }

  /**
   * ЧТЕНИЕ ОШИБОК ЭБУ (DTC)
   * KWP2000 Service 0x18: 18 00 FF 00 (ответ 58 [count] [DTC1] [Status1] ...)
   */
  async readDtcCodes() {
    this.elm.log('info', 'Запрос кодов неисправностей DTC (18 00 FF 00)...');
    try {
      await this.elm.send("AT SH 84 10 F1", 500);
      const raw = await this.elm.send("1800FF00", 1500);

      const hex = (raw || "").replace(/[\s\r\n]/g, '').toUpperCase();
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
    } finally {
      try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}
    }
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
    try {
      await this.elm.send("AT SH 83 10 F1", 500);
      const resp = (await this.elm.send("14FF00", 1500)).replace(/\s+/g, '').toUpperCase();
      return resp.startsWith("54") || resp.includes("OK");
    } finally {
      try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}
    }
  }

  async runActuatorTest(testType) {
    this.elm.log('info', `Запуск теста механизма: ${testType}`);

    // Команды KWP2000 службы 0x30 из OpenDiag для Итэлма М73:
    const map = {
      fan1_on: { id: "0A", duration: 4000, name: "Вентилятор 1" },
      fan2_on: { id: "0D", duration: 4000, name: "Вентилятор 2" },
      pump_on: { id: "09", duration: 3000, name: "Бензонасос" },
      mil_test: { id: "0C", duration: 3000, name: "Лампа Check Engine" }
    };

    const target = map[testType];
    if (!target) throw new Error("Неизвестный тест механизма: " + testType);

    await this.delay(150);

    try {
      // Устанавливаем заголовок под 3-байтовую команду управления ИМ
      await this.elm.send("AT SH 83 10 F1", 500);

      // 1. Включение механизма (30 <ID> 01)
      const cmdOn = `30${target.id}01`;
      this.elm.log('info', `[Тест ИМ] Включение ${target.name}: ${cmdOn}`);
      const rawResp = await this.elm.send(cmdOn, 2000);
      const respOn = (rawResp || "").replace(/\s+/g, '').toUpperCase();
      this.elm.log('info', `[Тест ИМ] Ответ ЭБУ: ${respOn || rawResp || "пусто"}`);

      if (respOn.includes("7F3022") || respOn.includes("7F22")) {
        throw new Error("ЭБУ отклонил тест (код 7F 30 22: условия не соблюдены). Двигатель должен быть полностью заглушен (0 об/мин) и включено зажигание.");
      }
      if (respOn.includes("7F3011") || respOn.includes("7F3012") || respOn.includes("7F3080")) {
        throw new Error(`ЭБУ отклонил команду: тест ${target.name} не поддерживается в данной сессии/прошивке (${respOn})`);
      }
      if (respOn.includes("7F")) {
        throw new Error(`ЭБУ отклонил команду (код ошибки: ${respOn})`);
      }
      if (!respOn.includes("70") && !respOn.includes("OK")) {
        throw new Error(`ЭБУ не подтвердил включение (${respOn || "нет ответа"}). Проверьте зажигание.`);
      }

      this.elm.log('info', `[Тест ИМ] ${target.name} активирован! Удержание ${target.duration / 1000} сек...`);

      // 2. Удержание в активном состоянии с Tester Present (3E)
      const startTime = Date.now();
      while (Date.now() - startTime < target.duration) {
        await this.delay(800);
        try { await this.elm.send("3E", 500); } catch (e) {}
      }

      // 3. Выключение механизма (30 <ID> 00)
      await this.delay(100);
      const cmdOff = `30${target.id}00`;
      this.elm.log('info', `[Тест ИМ] Выключение ${target.name}: ${cmdOff}`);
      try {
        await this.elm.send(cmdOff, 1500);
      } catch (e) {}

      return true;
    } finally {
      try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}
    }
  }

  async resetWithInit() {
    this.elm.log('info', 'Выполнение сброса ЭБУ с инициализацией (KWP2000 Reset 11 01)...');
    try {
      try {
        await this.elm.send("AT SH 82 10 F1", 500);
        const resp = await this.elm.send("1101", 2000);
        const clean = (resp || "").replace(/\s+/g, '').toUpperCase();
        if (clean.startsWith("5101") || clean.includes("OK")) {
          return true;
        }
      } catch (e) {}

      // Резервная попытка через старт процедуры 31 01 00
      this.elm.log('info', 'Резервная попытка сброса через 31 01 00...');
      try {
        await this.elm.send("AT SH 83 10 F1", 500);
        const resp2 = (await this.elm.send("310100", 2000)).replace(/\s+/g, '').toUpperCase();
        return resp2.startsWith("71") || resp2.includes("OK");
      } catch (e) {
        return false;
      }
    } finally {
      try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}
    }
  }

  delay(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  static get DTC_DICTIONARY() {
    return {
      "P0030": "Неисправность цепи нагревателя датчика кислорода 1 (до нейтрализатора)",
      "P0036": "Неисправность цепи нагревателя датчика кислорода 2 (после нейтрализатора)",
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
      "P0443": "Неисправность цепи управления клапаном продувки адсорбера",
      "P0480": "Неисправность цепи управления реле вентилятора 1",
      "P0481": "Неисправность цепи управления реле вентилятора 2",
      "P0500": "Неисправность в цепи датчика скорости автомобиля",
      "P0501": "Сигнал датчика скорости автомобиля вне допустимого диапазона",
      "P0560": "Неисправность напряжения питания системы",
      "P1545": "Неисправность привода дроссельной заслонки / отклонение положения",
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
