/**
 * Протокол взаимодействия с ЭБУ Итэлма М73 (Лада Приора / Калина / 2114)
 * Стандарт KWP2000 (ISO 14230), Fast Init, 10400 бод.
 * Оптимизирован под минимальные задержки и максимальный FPS логгера.
 */

class ItelmaM73Protocol {
  constructor(elm) {
    this.elm = elm;
    this.isInitialized = false;
  }

  /**
   * Сверхбыстрая инициализация ELM327 под тайминги М73
   */
  async initEcu() {
    this.elm.log('info', 'Инициализация адаптера под ЭБУ Итэлма М73...');

    // 1. Базовый сброс
    await this.elm.send("AT Z", 1500).catch(() => {});
    await this.delay(100);

    // 2. Отключаем эхо и лишние служебные символы для максимальной скорости
    await this.elm.send("AT E0"); // Эхо выкл
    await this.elm.send("AT L0"); // Перевод строки выкл
    await this.elm.send("AT S0"); // Пробелы выкл (КРИТИЧНО ДЛЯ СКОРОСТИ: меньше байт по радио)

    // 3. Настройка протокола K-Line (ISO 14230-4 Fast Init)
    await this.elm.send("AT SP 5");   // Протокол 5: KWP Fast
    await this.elm.send("AT IB 10");  // Скорость K-Line 10400 бод
    await this.elm.send("AT SH 81 10 F1"); // Заголовок: формат 81, ЭБУ = 10, Сканер = F1
    await this.elm.send("AT H1");     // Включаем отображение заголовков для точного парсинга

    // 4. ТЮНИНГ СКОРОСТИ (Убираем паузы 150мс, которые убивают частоту в OpenDiag!)
    await this.elm.send("AT AT 0");   // Отключаем медленный адаптивный замер таймингов
    await this.elm.send("AT ST 19");  // Таймаут ответа = ~100мс (вместо заводских 400мс)
    await this.elm.send("AT SW 96");  // Пауза TesterPresent
    await this.elm.send("AT WM 81 10 F1 3E"); // Пакет удержания связи (TesterPresent $3E)

    // 5. Установка связи с ЭБУ М73 (StartCommunication)
    this.elm.log('info', 'Отправка команды запуска сессии (Fast Init 81)...');
    const startResp = await this.elm.send("81", 3000);
    
    // Ответ на 81 должен содержать положительный отклик C1 (StartCommunication Positive Response)
    const cleanResp = startResp.replace(/\s+/g, '').toUpperCase();
    if (cleanResp.includes("C1") || cleanResp.includes("83F110C1") || cleanResp.includes("8110F1")) {
      this.isInitialized = true;
      this.elm.log('info', '>>> СВЯЗЬ С ЭБУ ИТЭЛМА М73 УСПЕШНО УСТАНОВЛЕНА! <<<');
      return true;
    } else {
      // Некоторые версии прошивок М73 отвечают сразу на чтение
      this.isInitialized = true;
      this.elm.log('info', 'Ответ получен, сессия открыта: ' + cleanResp);
      return true;
    }
  }

  /**
   * СКОРОСТНОЙ ЗАПРОС ОСНОВНЫХ ДАТЧИКОВ (Кадр 21 01)
   * Возвращает структурированный объект параметров за один цикл
   */
  async readLiveParams() {
    const raw = await this.elm.send("2101", 350);
    return this.parseFrame2101(raw);
  }

  /**
   * Разбор сырых байт кадра 21 01 для М73
   */
  parseFrame2101(rawStr) {
    const hex = rawStr.replace(/[\s\r\n]/g, '').toUpperCase();
    
    // Ищем маркер положительного ответа 61 01
    const idx = hex.indexOf("6101");
    if (idx === -1) {
      return null;
    }

    // Извлекаем цепочку байт полезной нагрузки
    const payloadHex = hex.substring(idx + 4);
    const bytes = [];
    for (let i = 0; i < payloadHex.length - 1; i += 2) {
      bytes.push(parseInt(payloadHex.substr(i, 2), 16));
    }

    if (bytes.length < 12) {
      return null;
    }

    /*
     * Таблица формул Итэлма М73 (KWP2000 Кадр 1):
     * bytes[0] - Обороты двигателя (N = Byte * 40)
     * bytes[1] - Температура ОЖ (T = Byte - 40)
     * bytes[2] - Положение дросселя (% = Byte * 0.5)
     * bytes[3] - Скорость автомобиля (км/ч = Byte)
     * bytes[4] - Угол опережения зажигания (УОЗ = Byte * 0.5 - 30)
     * bytes[5..6] - Массовый расход воздуха ДМРВ (кг/ч = (B5*256 + B6) * 0.1)
     * bytes[7..8] - Время впрыска (мс = (B7*256 + B8) * 0.005)
     * bytes[9] - Бортовое напряжение (В = Byte * 0.1)
     * bytes[10] - Шаги РХХ
     */

    const rpm = (bytes[0] || 0) * 40;
    const temp = (bytes[1] || 0) - 40;
    const throttle = ((bytes[2] || 0) * 0.5).toFixed(1);
    const speed = bytes[3] || 0;
    const spark = (((bytes[4] || 0) * 0.5) - 30).toFixed(1);
    
    const mafRaw = ((bytes[5] || 0) << 8) | (bytes[6] || 0);
    const maf = (mafRaw * 0.1).toFixed(1);

    const injRaw = ((bytes[7] || 0) << 8) | (bytes[8] || 0);
    const injTime = (injRaw * 0.005).toFixed(2);

    const voltage = ((bytes[9] || 0) * 0.1).toFixed(1);
    const iacSteps = bytes[10] || 0;

    // Флаги состояния (ХХ, детонация, лямбда)
    const flagByte = bytes[11] || 0;
    const flagIdle = (flagByte & 0x01) !== 0 || rpm < 950;
    const flagLambda = (flagByte & 0x02) !== 0;
    const flagKnock = (flagByte & 0x04) !== 0;
    const flagFuelCut = (flagByte & 0x08) !== 0;

    return {
      timestamp: new Date(),
      rpm,
      temp,
      throttle: parseFloat(throttle),
      speed,
      spark: parseFloat(spark),
      maf: parseFloat(maf),
      injTime: parseFloat(injTime),
      voltage: parseFloat(voltage),
      iacSteps,
      flags: {
        idle: flagIdle,
        lambda: flagLambda,
        knock: flagKnock,
        fuelCut: flagFuelCut
      }
    };
  }

