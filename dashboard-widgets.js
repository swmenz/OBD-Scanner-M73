/**
 * DashboardWidgetManager — Модульная система кастомизации приборной панели в стиле виджетов iOS.
 * Поддерживает:
 *  - Режим редактирования (Jiggle / Wiggle Mode)
 *  - Переключение размеров карточек (1 колонка ↔ во всю ширину на 2 колонки)
 *  - Плавный Touch Drag & Drop для изменения порядка блоков на iPhone
 *  - Удаление / добавление любых датчиков ЭБУ М73 через галерею виджетов
 *  - Универсальный живой осциллограф (Canvas) с переключением любого датчика ЭБУ
 *  - Сохранение пользовательской раскладки в LocalStorage и сброс по умолчанию
 */

function hexToRgba(hex, alpha = 1) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

const OSC_CHANNELS = {
  'o2Volt': {
    id: 'o2Volt',
    title: 'ДК1 (до ката)',
    shortTitle: 'ДК1',
    unit: 'В',
    decimals: 3,
    color: '#00F5A0',
    min: 0,
    max: 1.0,
    refLine: 0.45,
    refLabel: '0.45В (λ=1.0)',
    extract: (d) => d.o2Volt !== undefined ? d.o2Volt : (d.adc ? d.adc.o2 : null)
  },
  'o2Volt2': {
    id: 'o2Volt2',
    title: 'ДК2 (после ката)',
    shortTitle: 'ДК2',
    unit: 'В',
    decimals: 3,
    color: '#00D2FF',
    min: 0,
    max: 1.0,
    refLine: 0.60,
    refLabel: '0.60В',
    extract: (d) => d.o2Volt2 !== undefined ? d.o2Volt2 : (d.adc ? d.adc.o2_2 : null)
  },
  'maf': {
    id: 'maf',
    title: 'ДМРВ (Расход)',
    shortTitle: 'ДМРВ',
    unit: 'кг/ч',
    decimals: 1,
    color: '#FFD60A',
    min: 0,
    max: 45,
    refLine: 9.5,
    refLabel: 'ХХ 9.5 кг/ч',
    extract: (d) => d.maf
  },
  'mafAdc': {
    id: 'mafAdc',
    title: 'ДМРВ (АЦП покой/дин)',
    shortTitle: 'ДМРВ АЦП',
    unit: 'В',
    decimals: 3,
    color: '#FF9F0A',
    min: 0.9,
    max: 2.2,
    refLine: 1.01,
    refLabel: 'Покой 1.00В',
    extract: (d) => (d.adc && d.adc.maf !== undefined) ? d.adc.maf : (d.mafVolt || null)
  },
  'rpm': {
    id: 'rpm',
    title: 'Обороты двигателя (RPM)',
    shortTitle: 'RPM',
    unit: 'об/мин',
    decimals: 0,
    color: '#0A84FF',
    min: 500,
    max: 4000,
    refLine: 840,
    refLabel: 'ХХ 840',
    extract: (d) => d.rpm
  },
  'spark': {
    id: 'spark',
    title: 'УОЗ (Зажигание)',
    shortTitle: 'УОЗ',
    unit: '°',
    decimals: 1,
    color: '#BF5AF2',
    min: -5,
    max: 45,
    refLine: 10,
    refLabel: '10°',
    extract: (d) => d.spark
  },
  'injTime': {
    id: 'injTime',
    title: 'Время впрыска форсунок',
    shortTitle: 'Впрыск',
    unit: 'мс',
    decimals: 2,
    color: '#FF453A',
    min: 1.0,
    max: 16.0,
    refLine: 3.8,
    refLabel: 'ХХ 3.8 мс',
    extract: (d) => d.injTime
  },
  'tps': {
    id: 'tps',
    title: 'Положение дросселя (ДПДЗ)',
    shortTitle: 'Дроссель',
    unit: '%',
    decimals: 1,
    color: '#30D158',
    min: 0,
    max: 100,
    refLine: 0,
    refLabel: '0%',
    extract: (d) => d.throttle !== undefined ? d.throttle : d.tps
  },
  'volt': {
    id: 'volt',
    title: 'Бортовая сеть',
    shortTitle: 'Бортсеть',
    unit: 'В',
    decimals: 2,
    color: '#64D2FF',
    min: 11.5,
    max: 15.0,
    refLine: 14.0,
    refLabel: '14.0 В',
    extract: (d) => d.voltage !== undefined ? d.voltage : (d.volt !== undefined ? d.volt : (d.adc ? d.adc.volt : null))
  },
  'speed': {
    id: 'speed',
    title: 'Скорость автомобиля',
    shortTitle: 'Скорость',
    unit: 'км/ч',
    decimals: 0,
    color: '#5E5CE6',
    min: 0,
    max: 160,
    refLine: 60,
    refLabel: '60 км/ч',
    extract: (d) => d.speed
  },
  'cycleAir': {
    id: 'cycleAir',
    title: 'Цикловой расход воздуха',
    shortTitle: 'Цикл. расх.',
    unit: 'мг/т',
    decimals: 1,
    color: '#FF9F0A',
    min: 50,
    max: 450,
    refLine: 95,
    refLabel: 'ХХ 95 мг',
    extract: (d) => d.cycleAir
  },
  'duty': {
    id: 'duty',
    title: 'Загрузка форсунок',
    shortTitle: 'Duty %',
    unit: '%',
    decimals: 1,
    color: '#FF375F',
    min: 0,
    max: 80,
    refLine: 15,
    refLabel: '15%',
    extract: (d) => d.dutyCycle !== undefined ? d.dutyCycle : d.duty
  },
  'knockVolt': {
    id: 'knockVolt',
    title: 'Сигнал датчика детонации',
    shortTitle: 'Детонация',
    unit: 'В',
    decimals: 3,
    color: '#FF6482',
    min: 0,
    max: 3.5,
    refLine: 1.0,
    refLabel: '1.0 В',
    extract: (d) => d.knockVolt
  }
};

