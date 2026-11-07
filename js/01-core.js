// =====================================================================
// 01-core: Zustand (appData), Persistenz (IndexedDB), Start, Navigation,
// Theme, Modal und Toast.
// =====================================================================

const ZJ_DB_NAME = 'zettel-job';
const ZJ_DB_STORE = 'store';
const ZJ_DB_KEY = 'appData';
const ZJ_DB_FILES = 'files'; // Dateianhänge (PDF/Fotos) der Aufträge, getrennt von appData

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

// Kostenstellen der Werkstatt (Standardliste, in den Einstellungen änderbar)
const DEFAULT_COST_CENTERS = [
  ['10', 'Allgemeine Kosten'],
  ['11', 'Bürogebäude/Betriebsausstattung Büro'],
  ['12', 'Sozialgebäude'],
  ['13', 'Gelände'],
  ['14', 'Halle/Werkstätten'],
  ['15', 'Prüfstand+Peripherie/Brunnen/Kaianlage'],
  ['16', 'Lager/Außenlagerplätze'],
  ['17B', 'Betriebsmittel'],
  ['17W', 'Werkzeuge'],
  ['18', 'Betriebsfahrzeuge'],
  ['19', 'Betriebsstoffe'],
  ['20', 'EDV'],
  ['301', 'Lagereinkäufe'],
  ['110', 'Geschäftsführung'],
  ['120', 'Verwaltung'],
  ['201', 'Vertrieb Stationär'],
  ['208', 'Vertrieb Service - Mechanik'],
  ['209', 'Vertrieb Service - Elektrik'],
  ['210', 'Vertrieb Service - Büro'],
  ['211', 'Vertrieb Service - Wilhelmshaven'],
  ['212', 'Vertrieb Service - Stralsund'],
  ['215', 'Vertrieb Service - Helgoland'],
  ['220', 'Einkauf/Vertrieb ET'],
  ['230', 'Vertrieb Aggregate/Anlagen'],
  ['240', 'Projektierung'],
  ['250', 'Dokumentation/Abwicklung/EDV'],
  ['310', 'Betriebsleitung/Prüfstand'],
  ['320', 'Fertigung - Mechanik'],
  ['330', 'Fertigung - Elektrik'],
  ['340', 'Auszubildende/Studenten/Praktikanten'],
  ['350', 'Lager']
];

function defaultCostCenters() {
  return DEFAULT_COST_CENTERS.map(([no, label]) => ({ no, label }));
}

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
      costCenters: defaultCostCenters(), // Kostenstellen für Werkstatt: { no, label }
      costCentersVersion: 1, // Version der eingetragenen Standard-Kostenstellen
      ownSignature: null
    },
    role: null,   // 'tech' (Servicetechniker) | 'office' (Sachbearbeiter) – Auswahl beim Start
    jobs: [],     // vom Sachbearbeiter angelegte Aufträge
    technicians: [], // vom Büro angelegte Monteure: { id, name, phone }
    profiles: {},    // persönliche Einstellungen je Monteur (beim Wechsel auf einem Gerät)
    sheets: [],
    daysOff: [],
    orders: {} // Zusammenstellungen je Auftragsnummer (Unterschriften)
  };
}

// Fehlende Felder ergänzen (ältere Backups / Datenstände bleiben lesbar)
function normalizeData(data) {
  const def = createDefaultData();
  if (!data || typeof data !== 'object') return def;
  // Vor dem Zusammenführen merken, ob die Standard-Kostenstellen schon eingetragen wurden
  // (sonst würde der Standardwert aus createDefaultData den Stand überdecken)
  const costVersion = Number(data.settings && data.settings.costCentersVersion) || 0;
  data.settings = Object.assign({}, def.settings, data.settings || {});
  const s = data.settings;
  if (!Array.isArray(s.targets) || s.targets.length !== 7) s.targets = DEFAULT_TARGETS.slice();
  if (!Array.isArray(s.codes) || !s.codes.length) s.codes = DEFAULT_CODES.map(c => ({ ...c }));
  if (!Array.isArray(s.costCenters)) s.costCenters = [];
  // Standardliste einmalig eintragen, wenn noch keine Kostenstellen angelegt sind
  if (costVersion < 1) {
    if (!s.costCenters.length) s.costCenters = defaultCostCenters();
    s.costCentersVersion = 1;
  }
  delete s.costCentersSeeded; // fehlerhafte Markierung der Vorversion
  if (!Array.isArray(data.sheets)) data.sheets = [];
  if (!Array.isArray(data.daysOff)) data.daysOff = [];
  if (!Array.isArray(data.jobs)) data.jobs = [];
  if (!Array.isArray(data.technicians)) data.technicians = [];
  if (!data.profiles || typeof data.profiles !== 'object' || Array.isArray(data.profiles)) data.profiles = {};
  data.jobs.forEach(j => {
    if (!Array.isArray(j.engines) || !j.engines.length) j.engines = [{}];
    if (!Array.isArray(j.files)) j.files = [];
    if (!j.status) j.status = 'offen';
    if (!['montage', 'werkstatt', 'mix'].includes(j.kind)) j.kind = 'montage'; // Auftragsart
    // Zuteilung: früher ein Name (assignedTo) → jetzt Liste mehrerer Monteure
    if (!Array.isArray(j.assigned)) j.assigned = j.assignedTo ? [String(j.assignedTo).trim()].filter(Boolean) : [];
    delete j.assignedTo;
    if (!Array.isArray(j.slots)) j.slots = []; // Einsatzplanung: [{ id, name, from, to }]
  });
  if (data.role !== 'tech' && data.role !== 'office') data.role = null;
  if (!data.orders || typeof data.orders !== 'object' || Array.isArray(data.orders)) data.orders = {};
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
  // Motoren: früher ein einzelnes sheet.engine → jetzt Liste sheet.engines
  if (!Array.isArray(sh.engines)) {
    sh.engines = [sh.engine && typeof sh.engine === 'object' ? { ...sh.engine } : {}];
  }
  if (!sh.engines.length) sh.engines = [{}];
  delete sh.engine;
  return sh;
}