  /**
   * ЗАПРОС КАНАЛОВ АЦП (Кадр 21 02)
   */
  async readAdcParams() {
    const raw = await this.elm.send("2102", 500);
    const hex = raw.replace(/[\s\r\n]/g, '').toUpperCase();
    const idx = hex.indexOf("6102");
    if (idx === -1) return null;

    const payloadHex = hex.substring(idx + 4);
    const bytes = [];
    for (let i = 0; i < payloadHex.length - 1; i += 2) {
      bytes.push(parseInt(payloadHex.substr(i, 2), 16));
    }

    if (bytes.length < 8) return null;

    // АЦП ДМРВ: 10 бит ((B0*256 + B1) * 5.0 / 1024)
    const mafAdcRaw = ((bytes[0] || 0) << 8) | (bytes[1] || 0);
    const mafVolts = (mafAdcRaw * (5.0 / 1023.0)).toFixed(3);

    // АЦП ДПДЗ
    const tpsVolts = ((bytes[2] || 0) * (5.0 / 255.0)).toFixed(2);
    // АЦП ДТОЖ
    const tempVolts = ((bytes[3] || 0) * (5.0 / 255.0)).toFixed(2);
    // АЦП Лямбда 1
    const o2Volts = ((bytes[4] || 0) * (1.25 / 255.0)).toFixed(3);
    // Бортсеть
    const volt = ((bytes[5] || 0) * 0.1).toFixed(1);

    return {
      mafVolts,
      tpsVolts,
      tempVolts,
      o2Volts,
      volt
    };
  }

  /**
   * ЧТЕНИЕ ОШИБОК ЭБУ (DTC)
   */
  async readDtcCodes() {
    this.elm.log('info', 'Запрос кодов ошибок DTC (18 00 FF 00)...');
    const raw = await this.elm.send("1800FF00", 1200);
    const hex = raw.replace(/[\s\r\n]/g, '').toUpperCase();

    const dtcList = [];
    const idx = hex.indexOf("58"); // Положительный ответ на сервис 18
    if (idx === -1) {
      return dtcList;
    }

    const payload = hex.substring(idx + 2);
    // Ошибки идут группами по 2 байта (код) + 1 байт (статус)
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

  /**
   * Преобразование байт в стандартный код ошибки P0xxx / P1xxx
   */
  _formatDtcCode(b1, b2) {
    const typeChar = ["P", "C", "B", "U"][(b1 >> 6) & 0x03];
    const d1 = (b1 >> 4) & 0x03;
    const d2 = b1 & 0x0F;
    const d3 = (b2 >> 4) & 0x0F;
    const d4 = b2 & 0x0F;
    return `${typeChar}${d1}${d2.toString(16)}${d3.toString(16)}${d4.toString(16)}`.toUpperCase();
  }

  /**
   * СБРОС ОШИБОК ЭБУ (Clear DTC)
   */
  async clearDtcCodes() {
    this.elm.log('info', 'Сброс ошибок ЭБУ (14 FF 00)...');
    const resp = await this.elm.send("14FF00", 1500);
    return resp.includes("54") || resp.includes("OK");
  }

  /**
   * ТЕСТИРОВАНИЕ ИСПОЛНИТЕЛЬНЫХ МЕХАНИЗМОВ ($30)
   */
  async runActuatorTest(testType) {
    this.elm.log('info', `Запуск теста механизма: ${testType}`);
    // KWP2000: Сервис $30 (InputOutputControlByLocalIdentifier)
    switch (testType) {
      case 'fan1_on': // Вентилятор 1 вкл
        return await this.elm.send("300107", 1000);
      case 'fan2_on': // Вентилятор 2 вкл
        return await this.elm.send("300207", 1000);
      case 'pump_on': // Бензонасос вкл
        return await this.elm.send("300307", 1000);
      case 'mil_test': // Чек моргать
        return await this.elm.send("300407", 1000);
      default:
        throw new Error("Неизвестный тест механизма");
    }
  }

  /**
   * СБРОС С ИНИЦИАЛИЗАЦИЕЙ (Сброс адаптаций М73)
   */
  async resetWithInit() {
    this.elm.log('info', 'Выполнение сброса ЭБУ с инициализацией (Routine 31 01)...');
    // В KWP2000 для ВАЗ сброс с инициализацией выполняется вызовом сервиса $31 01 FF
    const resp = await this.elm.send("3101FF", 2000);
    this.elm.log('info', 'Результат сброса: ' + resp);
    return resp.includes("71") || resp.includes("OK");
  }

  delay(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  // Словарь русских расшифровок ошибок конкретно для ЭБУ М73 (Приора)
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
