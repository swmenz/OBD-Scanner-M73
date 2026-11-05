// Сервис-воркер для 100% оффлайн работы приложения в машине без интернета
const CACHE_NAME = 'm73-diag-cache-v51.6';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './elm327.js',
  './m73.js',
  './logger.js',
  './dashboard-widgets.js',
  './app.js',
  './manifest.json',
  './xlsx.full.min.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// Установка: кэшируем каждый файл в обход HTTP-кэша браузера (cache: 'reload'),
// иначе в новый кэш могут попасть устаревшие копии файлов
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS_TO_CACHE.map((url) => {
          return cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('Не удалось закэшировать ресурс:', url, err);
          });
        })
      );
    })
  );
});

// Активация: удаляем старый кэш и немедленно берем под контроль все открытые вкладки
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Перехват запросов: приоритет сети при наличии интернета, надежный оффлайн в машине
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Обрабатываем только GET-запросы к своему же сайту
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // Открытие страницы: сначала сеть (свежая версия), но не дольше 2 секунд —
  // при слабом/отсутствующем интернете в машине сразу отдаём страницу из кэша
  if (request.mode === 'navigate') {
    event.respondWith(
      Promise.race([
        fetch(request),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
      ]).catch(async () => {
        const cached = (await caches.match('./index.html')) || (await caches.match('./'));
        return cached || new Response('Оффлайн режим. Запустите приложение с интернетом хотя бы один раз.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
    );
    return;
  }

  // Скрипты, стили, иконки: сначала пробуем сеть (таймаут 1.5 с), чтобы
  // любые обновления доставлялись сразу при перезагрузке. Если сети нет — мгновенно из кэша!
  event.respondWith(
    Promise.race([
      fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
    ]).catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
