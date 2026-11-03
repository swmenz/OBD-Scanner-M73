/**
 * РџСЂРѕС‚РѕРєРѕР» РІР·Р°РёРјРѕРґРµР№СЃС‚РІРёСЏ СЃ Р­Р‘РЈ РС‚СЌР»РјР° Рњ73 (Р›Р°РґР° РџСЂРёРѕСЂР° / РљР°Р»РёРЅР° / 2114)
 * РЎС‚Р°РЅРґР°СЂС‚ KWP2000 (ISO 14230), Fast Init, 10400 Р±РѕРґ.
 * РџРѕР»РЅС‹Р№ СЌС‚Р°Р»РѕРЅРЅС‹Р№ РЅР°Р±РѕСЂ РїР°СЂР°РјРµС‚СЂРѕРІ OpenDiag Mobile Рё ReadLogs (83 РєР°РЅР°Р»Р°).
 */

class ItelmaM73Protocol {
  constructor(elm) {
    this.elm = elm;
    this.isInitialized = false;

    // РљСЌС€ РґР»СЏ РѕР±СЉРµРґРёРЅРµРЅРёСЏ РґР°РЅРЅС‹С… РёР· РІСЃРµС… РїР°СЂР°РјРµС‚СЂРѕРІ Р­Р‘РЈ (РљР°РґСЂ 21 01 Рё 21 03)
    // РџРѕР»РЅС‹Р№ СЌС‚Р°Р»РѕРЅРЅС‹Р№ РЅР°Р±РѕСЂ РїР°СЂР°РјРµС‚СЂРѕРІ OpenDiag Mobile Рё ReadLogs (83 РєР°РЅР°Р»Р°)
    this.latestData = {
      timestamp: new Date(),

      // 1. РћС€РёР±РєРё Рё РїСѓСЃРє
      dtcCount: 0,
      tempAtStart: 0,

      // 2. Р‘Р°Р·РѕРІС‹Рµ РґР°С‚С‡РёРєРё РґРІРёРіР°С‚РµР»СЏ
      rpm: 0,
      temp: 0,
      intakeTemp: 0,
      voltage: 0,
      speed: 0,
      throttle: 0,
      maf: 0,
      spark: 0,
      sparkRetard: 0,

      // 3. РќР°РіСЂСѓР·РєР° Рё РІРѕР·РґСѓС…
      frlLoad: 0,           // РџР°СЂР°РјРµС‚СЂ РЅР°РіСЂСѓР·РєРё FRL (%)
      calcLoad: 0,          // Р Р°СЃС‡С‘С‚РЅР°СЏ РЅР°РіСЂСѓР·РєР° (%)
      altitudeFactor: 1.0,  // Р¤Р°РєС‚РѕСЂ РІС‹СЃРѕС‚РЅРѕР№ РєРѕСЂСЂРµРєС†РёРё / Р±Р°СЂРѕРєРѕСЂСЂРµРєС†РёСЏ (-)
      cycleAir: 0,          // Р¦РёРєР»РѕРІРѕР№ СЂР°СЃС…РѕРґ РІРѕР·РґСѓС…Р° (РјРі/С‚Р°РєС‚)
      airTargetIdle: 0,     // Р–РµР»Р°РµРјС‹Р№ СЂР°СЃС…РѕРґ РІРѕР·РґСѓС…Р° РЅР° РҐРҐ (РєРі/С‡)

      // 4. РўРѕРїР»РёРІРѕРїРѕРґР°С‡Р° Рё РІРїСЂС‹СЃРє
      injTime: 0,           // Р”Р»РёС‚РµР»СЊРЅРѕСЃС‚СЊ РІРїСЂС‹СЃРєР° (РјСЃ)
      dutyCycle: 0,         // Р—Р°РіСЂСѓР·РєР° С„РѕСЂСЃСѓРЅРѕРє (%)
      fuelRate: 0,          // Р Р°СЃС…РѕРґ С‚РѕРїР»РёРІР° (Р»/С‡)
      lambdaCorr: 1.0,      // РљРѕСЌС„С„РёС†РёРµРЅС‚ РєРѕСЂСЂРµРєС†РёРё РІСЂРµРјРµРЅРё РІРїСЂС‹СЃРєР°
      targetLambda: 1.0,    // Р—Р°РґР°РЅРЅРѕРµ Р·РЅР°С‡РµРЅРёРµ Р»СЏРјР±РґР°
      purgeRate: 0,         // РљРѕСЌС„С„РёС†РёРµРЅС‚ РїСЂРѕРґСѓРІРєРё Р°РґСЃРѕСЂР±РµСЂР° (%)
      multAdapt: 1.0,       // РњСѓР»СЊС‚РёРїР»РёРєР°С‚РёРІРЅР°СЏ СЃРѕСЃС‚Р°РІР»СЏСЋС‰Р°СЏ РєРѕСЂСЂРµРєС†РёРё (FR)
      addAdapt: 0.0,        // РђРґРґРёС‚РёРІРЅР°СЏ СЃРѕСЃС‚Р°РІР»СЏСЋС‰Р°СЏ РєРѕСЂСЂРµРєС†РёРё (FRA, %)

      // 5. РҐРѕР»РѕСЃС‚РѕР№ С…РѕРґ
      idleTarget: 0,        // Р–РµР»Р°РµРјС‹Рµ РѕР±РѕСЂРѕС‚С‹ С…РѕР»РѕСЃС‚РѕРіРѕ С…РѕРґР° (РѕР±/РјРёРЅ)
      iacSteps: 0,          // РџРѕР·РёС†РёСЏ С€Р°РіРѕРІРѕРіРѕ РґРІРёРіР°С‚РµР»СЏ Р РҐРҐ (С€Р°РіРё)
      idleAdapt: 0,         // РџР°СЂР°РјРµС‚СЂ Р°РґР°РїС‚Р°С†РёРё СЂРµРіСѓР»РёСЂРѕРІРєРё РҐРҐ (%)
      idleTorqueI: 0,       // РџРѕС‚СЂРµР±РЅРѕСЃС‚СЊ РІ РјРѕРјРµРЅС‚Рµ РґР»СЏ РҐРҐ: I-С‡Р°СЃС‚СЊ (%)
      idleTorquePD: 0,      // РџРѕС‚СЂРµР±РЅРѕСЃС‚СЊ РІ РјРѕРјРµРЅС‚Рµ РґР»СЏ РҐРҐ: PD-С‡Р°СЃС‚СЊ (%)
      idleRpm: 0,           // РћР±РѕСЂРѕС‚С‹ РЅР° С…РѕР»РѕСЃС‚РѕРј С…РѕРґСѓ (РѕР±/РјРёРЅ)

      // 6. Р”Р°С‚С‡РёРєРё РєРёСЃР»РѕСЂРѕРґР° (Р›СЏРјР±РґР°)
      o2Volt: 0,            // РЎРёРіРЅР°Р» Р”Рљ1 РґРѕ РЅРµР№С‚СЂР°Р»РёР·Р°С‚РѕСЂР° (Р’)
      o2Volt2: 0,           // РЎРёРіРЅР°Р» Р”Рљ2 РїРѕСЃР»Рµ РЅРµР№С‚СЂР°Р»РёР·Р°С‚РѕСЂР° (Р’)
      o2Period: 0,          // РџРµСЂРёРѕРґ СЃРёРіРЅР°Р»Р° Р”Рљ1 (СЃ)
      o2_2_integralDelay: 0,// РРЅС‚РµРіСЂР°Р»СЊРЅР°СЏ Р·Р°РґРµСЂР¶РєР° РћРЎ РїРѕ РІС‚РѕСЂРѕРјСѓ РґР°С‚С‡РёРєСѓ (СЃ)
      o2_2_amplitude: 0,    // РљРѕСЂСЂРµРєС‚РёСЂРѕРІР°РЅРЅР°СЏ Р°РјРїР»РёС‚СѓРґР° Р”Рљ2 (-)

      // 7. Р”РµС‚РѕРЅР°С†РёСЏ, РЅРµСЂР°РІРЅРѕРјРµСЂРЅРѕСЃС‚СЊ Рё РґРёРЅР°РјРёРєР°
      knockVolt: 0,         // РќРѕСЂРјР°Р»РёР·РѕРІР°РЅРЅС‹Р№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° РґРµС‚РѕРЅР°С†РёРё (Р’)
      unbalanceRpm: 0,      // РЎСЂРµРґРЅРµРµ Р·РЅР°С‡РµРЅРёРµ РЅРµСЂР°РІРЅРѕРјРµСЂРЅРѕСЃС‚Рё РІСЂР°С‰РµРЅРёСЏ РєРѕР»РµРЅРІР°Р»Р° (РѕР±/СЃВІ)
      damperAdapt: 0,       // РђРґР°РїС‚Р°С†РёСЏ СѓРіР»РѕРІРѕР№ РїРѕРіСЂРµС€РЅРѕСЃС‚Рё Р·СѓР±СЊРµРІ РІРµРЅС†Р° РґРµРјРїС„РµСЂР° (РѕР±/СЃВІ)
      roughRoad: 0.0,       // РЎРёРіРЅР°Р» РґР°С‚С‡РёРєР° РЅРµСЂРѕРІРЅРѕР№ РґРѕСЂРѕРіРё (СѓСЃРєРѕСЂРµРЅРёРµ РєСѓР·РѕРІР° РІ g)
      enginePower: 0,       // Р Р°СЃС‡С‘С‚РЅР°СЏ РјРѕС‰РЅРѕСЃС‚СЊ РїРѕ Р”РњР Р’ (Р».СЃ.)
      engineTorque: 0,      // Р Р°СЃС‡С‘С‚РЅС‹Р№ РєСЂСѓС‚СЏС‰РёР№ РјРѕРјРµРЅС‚ РїРѕ Р”РњР Р’ (РќВ·Рј)

      // 8. РџСЂРѕРїСѓСЃРєРё РІРѕСЃРїР»Р°РјРµРЅРµРЅРёСЏ Рё СЃР±СЂРѕСЃ
      misfires: { cyl1: 0, cyl2: 0, cyl3: 0, cyl4: 0, total: 0, cycle: 0 },
      timeSinceReset: 0,    // Р’СЂРµРјСЏ СЃ РјРѕРјРµРЅС‚Р° РїРѕСЃР»РµРґРЅРµРіРѕ СЃР±СЂРѕСЃР° Р­Р‘РЈ (РјРёРЅ)
      ecuChecksum: 0,

      // 9. РљР°РЅР°Р»С‹ РђР¦Рџ (РљР°РґСЂ 21 03)
      adc: {
        volt: 0, temp: 0, maf: 0, tps: 0, o2: 0,
        airTemp: 0, o2_2: 0, o2Resist1: 0, roughRoad: 0,
        valvePurge: 0, o2Resist2: 0
      },

      // 10. Р¤Р»Р°РіРё РіРѕС‚РѕРІРЅРѕСЃС‚Рё Рё СЂРµР¶РёРјРѕРІ СЂР°Р±РѕС‚С‹
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
   * РЎРІРµСЂС…Р±С‹СЃС‚СЂР°СЏ РёРЅРёС†РёР°Р»РёР·Р°С†РёСЏ ELM327 РїРѕРґ С‚Р°Р№РјРёРЅРіРё Рњ73
   */
  async initEcu() {
    this.elm.log('info', 'РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ Р°РґР°РїС‚РµСЂР° РїРѕРґ Р­Р‘РЈ РС‚СЌР»РјР° Рњ73...');

    await this.elm.send("AT Z", 1500).catch(() => {});
    await this.delay(100);

    // РџРѕСЃР»РµРґРѕРІР°С‚РµР»СЊРЅРѕСЃС‚СЊ, РїСЂРѕРІРµСЂРµРЅРЅР°СЏ РїРѕ СЂРµР°Р»СЊРЅРѕРјСѓ Р»РѕРіСѓ OpenDiag Mobile РЅР° СЌС‚РѕРј Р¶Рµ Р°РІС‚РѕРјРѕР±РёР»Рµ
    await this.elm.send("AT E0");
    await this.elm.send("AT L0");
    await this.elm.send("AT AL");     // Р Р°Р·СЂРµС€РёС‚СЊ РґР»РёРЅРЅС‹Рµ РѕС‚РІРµС‚С‹ (РєР°РґСЂ 21 01 = 74 Р±Р°Р№С‚Р°)
    await this.elm.send("AT AT 2");   // Агрессивный адаптивный тайминг (разгон)
    await this.elm.send("AT S0");     // РџСЂРѕР±РµР»С‹ РІС‹РєР»
    await this.elm.send("AT ST 19");  // Быстрый таймаут шины ~100 мс (вместо 200 мс)
    await this.elm.send("AT SH 81 10 F1");
    await this.elm.send("AT IIA 10"); // РђРґСЂРµСЃ Р­Р‘РЈ РґР»СЏ Fast Init
    await this.elm.send("AT SP 5");
    await this.elm.send("AT SW 00");

    this.elm.log('info', 'РћС‚РєСЂС‹С‚РёРµ РґРёР°РіРЅРѕСЃС‚РёС‡РµСЃРєРѕР№ СЃРµСЃСЃРёРё (AT FI)...');

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
      this.elm.log('err', 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ СЃРµСЃСЃРёСЋ СЃ Р­Р‘РЈ Рњ73: ' + session.clean);
      throw new Error("Р­Р‘РЈ Рњ73 РЅРµ РѕС‚РІРµС‡Р°РµС‚ РЅР° Fast Init. РџСЂРѕРІРµСЂСЊС‚Рµ, РІРєР»СЋС‡РµРЅРѕ Р»Рё Р·Р°Р¶РёРіР°РЅРёРµ!");
    }

    // РћС‚РєР»СЋС‡Р°РµРј Р·Р°РіРѕР»РѕРІРєРё (AT H0), С‡С‚РѕР±С‹ ELM РѕС‚РґР°РІР°Р» С‡РёСЃС‚С‹Р№ payload Р±РµР· 83 F1 10 Рё РєРѕРЅС‚СЂРѕР»СЊРЅРѕР№ СЃСѓРјРјС‹
    await this.elm.send("AT H0");

    // РџСЂРѕРІРµСЂСЏРµРј Р¶РёРІРѕР№ РѕС‚РєР»РёРє С‚РµСЃС‚РѕРІС‹Рј Р·Р°РїСЂРѕСЃРѕРј РєР°РґСЂР° 21 01
    this.elm.log('info', 'РўРµСЃС‚РѕРІС‹Р№ РѕРїСЂРѕСЃ РєР°РґСЂР° 21 01...');
    const testResp = await this.elm.send("2101", 1000);
    const cleanTest = testResp.replace(/\s+/g, '').toUpperCase();
    if (!cleanTest.includes("6101")) {
      throw new Error("Р­Р‘РЈ РѕС‚РєСЂС‹Р» СЃРµСЃСЃРёСЋ, РЅРѕ РЅРµ РѕС‚РґР°РµС‚ РєР°РґСЂ 21 01: " + testResp);
    }

    this.isInitialized = true;
    this.elm.log('info', '>>> РЎР’РЇР—Р¬ РЎ Р­Р‘РЈ РРўР­Р›РњРђ Рњ73 РЈРЎРџР•РЁРќРћ РЈРЎРўРђРќРћР’Р›Р•РќРђ Р РџР РћР’Р•Р Р•РќРђ! <<<');
    return true;
  }

  /**
   * Динамическое переключение профилей скорости опроса K-Line в реальном времени
   */
  async setSpeedProfile(profile) {
    if (!this.elm || !this.elm.isConnected) return false;
    try {
      if (profile === 'extreme') {
        await this.elm.send("AT AT 2");
        await this.elm.send("AT ST 10"); // ~64 мс
        this.currentSpeedProfile = 'extreme';
        this.elm.log('info', 'Режим скорости: Экстрим (AT AT 2, AT ST 10, ~64мс)');
      } else if (profile === 'turbo') {
        await this.elm.send("AT AT 2");
        await this.elm.send("AT ST 19"); // ~100 мс
        this.currentSpeedProfile = 'turbo';
        this.elm.log('info', 'Режим скорости: Турбо (AT AT 2, AT ST 19, ~100мс)');
      } else {
        await this.elm.send("AT AT 1");
        await this.elm.send("AT ST 32"); // ~200 мс
        this.currentSpeedProfile = 'standard';
        this.elm.log('info', 'Режим скорости: Стандарт (AT AT 1, AT ST 32, ~200мс)');
      }
      return true;
    } catch (e) {
      this.elm.log('err', 'Ошибка переключения профиля скорости: ' + e.message);
      return false;
    }
  }


  /**
   * Р”РРќРђРњРР§Р•РЎРљРР™ РћРџР РћРЎ РљРђР”Р РћР’ (Р РђР—Р”Р•Р›Р¬РќР«Р™ РћРџР РћРЎ РљРђРљ Р’ OPENDIAG)
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

    // РџРѕ СѓРјРѕР»С‡Р°РЅРёСЋ вЂ” Р±Р°Р·РѕРІС‹Р№ СЃРєРѕСЂРѕСЃС‚РЅРѕР№ РљР°РґСЂ 1 (21 01)
    const raw1 = await this.elm.send("2101", 1000);
    if (!this.parseFrame2101(raw1)) return null;

    this.latestData.timestamp = new Date();
    return this.latestData;
  }

  /**
   * Р Р°Р·Р±РѕСЂ РљР°РґСЂР° 1 (21 01, РѕС‚РІРµС‚ 61 01) вЂ” РџРѕР»РЅР°СЏ РєР°СЂС‚Р° РІСЃРµС… 72 РїР°СЂР°РјРµС‚СЂРѕРІ Рњ73
   * Р’С‹РІРµСЂРµРЅР° РґРѕ РїРѕСЃР»РµРґРЅРµРіРѕ Р±РёС‚Р° РїРѕ СЌС‚Р°Р»РѕРЅР°Рј ReadLogs 3.3.5.1 Рё OpenDiag Mobile (hk.java)
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

    // 0: РљРѕР»РёС‡РµСЃС‚РІРѕ РѕС€РёР±РѕРє DTC
    const dtcCount = u8(0);
    // 1: РўРµРјРїРµСЂР°С‚СѓСЂР° РћР– РїСЂРё РїСѓСЃРєРµ (В°C)
    const tempAtStart = r1(u8(1) * 0.75 - 48);
    // 2: РўРµРјРїРµСЂР°С‚СѓСЂР° РѕС…Р»Р°Р¶РґР°СЋС‰РµР№ Р¶РёРґРєРѕСЃС‚Рё (В°C)
    const temp = r1(u8(2) * 0.75 - 48);
    // 3: РўРµРјРїРµСЂР°С‚СѓСЂР° РІРїСѓСЃРєРЅРѕРіРѕ РІРѕР·РґСѓС…Р° (В°C)
    const intakeTemp = r1(u8(3) * 0.75 - 48);
    // 4: РќР°РїСЂСЏР¶РµРЅРёРµ Р±РѕСЂС‚РѕРІРѕР№ СЃРµС‚Рё (Р’)
    const voltage = r2(u8(4) * 0.073765);
    // 5: РЎРєРѕСЂРѕСЃС‚СЊ Р°РІС‚РѕРјРѕР±РёР»СЏ (РєРј/С‡)
    const speed = Math.round(u8(5) * 1.25);
    // 6: РџРѕР»РѕР¶РµРЅРёРµ РґСЂРѕСЃСЃРµР»СЊРЅРѕР№ Р·Р°СЃР»РѕРЅРєРё (%)
    const throttle = r1(u8(6) * 100 / 255);
    // 7: РћР±РѕСЂРѕС‚С‹ РєРѕР»РµРЅРІР°Р»Р° (С€Р°Рі 40 РѕР±/РјРёРЅ)
    const rpm = u8(7) * 40;
    // 8-9: РњР°СЃСЃРѕРІС‹Р№ СЂР°СЃС…РѕРґ РІРѕР·РґСѓС…Р° Р”РњР Р’ (РєРі/С‡)
    const maf = r1(u16(8) / 10.0);
    // 10: РЈРћР— (В°РџРљР’, Р·РЅР°РєРѕРІС‹Р№)
    const spark = r2(s8(10) * 0.75);
    // 11: РћС‚СЃРєРѕРє РЈРћР— РїРѕ РґРµС‚РѕРЅР°С†РёРё (В°РџРљР’)
    const sparkRetard = r2(0 - s8(11) * 0.75);

    // 12-13: РџР°СЂР°РјРµС‚СЂ РЅР°РіСЂСѓР·РєРё FRL (%)
    const frlLoad = r2(u16(12) * 75.0 / 3200.0);
    // 14: Р Р°СЃС‡С‘С‚РЅР°СЏ РЅР°РіСЂСѓР·РєР° (%)
    const calcLoad = r1(u8(14) * 0.75);
    // 15: Р¤Р°РєС‚РѕСЂ РІС‹СЃРѕС‚РЅРѕР№ РєРѕСЂСЂРµРєС†РёРё / Р±Р°СЂРѕРєРѕСЂСЂРµРєС†РёСЏ (-)
    const altitudeFactor = r3(u8(15) / 64.0);

    // 16-17: Р”Р»РёС‚РµР»СЊРЅРѕСЃС‚СЊ РІРїСЂС‹СЃРєР° С„РѕСЂСЃСѓРЅРѕРє (РјСЃ)
    const injTime = r2(u16(16) / 75.0);
    // 18: Р–РµР»Р°РµРјС‹Рµ РѕР±РѕСЂРѕС‚С‹ С…РѕР»РѕСЃС‚РѕРіРѕ С…РѕРґР° (РѕР±/РјРёРЅ)
    const idleTarget = u8(18) * 10;
    // 19: РџРѕР·РёС†РёСЏ С€Р°РіРѕРІРѕРіРѕ РґРІРёРіР°С‚РµР»СЏ Р РҐРҐ (С€Р°РіРё)
    const iacSteps = u8(19);
    // 20-21: Р–РµР»Р°РµРјС‹Р№ СЂР°СЃС…РѕРґ РІРѕР·РґСѓС…Р° РЅР° РҐРҐ (РєРі/С‡)
    const airTargetIdle = r2(u16(20) / 640.0);
    // 22-23: РџР°СЂР°РјРµС‚СЂ Р°РґР°РїС‚Р°С†РёРё СЂРµРіСѓР»РёСЂРѕРІРєРё РҐРҐ (%)
    const idleAdapt = r2(s16(22) * 100.0 / 32768.0);

    // 24: РЎРёРіРЅР°Р» РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° Р”Рљ1 (Р’)
    const o2Volt = r3(u8(24) / 192.0 - 0.2);
    // 25-26: РўРµРєСѓС‰РёР№ РєРѕСЌС„С„РёС†РёРµРЅС‚ РєРѕСЂСЂРµРєС†РёРё РІСЂРµРјРµРЅРё РІРїСЂС‹СЃРєР° (-)
    const lambdaCorr = r3(u16(25) / 32768.0);
    // 27-28: Р—Р°РґР°РЅРЅРѕРµ Р·РЅР°С‡РµРЅРёРµ Р»СЏРјР±РґР° (-)
    const targetLambda = r3(u16(27) / 4096.0);
    // 29: РљРѕСЌС„С„РёС†РёРµРЅС‚ РїСЂРѕРґСѓРІРєРё Р°РґСЃРѕСЂР±РµСЂР° (%)
    const purgeRate = r1(u8(29) * 100.0 / 256.0);

    // 30-31: РќРѕСЂРјР°Р»РёР·РѕРІР°РЅРЅС‹Р№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° РґРµС‚РѕРЅР°С†РёРё (Р’)
    const knockVolt = r3(u16(30) / 256.0);
    // 32-33: РЎСЂРµРґРЅРµРµ Р·РЅР°С‡РµРЅРёРµ РЅРµСЂР°РІРЅРѕРјРµСЂРЅРѕСЃС‚Рё РІСЂР°С‰РµРЅРёСЏ РєРѕР»РµРЅРІР°Р»Р° (РѕР±/СЃВІ)
    const unbalanceRpm = r1(u16(32) * 0.57554);
    // 34-35: РђРґР°РїС‚Р°С†РёСЏ Р·СѓР±СЊРµРІ РІРµРЅС†Р° РґРµРјРїС„РµСЂР° (РѕР±/СЃВІ)
    const damperAdapt = r1(s16(34) * 0.57554);

    // 36-43: РЎС‡РµС‚С‡РёРєРё РїСЂРѕРїСѓСЃРєРѕРІ РІРѕСЃРїР»Р°РјРµРЅРµРЅРёСЏ (РїРѕСЂСЏРґРѕРє РІ Рњ73: 1, 3, 4, 2)
    this.latestData.misfires.cyl1 = u16(36);
    this.latestData.misfires.cyl3 = u16(38);
    this.latestData.misfires.cyl4 = u16(40);
    this.latestData.misfires.cyl2 = u16(42);
    // 44-45: РЎСѓРјРјР°СЂРЅС‹Р№ СЃС‡РµС‚С‡РёРє РїСЂРѕРїСѓСЃРєРѕРІ
    this.latestData.misfires.total = u16(44);
    this.latestData.misfires.cycle = this.latestData.misfires.cyl1 +
                                    this.latestData.misfires.cyl2 +
                                    this.latestData.misfires.cyl3 +
                                    this.latestData.misfires.cyl4;

    // 46-47: Р’СЂРµРјСЏ СЃ РјРѕРјРµРЅС‚Р° РїРѕСЃР»РµРґРЅРµРіРѕ СЃР±СЂРѕСЃР° РєРѕРЅС‚СЂРѕР»Р»РµСЂР° (РјРёРЅ)
    const timeSinceReset = r1(u16(46) / 10.0);
    // 48-49: РљРѕРЅС‚СЂРѕР»СЊРЅР°СЏ СЃСѓРјРјР° Р­Р‘РЈ
    const ecuChecksum = u16(48);
    // 50-51: Р§Р°СЃРѕРІРѕР№ СЂР°СЃС…РѕРґ С‚РѕРїР»РёРІР° (Р»/С‡)
    const fuelRate = r2(u16(50) * 0.00215);

    // 52: Р¤Р»Р°РіРё Р·Р°РІРµСЂС€РµРЅРёСЏ С‚РµСЃС‚РѕРІ OBD-II
    const b52 = u8(52);
    this.latestData.readiness = {
      cat: (b52 & 0x01) !== 0,
      purge: (b52 & 0x04) !== 0,
      o2: (b52 & 0x10) !== 0 || (b52 & 0x20) !== 0,
      o2Heater: (b52 & 0x40) !== 0
    };

    // 53-54: РџРѕС‚СЂРµР±РЅРѕСЃС‚СЊ РІ РјРѕРјРµРЅС‚Рµ РґР»СЏ СЂРµРіСѓР»РёСЂРѕРІР°РЅРёСЏ РҐРҐ: I-С‡Р°СЃС‚СЊ (%)
    const idleTorqueI = r2(s16(53) * 100.0 / 32768.0);
    // 55-56: РџРѕС‚СЂРµР±РЅРѕСЃС‚СЊ РІ РјРѕРјРµРЅС‚Рµ РґР»СЏ СЂРµРіСѓР»РёСЂРѕРІР°РЅРёСЏ РҐРҐ: PD-С‡Р°СЃС‚СЊ (%)
    const idleTorquePD = r2(s16(55) * 100.0 / 32768.0);
    // 57-58: РњСѓР»СЊС‚РёРїР»РёРєР°С‚РёРІРЅР°СЏ СЃРѕСЃС‚Р°РІР»СЏСЋС‰Р°СЏ РєРѕСЂСЂРµРєС†РёРё СЃРјРµСЃРё FR (-) (РЅРѕСЂРјР° = 1.000)
    const multAdapt = r3(u16(57) / 32768.0);
    // 59-60: РђРґРґРёС‚РёРІРЅР°СЏ СЃРѕСЃС‚Р°РІР»СЏСЋС‰Р°СЏ РєРѕСЂСЂРµРєС†РёРё СЃРјРµСЃРё FRA (%) (РЅРѕСЂРјР° = 0.00%)
    const addAdapt = r2(s16(59) * 100.0 / 32768.0);

    // 62, 63, 64: Р‘РёС‚РѕРІС‹Рµ С„Р»Р°РіРё СЃРѕСЃС‚РѕСЏРЅРёСЏ
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

    // 65: РћР±РѕСЂРѕС‚С‹ РґРІРёРіР°С‚РµР»СЏ РЅР° С…РѕР»РѕСЃС‚РѕРј С…РѕРґСѓ (РѕР±/РјРёРЅ)
    const idleRpm = bytes.length >= 66 ? u8(65) * 10 : idleTarget;
    // 66: РЎРёРіРЅР°Р» РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° Р”Рљ2 РїРѕСЃР»Рµ РЅРµР№С‚СЂР°Р»РёР·Р°С‚РѕСЂР° (Р’)
    const o2Volt2 = bytes.length >= 67 ? r3(u8(66) / 192.0 - 0.2) : 0.0;
    // 67: РџРµСЂРёРѕРґ СЃРёРіРЅР°Р»Р° Р”Рљ1 РґРѕ РЅРµР№С‚СЂР°Р»РёР·Р°С‚РѕСЂР° (СЃ)
    const o2Period = bytes.length >= 68 ? r2(u8(67) / 25.0) : 0.0;
    // 68: РРЅС‚РµРіСЂР°Р»СЊРЅР°СЏ С‡Р°СЃС‚СЊ Р·Р°РґРµСЂР¶РєРё РћРЎ РїРѕ РІС‚РѕСЂРѕРјСѓ РґР°С‚С‡РёРєСѓ (СЃ)
    const o2_2_integralDelay = bytes.length >= 69 ? r2(s8(68) / 100.0) : 0.0;
    // 69: РљРѕСЂСЂРµРєС‚РёСЂРѕРІР°РЅРЅРѕРµ СЃСЂРµРґРЅРµРµ Р·РЅР°С‡РµРЅРёРµ Р°РјРїР»РёС‚СѓРґС‹ Р”Рљ2 (-)
    const o2_2_amplitude = bytes.length >= 70 ? r3(s8(69) / 256.0) : 0.0;
    // 70-71: РЎРёРіРЅР°Р» РґР°С‚С‡РёРєР° РЅРµСЂРѕРІРЅРѕР№ РґРѕСЂРѕРіРё Р”РќР” (СѓСЃРєРѕСЂРµРЅРёРµ РІ g)
    const roughRoad = bytes.length >= 72 ? r3((u16(70) * 6.25 / 32768.0) - 6.25) : 0.0;

    // Р Р°СЃС‡РµС‚РЅС‹Рµ РІРµР»РёС‡РёРЅС‹ (С„РёР·РёРєР° РјРѕС‚РѕСЂР° РџСЂРёРѕСЂС‹ Р’РђР— 21126 16V)
    const cycleAir = (rpm > 100 && maf > 0) ? r1((maf * 8333.33) / rpm) : 0.0;
    const dutyCycle = (rpm > 100 && injTime > 0) ? r1(Math.min(100, Math.max(0, (injTime * rpm) / 1200))) : 0.0;
    const enginePower = (maf > 0) ? r1(maf / 3.1) : 0.0;
    const engineTorque = (rpm > 200 && maf > 0) ? r1((maf / 3.1) * 7120 / rpm) : 0.0;

    // Р—Р°РїРёСЃСЊ РІ latestData
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
    this.latestData.ecuChecksum = ecuChecksum;
    this.latestData.flags = flags;

    return this.latestData;
  }

  /**
   * Р Р°Р·Р±РѕСЂ РљР°РґСЂР° РђР¦Рџ (РІ Рњ73 СЌС‚Рѕ 21 03, РѕС‚РІРµС‚ 61 03)
   * РўРѕС‡РЅР°СЏ РєР°Р»РёР±СЂРѕРІРєР° ReadLogs (b797) Рё OpenDiag РґР»СЏ РїСЂРѕС†РµСЃСЃРѕСЂР° ST10F273 (РС‚СЌР»РјР° Рњ73 / Bosch 7.9.7)
   */
  parseFrame2103(rawStr) {
    const hex = rawStr.replace(/[\s\r\n]/g, '').toUpperCase();
    const idx = hex.indexOf("6103");
    if (idx === -1) return null;

    // РЎСЂРµР· Р±Р°Р№С‚РѕРІ, РЅР°С‡РёРЅР°СЏ СЃ Р·Р°РіРѕР»РѕРІРєР° 61 03 (Р±Р°Р№С‚ 0 = 61, Р±Р°Р№С‚ 1 = 03)
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

    // РўРѕС‡РЅР°СЏ РєР°Р»РёР±СЂРѕРІРєР° РєР°РЅР°Р»РѕРІ РђР¦Рџ РёР· b797/Powertrain/pids.ini:
    // Р‘Р°Р№С‚ 2-3 (payload 0-1): Р‘РѕСЂС‚РѕРІРѕРµ РЅР°РїСЂСЏР¶РµРЅРёРµ (b7, 16 Р±РёС‚) -> raw * 0.0176 Р’
    this.latestData.adc.volt = +(u16(2) * 0.0176).toFixed(2);

    // Р‘Р°Р№С‚ 4 (payload 2): Р”РўРћР– (VA, 8 Р±РёС‚) -> raw * 5.0 / 256.0 Р’ (181 -> 3.535 Р’)
    this.latestData.adc.temp = +(u8(4) * (5.0 / 256.0)).toFixed(3);

    // Р‘Р°Р№С‚ 5-6 (payload 3-4): Р”РњР Р’ (bJ, 10-Р±РёС‚ РђР¦Рџ 0..1023) -> raw * 5.0 / 1024.0 Р’
    // РџСЂРё РїРѕРєРѕРµ РґР°РµС‚ СЌС‚Р°Р»РѕРЅРЅС‹Рµ 0.991 ... 1.012 Р’
    let mafAdcV = u16(5) * (5.0 / 1024.0);
    if (mafAdcV < 0.5 || mafAdcV > 2.0) {
      const raw7 = u16(7);
      if (raw7 >= 8000 && raw7 <= 15000) {
        mafAdcV = raw7 / 10000.0;
      }
    }
    this.latestData.adc.maf = +mafAdcV.toFixed(3);

    // Р‘Р°Р№С‚ 7-8 (payload 5-6): Р”РџР”Р— (10-Р±РёС‚ РђР¦Рџ) -> raw * 5.0 / 1024.0 Р’ (РїРѕРєРѕР№ 0.454 Р’)
    this.latestData.adc.tps = +(u16(7) * (5.0 / 1024.0)).toFixed(3);

    // Р‘Р°Р№С‚ 9-10 (payload 7-8): Р”Рљ1 РЈРїСЂР°РІР»СЏСЋС‰РёР№ Р»СЏРјР±РґР°-Р·РѕРЅРґ (10-Р±РёС‚ РђР¦Рџ) -> raw * 5.0 / 1024.0 Р’ (РѕРїРѕСЂРЅРѕРµ 0.454 Р’)
    this.latestData.adc.o2 = +(u16(9) * (5.0 / 1024.0)).toFixed(3);

    // Р‘Р°Р№С‚ 11 (payload 9): Р”РўР’ РўРµРјРїРµСЂР°С‚СѓСЂР° РІРѕР·РґСѓС…Р° РІРѕ РІРїСѓСЃРєРЅРѕРј РєРѕР»Р»РµРєС‚РѕСЂРµ (VA, 8 Р±РёС‚) -> raw * 5.0 / 256.0 Р’ (3.867 Р’)
    this.latestData.adc.airTemp = +(u8(11) * (5.0 / 256.0)).toFixed(3);

    // Р‘Р°Р№С‚ 12-13 (payload 10-11): Р”Рљ2 Р”РёР°РіРЅРѕСЃС‚РёС‡РµСЃРєРёР№ Р·РѕРЅРґ (10-Р±РёС‚ РђР¦Рџ) -> raw * 5.0 / 1024.0 Р’
    this.latestData.adc.o2_2 = +(u16(12) * (5.0 / 1024.0)).toFixed(3);

    // Р‘Р°Р№С‚ 14-15 (payload 12-13): РЎРѕРїСЂРѕС‚РёРІР»РµРЅРёРµ Р”Рљ1 (bN) -> raw * 2.0 РћРј
    if (bytes.length >= 16) {
      this.latestData.adc.o2Resist1 = u16(14) * 2;
    }

    // Р‘Р°Р№С‚ 16 (payload 14): Р”РќР” Р”Р°С‚С‡РёРє СѓСЃРєРѕСЂРµРЅРёСЏ (bL) -> raw * 6.25 / 128.0 - 6.25 g
    if (bytes.length >= 17) {
      this.latestData.adc.roughRoad = +(s8(16) * 6.25 / 128.0 - 6.25).toFixed(3);
    }

    // Р‘Р°Р№С‚ 17-18 (payload 15-16): РќР°РїСЂСЏР¶РµРЅРёРµ РєР»Р°РїР°РЅР° РїСЂРѕРґСѓРІРєРё Р°РґСЃРѕСЂР±РµСЂР° -> raw * 5.0 / 1024.0 Р’
    if (bytes.length >= 19) {
      this.latestData.adc.valvePurge = +(u16(17) * (5.0 / 1024.0)).toFixed(3);
    }

    // Р‘Р°Р№С‚ 19-20 (payload 17-18): РЎРѕРїСЂРѕС‚РёРІР»РµРЅРёРµ Р”Рљ2 (bN) -> raw * 2.0 РћРј
    if (bytes.length >= 21) {
      this.latestData.adc.o2Resist2 = u16(19) * 2;
    }

    return this.latestData.adc;
  }

  /**
   * Р§РўР•РќРР• РћРЁРР‘РћРљ Р­Р‘РЈ (DTC)
   * KWP2000 Service 0x18: 18 00 FF 00 (РѕС‚РІРµС‚ 58 [count] [DTC1] [Status1] ...)
   */
  async readDtcCodes() {
    this.elm.log('info', 'Р—Р°РїСЂРѕСЃ РєРѕРґРѕРІ РЅРµРёСЃРїСЂР°РІРЅРѕСЃС‚РµР№ DTC (18 00 FF 00)...');
    try { await this.elm.send("AT SH 84 10 F1", 500); } catch (e) {}

    const raw = await this.elm.send("1800FF00", 1500);
    try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}

    const hex = raw.replace(/[\s\r\n]/g, '').toUpperCase();
    const dtcList = [];
    if (hex.startsWith("7F")) throw new Error("Р­Р‘РЈ РѕС‚РєР»РѕРЅРёР» Р·Р°РїСЂРѕСЃ С‡С‚РµРЅРёСЏ РѕС€РёР±РѕРє (РѕС‚СЂРёС†Р°С‚РµР»СЊРЅС‹Р№ РѕС‚РІРµС‚ " + hex.substring(0, 6) + ")");
    if (/NODATA|ERROR|UNABLE|\?/.test(hex)) throw new Error("Р­Р‘РЈ РЅРµ РѕС‚РІРµС‚РёР» РЅР° Р·Р°РїСЂРѕСЃ РѕС€РёР±РѕРє");
    const idx = hex.indexOf("58");
    if (idx === -1) throw new Error("РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РѕС‚РІРµС‚ Р­Р‘РЈ: " + (hex || "РїСѓСЃС‚Рѕ"));

    const payload = hex.substring(idx + 2);
    if (payload.length < 2) return dtcList;

    const count = parseInt(payload.substr(0, 2), 16);
    if (isNaN(count) || count === 0) return dtcList;

    for (let i = 2; i + 4 <= payload.length && dtcList.length < count; i += 6) {
      const b1 = parseInt(payload.substr(i, 2), 16);
      const b2 = parseInt(payload.substr(i + 2, 2), 16);
      if (isNaN(b1) || isNaN(b2) || (b1 === 0 && b2 === 0)) continue;

      const codeStr = this._formatDtcCode(b1, b2);
      const desc = ItelmaM73Protocol.DTC_DICTIONARY[codeStr] || "РќРµРёР·РІРµСЃС‚РЅС‹Р№ РєРѕРґ РѕС€РёР±РєРё РєРѕРЅС‚СЂРѕР»Р»РµСЂР° Р’РђР—";
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
    this.elm.log('info', 'РЎР±СЂРѕСЃ РѕС€РёР±РѕРє Р­Р‘РЈ (14 FF 00)...');
    try { await this.elm.send("AT SH 83 10 F1", 500); } catch (e) {}
    const resp = (await this.elm.send("14FF00", 1500)).replace(/\s+/g, '').toUpperCase();
    try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}
    return resp.startsWith("54") || resp.includes("OK");
  }

  async runActuatorTest(testType) {
    this.elm.log('info', `Р—Р°РїСѓСЃРє С‚РµСЃС‚Р° РјРµС…Р°РЅРёР·РјР°: ${testType}`);

    // РљРѕРјР°РЅРґС‹ KWP2000 СЃР»СѓР¶Р±С‹ 0x30 РёР· OpenDiag РґР»СЏ РС‚СЌР»РјР° Рњ73:
    const map = {
      fan1_on: { id: "0A", duration: 4000, name: "Р’РµРЅС‚РёР»СЏС‚РѕСЂ 1" },
      fan2_on: { id: "0D", duration: 4000, name: "Р’РµРЅС‚РёР»СЏС‚РѕСЂ 2" },
      pump_on: { id: "09", duration: 3000, name: "Р‘РµРЅР·РѕРЅР°СЃРѕСЃ" },
      mil_test: { id: "0C", duration: 3000, name: "Р›Р°РјРїР° Check Engine" }
    };

    const target = map[testType];
    if (!target) throw new Error("РќРµРёР·РІРµСЃС‚РЅС‹Р№ С‚РµСЃС‚ РјРµС…Р°РЅРёР·РјР°: " + testType);

    await this.delay(150);

    // РЈСЃС‚Р°РЅР°РІР»РёРІР°РµРј Р·Р°РіРѕР»РѕРІРѕРє РїРѕРґ 3-Р±Р°Р№С‚РѕРІСѓСЋ РєРѕРјР°РЅРґСѓ СѓРїСЂР°РІР»РµРЅРёСЏ РРњ
    try { await this.elm.send("AT SH 83 10 F1", 500); } catch (e) {}

    // 1. Р’РєР»СЋС‡РµРЅРёРµ РјРµС…Р°РЅРёР·РјР° (30 <ID> 01)
    const cmdOn = `30${target.id}01`;
    this.elm.log('info', `[РўРµСЃС‚ РРњ] Р’РєР»СЋС‡РµРЅРёРµ ${target.name}: ${cmdOn}`);
    const rawResp = await this.elm.send(cmdOn, 2000);
    const respOn = (rawResp || "").replace(/\s+/g, '').toUpperCase();
    this.elm.log('info', `[РўРµСЃС‚ РРњ] РћС‚РІРµС‚ Р­Р‘РЈ: ${respOn || rawResp || "РїСѓСЃС‚Рѕ"}`);

    if (respOn.includes("7F3022") || respOn.includes("7F22")) {
      try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}
      throw new Error("Р­Р‘РЈ РѕС‚РєР»РѕРЅРёР» С‚РµСЃС‚ (РєРѕРґ 7F 30 22: СѓСЃР»РѕРІРёСЏ РЅРµ СЃРѕР±Р»СЋРґРµРЅС‹). Р”РІРёРіР°С‚РµР»СЊ РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РїРѕР»РЅРѕСЃС‚СЊСЋ Р·Р°РіР»СѓС€РµРЅ (0 РѕР±/РјРёРЅ) Рё РІРєР»СЋС‡РµРЅРѕ Р·Р°Р¶РёРіР°РЅРёРµ.");
    }
    if (respOn.includes("7F3011") || respOn.includes("7F3012") || respOn.includes("7F3080")) {
      try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}
      throw new Error(`Р­Р‘РЈ РѕС‚РєР»РѕРЅРёР» РєРѕРјР°РЅРґСѓ: С‚РµСЃС‚ ${target.name} РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ РІ РґР°РЅРЅРѕР№ СЃРµСЃСЃРёРё/РїСЂРѕС€РёРІРєРµ (${respOn})`);
    }
    if (respOn.includes("7F")) {
      try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}
      throw new Error(`Р­Р‘РЈ РѕС‚РєР»РѕРЅРёР» РєРѕРјР°РЅРґСѓ (РєРѕРґ РѕС€РёР±РєРё: ${respOn})`);
    }
    if (!respOn.includes("70") && !respOn.includes("OK")) {
      try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}
      throw new Error(`Р­Р‘РЈ РЅРµ РїРѕРґС‚РІРµСЂРґРёР» РІРєР»СЋС‡РµРЅРёРµ (${respOn || "РЅРµС‚ РѕС‚РІРµС‚Р°"}). РџСЂРѕРІРµСЂСЊС‚Рµ Р·Р°Р¶РёРіР°РЅРёРµ.`);
    }

    this.elm.log('info', `[РўРµСЃС‚ РРњ] ${target.name} Р°РєС‚РёРІРёСЂРѕРІР°РЅ! РЈРґРµСЂР¶Р°РЅРёРµ ${target.duration / 1000} СЃРµРє...`);

    // 2. РЈРґРµСЂР¶Р°РЅРёРµ РІ Р°РєС‚РёРІРЅРѕРј СЃРѕСЃС‚РѕСЏРЅРёРё СЃ Tester Present (3E)
    const startTime = Date.now();
    while (Date.now() - startTime < target.duration) {
      await this.delay(800);
      try { await this.elm.send("3E", 500); } catch (e) {}
    }

    // 3. Р’С‹РєР»СЋС‡РµРЅРёРµ РјРµС…Р°РЅРёР·РјР° (30 <ID> 00)
    await this.delay(100);
    const cmdOff = `30${target.id}00`;
    this.elm.log('info', `[РўРµСЃС‚ РРњ] Р’С‹РєР»СЋС‡РµРЅРёРµ ${target.name}: ${cmdOff}`);
    try {
      await this.elm.send(cmdOff, 1500);
    } catch (e) {}

    // Р’РѕР·РІСЂР°С‰Р°РµРј Р·Р°РіРѕР»РѕРІРѕРє РЅР°Р·Р°Рґ
    try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}

    return true;
  }

  async resetWithInit() {
    this.elm.log('info', 'Р’С‹РїРѕР»РЅРµРЅРёРµ СЃР±СЂРѕСЃР° Р­Р‘РЈ СЃ РёРЅРёС†РёР°Р»РёР·Р°С†РёРµР№ (KWP2000 Reset 11 01)...');
    try {
      try { await this.elm.send("AT SH 82 10 F1", 500); } catch (e) {}
      const resp = await this.elm.send("1101", 2000);
      try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}
      const clean = resp.replace(/\s+/g, '').toUpperCase();
      if (clean.startsWith("5101") || clean.includes("OK")) {
        return true;
      }
    } catch (e) {}

    // Р РµР·РµСЂРІРЅР°СЏ РїРѕРїС‹С‚РєР° С‡РµСЂРµР· СЃС‚Р°СЂС‚ РїСЂРѕС†РµРґСѓСЂС‹ 31 01 00
    this.elm.log('info', 'Р РµР·РµСЂРІРЅР°СЏ РїРѕРїС‹С‚РєР° СЃР±СЂРѕСЃР° С‡РµСЂРµР· 31 01 00...');
    try { await this.elm.send("AT SH 83 10 F1", 500); } catch (e) {}
    const resp2 = (await this.elm.send("310100", 2000)).replace(/\s+/g, '').toUpperCase();
    try { await this.elm.send("AT SH 81 10 F1", 500); } catch (e) {}
    return resp2.startsWith("71") || resp2.includes("OK");
  }

  delay(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  static get DTC_DICTIONARY() {
    return {
            "P0030": "Неисправность цепи нагревателя датчика кислорода 1 (до нейтрализатора)",
      "P0036": "Неисправность цепи нагревателя датчика кислорода 2 (после нейтрализатора)",
      "P0102": "РќРёР·РєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РІ С†РµРїРё РґР°С‚С‡РёРєР° СЂР°СЃС…РѕРґР° РІРѕР·РґСѓС…Р° (Р”РњР Р’)",
      "P0103": "Р’С‹СЃРѕРєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РІ С†РµРїРё РґР°С‚С‡РёРєР° СЂР°СЃС…РѕРґР° РІРѕР·РґСѓС…Р° (Р”РњР Р’)",
      "P0112": "РќРёР·РєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° С‚РµРјРїРµСЂР°С‚СѓСЂС‹ РІРїСѓСЃРєРЅРѕРіРѕ РІРѕР·РґСѓС…Р°",
      "P0113": "Р’С‹СЃРѕРєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° С‚РµРјРїРµСЂР°С‚СѓСЂС‹ РІРїСѓСЃРєРЅРѕРіРѕ РІРѕР·РґСѓС…Р°",
      "P0116": "Р’С‹С…РѕРґ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° С‚РµРјРїРµСЂР°С‚СѓСЂС‹ РћР– Р·Р° РґРѕРїСѓСЃС‚РёРјС‹Р№ РґРёР°РїР°Р·РѕРЅ",
      "P0117": "РќРёР·РєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° С‚РµРјРїРµСЂР°С‚СѓСЂС‹ РћР– (Р”РўРћР–)",
      "P0118": "Р’С‹СЃРѕРєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° С‚РµРјРїРµСЂР°С‚СѓСЂС‹ РћР– (Р”РўРћР–)",
      "P0122": "РќРёР·РєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° РїРѕР»РѕР¶РµРЅРёСЏ РґСЂРѕСЃСЃРµР»СЊРЅРѕР№ Р·Р°СЃР»РѕРЅРєРё (Р”РџР”Р—)",
      "P0123": "Р’С‹СЃРѕРєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° РїРѕР»РѕР¶РµРЅРёСЏ РґСЂРѕСЃСЃРµР»СЊРЅРѕР№ Р·Р°СЃР»РѕРЅРєРё (Р”РџР”Р—)",
      "P0130": "РќРµРёСЃРїСЂР°РІРЅРѕСЃС‚СЊ С†РµРїРё РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° (Р»СЏРјР±РґР° 1)",
      "P0131": "РќРёР·РєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° РґРѕ РЅРµР№С‚СЂР°Р»РёР·Р°С‚РѕСЂР°",
      "P0132": "Р’С‹СЃРѕРєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° РґРѕ РЅРµР№С‚СЂР°Р»РёР·Р°С‚РѕСЂР°",
      "P0134": "РћС‚СЃСѓС‚СЃС‚РІРёРµ РѕС‚РєР»РёРєР° РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° РґРѕ РЅРµР№С‚СЂР°Р»РёР·Р°С‚РѕСЂР°",
      "P0135": "РќРµРёСЃРїСЂР°РІРЅРѕСЃС‚СЊ РЅР°РіСЂРµРІР°С‚РµР»СЏ РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° 1",
      "P0136": "РќРµРёСЃРїСЂР°РІРЅРѕСЃС‚СЊ С†РµРїРё РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° 2 (РїРѕСЃР»Рµ РЅРµР№С‚СЂР°Р»РёР·Р°С‚РѕСЂР°)",
      "P0137": "РќРёР·РєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° 2",
      "P0138": "Р’С‹СЃРѕРєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° 2",
      "P0140": "РћР±СЂС‹РІ С†РµРїРё СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° 2",
      "P0141": "РќРµРёСЃРїСЂР°РІРЅРѕСЃС‚СЊ РЅР°РіСЂРµРІР°С‚РµР»СЏ РґР°С‚С‡РёРєР° РєРёСЃР»РѕСЂРѕРґР° 2",
      "P0171": "РЎР»РёС€РєРѕРј Р±РµРґРЅР°СЏ СЃРјРµСЃСЊ РІ СЃРёСЃС‚РµРјРµ",
      "P0172": "РЎР»РёС€РєРѕРј Р±РѕРіР°С‚Р°СЏ СЃРјРµСЃСЊ РІ СЃРёСЃС‚РµРјРµ",
      "P0300": "РЎР»СѓС‡Р°Р№РЅС‹Рµ/РјРЅРѕР¶РµСЃС‚РІРµРЅРЅС‹Рµ РїСЂРѕРїСѓСЃРєРё Р·Р°Р¶РёРіР°РЅРёСЏ",
      "P0301": "РџСЂРѕРїСѓСЃРєРё Р·Р°Р¶РёРіР°РЅРёСЏ РІ 1-Рј С†РёР»РёРЅРґСЂРµ",
      "P0302": "РџСЂРѕРїСѓСЃРєРё Р·Р°Р¶РёРіР°РЅРёСЏ РІРѕ 2-Рј С†РёР»РёРЅРґСЂРµ",
      "P0303": "РџСЂРѕРїСѓСЃРєРё Р·Р°Р¶РёРіР°РЅРёСЏ РІ 3-Рј С†РёР»РёРЅРґСЂРµ",
      "P0304": "РџСЂРѕРїСѓСЃРєРё Р·Р°Р¶РёРіР°РЅРёСЏ РІ 4-Рј С†РёР»РёРЅРґСЂРµ",
      "P0327": "РќРёР·РєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° РґРµС‚РѕРЅР°С†РёРё",
      "P0328": "Р’С‹СЃРѕРєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° РґРµС‚РѕРЅР°С†РёРё",
      "P0335": "РћС€РёР±РєР° РІ С†РµРїРё РґР°С‚С‡РёРєР° РїРѕР»РѕР¶РµРЅРёСЏ РєРѕР»РµРЅРІР°Р»Р° (Р”РџРљР’)",
      "P0336": "РћС€РёР±РєР° СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° РїРѕР»РѕР¶РµРЅРёСЏ РєРѕР»РµРЅРІР°Р»Р° (Р”РџРљР’)",
      "P0342": "РќРёР·РєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° С„Р°Р· (СЂР°СЃРїСЂРµРґРІР°Р»Р°)",
      "P0343": "Р’С‹СЃРѕРєРёР№ СѓСЂРѕРІРµРЅСЊ СЃРёРіРЅР°Р»Р° РґР°С‚С‡РёРєР° С„Р°Р· (СЂР°СЃРїСЂРµРґРІР°Р»Р°)",
      "P0422": "Р­С„С„РµРєС‚РёРІРЅРѕСЃС‚СЊ РЅРµР№С‚СЂР°Р»РёР·Р°С‚РѕСЂР° РЅРёР¶Рµ РїРѕСЂРѕРіР°",
      "P0441": "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ СЂР°СЃС…РѕРґ РІРѕР·РґСѓС…Р° С‡РµСЂРµР· РєР»Р°РїР°РЅ РїСЂРѕРґСѓРІРєРё Р°РґСЃРѕСЂР±РµСЂР°",
            "P0443": "Неисправность цепи управления клапаном продувки адсорбера",
      "P0480": "РќРµРёСЃРїСЂР°РІРЅРѕСЃС‚СЊ С†РµРїРё СѓРїСЂР°РІР»РµРЅРёСЏ СЂРµР»Рµ РІРµРЅС‚РёР»СЏС‚РѕСЂР° 1",
      "P0481": "РќРµРёСЃРїСЂР°РІРЅРѕСЃС‚СЊ С†РµРїРё СѓРїСЂР°РІР»РµРЅРёСЏ СЂРµР»Рµ РІРµРЅС‚РёР»СЏС‚РѕСЂР° 2",
      "P0500": "РќРµРёСЃРїСЂР°РІРЅРѕСЃС‚СЊ РІ С†РµРїРё РґР°С‚С‡РёРєР° СЃРєРѕСЂРѕСЃС‚Рё Р°РІС‚РѕРјРѕР±РёР»СЏ",
            "P0501": "Сигнал датчика скорости автомобиля вне допустимого диапазона",
      "P0560": "Неисправность напряжения питания системы",
      "P1545": "Неисправность привода дроссельной заслонки / отклонение положения",
      "P0506": "РЎР»РёС€РєРѕРј РЅРёР·РєРёРµ РѕР±РѕСЂРѕС‚С‹ С…РѕР»РѕСЃС‚РѕРіРѕ С…РѕРґР°",
      "P0507": "РЎР»РёС€РєРѕРј РІС‹СЃРѕРєРёРµ РѕР±РѕСЂРѕС‚С‹ С…РѕР»РѕСЃС‚РѕРіРѕ С…РѕРґР°",
      "P0562": "РџРѕРЅРёР¶РµРЅРЅРѕРµ РЅР°РїСЂСЏР¶РµРЅРёРµ Р±РѕСЂС‚РѕРІРѕР№ СЃРµС‚Рё",
      "P0563": "РџРѕРІС‹С€РµРЅРЅРѕРµ РЅР°РїСЂСЏР¶РµРЅРёРµ Р±РѕСЂС‚РѕРІРѕР№ СЃРµС‚Рё",
      "P0601": "РћС€РёР±РєР° РєРѕРЅС‚СЂРѕР»СЊРЅРѕР№ СЃСѓРјРјС‹ РџР—РЈ (Р­Р‘РЈ)",
      "P1602": "РџСЂРѕРїР°РґР°РЅРёРµ РЅР°РїСЂСЏР¶РµРЅРёСЏ Р±РѕСЂС‚РѕРІРѕР№ СЃРµС‚Рё РЅР° Р­Р‘РЈ (СЃРЅСЏС‚РёРµ РєР»РµРјРјС‹ РђРљР‘)"
    };
  }
}

window.ItelmaM73Protocol = ItelmaM73Protocol;