class DashboardWidgetManager {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.editBar = null;
    this.galleryModal = null;
    this.isEditMode = false;
    this.storageKey = 'priora_m73_dashboard_layout_v2';
    
    // Универсальный осциллограф
    this.oscChannels = OSC_CHANNELS;
    let savedChannel = 'o2Volt';
    let savedPoints = 90;
    let savedAutoScale = true;
    try {
      savedChannel = localStorage.getItem('priora_osc_channel') || 'o2Volt';
      savedPoints = parseInt(localStorage.getItem('priora_osc_points') || '90', 10) || 90;
      savedAutoScale = localStorage.getItem('priora_osc_autoscale') !== 'false';
    } catch (e) {}
    this.oscChannel = savedChannel;
    this.maxOscPoints = savedPoints;
    this.isOscPaused = false;
    this.isOscAutoScale = savedAutoScale;
    this.oscHistory = [];
    
    // Совместимость с предыдущим O2
    this.o2History = this.oscHistory;
    this.maxO2Points = this.maxOscPoints;
    this.o2Canvas = null;
    this.o2Ctx = null;
    this.modalCanvas = null;
    this.modalCtx = null;
    this.lastOscRender = 0;

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
      { id: 'extra-idle-air-offset', title: 'Аддитивная корр. TRA', unit: '%', field: 'addAdapt', category: 'fuel', decimals: 1 }
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

