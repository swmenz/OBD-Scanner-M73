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
    this._queue = Promise.resolve(); // Последовательная очередь команд (Mutex)
    
    this.onLog = null;
    this.onDisconnect = null;
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
      // Ищем конкретно ваш адаптер "OBD BLE" или любые устройства с префиксами OBD/IOS/ELM
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { name: "OBD BLE" },
          { namePrefix: "OBD" },
          { namePrefix: "IOS" },
          { namePrefix: "Viecar" },
          { namePrefix: "V-LINK" },
          { namePrefix: "ELM" }
        ],
        optionalServices: optionalServices
      });
    } catch (err1) {
      this.log('info', 'Повторная попытка без фильтра имен...');
      try {
        // Резервный вариант, если имя адаптера скрыто
        this.device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: optionalServices
        });
      } catch (err2) {
        if (err2.name === 'NotFoundError' || (err2.message && err2.message.includes('User cancelled'))) {
          throw new Error("Окно выбора закрыто или устройство не выбрано");
        }
        throw new Error(err2.message || "Не удалось найти Bluetooth устройство");
      }
    }

    if (!this.device) {
      throw new Error("Адаптер не выбран");
    }

    this.log('info', `Выбран адаптер: ${this.device.name || 'Безымянный'}`);

    this.device.addEventListener('gattserverdisconnected', () => {
      this.isConnected = false;
      this.log('err', 'Связь с Bluetooth адаптером разорвана');
      if (this.onDisconnect) this.onDisconnect();
    });

    this.log('info', 'Подключение к GATT серверу адаптера...');
    this.server = await this.device.gatt.connect();

    await this._discoverSerialPort();
    
    this.isConnected = true;
    this.log('info', 'Порт BLE успешно открыт и готов к работе!');
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
        this.rxCharacteristic.addEventListener(
          'characteristicvaluechanged', 
          (e) => this._onDataReceived(e)
        );

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
          this.rxCharacteristic.addEventListener('characteristicvaluechanged', (e) => this._onDataReceived(e));
          this.log('info', `Автоматически подобран порт в сервисе ${s.uuid}`);
          return;
        }
      }
    } catch (e) {}

    throw new Error("Не удалось найти последовательный порт (SPP/UART) на адаптере");
  }

  _onDataReceived(event) {
    const value = event.target.value;
    const decoder = new TextDecoder('utf-8');
    const chunk = decoder.decode(value);
    
    this.rxBuffer += chunk;

    if (this.rxBuffer.includes('>')) {
      if (this.commandTimeoutTimer) {
        clearTimeout(this.commandTimeoutTimer);
        this.commandTimeoutTimer = null;
      }

      const fullResponse = this.rxBuffer.replace(/>/g, '').trim();
      this.rxBuffer = "";

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
    this._queue = this._queue.catch(() => {}).then(() => {
      return new Promise((resolve, reject) => {
        this.rxBuffer = "";

        const encoder = new TextEncoder();
        const cleanCmd = command.trim() + "\r";
        const data = encoder.encode(cleanCmd);

        this.log('tx', command);

        this.activeResolver = (resp) => {
          this.log('rx', resp);
          resolve(resp);
        };
        this.activeRejecter = reject;

        this.commandTimeoutTimer = setTimeout(() => {
          const partial = this.rxBuffer;
          this.rxBuffer = "";
          this.activeResolver = null;
          this.activeRejecter = null;
          this.log('err', `Таймаут команды ${command} (${timeoutMs}мс)`);
          reject(new Error(`Timeout: ${command}. Ответ: ${partial}`));
        }, timeoutMs);

        const writePromise = this.txCharacteristic.writeValueWithoutResponse
          ? this.txCharacteristic.writeValueWithoutResponse(data).catch(() => this.txCharacteristic.writeValue(data))
          : this.txCharacteristic.writeValue(data);

        writePromise.catch((err) => {
          if (this.commandTimeoutTimer) {
            clearTimeout(this.commandTimeoutTimer);
            this.commandTimeoutTimer = null;
          }
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
    this.activeResolver = null;
    this.activeRejecter = null;
    this._queue = Promise.resolve();

    if (this.device && this.device.gatt.connected) {
      await this.device.gatt.disconnect();
    }
    this.isConnected = false;
  }
}

window.Elm327BLE = Elm327BLE;
