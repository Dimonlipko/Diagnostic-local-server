const CACHE_NAME = 'diag-app-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './logo.png',
  
  // Modules
  './modules/canProtocol.js',
  './modules/config.js',
  './modules/parameterRegistry.js',
  './modules/pollingManager.js',
  './modules/state.js',
  './modules/translator.js',
  './modules/ui.js',
  './modules/webSerial.js',

  // Pages
  './pages/bms_cells.html',
  './pages/bms_params.html',
  './pages/bms_soc_map.html',
  './pages/bms_temp_map.html',
  './pages/inverter.html',
  './pages/settings.html',
  './pages/terminal.html',
  './pages/update.html'
];

// Встановлення: кешуємо всі файли
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching all files');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Активація: видаляємо старі кеші, якщо ми оновили версію
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[Service Worker] Removing old cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
});

// Перехоплення запитів: спочатку шукаємо в кеші
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Повертаємо файл з кешу або робимо запит в мережу
      return response || fetch(event.request);
    })
  );
});