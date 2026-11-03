/**
 * Хранилище логов в энергонезависимой памяти браузера (IndexedDB)
 * Автоматически сохраняет поездки при выключении зажигания и защищает от потери данных.
 */
class TripStorage {
  constructor() {
    this.dbName = 'Priora_M73_Logs';
    this.storeName = 'trips';
    this.version = 1;
    this.db = null;
  }

  async _openDb() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async saveTrip(records, maxRpm = 0) {
    if (!records || records.length === 0) return null;
    const db = await this._openDb();
    const now = new Date();
    const dateFormatted = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const fileDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    
    const trip = {
      id: Date.now(),
      dateStr: dateFormatted,
      fileName: `Приора_М73_Лог_${fileDateStr}.xlsx`,
      pointCount: records.length,
      maxRpm: maxRpm,
      records: records
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      store.add(trip);
      tx.oncomplete = async () => {
        await this._pruneOldTrips();
        resolve(trip);
      };
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async _pruneOldTrips(maxCount = 10) {
    const trips = await this.getAllTripsMeta();
    if (trips.length > maxCount) {
      trips.sort((a, b) => b.id - a.id);
      const toDelete = trips.slice(maxCount);
      const db = await this._openDb();
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      for (const t of toDelete) {
        store.delete(t.id);
      }
    }
  }

  async getAllTripsMeta() {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        const meta = all.map(t => ({
          id: t.id,
          dateStr: t.dateStr,
          fileName: t.fileName,
          pointCount: t.pointCount,
          maxRpm: t.maxRpm
        })).sort((a, b) => b.id - a.id);
        resolve(meta);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getTrip(id) {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteTrip(id) {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      store.delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async clearAll() {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      store.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }
}

/**
 * Модуль скоростного логирования телеметрии и экспорта в формат Excel (.xlsx)
 * Полностью согласован со структурой и названиями колонок OpenDiag Mobile.
 * Включает фоновый режим работы на iOS (Silent Audio Loop), WakeLock и автосохранение.
 */
class TripLogger {
  constructor() {
    this.isRecording = false;
    this.records = [];
    this.startTime = null;
    this.storage = new TripStorage();
    this.lastSavedTrip = null;
    
    // Метрики частоты опроса
    this.lastFrameTime = 0;
    this.hzHistory = [];
    this.currentHz = 0;
    this.currentMs = 0;

    // Фоновый звук для защиты от засыпания на iOS
    this.silentAudio = null;
    this.wakeLock = null;

    this.onStatsUpdate = null; // (stats: { count: number, hz: number, ms: number }) => void
  }

  _enableBackgroundMode() {
    if (window.M73App && window.M73App.bgKeeper) {
      window.M73App.bgKeeper.start();
      if (window.M73App.wakeLockMgr) {
        window.M73App.wakeLockMgr.request();
      }
      return;
    }

    try {
      if (!this.silentAudio) {
        const silentWav = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
        this.silentAudio = new Audio(silentWav);
        this.silentAudio.loop = true;
      }
      this.silentAudio.play().catch(e => console.log("Фоновый звук ожидает взаимодействия"));
    } catch (e) {
      console.warn("Ошибка запуска фонового режима:", e);
    }

    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(wl => {
        this.wakeLock = wl;
      }).catch(() => {});
    }
  }

  _disableBackgroundMode() {
    if (window.M73App && window.M73App.bgKeeper) {
      // Если связь с адаптером всё ещё продолжается, сохраняем фоновый режим и удержание экрана активными для панели
      if (!window.M73App.elm || !window.M73App.elm.isConnected) {
        window.M73App.bgKeeper.stop();
        if (window.M73App.wakeLockMgr) {
          window.M73App.wakeLockMgr.release();
        }
      }
      return;
    }

    if (this.silentAudio) {
      this.silentAudio.pause();
    }
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }

  start() {
    this.records = [];
    this.startTime = performance.now();
    this.isRecording = true;
    this.lastFrameTime = performance.now();
    this.hzHistory = [];
    this._enableBackgroundMode();
  }

  async stop(maxRpm = 0) {
    this.isRecording = false;
    this._disableBackgroundMode();
    if (this.records && this.records.length >= 5) {
      try {
        const saved = await this.storage.saveTrip(this.records, maxRpm);
        this.lastSavedTrip = saved;
        return saved;
      } catch (err) {
        console.warn("Ошибка автосохранения поездки:", err);
      }
    }
    return null;
  }

  /**
   * Добавление точки данных в лог
   */
  addPoint(params) {
    const now = performance.now();
    
    if (this.lastFrameTime > 0) {
      const deltaMs = now - this.lastFrameTime;
      this.currentMs = Math.round(deltaMs);
      const instantHz = 1000 / deltaMs;
      
      this.hzHistory.push(instantHz);
      if (this.hzHistory.length > 10) this.hzHistory.shift();

      const sumHz = this.hzHistory.reduce((a, b) => a + b, 0);
      this.currentHz = parseFloat((sumHz / this.hzHistory.length).toFixed(1));
    }
    this.lastFrameTime = now;

    if (this.isRecording) {
      const elapsedSec = ((now - this.startTime) / 1000).toFixed(3);
      const f = params.flags || {};
      const mis = params.misfires || {};

      // РџРѕР»РЅС‹Р№ СЌС‚Р°Р»РѕРЅРЅС‹Р№ РЅР°Р±РѕСЂ РїР°СЂР°РјРµС‚СЂРѕРІ OpenDiag Mobile Рё ReadLogs (83 РєР°РЅР°Р»Р°)
      const record = {
        "Р’СЂРµРјСЏ (СЃРµРє)": parseFloat(elapsedSec),
        "РћР±РѕСЂРѕС‚С‹ РґРІРёРіР°С‚РµР»СЏ (РѕР±/РјРёРЅ)": params.rpm || 0,
        "РЎРєРѕСЂРѕСЃС‚СЊ Р°РІС‚РѕРјРѕР±РёР»СЏ (РєРј/С‡)": params.speed || 0,
        "РЈРіРѕР» РѕС‚РєСЂС‹С‚РёСЏ РґСЂРѕСЃСЃРµР»СЊРЅРѕР№ Р·Р°СЃР»РѕРЅРєРё (%)": params.throttle !== undefined ? params.throttle : 0,
        "РџР°СЂР°РјРµС‚СЂ РЅР°РіСЂСѓР·РєРё (%)": params.frlLoad !== undefined ? params.frlLoad : 0,
        "Р Р°СЃС‡С‘С‚РЅР°СЏ РЅР°РіСЂСѓР·РєР° (%)": params.calcLoad !== undefined ? params.calcLoad : 0,
        "Р¤Р°РєС‚РѕСЂ РІС‹СЃРѕС‚РЅРѕР№ РєРѕСЂСЂРµРєС†РёРё (-)": params.altitudeFactor !== undefined ? params.altitudeFactor : 1.0,
        "РњР°СЃСЃРѕРІС‹Р№ СЂР°СЃС…РѕРґ РІРѕР·РґСѓС…Р° (РєРі/С‡)": params.maf || 0,
        "Р¦РёРєР»РѕРІРѕР№ СЂР°СЃС…РѕРґ РІРѕР·РґСѓС…Р° (РјРі/С‚Р°РєС‚)": params.cycleAir || 0,
        "Р”Р»РёС‚РµР»СЊРЅРѕСЃС‚СЊ РІРїСЂС‹СЃРєР° (РјСЃ)": params.injTime || 0,
        "Р—Р°РіСЂСѓР·РєР° С„РѕСЂСЃ (%)": params.dutyCycle || 0,
        "Р Р°СЃС…РѕРґ С‚РѕРїР»РёРІР° (Р»/С‡)": params.fuelRate || 0,
        "РЈРіРѕР» РѕРїРµСЂРµР¶РµРЅРёСЏ Р·Р°Р¶РёРіР°РЅРёСЏ (В°Рџ.Рљ.Р’)": params.spark !== undefined ? params.spark : 0,
        "Р’РµР»РёС‡РёРЅР° РѕС‚СЃРєРѕРєР° РЈРћР— РїСЂРё РґРµС‚РѕРЅР°С†РёРё (В°Рџ.Рљ.Р’)": params.sparkRetard !== undefined ? params.sparkRetard : 0,
        "РЎРёРіРЅР°Р» РґР°С‚С‡РёРєР° РґРµС‚РѕРЅР°С†РёРё (Р’)": params.knockVolt !== undefined ? params.knockVolt : 0,
        "РўРµРјРїРµСЂР°С‚СѓСЂР° РѕС…Р»Р°Р¶РґР°СЋС‰РµР№ Р¶РёРґРєРѕСЃС‚Рё (В°C)": params.temp !== undefined ? params.temp : 0,
        "РўРµРјРїРµСЂР°С‚СѓСЂР° РћР– РїСЂРё РїСѓСЃРєРµ (В°C)": params.tempAtStart !== undefined ? params.tempAtStart : 0,
        "РўРµРјРїРµСЂР°С‚СѓСЂР° РІРїСѓСЃРєРЅРѕРіРѕ РІРѕР·РґСѓС…Р° (В°C)": params.intakeTemp !== undefined ? params.intakeTemp : 0,
        "РќР°РїСЂСЏР¶РµРЅРёРµ РїРёС‚Р°РЅРёСЏ (Р’)": params.voltage || 0,
        "Р–РµР»Р°РµРјС‹Рµ РѕР±РѕСЂРѕС‚С‹ С…РѕР»РѕСЃС‚РѕРіРѕ С…РѕРґР° (РѕР±/РјРёРЅ)": params.idleTarget || 0,
        "РћР±РѕСЂРѕС‚С‹ С…РѕР»РѕСЃС‚РѕРіРѕ С…РѕРґР° (РѕР±/РјРёРЅ)": params.idleRpm || 0,
        "РџРѕР·РёС†РёСЏ С€Р°РіРѕРІРѕРіРѕ РґРІРёРіР°С‚РµР»СЏ (С€Р°Рі)": params.iacSteps !== undefined ? params.iacSteps : 0,
        "Р–РµР»Р°РµРјС‹Р№ СЂР°СЃС…РѕРґ РІРѕР·РґСѓС…Р° РЅР° РҐРҐ (РєРі/С‡)": params.airTargetIdle !== undefined ? params.airTargetIdle : 0,
        "РџР°СЂР°РјРµС‚СЂ Р°РґР°РїС‚Р°С†РёРё СЂРµРіСѓР»РёСЂРѕРІРєРё РҐРҐ (%)": params.idleAdapt !== undefined ? params.idleAdapt : 0,
        "РњРѕРјРµРЅС‚ РґР»СЏ СЂРµРіСѓР»РёСЂРѕРІР°РЅРёСЏ РҐРҐ: I-С‡Р°СЃС‚СЊ (%)": params.idleTorqueI !== undefined ? params.idleTorqueI : 0,
        "РњРѕРјРµРЅС‚ РґР»СЏ СЂРµРіСѓР»РёСЂРѕРІР°РЅРёСЏ РҐРҐ: PD-С‡Р°СЃС‚СЊ (%)": params.idleTorquePD !== undefined ? params.idleTorquePD : 0,
        "РЎРёРіРЅР°Р» РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° РґРѕ РЅРµР№С‚СЂР°Р»РёР·Р°С‚РѕСЂР° (Р’)": params.o2Volt !== undefined ? params.o2Volt : 0,
        "РЎРёРіРЅР°Р» РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° РїРѕСЃР»Рµ РЅРµР№С‚СЂР°Р»РёР·Р°С‚РѕСЂР° (Р’)": params.o2Volt2 !== undefined ? params.o2Volt2 : 0,
        "РўРµРєСѓС‰РёР№ РєРѕСЌС„С„РёС†РёРµРЅС‚ РєРѕСЂСЂРµРєС†РёРё РІРїСЂС‹СЃРєР° (-)": params.lambdaCorr !== undefined ? params.lambdaCorr : 1.0,
        "Р—Р°РґР°РЅРЅРѕРµ Р·РЅР°С‡РµРЅРёРµ Р»СЏРјР±РґР° (-)": params.targetLambda !== undefined ? params.targetLambda : 1.0,
        "РњСѓР»СЊС‚РёРїР»РёРєР°С‚РёРІРЅР°СЏ СЃРѕСЃС‚Р°РІР»СЏСЋС‰Р°СЏ РєРѕСЂСЂРµРєС†РёРё (-)": params.multAdapt !== undefined ? params.multAdapt : 1.0,
        "РђРґРґРёС‚РёРІРЅР°СЏ СЃРѕСЃС‚Р°РІР»СЏСЋС‰Р°СЏ РєРѕСЂСЂРµРєС†РёРё (%)": params.addAdapt !== undefined ? params.addAdapt : 0,
        "РџРµСЂРёРѕРґ СЃРёРіРЅР°Р»Р° Р”Рљ1 (СЃ)": params.o2Period !== undefined ? params.o2Period : 0,
        "Р—Р°РґРµСЂР¶РєР° РћРЎ РїРѕ РІС‚РѕСЂРѕРјСѓ РґР°С‚С‡РёРєСѓ (СЃ)": params.o2_2_integralDelay !== undefined ? params.o2_2_integralDelay : 0,
        "РљРѕСЌС„С„РёС†РёРµРЅС‚ РїСЂРѕРґСѓРІРєРё Р°РґСЃРѕСЂР±РµСЂР° (%)": params.purgeRate !== undefined ? params.purgeRate : 0,
        "РЎРёРіРЅР°Р» РґР°С‚С‡РёРєР° РЅРµСЂРѕРІРЅРѕР№ РґРѕСЂРѕРіРё (g)": params.roughRoad !== undefined ? params.roughRoad : 0,
        "РќРµСЂР°РІРЅРѕРјРµСЂРЅРѕСЃС‚СЊ РІСЂР°С‰РµРЅРёСЏ РєРѕР»РµРЅРІР°Р»Р° (РѕР±/СЃ2)": params.unbalanceRpm !== undefined ? params.unbalanceRpm : 0,
        "РђРґР°РїС‚Р°С†РёСЏ Р·СѓР±СЊРµРІ РІРµРЅС†Р° РґРµРјРїС„РµСЂР° (РѕР±/СЃ2)": params.damperAdapt !== undefined ? params.damperAdapt : 0,
        "РњРѕС‰РЅРѕСЃС‚СЊ РїРѕ Р”РњР Р’ (Р».СЃ.)": params.enginePower !== undefined ? params.enginePower : 0,
        "РњРѕРјРµРЅС‚ РїРѕ Р”РњР Р’ (Рќ/Рј)": params.engineTorque !== undefined ? params.engineTorque : 0,
        "РџСЂРѕРїСѓСЃРєРё С†РёР»РёРЅРґСЂ 1 (-)": mis.cyl1 || 0,
        "РџСЂРѕРїСѓСЃРєРё С†РёР»РёРЅРґСЂ 2 (-)": mis.cyl2 || 0,
        "РџСЂРѕРїСѓСЃРєРё С†РёР»РёРЅРґСЂ 3 (-)": mis.cyl3 || 0,
        "РџСЂРѕРїСѓСЃРєРё С†РёР»РёРЅРґСЂ 4 (-)": mis.cyl4 || 0,
        "РЎСѓРјРјР°СЂРЅС‹Р№ СЃС‡РµС‚С‡РёРє РїСЂРѕРїСѓСЃРєРѕРІ (-)": mis.total || 0,
        "РђРєС‚РёРІРЅС‹Рµ РїСЂРѕРїСѓСЃРєРё Р·Р° С†РёРєР» (1000 РѕР±)": mis.cycle !== undefined ? mis.cycle : 0,
        "Р’СЂРµРјСЏ СЃ РјРѕРјРµРЅС‚Р° СЃР±СЂРѕСЃР° РєРѕРЅС‚СЂРѕР»Р»РµСЂР° (РјРёРЅ)": params.timeSinceReset !== undefined ? params.timeSinceReset : 0,
        "РљРѕР»РёС‡РµСЃС‚РІРѕ РѕС€РёР±РѕРє DTC (-)": params.dtcCount !== undefined ? params.dtcCount : 0,

        // Р‘РёС‚РѕРІС‹Рµ С„Р»Р°РіРё СЃРѕСЃС‚РѕСЏРЅРёСЏ Р­Р‘РЈ
        "Р¤Р»Р°Рі С…РѕР»РѕСЃС‚РѕРіРѕ С…РѕРґР°": f.idle ? 'Р”Р°' : 'РќРµС‚',
        "Р¤Р»Р°Рі РїРѕР»РЅРѕР№ РЅР°РіСЂСѓР·РєРё": f.fullLoad ? 'Р”Р°' : 'РќРµС‚',
        "РљРѕРЅС‚СЂРѕР»СЊ РґРµС‚РѕРЅР°С†РёРё Р°РєС‚РёРІРµРЅ": f.knock ? 'Р”Р°' : 'РќРµС‚',
        "РћС‚СЃРµС‡РєР° С‚РѕРїР»РёРІРѕРїРѕРґР°С‡Рё": f.fuelCut ? 'Р”Р°' : 'РќРµС‚',
        "РћР±СЂР°С‚РЅР°СЏ СЃРІСЏР·СЊ РїРѕ Р”Рљ1": f.lambda ? 'Р”Р°' : 'РќРµС‚',
        "Р“РѕС‚РѕРІРЅРѕСЃС‚СЊ РґР°С‚С‡РёРєР° Рћ2 РґРѕ РєР°С‚Р°Р»РёР·Р°С‚РѕСЂР°": f.o2Ready ? 'Р”Р°' : 'РќРµС‚',
        "РћР±СЂР°С‚РЅР°СЏ СЃРІСЏР·СЊ РїРѕ Р”Рљ2": f.o2_2_loop ? 'Р”Р°' : 'РќРµС‚',
        "Р“РѕС‚РѕРІРЅРѕСЃС‚СЊ РґР°С‚С‡РёРєР° Рћ2 РїРѕСЃР»Рµ РєР°С‚Р°Р»РёР·Р°С‚РѕСЂР°": f.o2_2_ready ? 'Р”Р°' : 'РќРµС‚',
        "Р РµР»Рµ Р±РµРЅР·РѕРЅР°СЃРѕСЃР°": f.fuelPump ? 'Р”Р°' : 'РќРµС‚',
        "Р РµР»Рµ РІРµРЅС‚РёР»СЏС‚РѕСЂР° 1": f.fan1 ? 'Р”Р°' : 'РќРµС‚',
        "Р РµР»Рµ РІРµРЅС‚РёР»СЏС‚РѕСЂР° 2": f.fan2 ? 'Р”Р°' : 'РќРµС‚',
        "Р›Р°РјРїР° Check Engine": f.mil ? 'Р”Р°' : 'РќРµС‚',
        "Р—Р°РїСЂРѕСЃ РєРѕРЅРґРёС†РёРѕРЅРµСЂР°": f.acRequest ? 'Р”Р°' : 'РќРµС‚',
        "Р Р°Р·СЂРµС€РµРЅРёРµ РєРѕРЅРґРёС†РёРѕРЅРµСЂР°": f.acAllowed ? 'Р”Р°' : 'РќРµС‚',
        "РџСЂРѕРґСѓРІРєР° Р°РґСЃРѕСЂР±РµСЂР° Р°РєС‚РёРІРёСЂРѕРІР°РЅР°": f.purgeActive ? 'Р”Р°' : 'РќРµС‚',
        "РќРµСЂРѕРІРЅР°СЏ РґРѕСЂРѕРіР° (Р±Р»РѕРєРёСЂРѕРІРєР°)": f.roughRoadFlag ? 'Р”Р°' : 'РќРµС‚',
        "РРЅС‚РµСЂРІР°Р»_РѕРїСЂРѕСЃР° (РјСЃ)": this.currentMs
      };

      this.records.push(record);
    }

    if (this.onStatsUpdate) {
      this.onStatsUpdate({
        count: this.records.length,
        hz: this.currentHz,
        ms: this.currentMs
      });
    }
  }

  /**
   * Генерация файла .xlsx и вызов системного меню iOS «Поделиться»
   */
  async exportToXlsx(recordsToExport = null, customFileName = null) {
    const data = recordsToExport || this.records;
    if (!data || data.length === 0) {
      alert("Нет записанных данных для сохранения!");
      return;
    }

    if (typeof XLSX === "undefined") {
      alert("Ошибка: библиотека SheetJS не загружена");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(data);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Лог М73");

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const fileName = customFileName || `Приора_М73_Лог_${dateStr}.xlsx`;

    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const file = new File([blob], fileName, { type: blob.type });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Лог диагностики Приора М73',
          text: `Лог М73 (${data.length} точек)`
        });
        return;
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Share error fallback:', err);
        } else {
          return;
        }
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

window.TripLogger = TripLogger;
