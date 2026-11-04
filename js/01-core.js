// =====================================================================
// 01-core: Zustand (appData), Persistenz (IndexedDB), Start, Navigation,
// Theme, Modal und Toast.
// =====================================================================

const ZJ_DB_NAME = 'zettel-job';
const ZJ_DB_STORE = 'store';
const ZJ_DB_KEY = 'appData';

// Standard-Zeitarten. Erweiterbar über die Einstellungen.
// counts = zählt als Arbeitszeit (für Stunden- und Überstundenberechnung)
const DEFAULT_CODES = [
  { code: 'AZ', label: 'Arbeitszeit', counts: true },
  { code: 'RZ', label: 'Rüstzeit', counts: true },
  { code: 'FZ', label: 'Fahrzeit', counts: true },
  { code: 'LZ', label: 'Lenkzeit', counts: true },
  { code: 'WZ', label: 'Wartezeit', counts: true },
  { code: 'P', label: 'Pause', counts: false }
];

// Sollstunden je Wochentag (Index 0 = Sonntag … 6 = Samstag)
const DEFAULT_TARGETS = [0, 8, 8, 8, 8, 5, 0];

let appData = null;
let currentView = 'sheets';
let saveTimer = null;

function createDefaultData() {
  return {
    version: 1,
    settings: {
      name: '',
      plate: '',
      home: '',
      theme: 'auto',
      targets: DEFAULT_TARGETS.slice(),
      startBalance: 0,
      codes: DEFAULT_CODES.map(c => ({ ...c })),
      ownSignature: null
    },
    sheets: [],
    daysOff: []
  };
}

// Fehlende Felder ergänzen (ältere Backups / Datenstände bleiben lesbar)
function normalizeData(data) {
  const def = createDefaultData();
  if (!data || typeof data !== 'object') return def;
  data.settings = Object.assign({}, def.settings, data.settings || {});
  const s = data.settings;
  if (!Array.isArray(s.targets) || s.targets.length !== 7) s.targets = DEFAULT_TARGETS.slice();
  if (!Array.isArray(s.codes) || !s.codes.length) s.codes = DEFAULT_CODES.map(c => ({ ...c }));
  if (!Array.isArray(data.sheets)) data.sheets = [];
  if (!Array.isArray(data.daysOff)) data.daysOff = [];
  data.sheets.forEach(normalizeSheet);
  return data;
}

function normalizeSheet(sh) {
  if (!Array.isArray(sh.days)) sh.days = [];
  sh.days.forEach(d => {
    if (!Array.isArray(d.entries)) d.entries = [];
    if (!d.id) d.id = uid();
  });
  if (!sh.travelOut) sh.travelOut = {};
  if (!sh.travelBack) sh.travelBack = {};
  return sh;
}

// ---------- IndexedDB ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ZJ_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ZJ_DB_STORE)) db.createObjectStore(ZJ_DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadData() {
  try {
    const db = await openDb();
    const data = await new Promise((resolve, reject) => {
      const tx = db.transaction(ZJ_DB_STORE, 'readonly');
      const req = tx.objectStore(ZJ_DB_STORE).get(ZJ_DB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return normalizeData(data);
  } catch (e) {
    console.warn('IndexedDB nicht verfügbar, nutze localStorage', e);
    try { return normalizeData(JSON.parse(localStorage.getItem(ZJ_DB_KEY))); }
    catch { return createDefaultData(); }
  }
}

async function writeData() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ZJ_DB_STORE, 'readwrite');
      tx.objectStore(ZJ_DB_STORE).put(appData, ZJ_DB_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    try { localStorage.setItem(ZJ_DB_KEY, JSON.stringify(appData)); }
    catch (e2) { showToast('Speichern fehlgeschlagen!'); console.error(e2); }
  }
}

// Speichert gebündelt (bei vielen Tastendrücken nicht jedes Mal schreiben)
function saveData(immediate) {
  clearTimeout(saveTimer);
  if (immediate) return writeData();
  saveTimer = setTimeout(writeData, 350);
}

// Vor dem Schließen/Wegwechseln ausstehende Änderungen sofort schreiben
function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeData(); }
}

// ---------- Start ----------
async function initApp() {
  appData = await loadData();
  applyTheme();
  renderSheetList();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW-Registrierung fehlgeschlagen', e));
  }
}

document.addEventListener('DOMContentLoaded', initApp);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', flushSave);

// ---------- Navigation ----------
function showView(name) {
  if (name !== 'editor') activeSheetId = null;
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  const inEditor = name === 'editor';
  document.getElementById('btn-back').hidden = !inEditor;
  document.getElementById('btn-print').hidden = !inEditor;
  document.getElementById('btn-sheet-menu').hidden = !inEditor;
  document.getElementById('bottom-nav').classList.toggle('hidden', inEditor);
  document.body.classList.toggle('in-editor', inEditor);
  if (!inEditor) setTopbarTitle('Zettel-Job');

  if (name === 'sheets') renderSheetList();
  if (name === 'hours') renderHours();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

function setTopbarTitle(text) {
  document.querySelector('#topbar-title .brand-text').textContent = text;
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
  document.getElementById('modal').classList.add('open');
  const first = card.querySelector('[autofocus]');
  if (first) setTimeout(() => first.focus(), 50);
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

// Bestätigungsdialog als Promise
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
function showToast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

window.showView = showView;
window.toggleTheme = toggleTheme;
window.closeModal = closeModal;
