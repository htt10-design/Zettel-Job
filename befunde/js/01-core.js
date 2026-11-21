// =====================================================================
// 01-core: Zustand (appData), Persistenz (IndexedDB), Start, Navigation,
// Theme, Modal und Toast. Aufbau wie in Zettel-Job.
// =====================================================================

const BF_DB_NAME = 'befunde';
const BF_DB_STORE = 'store';
const BF_DB_KEY = 'appData';
const BF_DB_FILES = 'files'; // Fotos (Blobs), getrennt von appData
const DEFAULT_LOGO = 'img/sdt-logo.svg'; // Standard-Logo im Kopf (settings.logo: null = Standard, '' = kein Logo)

let appData = null;
let currentView = 'orders';
let saveTimer = null;
let activeOrderId = null;
let activeSheetId = null;

function createDefaultData() {
  return {
    version: 1,
    settings: {
      name: '',          // Prüfer / Monteur
      company: '',       // Firmenname im Kopf
      companyLine: '',   // z.B. Anschrift / Abteilung
      logo: null,        // Data-URL · null = SDT-Standardlogo · '' = ohne Logo
      theme: 'auto',
      ownSignature: null,
      quickInput: true   // Schnelleingabe µm bei Durchmessern
    },
    orders: [],
    specs: {}            // gemerkte Sollwerte: specs[Motortyp][Blattart] = {...}
  };
}

function normalizeData(data) {
  const def = createDefaultData();
  if (!data || typeof data !== 'object') return def;
  data.settings = Object.assign({}, def.settings, data.settings || {});
  if (!Array.isArray(data.orders)) data.orders = [];
  if (!data.specs || typeof data.specs !== 'object') data.specs = {};
  data.orders.forEach(normalizeOrder);
  return data;
}

function normalizeOrder(o) {
  if (!o.id) o.id = uid();
  if (!Array.isArray(o.engines) || !o.engines.length) o.engines = [newEngine()];
  o.engines.forEach(e => Object.assign(e, Object.assign(newEngine(), e)));
  if (!Array.isArray(o.sheets)) o.sheets = [];
  o.sheets.forEach(sh => {
    if (!sh.id) sh.id = uid();
    if (!sh.data || typeof sh.data !== 'object') sh.data = {};
    if (!Array.isArray(sh.findings)) sh.findings = [];
  });
  if (!o.status) o.status = 'offen';
  return o;
}

function newEngine() {
  return { name: '', make: 'MTU', model: '', number: '', hours: '', power: '', rpm: '', layout: 'V', cylinders: 16, count: 'KS' };
}

// ---------- IndexedDB ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BF_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BF_DB_STORE)) db.createObjectStore(BF_DB_STORE);
      if (!db.objectStoreNames.contains(BF_DB_FILES)) db.createObjectStore(BF_DB_FILES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadData() {
  try {
    const db = await openDb();
    const data = await new Promise((resolve, reject) => {
      const tx = db.transaction(BF_DB_STORE, 'readonly');
      const req = tx.objectStore(BF_DB_STORE).get(BF_DB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return normalizeData(data);
  } catch (e) {
    console.warn('IndexedDB nicht verfügbar, nutze localStorage', e);
    try { return normalizeData(JSON.parse(localStorage.getItem(BF_DB_KEY))); }
    catch { return createDefaultData(); }
  }
}

async function writeData() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BF_DB_STORE, 'readwrite');
      tx.objectStore(BF_DB_STORE).put(appData, BF_DB_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    try { localStorage.setItem(BF_DB_KEY, JSON.stringify(appData)); }
    catch (e2) { showToast('Speichern fehlgeschlagen!'); console.error(e2); }
  }
  if (typeof scheduleSync === 'function') scheduleSync(); // Änderungen bald zum Server
}

// Weitere Werte pro Gerät im selben Store (z.B. Sync-Anmeldung) – nicht Teil von appData/Backup
async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BF_DB_STORE, 'readwrite');
    tx.objectStore(BF_DB_STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(BF_DB_STORE, 'readonly').objectStore(BF_DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function fileStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BF_DB_FILES, mode);
    const req = fn(tx.objectStore(BF_DB_FILES));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}
function saveFile(id, blob) { return fileStore('readwrite', st => st.put(blob, id)); }
function getFile(id) { return fileStore('readonly', st => st.get(id)); }
function deleteFile(id) { return fileStore('readwrite', st => st.delete(id)); }

function saveData(immediate) {
  clearTimeout(saveTimer);
  if (immediate) { saveTimer = null; return writeData(); }
  saveTimer = setTimeout(() => { saveTimer = null; writeData(); }, 350);
}

function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeData(); }
}

// ---------- Start ----------
async function initApp() {
  appData = await loadData();
  applyTheme();
  requestPersistentStorage();
  showView('orders');
  openFromLink();
  window.addEventListener('hashchange', openFromLink);
  initSync();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('../sw.js').catch(e => console.warn('SW-Registrierung fehlgeschlagen', e));
  }
}

