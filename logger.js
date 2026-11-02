/**
 * Модуль скоростного логирования телеметрии и экспорта в формат Excel (.xlsx)
 * Рассчитывает точную частоту дискретизации (Гц и мс) и выгружает данные через iOS Share Sheet.
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

    this.onStatsUpdate = null; // (stats: { count: number, hz: number, ms: number }) => void
  }

  start() {
    this.records = [];
    this.startTime = new Date();
    this.isRecording = true;
    this.lastFrameTime = performance.now();
    this.hzHistory = [];
  }

  stop() {
    this.isRecording = false;
  }

  /**
   * Добавление точки данных в лог и расчет реальной задержки между пакетами
   */
  addPoint(params) {
    const now = performance.now();
    
    if (this.lastFrameTime > 0) {
      const deltaMs = now - this.lastFrameTime;
      this.currentMs = Math.round(deltaMs);
      const instantHz = 1000 / deltaMs;
      
      this.hzHistory.push(instantHz);
      if (this.hzHistory.length > 10) this.hzHistory.shift();

      // Усредненная частота
      const sumHz = this.hzHistory.reduce((a, b) => a + b, 0);
      this.currentHz = parseFloat((sumHz / this.hzHistory.length).toFixed(1));
    }
    this.lastFrameTime = now;

    if (this.isRecording) {
      const nowIso = new Date();
      const timeStr = `${String(nowIso.getHours()).padStart(2, '0')}:${String(nowIso.getMinutes()).padStart(2, '0')}:${String(nowIso.getSeconds()).padStart(2, '0')}.${String(nowIso.getMilliseconds()).padStart(3, '0')}`;

      this.records.push({
        "Время": timeStr,
        "Интервал_мс": this.currentMs,
        "Обороты_об_мин": params.rpm,
        "Скорость_км_ч": params.speed,
        "Дроссель_проц": params.throttle,
        "ДМРВ_кг_ч": params.maf,
        "Температура_ОЖ": params.temp,
        "УОЗ_град": params.spark,
        "Впрыск_мс": params.injTime,
        "Бортсеть_В": params.voltage,
        "РХХ_шаги": params.iacSteps,
        "Флаг_ХХ": params.flags.idle ? 1 : 0,
        "Флаг_Лямбда": params.flags.lambda ? 1 : 0,
        "Флаг_Детонация": params.flags.knock ? 1 : 0,
        "Флаг_Отсечка": params.flags.fuelCut ? 1 : 0
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

    // Создаем рабочий лист Excel из массива объектов
    const worksheet = XLSX.utils.json_to_sheet(this.records);

    // Автоподбор ширины столбцов
    const colWidths = [
      { wch: 14 }, // Время
      { wch: 12 }, // Интервал_мс
      { wch: 16 }, // Обороты
      { wch: 14 }, // Скорость
      { wch: 14 }, // Дроссель
      { wch: 12 }, // ДМРВ
      { wch: 14 }, // Температура
      { wch: 10 }, // УОЗ
      { wch: 12 }, // Впрыск
      { wch: 12 }, // Бортсеть
      { wch: 10 }, // РХХ
      { wch: 9 },  // Флаг_ХХ
      { wch: 12 }, // Флаг_Лямбда
      { wch: 14 }, // Флаг_Детонация
      { wch: 14 }  // Флаг_Отсечка
    ];
    worksheet["!cols"] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Телеметрия М73");

    // Формируем имя файла с датой и временем
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const fileName = `Приора_М73_Лог_${dateStr}.xlsx`;

    // Генерируем массив байт файла Excel
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    // Если браузер поддерживает нативный Web Share API (как Bluefy/Safari на iOS)
    if (navigator.canShare && navigator.canShare({ files: [new File([blob], fileName)] })) {
      try {
        const file = new File([blob], fileName, { type: blob.type });
        await navigator.share({
          files: [file],
          title: 'Лог диагностики Приора М73',
          text: `Лог телеметрии М73 (${this.records.length} точек)`
        });
        return;
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Share API error, fallback to download:', err);
        } else {
          return; // Пользователь сам закрыл меню
        }
      }
    }

    // Резервный способ сохранения: прямая ссылка на скачивание
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
