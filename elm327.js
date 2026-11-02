/**
 * Драйвер скоростной связи с адаптером ELM327 по Bluetooth Low Energy (BLE)
 * Поддерживает автоопределение чипов BLE (FFF0, FFE0, Nordic UART и др.)
 * и агрессивную оптимизацию задержек для максимальной частоты опроса.
 */

class Elm327BLE {
  constructor() {
    this.device = null;
    this.server = null;
    this.service = null;
    this.txCharacteristic = null; // Для отправки команд в ELM
    this.rxCharacteristic = null; // Для приема ответов от ELM
    
    this.isConnected = false;
    this.rxBuffer = "";
    this.activeResolver = null;
    this.activeRejecter = null;
    this.commandTimeoutTimer = null;
    
    // Подписчики на логирование терминала
    this.onLog = null; // (type: 'tx'|'rx'|'info'|'err', message: string) => void
    this.onDisconnect = null;
  }

  // Распространенные UUID сервисов и характеристик для китайских клонов ELM327 BLE
  static get CANDIDATE_SERVICES() {
    return [
      // 1. Стандартный чип BLE (Vgate, Viecar, большинство PIC18F25K80)
      {
        service: 0xfff0,
        tx: 0xfff2, // Write
        rx: 0xfff1  // Notify
      },
      // 2. Альтернативный чип CC2541 / HM-10
      {
        service: 0xffe0,
        tx: 0xffe1,
        rx: 0xffe1
      },
      // 3. Nordic UART Service
      {
        service: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
        tx: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
        rx: "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
      },
      // 4. OBDLink / Carista
      {
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
   * Запуск стандартного системного диалога Web Bluetooth для выбора ELM327
   */
  async requestAndConnect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth не поддерживается этим браузером. Откройте в Bluefy на iOS!");
    }

    this.log('info', 'Поиск адаптера Bluetooth BLE...');

    const optionalServices = [
      0xfff0, 0xffe0, 
      "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
      "000018f0-0000-1000-8000-00805f9b34fb"
    ];

    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: optionalServices
      });
    } catch (e) {
      if (e.name === 'NotFoundError' || (e.message && e.message.includes('User cancelled'))) {
        throw new Error("Устройство не выбрано. Вставьте ELM327 в разъём авто и включите зажигание.");
      }
      throw new Error(e.message || "Bluetooth устройство не найдено");
    }

    if (!this.device) {
      throw new Error("Устройство не выбрано");
    }

    this.log('info', `Выбран адаптер: ${this.device.name || 'Безымянный'}`);

    this.device.addEventListener('gattserverdisconnected', () => {
      this.isConnected = false;
      this.log('err', 'Связь с Bluetooth адаптером разорвана');
      if (this.onDisconnect) this.onDisconnect();
    });

    this.log('info', 'Подключение к GATT серверу...');
    this.server = await this.device.gatt.connect();

    // Автоопределение сервиса и характеристик TX/RX
    await this._discoverSerialPort();
    
    this.isConnected = true;
    this.log('info', 'Канал BLE успешно открыт!');
  }

  /**
   * Перебор профилей BLE для нахождения порта передачи данных
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

        // Включаем подписку на входящие уведомления от ELM
        await this.rxCharacteristic.startNotifications();
        this.rxCharacteristic.addEventListener(
          'characteristicvaluechanged', 
          (e) => this._onDataReceived(e)
        );

        this.log('info', `Определен тип BLE чипа: Service 0x${candidate.service.toString(16)}`);
        return;
      } catch (e) {
        // Пробуем следующий сервис
      }
    }
    throw new Error("Не удалось найти последовательный порт (SPP/UART) на этом адаптере");
  }

  /**
   * Обработчик входящих байт по радиоканалу Bluetooth
   */
  _onDataReceived(event) {
    const value = event.target.value;
    const decoder = new TextDecoder('utf-8');
    const chunk = decoder.decode(value);
    
    this.rxBuffer += chunk;

    // Символ '>' в протоколе ELM означает конец ответа и готовность к новой команде
    if (this.rxBuffer.includes('>')) {
      if (this.commandTimeoutTimer) {
        clearTimeout(this.commandTimeoutTimer);
        this.commandTimeoutTimer = null;
      }

      const fullResponse = this.rxBuffer.replace(/>/g, '').trim();
      this.rxBuffer = ""; // Очищаем буфер под следующий ответ

      if (this.activeResolver) {
        const resolve = this.activeResolver;
        this.activeResolver = null;
        this.activeRejecter = null;
        resolve(fullResponse);
      }
    }
  }

  /**
   * Скоростная отправка команды с таймаутом
   */
  async send(command, timeoutMs = 1200) {
    if (!this.isConnected || !this.txCharacteristic) {
      throw new Error("Адаптер не подключен");
    }

    // Если в буфере остался старый мусор, сбрасываем его
    this.rxBuffer = "";

    const encoder = new TextEncoder();
    const cleanCmd = command.trim() + "\r";
    const data = encoder.encode(cleanCmd);

    this.log('tx', command);

    return new Promise((resolve, reject) => {
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
        reject(new Error(`Timeout: ${command}. Получено: ${partial}`));
      }, timeoutMs);

      // Отправляем байты в BLE характеристику
      if (this.txCharacteristic.writeValueWithoutResponse) {
        this.txCharacteristic.writeValueWithoutResponse(data).catch(err => {
          this.txCharacteristic.writeValue(data).catch(reject);
        });
      } else {
        this.txCharacteristic.writeValue(data).catch(reject);
      }
    });
  }

  /**
   * Разрыв соединения
   */
  async disconnect() {
    if (this.device && this.device.gatt.connected) {
      await this.device.gatt.disconnect();
    }
    this.isConnected = false;
  }
}

window.Elm327BLE = Elm327BLE;
