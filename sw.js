const CACHE_NAME = 'diag-app-v43';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './version.js',
  './manifest.json',
  './E-Engines_logo_flash.svg',
  './E-Engines_logo_white.svg',
  './E-Engines_logo_flash_white.svg',

  // Fonts
  './fonts/roboto-cyrillic.woff2',
  './fonts/roboto-latin.woff2',
  './fonts/orbitron-latin.woff2',

  // Modules
  './modules/canProtocol.js',
  './modules/canopenCanmap.js',
  './modules/canopenSdo.js',
  './modules/ccsCtlEnums.js',
  './modules/ccsCtlPage.js',
  './modules/config.js',
  './modules/elmInit.js',
  './modules/parameterPreset.js',
  './modules/firmwareUpdate.js',
  './modules/parameterRegistry.js',
  './modules/pollingManager.js',
  './modules/socMapPage.js',
  './modules/state.js',
  './modules/translator.js',
  './modules/ui.js',
  './modules/updatePage.js',
  './modules/webSerial.js',
  './modules/webBluetooth.js',
  './modules/linkStatus.js',
  './modules/cruiseChartPage.js',
  './modules/pedalChartPage.js',
  './modules/chart.min.js',

  // Pages
  './pages/ac_charging.html',
  './pages/bms_cells.html',
  './pages/bms_params.html',
  './pages/bms_soc_map.html',
  './pages/bms_temp_map.html',
  './pages/brake.html',
  './pages/ccs.html',
  './pages/chademo.html',
  './pages/climate.html',
  './pages/cruise_control.html',
  './pages/dashboard.html',
  './pages/internal.html',
  './pages/inverter.html',
  './pages/settings.html',
  './pages/terminal.html',
  './pages/update.html'
];

// Встановлення: кешуємо всі файли
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching all files');
      // cache: 'reload' обовʼязковий. GitHub Pages віддає max-age=600, а addAll
      // за замовчуванням ходить через HTTP-кеш браузера — тож новий CACHE_NAME
      // наповнювався СТАРИМИ файлами, якщо оновлення трапилось у ті 10 хвилин.
      // Зовні це виглядало як «кеш перебудувався, а сторінка стара»: версія в
      // футері нова, розмітка й парсери попередні.
      return cache.addAll(
        ASSETS_TO_CACHE.map((url) => new Request(url, { cache: 'reload' }))
      );
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
  self.clients.claim();
});

// Перехоплення запитів: спочатку шукаємо в кеші
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) return response;

      // У кеші немає — пробуємо мережу. Офлайн вона впаде, і для навігації
      // треба віддати оболонку застосунку: інакше браузер покаже свою сторінку
      // помилки. Точного збігу може не бути через query-рядок (?utm=…), який
      // caches.match враховує, — а це той самий index.html.
      return fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