document.addEventListener('DOMContentLoaded', initApp);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', flushSave);

// ---------- Navigation ----------
// Offenes Eingabefeld abschließen, solange es noch zum aktuellen Blatt/Auftrag gehört.
// Sonst feuert der Browser sein „change“ erst nach dem Wechsel – und der Wert landet im falschen Blatt.
function commitFocus() {
  const el = document.activeElement;
  if (el && el !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur();
}

function showView(name) {
  commitFocus();
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  const inSub = name === 'order' || name === 'sheet' || name === 'report';
  document.getElementById('btn-back').hidden = !inSub;
  document.getElementById('btn-print').hidden = !inSub;
  document.getElementById('btn-menu').hidden = !inSub;
  document.getElementById('bottom-nav').classList.toggle('hidden', inSub);
  document.body.classList.toggle('in-editor', inSub);
  if (!inSub) setTopbarTitle('Befunde');

  if (name === 'orders') renderOrders();
  if (name === 'order') renderOrder();
  if (name === 'sheet') renderSheet();
  if (name === 'settings') renderSettings();
  if (name === 'report') renderReportView();
  window.scrollTo(0, 0);
}

function setTopbarTitle(text) {
  document.querySelector('#topbar-title .brand-text').textContent = text;
}

function goBack() {
  flushSave();
  if (currentView === 'sheet' || currentView === 'report') showView('order');
  else showView('orders');
}

function printCurrent() {
  if (currentView === 'sheet') printSheets([getActiveSheet()]);
  else if (currentView === 'report') printReportView();
  else if (currentView === 'order') openPrintChooser();
}

function openContextMenu() {
  if (currentView === 'sheet') openSheetMenu();
  else if (currentView === 'report') openReportViewMenu();
  else if (currentView === 'order') openOrderMenu();
}

// ---------- Theme ----------
function effectiveTheme() {
  const t = appData && appData.settings.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  const theme = effectiveTheme();
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0f1b2b' : '#3aa8e6';
}

function toggleTheme() {
  appData.settings.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
  applyTheme();
  saveData();
  if (currentView === 'settings') renderSettings();
}

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (appData) applyTheme(); });
}

// ---------- Modal ----------
function openModal(html, opts = {}) {
  const card = document.getElementById('modal-card');
  card.className = 'modal-card' + (opts.wide ? ' wide' : '');
  card.innerHTML = html;
  const modal = document.getElementById('modal');
  if (opts.locked) modal.dataset.locked = '1'; else delete modal.dataset.locked;
  modal.classList.add('open');
  const first = card.querySelector('[autofocus]');
  if (first) setTimeout(() => first.focus(), 50);
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

function confirmDialog(message, okText = 'OK', danger = false) {
  return new Promise(resolve => {
    window.__confirmResolve = v => { closeModal(); resolve(v); };
    openModal(`
      <p class="modal-text">${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="__confirmResolve(false)">Abbrechen</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" onclick="__confirmResolve(true)">${escapeHtml(okText)}</button>
      </div>`);
  });
}

// ---------- Toast ----------
let toastTimer = null;
let toastAction = null;
function showToast(text, action) {
  const el = document.getElementById('toast');
  toastAction = action || null;
  el.innerHTML = escapeHtml(text) + (action ? ` <button class="toast-action" onclick="runToastAction()">${escapeHtml(action.label)}</button>` : '');
  el.classList.toggle('has-action', !!action);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); toastAction = null; }, action ? 6000 : 2200);
}

function runToastAction() {
  const a = toastAction;
  toastAction = null;
  document.getElementById('toast').classList.remove('show');
  if (a) a.fn();
}

function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist().catch(() => {}); }).catch(() => {});
    }
  } catch (e) { /* nicht unterstützt */ }
}

// ---------- Installation ----------
let installPromptEvent = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPromptEvent = e;
  if (appData && currentView === 'settings') renderSettings();
});

function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

async function installApp() {
  if (installPromptEvent) {
    installPromptEvent.prompt();
    await installPromptEvent.userChoice.catch(() => null);
    installPromptEvent = null;
    renderSettings();
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  openModal(`
    <h2 class="modal-title">App installieren</h2>
    ${ios
      ? `<ol class="install-steps"><li>Seite in <b>Safari</b> öffnen</li><li>Unten auf das <b>Teilen</b>-Symbol tippen</li><li><b>„Zum Home-Bildschirm“</b> wählen</li></ol>`
      : `<ol class="install-steps"><li>In Chrome oben rechts auf <b>⋮</b> tippen</li><li><b>„App installieren“</b> bzw. „Zum Startbildschirm hinzufügen“ wählen</li></ol>`}
    <div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">OK</button></div>`);
}

Object.assign(window, { showView, goBack, printCurrent, openContextMenu, toggleTheme, closeModal, runToastAction, installApp });
