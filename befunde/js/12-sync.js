// =====================================================================
// 12-sync: Abgleich mit dem eigenen PocketBase-Server – derselbe Server
// und dieselben Benutzer wie Zettel-Job, aber eigene Collections
// „bf_items“ und „bf_files“ (Einrichtung: tools/pocketbase/README.md).
// Offline zuerst: die App arbeitet lokal, der Abgleich läuft im
// Hintergrund, sobald der Server erreichbar ist.
//
// Einträge (key → data):
//   order:<id>   Auftragskopf ohne Blätter, dazu sheetIds (Reihenfolge)
//   sheet:<id>   ein Blatt mit orderId → zwei Leute können gleichzeitig an
//                verschiedenen Blättern desselben Auftrags arbeiten
//   team:specs   gemerkte Sollwerte · team:settings  Logo
// Fotos: Store „files“ ↔ bf_files (fileId = Foto-ID).
// Ablauf wie Zettel-Job: Ziehen → pro Eintrag zusammenführen (neuerer
// Stand gewinnt) → Senden → Fotos. Beispielaufträge (demo) bleiben lokal.
// Pro Gerät (nicht abgeglichen): Prüfername, eigene Unterschrift, Theme.
// =====================================================================

const SYNC_CFG_KEY = 'syncConfig';
const SYNC_META_KEY = 'syncMeta';
const SYNC_INTERVAL_MS = 2 * 60 * 1000;
const SYNC_DEFAULT_URL = 'https://heimserver.tail8f2780.ts.net';
const SYNC_ITEMS = 'bf_items';
const SYNC_FILES = 'bf_files';

let syncCfg = null;       // { url, email, token, userId, deviceId, cursor, lastSync, lastError }
let syncMeta = {};        // key → { hash, ts, deleted }
let syncState = 'off';    // off | idle | busy | error | offline
let syncTimer = null;
let syncRunning = false;
let syncAgain = false;

// ---------- Hilfen ----------
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  // leere Objekte zählen wie „nicht vorhanden“ – sie entstehen schon beim Ansehen eines Blatts
  return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined && !isEmptyObj(v[k])).map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
function isEmptyObj(x) { return x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 0; }

