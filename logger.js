/**
 * Модуль скоростного логирования телеметрии и экспорта в формат Excel (.xlsx)
 * Полностью согласован со структурой и названиями колонок OpenDiag Mobile.
 * Включает фоновый режим работы на iOS (Silent Audio Loop) и WakeLock.
 */

class TripLogger {
  constructor() {
    this.isRecording = false;
    this.records = [];
    this.startTime = null;
    
    // Метрики частоты опроса
    this.lastFrameTime = 0;
    this.hzHistory = [];
    this.currentHz = 0;
    this.currentMs = 0;

    // Фоновый звук для защиты от засыпания на iOS
    this.silentAudio = null;
    this.wakeLock = null;

    this.onStatsUpdate = null; // (stats: { count: number, hz: number, ms: number }) => void

    // iOS снимает блокировку экрана при сворачивании страницы — возвращаем её при возврате в приложение
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isRecording && 'wakeLock' in navigator) {
        navigator.wakeLock.request('screen').then(wl => { this.wakeLock = wl; }).catch(() => {});
      }
    });
  }

  _enableBackgroundMode() {
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

  stop() {
    this.isRecording = false;
    this._disableBackgroundMode();
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

      // Базовые параметры (Кадр 1 - 21 01)
      const record = {
        "Время (сек)": parseFloat(elapsedSec),
        "Обороты двигателя (об/мин)": params.rpm,
        "Скорость автомобиля (км/ч)": params.speed,
        "Угол открытия дроссельной заслонки (%)": params.throttle,
        "Массовый расход воздуха (кг/ч)": params.maf,
        "Цикловой расход воздуха (мг/такт)": params.cycleAir,
        "Длительность впрыска (мс)": params.injTime,
        "Загрузка форс (%)": params.dutyCycle,
        "Угол опережения зажигания (°П.К.В)": params.spark,
        "Величина отскока УОЗ при детонации (°П.К.В)": params.sparkRetard,
        "Температура охлаждающей жидкости (°C)": params.temp,
        "Напряжение питания (В)": params.voltage,
        "Позиция шагового двигателя (шаг)": params.iacSteps,
        "Расход топлива (л/ч)": params.fuelRate,
        "Сигнал датчика кислорода до нейтрализатора (В)": params.o2Volt,
        "Текущий коэффициент коррекции впрыска (-)": params.lambdaCorr,
        "Флаг холостого хода": params.flags.idle ? "Да" : "Нет",
        "Флаг полной нагрузки": params.throttle > 75 ? "Да" : "Нет",
        "Контроль детонации активен": params.flags.knock ? "Да" : "Нет",
        "Отсечка топливоподачи": params.flags.fuelCut ? "Да" : "Нет",
        "Интервал_опроса (мс)": this.currentMs
      };

      // Адаптации смеси и продувка адсорбера
      record["Заданное значение лямбда (-)"] = params.targetLambda;
      record["Коэффициент продувки адсорбера (%)"] = params.purgeRate;
      record["Мультипликативная составляющая коррекции (-)"] = params.multAdapt;
      record["Аддитивная составляющая коррекции (%)"] = params.addAdapt;

      // Пропуски зажигания
      record["Пропуски цилиндр 1 (-)"] = params.misfires.cyl1;
      record["Пропуски цилиндр 2 (-)"] = params.misfires.cyl2;
      record["Пропуски цилиндр 3 (-)"] = params.misfires.cyl3;
      record["Пропуски цилиндр 4 (-)"] = params.misfires.cyl4;
      record["Суммарный счетчик пропусков (-)"] = params.misfires.total;
      record["Активные пропуски за цикл (1000 об)"] = (params.misfires && params.misfires.cycle !== undefined) ? params.misfires.cycle : 0;

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
  async exportToXlsx() {
    if (this.records.length === 0) {
      alert("Нет записанных данных для сохранения!");
      return;
    }

    if (typeof XLSX === "undefined") {
      alert("Ошибка: библиотека SheetJS не загружена");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(this.records);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Лог М73");

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const fileName = `Приора_М73_Лог_${dateStr}.xlsx`;

    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const file = new File([blob], fileName, { type: blob.type });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Лог диагностики Приора М73',
          text: `Лог М73 (${this.records.length} точек)`
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
