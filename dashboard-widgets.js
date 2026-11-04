/**
 * DashboardWidgetManager — Модульная система кастомизации приборной панели в стиле виджетов iOS.
 * Поддерживает:
 *  - Режим редактирования (Jiggle / Wiggle Mode)
 *  - Переключение размеров карточек (1 колонка ↔ во всю ширину на 2 колонки)
 *  - Плавный Touch Drag & Drop для изменения порядка блоков на iPhone
 *  - Удаление / добавление любых датчиков ЭБУ М73 через галерею виджетов
 *  - Живой неоновый осциллограф ДК1 (лямбда-зонд) на Canvas
 *  - Сохранение пользовательской раскладки в LocalStorage и сброс по умолчанию
 */

class DashboardWidgetManager {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.editBar = null;
    this.galleryModal = null;
    this.isEditMode = false;
    this.storageKey = 'priora_m73_dashboard_layout_v2';
    
    // Буфер истории ДК1 для графика-осциллографа
    this.o2History = [];
    this.maxO2Points = 45;
    this.o2Canvas = null;
    this.o2Ctx = null;
    this.lastO2Render = 0;

    // Каталог скрытых датчиков, доступных для добавления
    this.extraSensorsCatalog = [
      { id: 'extra-power', title: 'Мощность двигателя', unit: 'л.с.', field: 'enginePower', category: 'dynamics', decimals: 1 },
      { id: 'extra-torque', title: 'Крутящий момент', unit: 'Н·м', field: 'engineTorque', category: 'dynamics', decimals: 1 },
      { id: 'extra-idle-target', title: 'Желаемые обороты ХХ', unit: 'об/мин', field: 'idleTarget', category: 'dynamics', decimals: 0 },
      { id: 'extra-idle-rpm', title: 'Фактические обороты ХХ', unit: 'об/мин', field: 'idleRpm', category: 'dynamics', decimals: 0 },
      { id: 'extra-air-idle', title: 'Желаемый расход на ХХ', unit: 'кг/ч', field: 'airTargetIdle', category: 'air', decimals: 2 },
      { id: 'extra-idle-adapt', title: 'Адаптация регул. ХХ', unit: '%', field: 'idleAdapt', category: 'dynamics', decimals: 2 },
      { id: 'extra-idle-torque-i', title: 'Момент ХХ: I-часть', unit: '%', field: 'idleTorqueI', category: 'dynamics', decimals: 2 },
      { id: 'extra-idle-torque-pd', title: 'Момент ХХ: PD-часть', unit: '%', field: 'idleTorquePD', category: 'dynamics', decimals: 2 },
      { id: 'extra-o2-period', title: 'Период сигнала ДК1', unit: 'с', field: 'o2Period', category: 'fuel', decimals: 2 },
      { id: 'extra-o2-2-delay', title: 'Задержка ОС по ДК2', unit: 'с', field: 'o2_2_integralDelay', category: 'fuel', decimals: 1 },
      { id: 'extra-damper-adapt', title: 'Адаптация демпфера', unit: 'об/с²', field: 'damperAdapt', category: 'dynamics', decimals: 2 },
      { id: 'extra-unbalance-rpm', title: 'Неравномерность коленвала', unit: 'об/с²', field: 'unbalanceRpm', category: 'dynamics', decimals: 2 },
      { id: 'extra-temp-start', title: 'Температура ОЖ при пуске', unit: '°C', field: 'tempAtStart', category: 'ignition', decimals: 1 },
      { id: 'extra-time-reset', title: 'Время с момента сброса', unit: 'мин', field: 'timeSinceReset', category: 'main', decimals: 0 },
      { id: 'extra-time-reset-hours', title: 'Время сброса ЭБУ (ч)', unit: 'ч', field: 'timeSinceResetHours', category: 'main', decimals: 1 },
      { id: 'extra-idle-air-offset', title: 'Смещение воздуха ХХ', unit: 'кг/ч', field: 'idleAirOffset', category: 'air', decimals: 1 }
    ];
  }

  init() {
    this.container = document.getElementById('dashboardGrid');
    this.editBar = document.getElementById('dashboardEditBar');
    this.galleryModal = document.getElementById('modalWidgetGallery');
    this.o2Canvas = document.getElementById('canvasO2');
    if (this.o2Canvas) {
      this.o2Ctx = this.o2Canvas.getContext('2d');
    }

    if (!this.container) return;

    // Сохраняем заводские шаблоны всех стандартных виджетов прямо из DOM перед любыми изменениями
    this.standardTemplates = new Map();
    Array.from(this.container.querySelectorAll('.dashboard-widget')).forEach(w => {
      const id = w.getAttribute('data-widget-id');
      if (id) {
        const clone = w.cloneNode(true);
        clone.querySelectorAll('.widget-action-btn').forEach(b => b.remove());
        clone.classList.remove('is-dragging', 'widget-entering', 'widget-leaving');
        this.standardTemplates.set(id, {
          html: clone.innerHTML,
          defaultSize: w.classList.contains('widget-wide') ? 'wide' : 'compact',
          title: w.getAttribute('data-title') || id
        });
      }
    });

    // Инициализация виджетов и добавление кнопок управления
    this._setupWidgets();

    // Загрузка сохранённого порядка и размеров из LocalStorage
    this._loadSavedLayout();

    // Привязка событий взаимодействия
    this._bindEvents();
  }

  _setupWidgets() {
    const widgets = Array.from(this.container.querySelectorAll('.dashboard-widget'));
    widgets.forEach(w => {
      this._attachWidgetControls(w);
    });
  }

  _attachWidgetControls(widgetEl) {
    if (widgetEl.querySelector('.widget-btn-resize')) return;

    // Кнопка переключения размера (1 колонка ↔ во всю ширину)
    const btnResize = document.createElement('button');
    btnResize.className = 'widget-action-btn widget-btn-resize';
    btnResize.setAttribute('type', 'button');
    btnResize.setAttribute('aria-label', 'Изменить размер');
    btnResize.innerHTML = '⤢';
    btnResize.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleWidgetSize(widgetEl);
    });

    // Карточка логгера является системной — запрещаем её случайное удаление
    if (widgetEl.getAttribute('data-widget-id') === 'logger-card') {
      widgetEl.appendChild(btnResize);
      return;
    }

    if (!widgetEl.querySelector('.widget-btn-remove')) {
      // Кнопка удаления (скрытия)
      const btnRemove = document.createElement('button');
      btnRemove.className = 'widget-action-btn widget-btn-remove';
      btnRemove.setAttribute('type', 'button');
      btnRemove.setAttribute('aria-label', 'Скрыть виджет');
      btnRemove.innerHTML = '✕';
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeWidget(widgetEl);
      });
      widgetEl.appendChild(btnRemove);
    }

    widgetEl.appendChild(btnResize);
  }

  _bindEvents() {
    // Кнопка включения режима кастомизации в шапке
    const btnCustomize = document.getElementById('btnCustomizeDash');
    if (btnCustomize) {
      btnCustomize.addEventListener('click', () => this.toggleEditMode());
    }

    // Кнопка «Готово»
    const btnDone = document.getElementById('btnDoneDashboard');
    if (btnDone) {
      btnDone.addEventListener('click', () => this.exitEditMode());
    }

    // Кнопка «+ Добавить датчик»
    const btnAdd = document.getElementById('btnAddWidget');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => this.openGallery());
    }

    // Кнопка «Сброс»
    const btnReset = document.getElementById('btnResetDashboard');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (confirm('Сбросить расположение и состав виджетов к заводскому виду?')) {
          this.resetLayout();
        }
      });
    }

    // Закрытие модального окна галереи
    const btnCloseGallery = document.getElementById('btnCloseGallery');
    if (btnCloseGallery) {
      btnCloseGallery.addEventListener('click', () => this.closeGallery());
    }
    if (this.galleryModal) {
      this.galleryModal.addEventListener('click', (e) => {
        if (e.target === this.galleryModal) this.closeGallery();
      });
    }

    // Поиск по галерее виджетов
    const gallerySearch = document.getElementById('gallerySearchInput');
    if (gallerySearch) {
      gallerySearch.addEventListener('input', (e) => this._filterGallery(e.target.value));
    }

    // Нажатие и удержание для входа в режим редактирования как в iOS
    this._bindLongPress();

    // Touch Drag & Drop перетаскивание на iPhone с задержкой 1.5с
    this._bindTouchDrag();
  }

  _bindLongPress() {
    let pressTimer = null;
    let startX = 0;
    let startY = 0;

    this.container.addEventListener('touchstart', (e) => {
      if (this.isEditMode) return;
      if (e.target.closest('button, input, a, select')) return;

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;

      pressTimer = setTimeout(() => {
        if (navigator.vibrate) navigator.vibrate(50);
        this.enterEditMode();
      }, 700);
    }, { passive: true });

    this.container.addEventListener('touchmove', (e) => {
      if (pressTimer) {
        const touch = e.touches[0];
        if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 10) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      }
    }, { passive: true });

    this.container.addEventListener('touchend', () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }, { passive: true });

    this.container.addEventListener('touchcancel', () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }, { passive: true });
  }

  _bindTouchDrag() {
    let draggedEl = null;
    let initialX = 0;
    let initialY = 0;
    let touchTarget = null;
    let holdTimer = null;
    let canDrag = false;

    const cleanupDrag = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (draggedEl) {
        draggedEl.classList.remove('is-dragging');
        draggedEl.style.transform = '';
        draggedEl.style.pointerEvents = '';
        this._saveLayout();
        draggedEl = null;
      }
      touchTarget = null;
      canDrag = false;
    };

    this.container.addEventListener('touchstart', (e) => {
      if (!this.isEditMode) return;
      const widget = e.target.closest('.dashboard-widget');
      if (!widget || e.target.closest('.widget-action-btn')) return;

      // Сбрасываем предыдущее состояние
      cleanupDrag();

      touchTarget = widget;
      const touch = e.touches[0];
      initialX = touch.clientX;
      initialY = touch.clientY;
      canDrag = false;

      // Задержка удержания 1.5 секунды перед активацией перемещения виджета
      // Это позволяет пользователю свободно прокручивать страницу вниз в режиме редактирования!
      holdTimer = setTimeout(() => {
        if (!touchTarget) return;
        canDrag = true;
        draggedEl = touchTarget;
        draggedEl.classList.add('is-dragging');
        if (navigator.vibrate) {
          navigator.vibrate([40, 30, 40]);
        }
      }, 1500);
    }, { passive: true });

    this.container.addEventListener('touchmove', (e) => {
      if (!this.isEditMode || !touchTarget) return;

      const touch = e.touches[0];
      const dx = touch.clientX - initialX;
      const dy = touch.clientY - initialY;
      const dist = Math.hypot(dx, dy);

      // Если 1.5 сек удержания еще не прошло:
      if (!canDrag) {
        // Если палец сдвинулся более чем на 10px — пользователь просто скроллит страницу
        if (dist > 10) {
          if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
          touchTarget = null;
        }
        // Не блокируем нативную прокрутку страницы!
        return;
      }

      // После 1.5 сек удержания виджет переходит в режим перемещения:
      if (draggedEl) {
        e.preventDefault(); // Предотвращаем скролл страницы только во время активного drag
        draggedEl.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.05)`;

        // Автоматическая подкрутка экрана если палец у края экрана (контейнер .app-scroll-view)
        const scrollView = this.container.closest('.app-scroll-view') || document.querySelector('.app-scroll-view');
        if (scrollView) {
          if (touch.clientY > window.innerHeight - 80) {
            scrollView.scrollBy({ top: 12, behavior: 'auto' });
          } else if (touch.clientY < 80) {
            scrollView.scrollBy({ top: -12, behavior: 'auto' });
          }
        }

        // Поиск элемента под пальцем для перестановки
        draggedEl.style.pointerEvents = 'none';
        const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        draggedEl.style.pointerEvents = '';

        if (!elemBelow) return;
        const targetWidget = elemBelow.closest('.dashboard-widget');

        if (targetWidget && targetWidget !== draggedEl && targetWidget.parentNode === this.container) {
          const rect = targetWidget.getBoundingClientRect();
          const isAfter = touch.clientY > rect.top + rect.height / 2;
          if (isAfter) {
            this.container.insertBefore(draggedEl, targetWidget.nextSibling);
          } else {
            this.container.insertBefore(draggedEl, targetWidget);
          }
        }
      }
    }, { passive: false });

    this.container.addEventListener('touchend', cleanupDrag);
    this.container.addEventListener('touchcancel', cleanupDrag);
  }

  toggleEditMode() {
    if (this.isEditMode) {
      this.exitEditMode();
    } else {
      this.enterEditMode();
    }
  }

  enterEditMode() {
    this.isEditMode = true;
    this.container.classList.add('edit-mode');
    if (this.editBar) {
      this.editBar.style.display = 'flex';
      this.editBar.classList.add('animate-slide-up');
    }
    const btnCustomize = document.getElementById('btnCustomizeDash');
    if (btnCustomize) btnCustomize.classList.add('active');
  }

  exitEditMode() {
    this.isEditMode = false;
    this.container.classList.remove('edit-mode');
    if (this.editBar) {
      this.editBar.style.display = 'none';
      this.editBar.classList.remove('animate-slide-up');
    }
    const btnCustomize = document.getElementById('btnCustomizeDash');
    if (btnCustomize) btnCustomize.classList.remove('active');
    this._saveLayout();
  }

  toggleWidgetSize(widgetEl) {
    if (widgetEl.classList.contains('widget-wide')) {
      widgetEl.classList.remove('widget-wide');
      widgetEl.classList.add('widget-compact');
    } else {
      widgetEl.classList.remove('widget-compact');
      widgetEl.classList.add('widget-wide');
    }
    if (navigator.vibrate) navigator.vibrate(20);
    this._saveLayout();

    // Если это виджет ДК1 — перерисовываем график под новую ширину
    if (widgetEl.getAttribute('data-widget-id') === 'o2-volt') {
      setTimeout(() => this.drawO2Oscilloscope(), 50);
    }
  }

  removeWidget(widgetEl) {
    widgetEl.removeAttribute('data-widget-id');
    widgetEl.classList.add('widget-leaving');
    setTimeout(() => {
      widgetEl.remove();
      this._saveLayout();
      if (this.app && typeof this.app.initElements === 'function') {
        this.app.initElements();
      }
    }, 200);
    if (navigator.vibrate) navigator.vibrate(30);
  }

  openGallery() {
    if (!this.galleryModal) {
      this.galleryModal = document.getElementById('modalWidgetGallery');
    }
    if (!this.galleryModal) return;

    const searchInput = document.getElementById('gallerySearchInput');
    if (searchInput) searchInput.value = '';

    this._populateGallery();
    this.galleryModal.style.display = 'flex';
    void this.galleryModal.offsetWidth; // Принудительный reflow для активации CSS-перехода
    this.galleryModal.classList.add('open');
  }

  closeGallery() {
    if (!this.galleryModal) {
      this.galleryModal = document.getElementById('modalWidgetGallery');
    }
    if (!this.galleryModal) return;

    this.galleryModal.classList.remove('open');
    setTimeout(() => {
      if (this.galleryModal && !this.galleryModal.classList.contains('open')) {
        this.galleryModal.style.display = 'none';
      }
    }, 250);
  }

  _populateGallery() {
    const listContainer = document.getElementById('galleryList');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    const activeIds = new Set(
      Array.from(this.container.querySelectorAll('.dashboard-widget')).map(w => w.getAttribute('data-widget-id'))
    );

    // 1. Стандартные виджеты из фабричной раскладки
    const standardWidgets = [
      { id: 'hero-gauges', title: 'Спидометр и Тахометр', category: 'main', desc: 'Главные цифровые приборы скорости и оборотов' },
      { id: 'misfires', title: 'Пропуски зажигания', category: 'main', desc: 'Счётчики пропусков по всем 4 цилиндрам' },
      { id: 'maf', title: 'Расход воздуха (ДМРВ)', category: 'air', desc: 'Массовый расход воздуха в кг/ч' },
      { id: 'cycle-air', title: 'Цикловой расход', category: 'air', desc: 'Наполнение цилиндра воздухом (мг/такт)' },
      { id: 'inj-time', title: 'Длительность впрыска', category: 'fuel', desc: 'Время открытия форсунок в мс' },
      { id: 'duty', title: 'Загрузка форсунок', category: 'fuel', desc: 'Процент загруженности форсунок (%)' },
      { id: 'mult-adapt', title: 'Мультипликатив (FRA)', category: 'fuel', desc: 'Долговременная коррекция смеси под нагрузкой' },
      { id: 'add-adapt', title: 'Аддитив (TRA / ХХ)', category: 'fuel', desc: 'Смещение топливоподачи на ХХ (%)' },
      { id: 'spark', title: 'УОЗ и отскок детонации', category: 'ignition', desc: 'Угол зажигания и величина отката (°П.К.В)' },
      { id: 'throttle', title: 'Дроссельная заслонка', category: 'main', desc: 'Положение педали/заслонки в %' },
      { id: 'temp', title: 'Температура ОЖ', category: 'ignition', desc: 'Температура охлаждающей жидкости со шкалой' },
      { id: 'intake-temp', title: 'Температура впуска (ДТВ)', category: 'air', desc: 'Температура воздуха в коллекторе' },
      { id: 'voltage', title: 'Бортовая сеть', category: 'main', desc: 'Напряжение генератора/АКБ (В)' },
      { id: 'rough-road', title: 'Неровная дорога (ДНД)', category: 'main', desc: 'Сигнал акселерометра в g' },
      { id: 'fuel-rate', title: 'Текущий расход топлива', category: 'fuel', desc: 'Мгновенный расход в л/ч' },
      { id: 'iac', title: 'Позиция РХХ', category: 'air', desc: 'Шаги регулятора холостого хода' },
      { id: 'frl-load', title: 'Нагрузка (FRL)', category: 'air', desc: 'Параметр нагрузки двигателя (%)' },
      { id: 'calc-load', title: 'Расчётная нагрузка', category: 'air', desc: 'Относительное заполнение воздухом (%)' },
      { id: 'knock-volt', title: 'Шум датчика детонации', category: 'ignition', desc: 'Амплитуда шума ДД в Вольтах' },
      { id: 'o2-volt', title: 'ДК1 (до ката) — Осциллограф', category: 'fuel', desc: 'Живой неоновый график синусоиды лямбда-зонда' },
      { id: 'o2-volt2', title: 'ДК2 (после ката)', category: 'fuel', desc: 'Диагностический датчик кислорода (В)' },
      { id: 'lambda-corr', title: 'Коррекция смеси', category: 'fuel', desc: 'Быстрый коэффициент регулирования лямбда' },
      { id: 'target-lambda', title: 'Целевая лямбда', category: 'fuel', desc: 'Заданный состав топливной смеси' },
      { id: 'purge-rate', title: 'Продувка адсорбера', category: 'fuel', desc: 'Степень продувки клапана КПА (%)' },
      { id: 'altitude', title: 'Барокоррекция', category: 'air', desc: 'Фактор высотной коррекции атмосферного давления' },
      { id: 'ecu-flags', title: 'Флаги и режимы ЭБУ', category: 'main', desc: 'Статусы ХХ, лямбда-петли, вентиляторов и Check Engine' },
      { id: 'logger-card', title: 'Запись поездки в Excel', category: 'main', desc: 'Кнопки старта/экспорта логов и автозапись' }
    ];

    const allItems = [...standardWidgets, ...this.extraSensorsCatalog];

    allItems.forEach(item => {
      const isAlreadyAdded = activeIds.has(item.id);
      const row = document.createElement('div');
      row.className = `gallery-item ${isAlreadyAdded ? 'item-added' : ''}`;
      row.setAttribute('data-id', item.id);
      row.setAttribute('data-title', item.title.toLowerCase());

      row.innerHTML = `
        <div class="gallery-info">
          <div class="gallery-title">${item.title}</div>
          <div class="gallery-sub">${item.desc || ('Канал ЭБУ: ' + (item.unit || ''))}</div>
        </div>
        <div class="gallery-action">
          ${item.id === 'logger-card'
            ? '<span class="badge-system">Системный</span>'
            : (isAlreadyAdded 
              ? '<button class="glass-btn btn-compact btn-gallery-remove" type="button">✕ Удалить</button>' 
              : '<button class="glass-btn btn-compact btn-gallery-add" type="button">＋ Добавить</button>')}
        </div>
      `;

      const actionWrap = row.querySelector('.gallery-action');

      const toggleAction = (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (item.id === 'logger-card') return;

        const currentlyAdded = row.classList.contains('item-added');
        if (currentlyAdded) {
          // Удалить датчик с панели прямо из галереи
          const widgetEl = this.container.querySelector(`[data-widget-id="${item.id}"]`);
          if (widgetEl) {
            this.removeWidget(widgetEl);
          }
          row.classList.remove('item-added');
          actionWrap.innerHTML = '<button class="glass-btn btn-compact btn-gallery-add" type="button">＋ Добавить</button>';
        } else {
          // Добавить датчик на панель прямо из галереи
          this._createAndAddWidget(item);
          row.classList.add('item-added');
          actionWrap.innerHTML = '<button class="glass-btn btn-compact btn-gallery-remove" type="button">✕ Удалить</button>';
        }
      };

      row.style.cursor = 'pointer';
      row.addEventListener('click', toggleAction);

      listContainer.appendChild(row);
    });
  }

  _filterGallery(query) {
    const q = (query || '').toLowerCase().trim();
    const rows = document.querySelectorAll('#galleryList .gallery-item');
    rows.forEach(r => {
      const title = r.getAttribute('data-title') || '';
      if (!q || title.includes(q)) {
        r.style.display = 'flex';
      } else {
        r.style.display = 'none';
      }
    });
  }

  _createAndAddWidget(item, skipSave = false) {
    const existing = this.container.querySelector(`[data-widget-id="${item.id}"]`);
    if (existing) return;

    let widgetEl = document.createElement('div');
    widgetEl.className = 'dashboard-widget widget-compact widget-entering';
    widgetEl.setAttribute('data-widget-id', item.id);
    widgetEl.setAttribute('data-title', item.title);

    // Если это дополнительный датчик из каталога М73
    const isExtra = this.extraSensorsCatalog.find(s => s.id === item.id);
    if (isExtra) {
      widgetEl.innerHTML = `
        <div class="glass-card metric-tile">
          <span class="tile-label">${isExtra.title}</span>
          <div class="tile-val-wrap">
            <span class="tile-num" id="val_${isExtra.id}">0</span>
            <span class="tile-unit">${isExtra.unit}</span>
          </div>
        </div>
      `;
    } else {
      // Восстановление стандартного виджета из сохраненного шаблона или генератора
      const tpl = this.standardTemplates && this.standardTemplates.get(item.id);
      if (tpl) {
        widgetEl.innerHTML = tpl.html;
        if (tpl.defaultSize === 'wide') {
          widgetEl.classList.remove('widget-compact');
          widgetEl.classList.add('widget-wide');
        }
      } else {
        widgetEl.innerHTML = this._getStandardWidgetHtml(item.id);
      }
    }

    this._attachWidgetControls(widgetEl);
    this.container.appendChild(widgetEl);
    if (!skipSave) this._saveLayout();

    // Обновляем контекст canvas если вернули ДК1
    if (item.id === 'o2-volt') {
      this.o2Canvas = document.getElementById('canvasO2');
      if (this.o2Canvas) this.o2Ctx = this.o2Canvas.getContext('2d');
    }

    // Повторно инициализируем кэшированные элементы в приложении
    if (!skipSave && this.app && typeof this.app.initElements === 'function') {
      this.app.initElements();
    }

    // Плавная прокрутка к добавленному виджету только если галерея закрыта
    if (!skipSave && (!this.galleryModal || !this.galleryModal.classList.contains('open'))) {
      setTimeout(() => {
        widgetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 120);
    }

    if (!skipSave && navigator.vibrate) navigator.vibrate(40);
  }

  _getStandardWidgetHtml(id) {
    // Шаблоны стандартных виджетов при повторном добавлении
    if (id === 'hero-gauges') {
      return `
        <div class="hero-grid">
          <div class="glass-card hero-card">
            <div class="card-top-row"><span class="micro-header">Обороты</span><span class="peak-badge" id="valPeakRpm">Пик: 0</span></div>
            <div class="hero-digital-row"><span class="hero-value" id="valRpm">0</span><span class="hero-unit">об/мин</span></div>
            <div class="glass-progress-track"><div class="glass-progress-bar" id="barRpm"></div></div>
          </div>
          <div class="glass-card hero-card">
            <div class="card-top-row"><span class="micro-header">Скорость</span><span class="gear-badge" id="valGearAux">КПП: —</span></div>
            <div class="hero-digital-row"><span class="hero-value" id="valSpeed">0</span><span class="hero-unit">км/ч</span></div>
            <div class="hero-subtext"><span>Дроссель: <strong id="valThrottleSub">0%</strong></span></div>
          </div>
        </div>
      `;
    }
    if (id === 'misfires') {
      return `
        <div class="glass-card">
          <div class="panel-header"><div><h2 class="panel-heading">Пропуски зажигания</h2><p class="panel-sub">Счётчики воспламенения по цилиндрам</p></div></div>
          <div class="cyl-matrix">
            <div class="cyl-tile"><span class="cyl-lbl">Цилиндр 1</span><span class="cyl-val" id="misCyl1">0</span></div>
            <div class="cyl-tile"><span class="cyl-lbl">Цилиндр 2</span><span class="cyl-val" id="misCyl2">0</span></div>
            <div class="cyl-tile"><span class="cyl-lbl">Цилиндр 3</span><span class="cyl-val" id="misCyl3">0</span></div>
            <div class="cyl-tile"><span class="cyl-lbl">Цилиндр 4</span><span class="cyl-val" id="misCyl4">0</span></div>
          </div>
          <div class="misfire-cycle-summary" style="display:flex;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);font-size:13px;color:var(--text-secondary);">
            <span>Активные пропуски (1000 об):</span>
            <span class="mono-badge" id="misCycle" style="font-weight:700;color:var(--text-primary);font-size:16px;">0</span>
          </div>
        </div>
      `;
    }
    if (id === 'o2-volt') {
      return `
        <div class="glass-card metric-tile o2-oscilloscope-tile">
          <div class="o2-tile-header">
            <span class="tile-label">ДК1 (до ката)</span>
            <div class="o2-mini-val-badge">
              <span class="tile-num-mini" id="valO2Volt">0.000</span>
              <span class="tile-unit-mini">В</span>
            </div>
          </div>
          <div class="o2-canvas-wrap">
            <canvas id="canvasO2" width="280" height="48"></canvas>
          </div>
        </div>
      `;
    }
    const standardDefMap = {
      'maf': { title: 'Расход воздуха (ДМРВ)', valId: 'valMaf', unit: 'кг/ч', def: '0.0' },
      'cycle-air': { title: 'Цикловой расход', valId: 'valCycleAir', unit: 'мг/такт', def: '0.0', featured: true },
      'inj-time': { title: 'Длительность впрыска', valId: 'valInjTime', unit: 'мс', def: '0.00' },
      'duty': { title: 'Загрузка форсунок', valId: 'valDuty', unit: 'нагрузка', def: '0.0%', featured: true },
      'mult-adapt': { title: 'Мультипликатив (FRA)', valId: 'valMultAdapt', unit: 'множитель', def: '1.000' },
      'add-adapt': { title: 'Аддитив (TRA / ХХ)', valId: 'valAddAdapt', unit: 'смещение ХХ', def: '+0.00%' },
      'spark': { title: 'УОЗ / Отскок', valId: 'valSpark', unit: '° / <strong id="valRetard" style="font-weight:700;">0.0°</strong>', def: '0.0', cardId: 'cardSpark' },
      'throttle': { title: 'Дроссельная заслонка', valId: 'valThrottle', unit: '%', def: '0.0' },
      'temp': { title: 'Температура ОЖ', valId: 'valTemp', unit: '°C', def: '0', progress: 'barTemp' },
      'intake-temp': { title: 'Температура впуска (ДТВ)', valId: 'valIntakeTemp', unit: '°C', def: '0.0' },
      'voltage': { title: 'Бортовая сеть', valId: 'valVoltage', unit: 'В', def: '0.0' },
      'rough-road': { title: 'Неровная дорога (ДНД)', valId: 'valRoughRoad', unit: 'g', def: '0.00' },
      'fuel-rate': { title: 'Текущий расход', valId: 'valFuelRate', unit: 'л/ч', def: '0.00' },
      'iac': { title: 'Позиция РХХ', valId: 'valIac', unit: 'шагов', def: '0' },
      'frl-load': { title: 'Нагрузка (FRL)', valId: 'valFrlLoad', unit: '%', def: '0.0' },
      'calc-load': { title: 'Расчётная нагрузка', valId: 'valCalcLoad', unit: '%', def: '0.0' },
      'knock-volt': { title: 'Шум датчика детонации', valId: 'valKnockVolt', unit: 'В', def: '0.00' },
      'o2-volt2': { title: 'ДК2 (после ката)', valId: 'valO2Volt2', unit: 'В', def: '0.000' },
      'lambda-corr': { title: 'Коррекция смеси', valId: 'valLambdaCorr', unit: 'множитель', def: '1.000' },
      'target-lambda': { title: 'Целевая лямбда', valId: 'valTargetLambda', unit: 'λ', def: '1.000' },
      'purge-rate': { title: 'Продувка адсорбера', valId: 'valPurgeRate', unit: '%', def: '0.0' },
      'altitude': { title: 'Барокоррекция', valId: 'valAltitude', unit: 'фактор', def: '1.000' }
    };
    const def = standardDefMap[id];
    if (def) {
      return `
        <div class="glass-card metric-tile ${def.featured ? 'tile-featured' : ''}" ${def.cardId ? `id="${def.cardId}"` : ''}>
          <span class="tile-label">${def.title}</span>
          <div class="tile-val-wrap">
            <span class="tile-num" id="${def.valId}">${def.def}</span>
            <span class="tile-unit">${def.unit}</span>
          </div>
          ${def.progress ? `<div class="glass-progress-track"><div class="glass-progress-bar" id="${def.progress}"></div></div>` : ''}
        </div>
      `;
    }
    return `
      <div class="glass-card metric-tile">
        <span class="tile-label">Датчик ${id}</span>
        <div class="tile-val-wrap"><span class="tile-num" id="${id}">—</span></div>
      </div>
    `;
  }

  _saveLayout() {
    const widgets = Array.from(this.container.querySelectorAll('.dashboard-widget'));
    const layout = widgets.map(w => ({
      id: w.getAttribute('data-widget-id'),
      size: w.classList.contains('widget-wide') ? 'wide' : 'compact'
    }));
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(layout));
    } catch (e) {}
  }

  _loadSavedLayout() {
    let saved = null;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch (e) {}

    if (!saved || !Array.isArray(saved) || saved.length === 0) return;

    // Восстанавливаем порядок и размеры
    const existingMap = new Map();
    Array.from(this.container.querySelectorAll('.dashboard-widget')).forEach(w => {
      existingMap.set(w.getAttribute('data-widget-id'), w);
    });

    saved.forEach(item => {
      let widget = existingMap.get(item.id);
      if (widget) {
        widget.classList.remove('widget-compact', 'widget-wide');
        widget.classList.add(item.size === 'wide' ? 'widget-wide' : 'widget-compact');
        this.container.appendChild(widget);
        existingMap.delete(item.id);
      } else {
        // Проверяем, был ли это сохраненный дополнительный датчик
        const extra = this.extraSensorsCatalog.find(s => s.id === item.id);
        if (extra) {
          this._createAndAddWidget(extra, true);
          const newW = this.container.querySelector(`[data-widget-id="${item.id}"]`);
          if (newW && item.size === 'wide') {
            newW.classList.remove('widget-compact');
            newW.classList.add('widget-wide');
          }
        }
      }
    });

    // Скрытые виджеты, которых нет в сохраненном layout
    existingMap.forEach(widget => {
      widget.remove();
    });

    // Однократная инициализация элементов после полной сборки сохраненной раскладки
    if (this.app && typeof this.app.initElements === 'function') {
      this.app.initElements();
    }
  }

  resetLayout() {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (e) {}
    window.location.reload();
  }

  /**
   * Обновление осциллографа ДК1 (синусоида лямбда-зонда)
   */
  updateO2(volt) {
    if (typeof volt !== 'number' || isNaN(volt)) return;
    this.o2History.push(volt);
    if (this.o2History.length > this.maxO2Points) {
      this.o2History.shift();
    }
    this.drawO2Oscilloscope();
  }

  drawO2Oscilloscope() {
    if (!this.o2Canvas) {
      this.o2Canvas = document.getElementById('canvasO2');
      if (this.o2Canvas) this.o2Ctx = this.o2Canvas.getContext('2d');
    }
    if (!this.o2Canvas || !this.o2Ctx) return;

    const canvas = this.o2Canvas;
    const ctx = this.o2Ctx;
    const parent = canvas.parentElement;
    if (!parent) return;

    const w = parent.clientWidth || 260;
    const h = parent.clientHeight || 46;
    const dpr = window.devicePixelRatio || 2;

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // 1. Опорная пунктирная линия стехиометрии 0.45 В (λ = 1.0)
    const yRef = h * (1.0 - 0.45 / 1.0);
    ctx.beginPath();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.moveTo(0, yRef);
    ctx.lineTo(w, yRef);
    ctx.stroke();
    ctx.setLineDash([]);

    if (this.o2History.length < 2) {
      ctx.restore();
      return;
    }

    // 2. Расчет экранных координат точек синусоиды
    const stepX = w / (this.maxO2Points - 1);
    const startOffset = (this.maxO2Points - this.o2History.length) * stepX;
    const points = [];

    for (let i = 0; i < this.o2History.length; i++) {
      const v = Math.max(0, Math.min(1.0, this.o2History[i]));
      const px = startOffset + i * stepX;
      // Отступ сверху и снизу по 4px, чтобы кривая не обрезалась
      const py = 4 + (h - 8) * (1.0 - v / 1.0);
      points.push({ x: px, y: py });
    }

    // 3. Плавный сплайн кривой Безье через точки
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      const mx = (prev.x + cur.x) / 2;
      const my = (prev.y + cur.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    const lastPt = points[points.length - 1];
    ctx.lineTo(lastPt.x, lastPt.y);

    ctx.strokeStyle = '#00F5A0';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // 4. Мягкий неоновый градиент под синусоидой
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0, 245, 160, 0.32)');
    grad.addColorStop(1, 'rgba(0, 245, 160, 0.0)');
    ctx.lineTo(lastPt.x, h);
    ctx.lineTo(points[0].x, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 5. Неоновый светящийся маркер текущего значения
    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#00F5A0';
    ctx.shadowBlur = 6;
    ctx.fill();

    ctx.restore();
  }

  /**
   * Обновление динамически добавленных датчиков из каталога
   */
  updateDynamicWidgets(data) {
    if (!data) return;

    // Обновляем ДК1 осциллограф
    if (data.o2Volt !== undefined) {
      this.updateO2(data.o2Volt);
    }

    // Обновляем скрытые датчики, выведенные пользователем на экран
    this.extraSensorsCatalog.forEach(s => {
      const el = document.getElementById(`val_${s.id}`);
      if (el && data[s.field] !== undefined && data[s.field] !== null) {
        const val = Number(data[s.field]);
        el.textContent = isNaN(val) ? data[s.field] : val.toFixed(s.decimals);
      }
    });
  }
}

window.DashboardWidgetManager = DashboardWidgetManager;