function hashString(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

function itemHash(data) { return hashString(stableStringify(data)); }

// PocketBase-Datensatz-ID aus dem Schlüssel (15 Zeichen a–z0–9, immer gleich)
function recordIdFor(key) {
  let id = '', seed = 0;
  while (id.length < 15) { id += hashString('bf:' + seed + ':' + key).replace(/[^a-z0-9]/g, ''); seed++; }
  return id.slice(0, 15);
}

function syncActive() { return !!(syncCfg && syncCfg.url && syncCfg.token); }

// ---------- Lokale Einträge ----------
function syncOrders() { return appData.orders.filter(o => !o.demo); }

function localSyncItems() {
  const m = new Map();
  syncOrders().forEach(o => {
    const { sheets, ...head } = o;
    m.set('order:' + o.id, { kind: 'order', data: Object.assign({}, head, { sheetIds: o.sheets.map(s => s.id) }) });
    o.sheets.forEach(s => m.set('sheet:' + s.id, { kind: 'sheet', data: Object.assign({}, s, { orderId: o.id }) }));
  });
  m.set('team:specs', { kind: 'team', data: { specs: appData.specs || {}, updated: appData.specsUpdated || null } });
  m.set('team:settings', { kind: 'team', data: { logo: appData.settings.logo === undefined ? null : appData.settings.logo, updated: appData.settings.logoUpdated || null } });
  return m;
}

function findSheetLocation(id) {
  for (const o of appData.orders) {
    const i = o.sheets.findIndex(s => s.id === id);
    if (i >= 0) return { order: o, index: i };
  }
  return null;
}

function sortSheets(order, ids) {
  if (!Array.isArray(ids)) return;
  const pos = id => { const i = ids.indexOf(id); return i < 0 ? 1e9 : i; };
  order.sheets.sort((a, b) => pos(a.id) - pos(b.id) || String(a.created || '').localeCompare(String(b.created || '')));
}

// Eintrag vom Server übernehmen (data = null → löschen)
function applySyncItem(key, kind, data) {
  const id = key.slice(key.indexOf(':') + 1);
  if (kind === 'order') {
    const i = appData.orders.findIndex(o => o.id === id);
    if (data === null) { if (i >= 0) appData.orders.splice(i, 1); return; }
    const { sheetIds, ...head } = data;
    if (i >= 0) {
      const o = appData.orders[i];
      const sheets = o.sheets;
      Object.keys(o).forEach(k => delete o[k]);
      Object.assign(o, head, { sheets });
      sortSheets(o, sheetIds);
    } else {
      appData.orders.push(normalizeOrder(Object.assign({}, head, { sheets: [] })));
    }
  } else if (kind === 'sheet') {
    const loc = findSheetLocation(id);
    if (data === null) { if (loc) loc.order.sheets.splice(loc.index, 1); return; }
    const { orderId, ...sheet } = data;
    let order = appData.orders.find(o => o.id === orderId);
    // Blatt kam vor seinem Auftrag an → Platzhalter, der Kopf folgt mit dem Auftrag
    if (!order) { order = normalizeOrder({ id: orderId, orderNo: '', sheets: [], engines: [newEngine()] }); appData.orders.push(order); }
    if (loc && loc.order !== order) loc.order.sheets.splice(loc.index, 1);
    const j = order.sheets.findIndex(s => s.id === id);
    if (j >= 0) order.sheets[j] = sheet; else order.sheets.push(sheet);
  } else if (key === 'team:specs' && data) {
    appData.specs = data.specs || {};
    appData.specsUpdated = data.updated || null;
  } else if (key === 'team:settings' && data) {
    if ('logo' in data) appData.settings.logo = data.logo;
    appData.settings.logoUpdated = data.updated || null;
  }
}

function localItemTs(data) {
  const s = data && (data.updated || data.updatedAt || data.created);
  const t = s ? Date.parse(s) : NaN;
  return isNaN(t) ? 0 : t;
}

// ---------- Speicher pro Gerät ----------
async function loadSyncState() {
  try {
    syncCfg = (await idbGet(SYNC_CFG_KEY)) || null;
    syncMeta = (await idbGet(SYNC_META_KEY)) || {};
  } catch (e) { syncCfg = null; syncMeta = {}; }
  if (syncCfg && !syncCfg.deviceId) syncCfg.deviceId = uid();
}
async function saveSyncCfg() { try { await idbPut(SYNC_CFG_KEY, syncCfg); } catch (e) { console.warn(e); } }
async function saveSyncMeta() { try { await idbPut(SYNC_META_KEY, syncMeta); } catch (e) { console.warn(e); } }

// Nach Import einer Sicherung: Merkdaten verwerfen → nächster Lauf führt sauber zusammen
async function resetSyncTracking() {
  syncMeta = {};
  if (syncCfg) { syncCfg.cursor = ''; await saveSyncCfg(); }
  await saveSyncMeta();
}

// ---------- Server-Aufrufe ----------
function apiUrl(path) { return syncCfg.url.replace(/\/+$/, '') + path; }

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (syncCfg && syncCfg.token) headers.Authorization = syncCfg.token;
  let body = opts.body;
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); }
  const res = await fetch(apiUrl(path), { method: opts.method || 'GET', headers, body });
  let out = null;
  try { out = await res.json(); } catch (e) { /* leer */ }
  if (!res.ok) {
    const err = new Error((out && out.message) || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return out;
}

async function syncLogin(url, email, password) {
  syncCfg = Object.assign({ deviceId: uid(), cursor: '' }, syncCfg || {}, { url: url.trim().replace(/\/+$/, ''), email: email.trim(), token: '' });
  const res = await api('/api/collections/users/auth-with-password', { method: 'POST', json: { identity: email.trim(), password } });
  syncCfg.token = res.token;
  syncCfg.userId = res.record && res.record.id;
  syncCfg.lastError = '';
  await saveSyncCfg();
}

async function pullRemote() {
  const out = [];
  let page = 1;
  const filter = syncCfg.cursor ? `updated >= "${syncCfg.cursor}"` : '';
  for (;;) {
    const q = `?perPage=200&page=${page}&sort=updated&skipTotal=1` + (filter ? '&filter=' + encodeURIComponent(filter) : '');
    const res = await api(`/api/collections/${SYNC_ITEMS}/records` + q);
    out.push(...(res.items || []));
    if (!res.items || res.items.length < 200) break;
    page++;
  }
  return out;
}

async function upsertRemote(key, kind, data, deleted) {
  const id = recordIdFor(key);
  const body = { key, kind, data: deleted ? null : data, ts: Date.now(), deleted: !!deleted, device: syncCfg.deviceId };
  try {
    await api(`/api/collections/${SYNC_ITEMS}/records/` + id, { method: 'PATCH', json: body });
  } catch (e) {
    if (e.status !== 404) throw e;
    await api(`/api/collections/${SYNC_ITEMS}/records`, { method: 'POST', json: Object.assign({ id }, body) });
  }
  return body.ts;
}

// ---------- Fotos ----------
async function syncFiles() {
  const ids = new Set(collectPhotoIds(syncOrders()));
  for (const id of ids) {
    const metaKey = 'file:' + id;
    let blob = null;
    try { blob = await getFile(id); } catch (e) { /* fehlt */ }
    if (blob && !syncMeta[metaKey]) {
      const fd = new FormData();
      fd.append('fileId', id);
      fd.append('name', id + '.jpg');
      fd.append('file', blob, id + '.jpg');
      try { await api(`/api/collections/${SYNC_FILES}/records`, { method: 'POST', body: fd }); }
      catch (e) { if (e.status !== 400) throw e; } // 400 = schon vorhanden (eindeutige fileId)
      syncMeta[metaKey] = { hash: 'up', ts: Date.now() };
    } else if (!blob) {
      const res = await api(`/api/collections/${SYNC_FILES}/records?perPage=1&filter=` + encodeURIComponent(`fileId = "${id}"`));
      const rec = res.items && res.items[0];
      if (rec && rec.file) {
        const r = await fetch(apiUrl(`/api/files/${SYNC_FILES}/${rec.id}/${encodeURIComponent(rec.file)}`), { headers: { Authorization: syncCfg.token } });
        if (r.ok) { await saveFile(id, await r.blob()); syncMeta[metaKey] = { hash: 'down', ts: Date.now() }; }
      }
    }
  }
}

// ---------- Ein Abgleich ----------
async function runSync(manual) {
  if (!syncActive()) { setSyncState('off'); return false; }
  if (syncRunning) { syncAgain = true; return false; }
  syncRunning = true;
  setSyncState('busy');
  let changedLocal = false;
  const changedKeys = new Set();
  try {
    flushSave();
    // 1) Ziehen und zusammenführen
    const remote = await pullRemote();
    const local = localSyncItems();
    let cursor = syncCfg.cursor || '';
    remote.forEach(r => {
      if (r.updated && r.updated > cursor) cursor = r.updated;
      if (r.device === syncCfg.deviceId && syncMeta[r.key] && syncMeta[r.key].ts === r.ts) return; // eigenes Echo
      const meta = syncMeta[r.key];
      const L = local.get(r.key);
      const localHash = L ? itemHash(L.data) : null;
      const localChanged = meta ? (L ? localHash !== meta.hash : !meta.deleted) : !!L;
      const localTs = L ? localItemTs(L.data) : 0;
      if (localChanged && L && localTs > (r.ts || 0)) return; // lokale neuere Änderung behalten → wird gesendet
      if (r.deleted) {
        if (L) { applySyncItem(r.key, r.kind, null); changedLocal = true; changedKeys.add(r.key); }
        syncMeta[r.key] = { hash: null, ts: r.ts, deleted: true };
      } else {
        const h = itemHash(r.data);
        if (h !== localHash) { applySyncItem(r.key, r.kind, r.data); changedLocal = true; changedKeys.add(r.key); }
        syncMeta[r.key] = { hash: h, ts: r.ts, deleted: false };
      }
    });
    syncCfg.cursor = cursor;
    if (changedLocal) { appData = normalizeData(appData); await saveData(true); }

    // 2) Senden: geänderte und gelöschte Einträge
    const now = localSyncItems();
    let pushed = 0;
    for (const [key, it] of now) {
      const h = itemHash(it.data);
      const meta = syncMeta[key];
      if (meta && meta.hash === h && !meta.deleted) continue;
      const ts = await upsertRemote(key, it.kind, it.data, false);
      syncMeta[key] = { hash: h, ts, deleted: false };
      pushed++;
    }
    for (const key of Object.keys(syncMeta)) {
      if (key.startsWith('file:') || now.has(key) || syncMeta[key].deleted) continue;
      const kind = key.slice(0, key.indexOf(':'));
      const ts = await upsertRemote(key, kind, null, true);
      syncMeta[key] = { hash: null, ts, deleted: true };
      pushed++;
    }

    // 3) Fotos
    await syncFiles();

    syncCfg.lastSync = new Date().toISOString();
    syncCfg.lastError = '';
    await saveSyncCfg();
    await saveSyncMeta();
    setSyncState('idle');
    if (changedLocal) refreshAfterSync(changedKeys);
    if (manual) showToast(changedLocal || pushed ? `Abgeglichen${changedLocal ? ' – neue Daten geladen' : ''}` : 'Alles auf dem neuesten Stand');
    return true;
  } catch (e) {
    console.warn('Sync fehlgeschlagen', e);
    if (e.status === 401 || e.status === 403) {
      syncCfg.token = '';
      syncCfg.lastError = 'Anmeldung abgelaufen – bitte neu anmelden';
      setSyncState('error');
    } else if (e.status === 404) {
      syncCfg.lastError = 'Auf dem Server fehlen die Befunde-Collections (bf_items / bf_files) – siehe Einrichtung';
      setSyncState('error');
    } else {
      syncCfg.lastError = e.status ? e.message : 'Server nicht erreichbar (Tailscale an?)';
      setSyncState(e.status ? 'error' : 'offline');
    }
    await saveSyncCfg();
    await saveSyncMeta();
    if (manual) showToast(syncCfg.lastError);
    return false;
  } finally {
    syncRunning = false;
    if (syncAgain) { syncAgain = false; scheduleSync(1500); }
  }
}

// Ansicht nach eingespielten Server-Daten neu zeichnen – ohne laufende Eingaben zu stören
function refreshAfterSync(keys) {
  const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (currentView === 'sheet') {
    if (!getActiveOrder()) { showView('orders'); return; }
    if (!getActiveSheet()) { showView('order'); showToast('Dieses Blatt wurde auf einem anderen Gerät gelöscht'); return; }
    if (keys.has('sheet:' + activeSheetId) && !typing) renderSheet();
    return;
  }
  if (currentView === 'order' && !getActiveOrder()) { showView('orders'); return; }
  if (typing) return;
  if (['orders', 'order', 'report', 'settings'].includes(currentView)) showView(currentView);
}

function scheduleSync(delay) {
  if (!syncActive()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync(false), delay == null ? 4000 : delay);
}

// ---------- Anzeige ----------
function setSyncState(s) {
  syncState = s;
  const b = document.getElementById('btn-sync');
  if (!b) return;
  b.hidden = !(syncCfg && syncCfg.url && (syncCfg.token || syncCfg.lastError));
  b.className = 'icon-btn sync-' + s;
  b.title = { idle: 'Synchronisiert', busy: 'Synchronisiere …', error: 'Sync-Fehler', offline: 'Server nicht erreichbar', off: 'Sync aus' }[s] || '';
}

// Anmeldung von Zettel-Job auf diesem Gerät (gleicher Server, gleiche Benutzer) – nur lesen
async function readZettelJobLogin() {
  try {
    if (!indexedDB.databases) return null;
    const dbs = await indexedDB.databases();
    if (!dbs.some(d => d.name === 'zettel-job')) return null;
    const db = await new Promise((res, rej) => { const r = indexedDB.open('zettel-job'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    if (!db.objectStoreNames.contains('store')) { db.close(); return null; }
    const cfg = await new Promise((res, rej) => {
      const r = db.transaction('store', 'readonly').objectStore('store').get('syncConfig');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    db.close();
    return cfg && cfg.url && cfg.token ? { url: cfg.url, email: cfg.email || '', token: cfg.token, userId: cfg.userId } : null;
  } catch (e) { return null; }
}

function syncCardHtml() {
  const c = syncCfg || {};
  const loggedIn = !!c.token;
  const last = c.lastSync ? new Date(c.lastSync).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–';
  return `
    <div class="card sync-card">
      <h3 class="card-title">Synchronisation (eigener Server)</h3>
      ${loggedIn ? `
        <div class="sync-status st-${syncState}">
          <span class="sync-dot"></span>
          <span><b>${{ idle: 'Verbunden', busy: 'Gleicht ab …', error: 'Fehler', offline: 'Server nicht erreichbar', off: 'Aus' }[syncState] || 'Verbunden'}</b>
            <small>${escapeHtml(c.email || '')} · ${escapeHtml(c.url || '')} · zuletzt ${escapeHtml(last)}</small>
            ${c.lastError ? `<small class="sync-err">${escapeHtml(c.lastError)}</small>` : ''}</span>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="runSync(true).then(() => renderSettings())">Jetzt abgleichen</button>
          <button class="btn btn-ghost" onclick="syncLogout()">Abmelden</button>
        </div>
        <p class="muted small-text">Aufträge, alle Blätter, Fotos und gemerkte Sollwerte werden automatisch abgeglichen – das Büro sieht Berichte sofort. Prüfername und eigene Unterschrift bleiben pro Gerät. Beispielaufträge bleiben lokal.</p>`
      : `
        <p class="muted small-text">Derselbe Server und dieselbe Anmeldung wie im Stundennachweis: Handy, Tablet und Büro-PC haben denselben Stand.</p>
        ${c.lastError ? `<p class="sync-err">${escapeHtml(c.lastError)}</p>` : ''}
        <div id="zj-login-offer"></div>
        <label class="field"><span>Server-Adresse</span><input type="url" id="sync-url" value="${escapeHtml(c.url || SYNC_DEFAULT_URL)}" autocomplete="off"></label>
        <div class="grid-2">
          <label class="field"><span>E-Mail</span><input type="email" id="sync-email" value="${escapeHtml(c.email || '')}" autocomplete="username"></label>
          <label class="field"><span>Passwort</span><input type="password" id="sync-pass" autocomplete="current-password"
            onkeydown="if(event.key==='Enter'){event.preventDefault();syncLoginFromForm();}"></label>
        </div>
        <button class="btn btn-primary" onclick="syncLoginFromForm()">Anmelden &amp; abgleichen</button>
        <p class="muted small-text">Benutzer wie im Stundennachweis (PocketBase-Admin → „users“). Das Gerät braucht die Tailscale-App.</p>`}
    </div>`;
}

// Nach dem Zeichnen der Einstellungen: ggf. „Anmeldung von Zettel-Job übernehmen“ anbieten
async function offerZettelJobLogin() {
  const box = document.getElementById('zj-login-offer');
  if (!box) return;
  const zj = await readZettelJobLogin();
  if (!zj || !document.getElementById('zj-login-offer')) return;
  window.__zjLogin = zj;
  box.innerHTML = `
    <button class="menu-row zj-login" onclick="syncUseZettelJobLogin()">
      <span><b>Anmeldung vom Stundennachweis übernehmen</b><small>${escapeHtml(zj.email || '')} · ${escapeHtml(zj.url)}</small></span>
      <span class="chip mini">verbinden</span>
    </button>`;
}

async function syncUseZettelJobLogin() {
  const zj = window.__zjLogin;
  if (!zj) return;
  syncCfg = Object.assign({ deviceId: uid(), cursor: '' }, syncCfg || {}, { url: zj.url.replace(/\/+$/, ''), email: zj.email, token: zj.token, userId: zj.userId, lastError: '' });
  await saveSyncCfg();
  showToast('Verbunden – gleiche ab …');
  const ok = await runSync(true);
  if (ok) startSyncLoop();
  renderSettings();
}

async function syncLoginFromForm() {
  const url = document.getElementById('sync-url').value.trim();
  const email = document.getElementById('sync-email').value.trim();
  const pass = document.getElementById('sync-pass').value;
  if (!url || !email || !pass) { showToast('Bitte Server, E-Mail und Passwort eingeben'); return; }
  try {
    setSyncState('busy');
    await syncLogin(url, email, pass);
    showToast('Angemeldet – gleiche ab …');
    await runSync(true);
    startSyncLoop();
  } catch (e) {
    syncCfg = syncCfg || {};
    syncCfg.lastError = e.status === 400 ? 'E-Mail oder Passwort falsch' : (e.status ? e.message : 'Server nicht erreichbar – Adresse und Tailscale prüfen');
    await saveSyncCfg();
    setSyncState('error');
    showToast(syncCfg.lastError);
  }
  renderSettings();
}

async function syncLogout() {
  if (!(await confirmDialog('Vom Server abmelden? Die Daten auf diesem Gerät bleiben erhalten, werden aber nicht mehr abgeglichen.', 'Abmelden'))) return;
  syncCfg.token = '';
  syncCfg.lastError = '';
  await saveSyncCfg();
  setSyncState('off');
  renderSettings();
}

function startSyncLoop() {
  clearInterval(window.__bfSyncLoop);
  window.__bfSyncLoop = setInterval(() => { if (!document.hidden) runSync(false); }, SYNC_INTERVAL_MS);
}

async function initSync() {
  await loadSyncState();
  setSyncState(syncActive() ? 'idle' : 'off');
  if (syncActive()) { runSync(false); startSyncLoop(); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(500); });
  window.addEventListener('online', () => scheduleSync(500));
}

Object.assign(window, { runSync, syncLoginFromForm, syncLogout, syncUseZettelJobLogin });
