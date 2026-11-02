// Сервис-воркер для 100% оффлайн работы приложения в машине без интернета
const CACHE_NAME = 'm73-diag-cache-v9';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './elm327.js',
  './m73.js',
  './logger.js',
  './app.js',
  './manifest.json',
  './xlsx.full.min.js'
];

// Установка: кэшируем каждый файл и сразу форсируем активацию
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS_TO_CACHE.map((url) => {
          return cache.add(url).catch((err) => {
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

// Перехват запросов: если сети нет, отдаем из памяти телефона
self.addEventListener('fetch', (event) => {
  // Для запросов на открытие страницы (навигация)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('./index.html') || caches.match('./');
      })
    );
    return;
  }

  // Для скриптов, стилей и файлов приложения: сначала кэш, затем сеть
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => {
        // Оффлайн фоллбэк для ресурсов
        return caches.match(event.request);
      });
    })
  );
});
