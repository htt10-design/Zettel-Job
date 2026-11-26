// Service Worker der Service-App (Startseite + alle Bereiche: zettel/, befunde/)
//
// WICHTIG: Bei jeder Änderung an Dateien der App (index.html, start.*, zettel/*, befunde/*)
// die Versionsnummer hochzählen, sonst bekommen Nutzer die alte Version aus dem Cache.
// Neue Datei in einem Bereich → hier in APP_SHELL_FILES eintragen.
const CACHE_VERSION = 'service-app-v48';

const APP_SHELL_FILES = [
  './',
  './index.html',
  './start.css',
  './start.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './zettel/',
  './zettel/index.html',
  './zettel/style.css',
  './zettel/js/01-core.js',
  './zettel/js/02-helpers.js',
  './zettel/js/03-sheets.js',
  './zettel/js/04-editor.js',
  './zettel/js/05-signature.js',
  './zettel/js/06-print.js',
  './zettel/js/07-hours.js',
  './zettel/js/08-settings.js',
  './zettel/js/09-orders.js',
  './zettel/js/10-jobs.js',
  './zettel/js/11-home.js',
  './zettel/js/12-plan.js',
  './zettel/js/13-demo.js',
  './zettel/js/14-apps.js',
  './zettel/js/15-staff.js',
  './zettel/js/16-sync.js',
  './zettel/js/17-handover.js',
  './zettel/js/18-leave.js',
  './zettel/icons/icon-192.png',
  './befunde/',
  './befunde/index.html',
  './befunde/style.css',
  './befunde/js/01-core.js',
  './befunde/js/02-helpers.js',
  './befunde/js/03-types.js',
  './befunde/js/04-orders.js',
  './befunde/js/05-editor.js',
  './befunde/js/06-special.js',
  './befunde/js/07-photos.js',
  './befunde/js/08-signature.js',
  './befunde/js/09-print.js',
  './befunde/js/10-settings.js',
  './befunde/js/11-report.js',
  './befunde/js/12-sync.js',
  './befunde/img/sdt-logo.svg',
  './befunde/icons/icon-192.png'
];

// Beim Installieren immer frisch vom Server laden (nicht aus dem HTTP-Cache)
async function fetchFreshAndCache(cache, url) {
  const response = await fetch(url, { cache: 'reload' });
  await cache.put(url, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => Promise.all(APP_SHELL_FILES.map((url) => fetchFreshAndCache(cache, url))))
      .then(() => self.skipWaiting())
  );
});

// Nur eigene alte Caches löschen (gleiche Herkunft wie andere Apps unter github.io!)
const OWN_CACHE = k => k.startsWith('service-app-') || k.startsWith('zettel-job-');
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => OWN_CACHE(k) && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, offline aus dem Cache
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return response;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
