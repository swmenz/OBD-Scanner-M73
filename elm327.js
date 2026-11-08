/**
 * Драйвер скоростной связи с адаптером ELM327 по Bluetooth Low Energy (BLE)
 * Полностью адаптирован под iOS (браузер Bluefy) и адаптер "OBD BLE" (PIC18F25K80 BT 5.1).
 */

class Elm327BLE {
  constructor() {
    this.device = null;
    this.server = null;
    this.service = null;
    this.txCharacteristic = null;
    this.rxCharacteristic = null;
    
    this.isConnected = false;
    this.rxBuffer = "";
    this.activeResolver = null;
    this.activeRejecter = null;
    this.commandTimeoutTimer = null;
    this._needsResync = false;
    this._queue = Promise.resolve(); // Последовательная очередь команд (Mutex)

    // Единые ссылки на обработчики: повторная регистрация одной и той же функции
    // браузером игнорируется, поэтому после переподключения пакеты не задваиваются
    this._rxHandler = (e) => this._onDataReceived(e);
    this._gattHandler = () => this._onGattDisconnected();
    
    this.onLog = null;
    this.onDisconnect = null;

    // Реиспользуемые декодер/энкодер для устранения GC-пауз в высокочастотном цикле (4-5 Гц)
    this._decoder = new TextDecoder('utf-8');
    this._encoder = new TextEncoder();
  }

  _onGattDisconnected() {
    this.isConnected = false;
    // Немедленно отклоняем зависшую команду и гасим таймер, чтобы очередь не ждала таймаут
    if (this.commandTimeoutTimer) {
      clearTimeout(this.commandTimeoutTimer);
      this.commandTimeoutTimer = null;
    }
    const pendingReject = this.activeRejecter;
    this.activeResolver = null;
    this.activeRejecter = null;
    this.rxBuffer = "";
    this._needsResync = false;
    if (this._decoder) this._decoder.decode();
    if (pendingReject) pendingReject(new Error("Связь с адаптером потеряна"));
    this.log('err', 'Связь с Bluetooth адаптером разорвана');
    if (this.onDisconnect) this.onDisconnect();
  }

  // 128-битные строковые UUID (строго требуется для iOS WebKit / Bluefy)
  static get CANDIDATE_SERVICES() {
    return [
      // 1. Стандартный чип BLE (Vgate, Viecar, OBD BLE, PIC18F25K80)
      {
        name: "FFF0 (Стандартный SPP BLE)",
        service: "0000fff0-0000-1000-8000-00805f9b34fb",
        tx: "0000fff2-0000-1000-8000-00805f9b34fb",
        rx: "0000fff1-0000-1000-8000-00805f9b34fb"
      },
      // 2. Альтернативный чип CC2541 / HM-10 (FFE0)
      {
        name: "FFE0 (HM-10 / CC2541)",
        service: "0000ffe0-0000-1000-8000-00805f9b34fb",
        tx: "0000ffe1-0000-1000-8000-00805f9b34fb",
        rx: "0000ffe1-0000-1000-8000-00805f9b34fb"
      },
      // 3. Nordic UART Service
      {
        name: "Nordic UART",
        service: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
        tx: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
        rx: "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
      },
      // 4. OBDLink / Carista
      {
        name: "18F0 (OBDLink)",
        service: "000018f0-0000-1000-8000-00805f9b34fb",
        tx: "00002af0-0000-1000-8000-00805f9b34fb",
        rx: "00002af1-0000-1000-8000-00805f9b34fb"
      }
    ];
  }

  log(type, msg) {
    if (this.onLog) this.onLog(type, msg);
  }