    // Инициализация универсального осциллографа
    this._initOscilloscope();
  }

  _setupWidgets() {
    const widgets = Array.from(this.container.querySelectorAll('.dashboard-widget'));
    widgets.forEach(w => {
      this._attachWidgetControls(w);
      if (w.getAttribute('data-widget-id') === 'o2-volt') {
        this._bindOscWidgetEvents(w);
      }
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

    // Touch Drag & Drop перетаскивание на iPhone с задержкой 0.5с и прямым обменом
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
    let currentDropTarget = null;

    const cleanupDrag = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (currentDropTarget) {
        currentDropTarget.classList.remove('is-drop-target');
        currentDropTarget = null;
      }
      if (draggedEl) {
        draggedEl.classList.remove('is-dragging');
        draggedEl.style.transform = '';
        draggedEl.style.zIndex = '';
        draggedEl.style.pointerEvents = '';
        draggedEl = null;
      }
      touchTarget = null;
      canDrag = false;
    };

    const handleDragEnd = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }

      if (canDrag && draggedEl) {
        if (currentDropTarget && currentDropTarget !== draggedEl && currentDropTarget.parentNode === this.container) {
          // Прямой обмен местами (Swap) двух блоков без промежуточных скачков!
          const parent = this.container;
          const nextDragged = draggedEl.nextSibling;
          const nextTarget = currentDropTarget.nextSibling;

          if (nextDragged === currentDropTarget) {
            parent.insertBefore(currentDropTarget, draggedEl);
          } else if (nextTarget === draggedEl) {
            parent.insertBefore(draggedEl, currentDropTarget);
          } else {
            parent.insertBefore(draggedEl, nextTarget);
            parent.insertBefore(currentDropTarget, nextDragged);
          }

          // Анимация фиксации на новой позиции
          const d = draggedEl;
          const t = currentDropTarget;
          d.classList.add('widget-entering');
          t.classList.add('widget-entering');
          setTimeout(() => {
            d.classList.remove('widget-entering');
            t.classList.remove('widget-entering');
          }, 280);

          if (navigator.vibrate) navigator.vibrate(40);
          this._saveLayout();
        }
      }

      cleanupDrag();
    };

    // ================== TOUCH GESTURES (iOS) ==================
    this.container.addEventListener('touchstart', (e) => {
      if (!this.isEditMode) return;
      const widget = e.target.closest('.dashboard-widget');
      if (!widget || e.target.closest('.widget-action-btn')) return;

      cleanupDrag();

      touchTarget = widget;
      const touch = e.touches[0];
      initialX = touch.clientX;
      initialY = touch.clientY;
      canDrag = false;

      // 0.5 секунды удержания пальца для захвата блока
      holdTimer = setTimeout(() => {
        if (!touchTarget) return;
        canDrag = true;
        draggedEl = touchTarget;
        draggedEl.classList.add('is-dragging');
        draggedEl.style.transform = 'translate3d(0, 0, 0) scale(1.06)';
        if (navigator.vibrate) {
          navigator.vibrate([40, 30, 40]);
        }
      }, 500);
    }, { passive: true });

    this.container.addEventListener('touchmove', (e) => {
      if (!this.isEditMode || !touchTarget) return;

      const touch = e.touches[0];
      const dx = touch.clientX - initialX;
      const dy = touch.clientY - initialY;
      const dist = Math.hypot(dx, dy);

      // Если 0.5 сек еще не прошло:
      if (!canDrag) {
        if (dist > 12) {
          if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
          touchTarget = null;
        }
        return;
      }

      // Виджет активен и следует за пальцем (примагничен к нему):
      if (draggedEl) {
        e.preventDefault();
        draggedEl.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.06)`;

        // Автоматическая подкрутка экрана у краев
        const scrollView = this.container.closest('.app-scroll-view') || document.querySelector('.app-scroll-view');
        if (scrollView) {
          if (touch.clientY > window.innerHeight - 80) {
            scrollView.scrollBy({ top: 10, behavior: 'auto' });
          } else if (touch.clientY < 80) {
            scrollView.scrollBy({ top: -10, behavior: 'auto' });
          }
        }

        // Поиск целевого виджета под пальцем
        const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        const targetWidget = elemBelow ? elemBelow.closest('.dashboard-widget') : null;

        if (targetWidget && targetWidget !== draggedEl && targetWidget.parentNode === this.container) {
          if (currentDropTarget !== targetWidget) {
            if (currentDropTarget) currentDropTarget.classList.remove('is-drop-target');
            currentDropTarget = targetWidget;
            currentDropTarget.classList.add('is-drop-target');
            if (navigator.vibrate) navigator.vibrate(12);
          }
        } else {
          if (currentDropTarget) {
            currentDropTarget.classList.remove('is-drop-target');
            currentDropTarget = null;
          }
        }
      }
    }, { passive: false });

    this.container.addEventListener('touchend', handleDragEnd);
    this.container.addEventListener('touchcancel', cleanupDrag);

    // ================== MOUSE DRAG (DESKTOP) ==================
    let mouseTarget = null;
    let mouseHoldTimer = null;
    let isMouseDragging = false;
    let mouseInitialX = 0;
    let mouseInitialY = 0;

    this.container.addEventListener('mousedown', (e) => {
      if (!this.isEditMode || e.button !== 0) return;
      const widget = e.target.closest('.dashboard-widget');
      if (!widget || e.target.closest('.widget-action-btn')) return;

      mouseTarget = widget;
      mouseInitialX = e.clientX;
      mouseInitialY = e.clientY;
      isMouseDragging = false;

      mouseHoldTimer = setTimeout(() => {
        if (!mouseTarget) return;
        isMouseDragging = true;
        canDrag = true;
        draggedEl = mouseTarget;
        draggedEl.classList.add('is-dragging');
        draggedEl.style.transform = 'translate3d(0, 0, 0) scale(1.06)';
      }, 350);
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isEditMode || !mouseTarget) return;
      const dx = e.clientX - mouseInitialX;
      const dy = e.clientY - mouseInitialY;

      if (!isMouseDragging) {
        if (Math.hypot(dx, dy) > 8) {
          clearTimeout(mouseHoldTimer);
          mouseHoldTimer = null;
          mouseTarget = null;
        }
        return;
      }

      if (draggedEl) {
        e.preventDefault();
        draggedEl.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.06)`;

        const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
        const targetWidget = elemBelow ? elemBelow.closest('.dashboard-widget') : null;

        if (targetWidget && targetWidget !== draggedEl && targetWidget.parentNode === this.container) {
          if (currentDropTarget !== targetWidget) {
            if (currentDropTarget) currentDropTarget.classList.remove('is-drop-target');
            currentDropTarget = targetWidget;
            currentDropTarget.classList.add('is-drop-target');
          }
        } else {
          if (currentDropTarget) {
            currentDropTarget.classList.remove('is-drop-target');
            currentDropTarget = null;
          }
        }
      }
    });

    window.addEventListener('mouseup', () => {
      if (mouseHoldTimer) {
        clearTimeout(mouseHoldTimer);
        mouseHoldTimer = null;
      }
      if (isMouseDragging) {
        handleDragEnd();
      } else {
        cleanupDrag();
      }
      mouseTarget = null;
      isMouseDragging = false;
    });
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

    // Если это виджет осциллографа — перерисовываем график под новую ширину
    if (widgetEl.getAttribute('data-widget-id') === 'o2-volt') {
      setTimeout(() => this.drawOscilloscope(), 50);
    }
  }

  removeWidget(widgetEl) {
    widgetEl.removeAttribute('data-widget-id');
    widgetEl.classList.add('widget-leaving');
    setTimeout(() => {
      widgetEl.remove();
      this._activeSensorsDirty = true;
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
    this._activeSensorsDirty = true;
    if (!skipSave) this._saveLayout();

    // Обновляем контекст canvas если вернули виджет осциллографа
    if (item.id === 'o2-volt') {
      this.o2Canvas = document.getElementById('canvasO2');
      if (this.o2Canvas) this.o2Ctx = this.o2Canvas.getContext('2d');
      this._bindOscWidgetEvents(widgetEl);
      setTimeout(() => this.drawOscilloscope(), 50);
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
          <div class="glass-card hero-card" id="heroCardRpm">
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
          <div class="panel-header"><div><h2 class="panel-heading">Пропуски зажигания</h2></div></div>
          <div class="cyl-matrix">
            <div class="cyl-tile"><span class="cyl-lbl">Цилиндр 1</span><span class="cyl-val" id="misCyl1">0</span></div>
            <div class="cyl-tile"><span class="cyl-lbl">Цилиндр 2</span><span class="cyl-val" id="misCyl2">0</span></div>
            <div class="cyl-tile"><span class="cyl-lbl">Цилиндр 3</span><span class="cyl-val" id="misCyl3">0</span></div>
            <div class="cyl-tile"><span class="cyl-lbl">Цилиндр 4</span><span class="cyl-val" id="misCyl4">0</span></div>
          </div>
          <div class="misfire-cycle-summary">
            <span>Влияет на нейтрализатор:</span>
            <span class="mono-badge" id="misCycle" title="Суммарный счётчик пропусков зажигания, влияющих на нейтрализатор">0</span>
          </div>
        </div>
      `;
    }
    if (id === 'o2-volt') {
      return `
        <div class="glass-card metric-tile o2-oscilloscope-tile">
          <div class="o2-tile-header">
            <div class="osc-tile-title-group">
              <select id="oscWidgetChannelSelect" class="osc-tile-channel-select" title="Выбрать датчик для осциллографа">
                <option value="o2Volt">ДК1 (до ката)</option>
                <option value="o2Volt2">ДК2 (после ката)</option>
                <option value="maf">ДМРВ (Расход)</option>
                <option value="mafAdc">ДМРВ (АЦП)</option>
                <option value="rpm">Обороты (RPM)</option>
                <option value="spark">УОЗ</option>
                <option value="injTime">Время впрыска</option>
                <option value="tps">Дроссель</option>
                <option value="volt">Бортсеть</option>
                <option value="speed">Скорость</option>
                <option value="cycleAir">Цикловой расход</option>
                <option value="duty">Загрузка %</option>
                <option value="knockVolt">Детонация</option>
              </select>
              <button id="btnOpenOscModalFromTile" class="osc-tile-expand-btn" type="button" title="Развернуть осциллограф на весь экран">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
              </button>
            </div>
            <div class="o2-mini-val-badge">
              <span class="tile-num-mini" id="valO2Volt">0.000</span>
              <span class="tile-unit-mini" id="unitOscTile">В</span>
            </div>
          </div>
          <div class="o2-canvas-wrap">
            <canvas id="canvasO2" class="o2-canvas"></canvas>
          </div>
        </div>
      `;
    }
    if (id === 'spark') {
      return `
        <div class="glass-card metric-tile" id="cardSpark">
          <span class="tile-label">Зажигание / Детонация</span>
          <div class="spark-split-grid">
            <div class="spark-split-col">
              <span class="spark-sub-label">УОЗ</span>
              <span class="tile-num-split" id="valSpark">0.0°</span>
            </div>
            <div class="spark-split-divider"></div>
            <div class="spark-split-col">
              <span class="spark-sub-label">Отскок</span>
              <span class="tile-num-split" id="valRetard">0.0°</span>
            </div>
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
   * =========================================================================
   * УНИВЕРСАЛЬНЫЙ ЖИВОЙ ОСЦИЛЛОГРАФ (CANVAS WAVEFORM PRO)
   * =========================================================================
   */

  _initOscilloscope() {
    this.modalOsc = document.getElementById('modalOscilloscope');
    this.modalCanvas = document.getElementById('canvasOscModal');
    if (this.modalCanvas) {
      this.modalCtx = this.modalCanvas.getContext('2d');
    }

    // Привязка селектора канала на плитке виджета
    this._bindOscWidgetEvents(document);

    // Привязка селектора в модальном окне
    const modalSelect = document.getElementById('oscChannelSelect');
    if (modalSelect) {
      modalSelect.value = this.oscChannel;
      modalSelect.addEventListener('change', (e) => {
        this.setOscChannel(e.target.value);
      });
    }

    // Закрытие модального окна
    const btnClose = document.getElementById('btnCloseOscModal');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.closeOscModal());
    }

    if (this.modalOsc) {
      this.modalOsc.addEventListener('click', (e) => {
        if (e.target === this.modalOsc) this.closeOscModal();
      });
    }

    // Кнопка Пауза / Запуск
    const btnPause = document.getElementById('btnOscPause');
    if (btnPause) {
      btnPause.addEventListener('click', () => this.toggleOscPause());
    }

    // Кнопка Сброс
    const btnClear = document.getElementById('btnOscClear');
    if (btnClear) {
      btnClear.addEventListener('click', () => this.clearOscHistory());
    }

    // Кнопка Автомасштаб
    const btnScale = document.getElementById('btnOscAutoScale');
    if (btnScale) {
      btnScale.addEventListener('click', () => this.toggleOscAutoScale());
      btnScale.classList.toggle('active', this.isOscAutoScale);
      btnScale.innerHTML = this.isOscAutoScale ? '<span>↕️ Авто</span>' : '<span>🔒 Фикс</span>';
    }

    // Кнопки буфера точек (45 / 90 / 180)
    const pill = document.getElementById('oscBufferPill');
    if (pill) {
      pill.querySelectorAll('.seg-btn').forEach(btn => {
        const pts = parseInt(btn.getAttribute('data-pts'), 10);
        btn.classList.toggle('active', pts === this.maxOscPoints);
        btn.addEventListener('click', () => {
          pill.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.maxOscPoints = pts;
          this.maxO2Points = pts;
          try { localStorage.setItem('priora_osc_points', pts); } catch (e) {}
          while (this.oscHistory.length > this.maxOscPoints) this.oscHistory.shift();
          this.drawOscilloscope();
        });
      });
    }

    this._updateOscUIElements();
  }

  _bindOscWidgetEvents(scopeEl = document) {
    const tileSelect = scopeEl.querySelector('#oscWidgetChannelSelect');
    if (tileSelect) {
      tileSelect.value = this.oscChannel;
      tileSelect.onchange = (e) => {
        this.setOscChannel(e.target.value);
      };
    }

    const btnExpand = scopeEl.querySelector('#btnOpenOscModalFromTile');
    if (btnExpand) {
      btnExpand.onclick = (e) => {
        e.stopPropagation();
        this.openOscModal();
      };
    }

    const canvas = scopeEl.querySelector('#canvasO2');
    if (canvas) {
      canvas.onclick = () => this.openOscModal();
    }
  }

  setOscChannel(chId) {
    if (!this.oscChannels[chId]) return;
    this.oscChannel = chId;
    try { localStorage.setItem('priora_osc_channel', chId); } catch (e) {}

    this.oscHistory = [];
    this.o2History = this.oscHistory;

    const valEl = document.getElementById('valO2Volt');
    if (valEl) {
      valEl.style.color = '';
      valEl._lastStyle_color = '';
    }

    const tileSelect = document.getElementById('oscWidgetChannelSelect');
    if (tileSelect) tileSelect.value = chId;

    const modalSelect = document.getElementById('oscChannelSelect');
    if (modalSelect) modalSelect.value = chId;

    this._updateOscUIElements();
    this.drawOscilloscope();
  }

  _updateOscUIElements() {
    const ch = this.oscChannels[this.oscChannel] || this.oscChannels['o2Volt'];
    const unitEl = document.getElementById('unitOscTile');
    if (unitEl) unitEl.textContent = ch.unit;

    const modalTitle = document.getElementById('oscModalActiveTitle');
    if (modalTitle) modalTitle.textContent = `${ch.title} (${ch.unit})`;

    const hudUnit = document.getElementById('oscHudUnit');
    if (hudUnit) hudUnit.textContent = ch.unit;
  }

  openOscModal(channelId) {
    if (channelId && this.oscChannels[channelId]) {
      this.setOscChannel(channelId);
    }
    if (this.modalOsc) {
      this.modalOsc.style.display = 'flex';
      this.modalOsc.classList.add('open');
      this.modalCanvas = document.getElementById('canvasOscModal');
      if (this.modalCanvas) this.modalCtx = this.modalCanvas.getContext('2d');
      this._updateOscUIElements();
      setTimeout(() => this.drawOscilloscope(), 40);
    }
  }

  closeOscModal() {
    if (this.modalOsc) {
      this.modalOsc.classList.remove('open');
      this.modalOsc.style.display = 'none';
    }
  }

  toggleOscPause() {
    this.isOscPaused = !this.isOscPaused;
    const btn = document.getElementById('btnOscPause');
    const txt = document.getElementById('btnOscPauseText');
    const icon = document.getElementById('btnOscPauseIcon');
    if (btn) btn.classList.toggle('is-paused', this.isOscPaused);
    if (txt) txt.textContent = this.isOscPaused ? 'Запуск' : 'Пауза';
    if (icon) icon.textContent = this.isOscPaused ? '▶️' : '⏸️';
    this.drawOscilloscope();
  }

  clearOscHistory() {
    this.oscHistory = [];
    this.o2History = this.oscHistory;

    const valEl = document.getElementById('valO2Volt');
    if (valEl) {
      valEl.style.color = '';
      valEl._lastStyle_color = '';
    }
    const currEl = document.getElementById('oscHudCurr');
    const minEl = document.getElementById('oscHudMin');
    const maxEl = document.getElementById('oscHudMax');
    const deltaEl = document.getElementById('oscHudDelta');
    if (currEl) currEl.textContent = '0.000';
    if (minEl) minEl.textContent = '0.000';
    if (maxEl) maxEl.textContent = '0.000';
    if (deltaEl) deltaEl.textContent = '0.000';
    this.drawOscilloscope();
  }

  toggleOscAutoScale() {
    this.isOscAutoScale = !this.isOscAutoScale;
    try { localStorage.setItem('priora_osc_autoscale', this.isOscAutoScale); } catch (e) {}
    const btn = document.getElementById('btnOscAutoScale');
    if (btn) {
      btn.classList.toggle('active', this.isOscAutoScale);
      btn.innerHTML = this.isOscAutoScale ? '<span>↕️ Авто</span>' : '<span>🔒 Фикс</span>';
    }
    this.drawOscilloscope();
  }

  /**
   * Совместимость со старым API ДК1
   */
  updateO2(volt) {
    if (typeof volt !== 'number' || isNaN(volt)) return;
    if (this.oscChannel === 'o2Volt') {
      if (!this.isOscPaused) {
        const now = performance.now();
        if (this._lastPointTime > 0) {
          const delta = now - this._lastPointTime;
          this._pointInterval = Math.max(60, Math.min(300, delta));
        }
        this._lastPointTime = now;
        this.oscHistory.push(volt);
        if (this.oscHistory.length > this.maxOscPoints) this.oscHistory.shift();
      }
      this.ensureOscLoop();
      if (this.isOscPaused) {
        this.drawOscilloscope();
      }
    }
  }

  feedOscilloscope(data) {
    if (!data) return;
    const ch = this.oscChannels[this.oscChannel] || this.oscChannels['o2Volt'];
    const val = ch.extract(data);

    if (val !== undefined && val !== null && !isNaN(val)) {
      const num = Number(val);

      // Обновляем мини-значение на плитке виджета (кэшированный элемент + dirty check)
      if (!this._valO2VoltEl || !this._valO2VoltEl.isConnected) {
        this._valO2VoltEl = document.getElementById('valO2Volt');
      }
      if (this._valO2VoltEl) {
        const str = num.toFixed(ch.decimals);
        if (this._valO2VoltEl.textContent !== str) {
          this._valO2VoltEl.textContent = str;
        }
      }

      // Добавляем точку в буфер
      if (!this.isOscPaused) {
        const now = performance.now();
        if (this._lastPointTime > 0) {
          const delta = now - this._lastPointTime;
          this._pointInterval = Math.max(60, Math.min(300, delta));
        }
        this._lastPointTime = now;

        this.oscHistory.push(num);
        if (this.oscHistory.length > this.maxOscPoints) {
          this.oscHistory.shift();
        }
      }

      // Обновляем телеметрию HUD (быстрый цикл без spread-аллокаций и с кэшированными селекторами)
      if (this.oscHistory.length > 0) {
        let minVal = this.oscHistory[0];
        let maxVal = this.oscHistory[0];
        for (let i = 1; i < this.oscHistory.length; i++) {
          const v = this.oscHistory[i];
          if (v < minVal) minVal = v;
          if (v > maxVal) maxVal = v;
        }
        const curVal = this.oscHistory[this.oscHistory.length - 1];
        const delta = maxVal - minVal;

        if (!this._hudElements || !this._hudElements.curr || !this._hudElements.curr.isConnected) {
          this._hudElements = {
            curr: document.getElementById('oscHudCurr'),
            min: document.getElementById('oscHudMin'),
            max: document.getElementById('oscHudMax'),
            delta: document.getElementById('oscHudDelta')
          };
        }

        const h = this._hudElements;
        const sCur = curVal.toFixed(ch.decimals);
        const sMin = minVal.toFixed(ch.decimals);
        const sMax = maxVal.toFixed(ch.decimals);
        const sDel = delta.toFixed(ch.decimals);

        if (h.curr && h.curr.textContent !== sCur) h.curr.textContent = sCur;
        if (h.min && h.min.textContent !== sMin) h.min.textContent = sMin;
        if (h.max && h.max.textContent !== sMax) h.max.textContent = sMax;
        if (h.delta && h.delta.textContent !== sDel) h.delta.textContent = sDel;
      }

      this.ensureOscLoop();
      if (this.isOscPaused) {
        this.drawOscilloscope();
      }
    }
  }

  ensureOscLoop() {
    if (this._oscAnimId) return;
    const animate = () => {
      const dashPane = document.getElementById('tab-dashboard');
      const isDashActive = dashPane && dashPane.classList.contains('active');
      const isModalOpen = this.modalOsc && (this.modalOsc.classList.contains('open') || this.modalOsc.style.display === 'flex');
      const canvasEl = document.getElementById('canvasO2');
      const hasVisibleCanvas = (isDashActive && Boolean(canvasEl && canvasEl.isConnected)) || isModalOpen;

      if (hasVisibleCanvas && this.oscHistory.length >= 2 && !this.isOscPaused) {
        this.drawOscilloscope();
        this._oscAnimId = requestAnimationFrame(animate);
      } else {
        this._oscAnimId = null;
      }
    };
    this._oscAnimId = requestAnimationFrame(animate);
  }

  stopOscLoop() {
    if (this._oscAnimId) {
      cancelAnimationFrame(this._oscAnimId);
      this._oscAnimId = null;
    }
  }

  drawOscilloscope() {
    // 1. Отрисовка на плитке дашборда (только если канвас реально подключен к странице)
    if (!this.o2Canvas || !this.o2Canvas.isConnected) {
      this.o2Canvas = document.getElementById('canvasO2');
      if (this.o2Canvas) this.o2Ctx = this.o2Canvas.getContext('2d');
    }
    if (this.o2Canvas && this.o2Canvas.isConnected && this.o2Ctx) {
      this._drawCanvasWave(this.o2Canvas, this.o2Ctx, false);
    }

    // 2. Отрисовка в модальном окне (если открыто)
    if (this.modalOsc && (this.modalOsc.classList.contains('open') || this.modalOsc.style.display === 'flex')) {
      if (!this.modalCanvas) {
        this.modalCanvas = document.getElementById('canvasOscModal');
        if (this.modalCanvas) this.modalCtx = this.modalCanvas.getContext('2d');
      }
      if (this.modalCanvas && this.modalCtx) {
        this._drawCanvasWave(this.modalCanvas, this.modalCtx, true);
      }
    }
  }

  _drawCanvasWave(canvas, ctx, isModal = false) {
    if (!canvas || !ctx) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const w = parent.clientWidth || (isModal ? 340 : 260);
    const h = parent.clientHeight || (isModal ? 220 : 46);
    const dpr = window.devicePixelRatio || 2;

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const ch = this.oscChannels[this.oscChannel] || this.oscChannels['o2Volt'];
    const padTop = isModal ? 16 : 4;
    const padBottom = isModal ? 18 : 4;
    const padLeft = isModal ? 38 : 0;
    const padRight = isModal ? 10 : 0;
    const drawW = Math.max(10, w - padLeft - padRight);
    const drawH = Math.max(10, h - padTop - padBottom);

    // Расчет пределов шкалы Y
    let yMin = ch.min;
    let yMax = ch.max;

    if (this.isOscAutoScale && this.oscHistory.length >= 2) {
      let histMin = this.oscHistory[0];
      let histMax = this.oscHistory[0];
      for (let i = 1; i < this.oscHistory.length; i++) {
        const v = this.oscHistory[i];
        if (v < histMin) histMin = v;
        if (v > histMax) histMax = v;
      }
      const delta = histMax - histMin;
      const margin = delta > 0.0001 ? delta * 0.16 : (Math.abs(histMin) * 0.1 || 1.0);
      yMin = histMin - margin;
      yMax = histMax + margin;
    }
    if (yMax <= yMin) yMax = yMin + 1.0;

    // Сетка и масштабные деления в модальном окне
    if (isModal) {
      const gridRows = 4;
      ctx.lineWidth = 1;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '10px -apple-system, BlinkMacSystemFont, "SF Pro Text", monospace';

      for (let r = 0; r <= gridRows; r++) {
        const ratio = r / gridRows;
        const gy = padTop + drawH * (1.0 - ratio);
        const valAtGrid = yMin + ratio * (yMax - yMin);

        ctx.beginPath();
        ctx.strokeStyle = r === 0 || r === gridRows ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.07)';
        ctx.moveTo(padLeft, gy);
        ctx.lineTo(w - padRight, gy);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillText(valAtGrid.toFixed(ch.decimals > 1 ? 2 : ch.decimals), padLeft - 6, gy);
      }

      // Вертикальные линии развертки времени
      const gridCols = 6;
      for (let c = 1; c < gridCols; c++) {
        const gx = padLeft + (drawW / gridCols) * c;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.moveTo(gx, padTop);
        ctx.lineTo(gx, padTop + drawH);
        ctx.stroke();
      }
    }

    // Опорная контрольная линия датчика
    if (ch.refLine !== undefined && ch.refLine >= yMin && ch.refLine <= yMax) {
      const normRef = (ch.refLine - yMin) / (yMax - yMin);
      const yRef = padTop + drawH * (1.0 - normRef);
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1;
      ctx.moveTo(padLeft, yRef);
      ctx.lineTo(w - padRight, yRef);
      ctx.stroke();
      ctx.setLineDash([]);

      if (isModal) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(ch.refLabel || `${ch.refLine}`, padLeft + 6, yRef - 6);
      }
    }

    // Если нет достаточного числа точек
    if (this.oscHistory.length < 2) {
      if (isModal) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.textAlign = 'center';
        ctx.font = '12px -apple-system, sans-serif';
        ctx.fillText('Ожидание потока данных датчика...', w / 2, h / 2);
      }
      ctx.restore();
      return;
    }

    // Расчет экранных координат точек
    const stepX = drawW / (this.maxOscPoints - 1);

    // Плавный субпиксельный сдвиг ленты по времени (интерполяция шага)
    let subpixelShift = 0;
    if (!this.isOscPaused && this._lastPointTime > 0) {
      const elapsed = performance.now() - this._lastPointTime;
      const interval = this._pointInterval || 120;
      const progress = Math.min(1.0, elapsed / interval);
      subpixelShift = progress * stepX;
    }

    const startOffset = padLeft + (this.maxOscPoints - this.oscHistory.length) * stepX - subpixelShift;
    const points = [];

    for (let i = 0; i < this.oscHistory.length; i++) {
      const v = this.oscHistory[i];
      const norm = Math.max(0, Math.min(1.0, (v - yMin) / (yMax - yMin)));
      const px = startOffset + i * stepX;
      const py = padTop + drawH * (1.0 - norm);
      points.push({ x: px, y: py, val: v });
    }

    // Область отсечения волны
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, padTop - 2, drawW, drawH + 4);
    ctx.clip();

    // Плавный сплайн Безье
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

    ctx.strokeStyle = ch.color;
    ctx.lineWidth = isModal ? 2.5 : 2.2;
    ctx.shadowColor = ch.color;
    ctx.shadowBlur = isModal ? 6 : 4;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Градиентная заливка под графиком
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + drawH);
    grad.addColorStop(0, hexToRgba(ch.color, isModal ? 0.35 : 0.26));
    grad.addColorStop(1, hexToRgba(ch.color, 0.0));
    ctx.lineTo(lastPt.x, padTop + drawH);
    ctx.lineTo(points[0].x, padTop + drawH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.restore();

    // Неоновый маркер текущего значения
    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, isModal ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = ch.color;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Индикатор паузы в модалке
    if (isModal && this.isOscPaused) {
      ctx.fillStyle = 'rgba(255, 69, 58, 0.85)';
      ctx.font = 'bold 11px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('⏸ ЗАМОРОЗКА КАДРА', w - padRight - 8, padTop + 14);
    }

    ctx.restore();
  }

  drawO2Oscilloscope() {
    this.drawOscilloscope();
  }

  /**
   * Обновление динамически добавленных датчиков из каталога и осциллографа
   * Использует кэширование активных DOM-узлов и dirty-check для устранения фризов UI
   */
  updateDynamicWidgets(data) {
    if (!data) return;

    // Подаем данные в универсальный осциллограф
    this.feedOscilloscope(data);

    // Кэш только РЕАЛЬНО отображаемых на панели дополнительных датчиков
    if (
      !this._cachedActiveSensors ||
      this._activeSensorsDirty ||
      (this._cachedActiveSensors.length > 0 && !this._cachedActiveSensors[0].el.isConnected)
    ) {
      this._cachedActiveSensors = [];
      this.extraSensorsCatalog.forEach(s => {
        const el = document.getElementById(`val_${s.id}`);
        if (el) this._cachedActiveSensors.push({ s, el });
      });
      this._activeSensorsDirty = false;
    }

    for (let i = 0; i < this._cachedActiveSensors.length; i++) {
      const item = this._cachedActiveSensors[i];
      const s = item.s;
      const el = item.el;
      if (data[s.field] !== undefined && data[s.field] !== null) {
        const val = Number(data[s.field]);
        const str = isNaN(val) ? String(data[s.field]) : val.toFixed(s.decimals);
        if (el.textContent !== str) {
          el.textContent = str;
        }
      }
    }
  }
}

window.DashboardWidgetManager = DashboardWidgetManager;
