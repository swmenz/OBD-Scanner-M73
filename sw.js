// Сервис-воркер для 100% оффлайн работы приложения в машине без интернета (v55.4)
const CACHE_NAME = 'm73-diag-cache-v55.4';

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

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function fetchNoCacheWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: 'no-cache', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Перехват запросов: приоритет сети (в обход HTTP-кэша браузера) при наличии интернета, надежный оффлайн в машине
self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return;
  }

  // Обрабатываем только GET-запросы к своему же сайту
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // Открытие страницы: сначала сеть (свежая версия), но не дольше 2 секунд —
  // при слабом/отсутствующем интернете в машине сразу отдаём страницу из кэша
  if (request.mode === 'navigate') {
    event.respondWith(
      fetchNoCacheWithTimeout(request.url, 2000).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone));
        }
        return networkResponse;
      }).catch(async () => {
        const cached = (await caches.match('./index.html')) || (await caches.match('./'));
        return cached || new Response('Оффлайн режим. Запустите приложение с интернетом хотя бы один раз.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
    );
    return;
  }

  // Скрипты, стили, иконки: сначала пробуем сеть (таймаут 1.5 с, AbortController + cache: 'no-cache'),
  // чтобы любые обновления доставлялись сразу при перезагрузке. Если сети нет — мгновенно из кэша!
  event.respondWith(
    fetchNoCacheWithTimeout(request.url, 1500).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }
      return networkResponse;
    }).catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
