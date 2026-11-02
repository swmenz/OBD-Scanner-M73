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
  }

  /**
   * Активация бесшумного звукового потока (трюк Car Scanner)
   * для предотвращения засыпания JavaScript на iOS при сворачивании браузера
   */
  _enableBackgroundMode() {
    try {
      if (!this.silentAudio) {
        // Минимальный бесшумный WAV в формате Base64
        const silentWav = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
        this.silentAudio = new Audio(silentWav);
        this.silentAudio.loop = true;
      }
      this.silentAudio.play().catch(e => console.log("Фоновый звук ожидает взаимодействия"));
    } catch (e) {
      console.warn("Ошибка запуска фонового режима:", e);
    }

    // Запрет гашения экрана (Screen Wake Lock API)
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
      // Время от старта записи в секундах (с точностью до тысячных, как в OpenDiag)
      const elapsedSec = ((now - this.startTime) / 1000).toFixed(3);

      // Формируем структуру строк, полностью идентичную OpenDiag Mobile
      this.records.push({
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
      });
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

    // Автоподбор ширины столбцов под русский текст
    worksheet["!cols"] = [
      { wch: 12 }, // Время (сек)
      { wch: 16 }, // Обороты
      { wch: 15 }, // Скорость
      { wch: 18 }, // Дроссель
      { wch: 16 }, // ДМРВ
      { wch: 18 }, // Цикловой расход
      { wch: 15 }, // Впрыск
      { wch: 12 }, // Загрузка форс
      { wch: 14 }, // УОЗ
      { wch: 18 }, // Отскок УОЗ
      { wch: 16 }, // ТОЖ
      { wch: 14 }, // Бортсеть
      { wch: 15 }, // РХХ
      { wch: 14 }, // Расход л/ч
      { wch: 18 }, // Лямбда 1
      { wch: 16 }, // Коррекция
      { wch: 12 }, // Флаг ХХ
      { wch: 14 }, // Флаг полной нагрузки
      { wch: 15 }, // Детонация
      { wch: 14 }, // Отсечка
      { wch: 12 }  // Интервал мс
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Лог М73 Скоростной");

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const fileName = `Приора_М73_Лог_${dateStr}.xlsx`;

    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    if (navigator.canShare && navigator.canShare({ files: [new File([blob], fileName)] })) {
      try {
        const file = new File([blob], fileName, { type: blob.type });
        await navigator.share({
          files: [file],
          title: 'Лог диагностики Приора М73',
          text: `Скоростной лог М73 (${this.records.length} точек)`
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
