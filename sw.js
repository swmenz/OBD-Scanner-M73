// Сервис-воркер для 100% оффлайн работы приложения в машине без интернета (v55.8)
const CACHE_NAME = 'm73-diag-cache-v55.8';

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

  // Открытие страницы: сначала сеть (свежая версия), но не дольше 800 мс —
  // при слабом/отсутствующем интернете в машине сразу отдаём страницу из кэша
  if (request.mode === 'navigate') {
    let navCacheTask = Promise.resolve();
    const navResponsePromise = fetchNoCacheWithTimeout(request.url, 800).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        const clone = networkResponse.clone();
        navCacheTask = caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone)).catch(() => {});
      }
      return networkResponse;
    }).catch(async () => {
      const cached = (await caches.match('./index.html')) || (await caches.match('./'));
      return cached || new Response('Оффлайн режим. Запустите приложение с интернетом хотя бы один раз.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    });

    event.respondWith(navResponsePromise);
    event.waitUntil(navResponsePromise.then(() => navCacheTask, () => {}));
    return;
  }

  // Скрипты, стили, иконки: Stale-While-Revalidate — мгновенно отдаём кэш (если есть) и обновляем в фоне;
  // при холодном промахе (например, крупный xlsx.full.min.js на слабой сети) даём расширенный таймаут 15 с
  let assetBgTask = Promise.resolve();
  const assetResponsePromise = caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
    const cleanUrl = new URL(request.url);
    cleanUrl.search = '';
    const cacheKey = cleanUrl.toString();

    if (cachedResponse) {
      assetBgTask = fetchNoCacheWithTimeout(request.url, 4000).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          return caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone));
        }
      }).catch(() => {});
      return cachedResponse;
    }

    return fetchNoCacheWithTimeout(request.url, 15000).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        const clone = networkResponse.clone();
        assetBgTask = caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone)).catch(() => {});
      }
      return networkResponse;
    });
  });

  event.respondWith(assetResponsePromise);
  event.waitUntil(assetResponsePromise.then(() => assetBgTask, () => {}));
});