// ---------- IndexedDB ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ZJ_DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ZJ_DB_STORE)) db.createObjectStore(ZJ_DB_STORE);
      if (!db.objectStoreNames.contains(ZJ_DB_FILES)) db.createObjectStore(ZJ_DB_FILES);
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

// ---------- Dateianhänge (IndexedDB-Store "files", Schlüssel = Datei-ID) ----------
async function fileStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ZJ_DB_FILES, mode);
    const req = fn(tx.objectStore(ZJ_DB_FILES));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}
function saveFile(id, blob) { return fileStore('readwrite', st => st.put(blob, id)); }
function getFile(id) { return fileStore('readonly', st => st.get(id)); }
function deleteFile(id) { return fileStore('readwrite', st => st.delete(id)); }

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
  applyRole();
  if (appData.role === 'office') showView('jobs'); else renderSheetList();
  if (!appData.role) openRoleChooser();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW-Registrierung fehlgeschlagen', e));
  }
}

document.addEventListener('DOMContentLoaded', initApp);

// ---------- Installation (Android/Chrome) ----------
// Chrome meldet über „beforeinstallprompt“, dass die App installiert werden kann.
let installPromptEvent = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPromptEvent = e;
  if (appData && currentView === 'settings') renderSettings();
});
window.addEventListener('appinstalled', () => {
  installPromptEvent = null;
  showToast('Zettel-Job wurde installiert');
  if (appData && currentView === 'settings') renderSettings();
});

function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

async function installApp() {
  if (installPromptEvent) {
    installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice.catch(() => null);
    installPromptEvent = null;
    if (choice && choice.outcome === 'accepted') showToast('Wird installiert …');
    renderSettings();
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  openModal(`
    <h2 class="modal-title">App installieren</h2>
    ${ios
      ? `<ol class="install-steps"><li>Seite in <b>Safari</b> öffnen</li><li>Unten auf das <b>Teilen</b>-Symbol tippen</li><li><b>„Zum Home-Bildschirm“</b> wählen</li></ol>`
      : `<ol class="install-steps"><li>In Chrome oben rechts auf <b>⋮</b> tippen</li><li><b>„App installieren“</b> bzw. „Zum Startbildschirm hinzufügen“ wählen</li><li>Kurz warten, bis Android „installiert“ meldet – das Symbol liegt dann in der App-Übersicht</li></ol>
         <p class="muted small-text">Zeigt Chrome „bereits installiert“, obwohl die App fehlt: Chrome ganz schließen und neu öffnen – die App hat eine neue Kennung und kann neu installiert werden.</p>`}
    <div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">OK</button></div>`);
}
window.installApp = installApp;
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', flushSave);

// ---------- Navigation ----------
function showView(name) {
  if (name !== 'editor') activeSheetId = null;
  if (name !== 'order' && name !== 'editor') activeOrderNo = null;
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  const inEditor = name === 'editor';
  const inSub = inEditor || name === 'order' || name === 'job';
  document.getElementById('btn-back').hidden = !inSub;
  document.getElementById('btn-print').hidden = !(inSub && name !== 'job') && name !== 'plan';
  document.getElementById('btn-sheet-menu').hidden = !inEditor;
  document.getElementById('bottom-nav').classList.toggle('hidden', inSub);
  document.body.classList.toggle('in-editor', inSub);
  if (!inSub) setTopbarTitle('Zettel-Job');

  if (name === 'sheets') renderSheetList();
  if (name === 'hours') renderHours();
  if (name === 'settings') renderSettings();
  if (name === 'order') renderOrder();
  if (name === 'jobs') renderJobs();
  if (name === 'job') renderJob();
  if (name === 'plan') renderPlan();
  window.scrollTo(0, 0);
}

function setTopbarTitle(text) {
  document.querySelector('#topbar-title .brand-text').textContent = text;
}

// Zurück-Knopf oben links
function goBack() {
  if (currentView === 'editor') closeEditor();
  else if (currentView === 'job') showView('jobs');
  else showView('sheets');
}

// Drucken-Knopf oben: Zettel oder Zusammenstellung
function printCurrent() {
  if (currentView === 'plan') printPlan();
  else if (currentView === 'order') printActiveOrder();
  else printActiveSheet();
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
  // locked: kein Schließen durch Tippen daneben (z.B. Anmeldung)
  if (opts.locked) modal.dataset.locked = '1'; else delete modal.dataset.locked;
  modal.classList.add('open');
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
window.goBack = goBack;
window.printCurrent = printCurrent;
window.toggleTheme = toggleTheme;
window.closeModal = closeModal;