  /**
   * Запуск системного окна iOS для подключения к "OBD BLE"
   */
  async requestAndConnect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth не поддерживается. Откройте страницу в приложении Bluefy на iOS!");
    }

    this.log('info', 'Поиск адаптера "OBD BLE"...');

    // Только строковые 128-битные UUID (исправляет ошибку Bluefy: "Request payload could not be parsed")
    const optionalServices = [
      "0000fff0-0000-1000-8000-00805f9b34fb",
      "0000ffe0-0000-1000-8000-00805f9b34fb",
      "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
      "000018f0-0000-1000-8000-00805f9b34fb"
    ];

    try {
      // Ищем адаптер "OBD BLE" или любые устройства с диагностическими префиксами
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { name: "OBD BLE" },
          { namePrefix: "OBD" },
          { namePrefix: "OBDII" },
          { namePrefix: "IOS" },
          { namePrefix: "Viecar" },
          { namePrefix: "V-LINK" },
          { namePrefix: "vLinker" },
          { namePrefix: "Veepeak" },
          { namePrefix: "Vgate" },
          { namePrefix: "ELM" },
          { namePrefix: "iCar" },
          { namePrefix: "KONNWEI" },
          { namePrefix: "CARISTA" },
          { namePrefix: "Android" },
          { namePrefix: "K-Line" }
        ],
        optionalServices: optionalServices
      });
    } catch (err) {
      const msg = (err && err.message) ? String(err.message) : '';
      const isUserCancel = !err || err.name === 'NotFoundError' || err.name === 'AbortError' || /cancel|dismiss|closed|user|chosen/i.test(msg);
      if (isUserCancel) {
        this.log('info', 'Окно выбора адаптера закрыто');
        const cancelErr = new Error("Поиск устройства отменен пользователем");
        cancelErr.isCancelled = true;
        throw cancelErr;
      }
      this.log('err', 'Ошибка Bluetooth: ' + (msg || err));
      throw err;
    }

    if (!this.device) {
      const cancelErr = new Error("Адаптер не выбран");
      cancelErr.isCancelled = true;
      throw cancelErr;
    }

    this.log('info', `Выбран адаптер: ${this.device.name || 'Безымянный'}`);

    this.device.addEventListener('gattserverdisconnected', this._gattHandler);

    this.log('info', 'Подключение к GATT серверу адаптера...');
    this.server = await this.device.gatt.connect();

    await this._discoverSerialPort();
    
    this.isConnected = true;
    this.log('info', 'Порт BLE успешно открыт и готов к работе!');
  }

  /**
   * Тихое переподключение к уже авторизованному адаптеру без показа окна выбора устройства iOS.
   * Позволяет мгновенно восстанавливать связь после сворачивания браузера (музыка, навигатор).
   */
  async silentReconnect() {
    if (!this.device) {
      throw new Error("Адаптер ранее не выбирался, тихое подключение невозможно");
    }

    this.log('info', `Тихое переподключение к "${this.device.name || 'OBD BLE'}"...`);

    // Гасим зависшие таймеры и очищаем очередь
    if (this.commandTimeoutTimer) {
      clearTimeout(this.commandTimeoutTimer);
      this.commandTimeoutTimer = null;
    }
    const pendingReject = this.activeRejecter;
    this.activeResolver = null;
    this.activeRejecter = null;
    this.rxBuffer = "";
    this._needsResync = false;
    if (this._decoder) this._decoder.decode();
    if (pendingReject) {
      try { pendingReject(new Error("Переподключение")); } catch (e) {}
    }
    this._queue = Promise.resolve();

    // Если GATT числился подключенным, производим аккуратный дисконнект перед новым коннектом
    try {
      if (this.device.gatt && this.device.gatt.connected) {
        await this.device.gatt.disconnect();
      }
    } catch (e) {}

    // Гарантируем регистрацию обработчика разрыва связи
    try {
      this.device.removeEventListener('gattserverdisconnected', this._gattHandler);
    } catch (e) {}
    this.device.addEventListener('gattserverdisconnected', this._gattHandler);

    this.log('info', 'Подключение к GATT серверу адаптера...');
    this.server = await this.device.gatt.connect();

    await this._discoverSerialPort();

    this.isConnected = true;
    this.log('info', 'Порт BLE успешно переподключен!');
    return true;
  }

  /**
   * Перебор профилей BLE для нахождения портов TX/RX
   */
  async _discoverSerialPort() {
    for (const candidate of Elm327BLE.CANDIDATE_SERVICES) {
      try {
        const service = await this.server.getPrimaryService(candidate.service);
        const rxChar = await service.getCharacteristic(candidate.rx);
        const txChar = (candidate.tx === candidate.rx) 
          ? rxChar 
          : await service.getCharacteristic(candidate.tx);

        this.service = service;
        this.rxCharacteristic = rxChar;
        this.txCharacteristic = txChar;

        // Включаем уведомления от ELM
        await this.rxCharacteristic.startNotifications();
        this.rxCharacteristic.addEventListener('characteristicvaluechanged', this._rxHandler);

        this.log('info', `Определен тип порта: ${candidate.name}`);
        return;
      } catch (e) {
        // Пробуем следующий сервис
      }
    }

    // Если стандартные не подошли, пробуем получить все сервисы устройства
    try {
      const services = await this.server.getPrimaryServices();
      for (const s of services) {
        const chars = await s.getCharacteristics();
        let rx = null;
        let tx = null;
        for (const c of chars) {
          if (c.properties.notify || c.properties.indicate) rx = c;
          if (c.properties.write || c.properties.writeWithoutResponse) tx = c;
        }
        if (rx && tx) {
          this.service = s;
          this.rxCharacteristic = rx;
          this.txCharacteristic = tx;
          await this.rxCharacteristic.startNotifications();
          this.rxCharacteristic.addEventListener('characteristicvaluechanged', this._rxHandler);
          this.log('info', `Автоматически подобран порт в сервисе ${s.uuid}`);
          return;
        }
      }
    } catch (e) {}

    throw new Error("Не удалось найти последовательный порт (SPP/UART) на адаптере");
  }

  _onDataReceived(event) {
    if (!this.activeResolver) {
      this.rxBuffer = "";
      return;
    }
    const value = event.target.value;
    const chunk = this._decoder.decode(value, { stream: true });
    
    this.rxBuffer += chunk;

    if (this.rxBuffer.includes('>')) {
      if (this.commandTimeoutTimer) {
        clearTimeout(this.commandTimeoutTimer);
        this.commandTimeoutTimer = null;
      }

      const fullResponse = this.rxBuffer.replace(/>/g, '').trim();
      this.rxBuffer = "";
      if (this._decoder) this._decoder.decode();

      if (this.activeResolver) {
        const resolve = this.activeResolver;
        this.activeResolver = null;
        this.activeRejecter = null;
        resolve(fullResponse);
      }
    }
  }

  send(command, timeoutMs = 1200) {
    if (!this.isConnected || !this.txCharacteristic) {
      return Promise.reject(new Error("Адаптер не подключен"));
    }

    // Последовательная очередь (Mutex) — исключает наложение и гонки команд
    this._queue = this._queue.catch(() => {}).then(async () => {
      if (!this.isConnected || !this.txCharacteristic) {
        throw new Error("Адаптер не подключен");
      }

      // Если предыдущая команда завершилась по таймауту или сбою записи —
      // выдерживаем короткую паузу тишины (140 мс) при закрытом activeResolver,
      // чтобы запоздавшие пакеты BLE от старой команды были отброшены и не сдвинули очередь
      if (this._needsResync) {
        this._needsResync = false;
        this.rxBuffer = "";
        if (this._decoder) this._decoder.decode();
        await new Promise(r => setTimeout(r, 140));
        if (!this.isConnected || !this.txCharacteristic) {
          throw new Error("Адаптер не подключен");
        }
      }

      return new Promise((resolve, reject) => {
        if (!this.isConnected || !this.txCharacteristic) {
          return reject(new Error("Адаптер не подключен"));
        }

        this.rxBuffer = "";
        if (this._decoder) this._decoder.decode();

        const cleanCmd = command.trim() + "\r";
        const data = this._encoder.encode(cleanCmd);

        this.log('tx', command);

        this.activeResolver = (resp) => {
          this.log('rx', resp);
          resolve(resp);
        };
        this.activeRejecter = reject;

        this.commandTimeoutTimer = setTimeout(() => {
          const partial = this.rxBuffer;
          this.rxBuffer = "";
          this._needsResync = true;
          if (this._decoder) this._decoder.decode();
          this.activeResolver = null;
          this.activeRejecter = null;
          this.log('err', `Таймаут команды ${command} (${timeoutMs}мс)`);
          reject(new Error(`Timeout: ${command}. Ответ: ${partial}`));
        }, timeoutMs);

        // Проверяем РЕАЛЬНУЮ поддержку writeWithoutResponse характеристикой GATT,
        // а не просто наличие метода в прототипе Web Bluetooth (устраняет ложный сбой и задержку 15-25 мс)
        const props = this.txCharacteristic.properties;
        const canWriteNoResp = Boolean(props && props.writeWithoutResponse && this.txCharacteristic.writeValueWithoutResponse);
        const writePromise = canWriteNoResp
          ? this.txCharacteristic.writeValueWithoutResponse(data).catch(() => this.txCharacteristic.writeValue(data))
          : this.txCharacteristic.writeValue(data);

        writePromise.catch((err) => {
          if (this.commandTimeoutTimer) {
            clearTimeout(this.commandTimeoutTimer);
            this.commandTimeoutTimer = null;
          }
          this._needsResync = true;
          this.activeResolver = null;
          this.activeRejecter = null;
          reject(err);
        });
      });
    });

    return this._queue;
  }

  async disconnect() {
    if (this.commandTimeoutTimer) {
      clearTimeout(this.commandTimeoutTimer);
      this.commandTimeoutTimer = null;
    }
    const pendingReject = this.activeRejecter;
    this.activeResolver = null;
    this.activeRejecter = null;
    this.rxBuffer = "";
    this._needsResync = false;
    if (this._decoder) this._decoder.decode();
    if (pendingReject) {
      pendingReject(new Error("Соединение с адаптером разорвано"));
    }
    this._queue = Promise.resolve();

    if (this.device) {
      try {
        this.device.removeEventListener('gattserverdisconnected', this._gattHandler);
      } catch (e) {}
      if (this.device.gatt && this.device.gatt.connected) {
        try {
          await this.device.gatt.disconnect();
        } catch (e) {}
      }
    }
    this.isConnected = false;
  }
}

window.Elm327BLE = Elm327BLE;
