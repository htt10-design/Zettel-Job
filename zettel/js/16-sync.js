// =====================================================================
// 16-sync: Abgleich mit dem eigenen PocketBase-Server (z.B. Heimserver
// über Tailscale). Offline zuerst: die App arbeitet lokal weiter,
// der Abgleich läuft im Hintergrund, sobald der Server erreichbar ist.
//
// Server: Collections „zj_items“ (ein Datensatz je Zettel/Auftrag/…) und
// „zj_files“ (Dateianhänge) – Einrichtung: tools/pocketbase/README.md
//
// Ablauf je Lauf: Ziehen (alles, was sich auf dem Server seit dem letzten
// Mal geändert hat) → Zusammenführen pro Eintrag (neuerer Stand gewinnt,
// lokale ungesendete Änderungen werden nicht überschrieben, wenn sie
// neuer sind) → Senden (lokal geänderte/gelöschte Einträge) → Dateien.
//
// Nicht abgeglichen (pro Gerät): Rolle, angemeldeter Name, Theme,
// persönliche Werte in settings (die liegen je Monteur in profiles).
// Merkdaten pro Gerät (IndexedDB, nicht im Backup): syncConfig, syncMeta.
// =====================================================================

const SYNC_CFG_KEY = 'syncConfig';
const SYNC_META_KEY = 'syncMeta';
const SYNC_INTERVAL_MS = 2 * 60 * 1000;
const SYNC_DEFAULT_URL = 'https://heimserver.tail8f2780.ts.net';
const TEAM_SETTING_KEYS = ['codes', 'costCenters', 'costCentersVersion', 'workshopPause'];

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
  return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// kurzer Hash (2 × 32 Bit FNV-1a)
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
  let id = '';
  let seed = 0;
  while (id.length < 15) {
    id += hashString(seed + ':' + key).replace(/[^a-z0-9]/g, '');
    seed++;
  }
  return id.slice(0, 15);
}

function syncActive() {
  return !!(syncCfg && syncCfg.url && syncCfg.token) && !(typeof isDemo === 'function' && isDemo());
}

// ---------- Lokale Einträge ----------
// Alle abzugleichenden Einträge: Map key → { kind, data }
function localSyncItems() {
  const m = new Map();
  appData.sheets.forEach(s => m.set('sheet:' + s.id, { kind: 'sheet', data: s }));
  appData.jobs.forEach(j => m.set('job:' + j.id, { kind: 'job', data: j }));
  appData.technicians.forEach(t => m.set('tech:' + t.id, { kind: 'tech', data: t }));
  appData.daysOff.forEach(o => m.set('off:' + o.id, { kind: 'off', data: o }));
  (appData.handovers || []).forEach(h => m.set('handover:' + h.id, { kind: 'handover', data: h }));
  (appData.leaveRequests || []).forEach(r => m.set('leave:' + r.id, { kind: 'leave', data: r }));
  Object.keys(appData.orders || {}).forEach(k => { if (appData.orders[k]) m.set('order:' + k, { kind: 'order', data: appData.orders[k] }); });
  Object.keys(appData.profiles || {}).forEach(k => m.set('profile:' + k, { kind: 'profile', data: appData.profiles[k] }));
  const team = {};
  TEAM_SETTING_KEYS.forEach(k => { if (appData.settings[k] !== undefined) team[k] = appData.settings[k]; });
  m.set('team:settings', { kind: 'team', data: team });
  return m;
}

const SYNC_LISTS = { sheet: 'sheets', job: 'jobs', tech: 'technicians', off: 'daysOff', handover: 'handovers', leave: 'leaveRequests' };

// Eintrag vom Server übernehmen (data = null → löschen)
function applySyncItem(key, kind, data) {
  const id = key.slice(key.indexOf(':') + 1);
  if (SYNC_LISTS[kind]) {
    const list = appData[SYNC_LISTS[kind]];
    const i = list.findIndex(x => x.id === id);
    if (data === null) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list[i] = data;
    else list.push(data);
    if (kind === 'sheet' && data) normalizeSheet(data);
  } else if (kind === 'order') {
    if (data === null) delete appData.orders[id]; else appData.orders[id] = data;
  } else if (kind === 'profile') {
    if (data === null) delete appData.profiles[id]; else appData.profiles[id] = data;
  } else if (kind === 'team' && data) {
    TEAM_SETTING_KEYS.forEach(k => { if (data[k] !== undefined) appData.settings[k] = data[k]; });
  }
}

// Zeitstempel einer lokalen Änderung (für Konflikte): updatedAt, sonst jetzt
function localItemTs(data) {
  const t = data && data.updatedAt ? Date.parse(data.updatedAt) : NaN;
  return isNaN(t) ? Date.now() : t;
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

// Nach Import/Zurücksetzen: Merkdaten verwerfen → nächster Lauf führt sauber zusammen
async function resetSyncTracking() {
  syncMeta = {};
  if (syncCfg) { syncCfg.cursor = ''; await saveSyncCfg(); }
  await saveSyncMeta();
}

// ---------- Server-Aufrufe ----------
function apiUrl(path) {
  return syncCfg.url.replace(/\/+$/, '') + path;
}

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (syncCfg && syncCfg.token) headers.Authorization = syncCfg.token;
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  const res = await fetch(apiUrl(path), { method: opts.method || 'GET', headers, body: opts.body });
  let body = null;
  try { body = await res.json(); } catch (e) { /* leer */ }
  if (!res.ok) {
    const err = new Error((body && body.message) || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return body;
}

async function syncLogin(url, email, password) {
  syncCfg = Object.assign({ deviceId: uid(), cursor: '' }, syncCfg || {}, { url: url.trim().replace(/\/+$/, ''), email: email.trim(), token: '' });
  const res = await api('/api/collections/users/auth-with-password', { method: 'POST', json: { identity: email.trim(), password } });
  syncCfg.token = res.token;
  syncCfg.userId = res.record && res.record.id;
  syncCfg.lastError = '';
  await saveSyncCfg();
}

// alle geänderten Server-Einträge seit dem Cursor
async function pullRemote() {
  const out = [];
  let page = 1;
  const filter = syncCfg.cursor ? `updated >= "${syncCfg.cursor}"` : '';
  for (;;) {
    const q = `?perPage=200&page=${page}&sort=updated&skipTotal=1` + (filter ? '&filter=' + encodeURIComponent(filter) : '');
    const res = await api('/api/collections/zj_items/records' + q);
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
    await api('/api/collections/zj_items/records/' + id, { method: 'PATCH', json: body });
  } catch (e) {
    if (e.status !== 404) throw e;
    await api('/api/collections/zj_items/records', { method: 'POST', json: Object.assign({ id }, body) });
  }
  return body.ts;
}

// ---------- Dateien (Anhänge an Aufträgen) ----------
async function syncFiles() {
  const wanted = new Map();
  appData.jobs.forEach(j => (j.files || []).forEach(f => wanted.set(f.id, f)));
  for (const [id, f] of wanted) {
    const metaKey = 'file:' + id;
    let blob = null;
    try { blob = await getFile(id); } catch (e) { /* fehlt */ }
    if (blob && !syncMeta[metaKey]) {
      // hochladen
      const fd = new FormData();
      fd.append('fileId', id);
      fd.append('name', f.name || 'datei');
      fd.append('file', blob, f.name || 'datei');
      try {
        await api('/api/collections/zj_files/records', { method: 'POST', body: fd });
      } catch (e) {
        if (e.status !== 400) throw e; // 400 = schon vorhanden (eindeutige fileId)
      }
      syncMeta[metaKey] = { hash: 'up', ts: Date.now() };
    } else if (!blob) {
      // herunterladen
      const res = await api('/api/collections/zj_files/records?perPage=1&filter=' + encodeURIComponent(`fileId = "${id}"`));
      const rec = res.items && res.items[0];
      if (rec && rec.file) {
        const r = await fetch(apiUrl(`/api/files/zj_files/${rec.id}/${encodeURIComponent(rec.file)}`), { headers: { Authorization: syncCfg.token } });
        if (r.ok) { await saveFile(id, await r.blob()); syncMeta[metaKey] = { hash: 'down', ts: Date.now() }; }
      }
    }
  }
}

// ---------- Ein Abgleich ----------
async function runSync(manual) {
  if (!syncActive()) { setSyncState(syncCfg && syncCfg.url ? 'off' : 'off'); return false; }
  if (syncRunning) { syncAgain = true; return false; }
  syncRunning = true;
  setSyncState('busy');
  let changedLocal = false;
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
      // Noch nie abgeglichenes Gerät: Server gewinnt, außer der lokale Eintrag ist nachweislich neuer (updatedAt)
      const localTs = !L ? 0 : (meta ? localItemTs(L.data) : (L.data.updatedAt ? Date.parse(L.data.updatedAt) || 0 : 0));
      if (localChanged && L && localTs > (r.ts || 0)) return; // lokale neuere Änderung behalten → wird gesendet
      if (r.deleted) {
        if (L) { applySyncItem(r.key, r.kind, null); changedLocal = true; }
        syncMeta[r.key] = { hash: null, ts: r.ts, deleted: true };
      } else {
        const h = itemHash(r.data);
        if (h !== localHash) { applySyncItem(r.key, r.kind, r.data); changedLocal = true; }
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

    // 3) Dateianhänge
    await syncFiles();

    syncCfg.lastSync = new Date().toISOString();
    syncCfg.lastError = '';
    await saveSyncCfg();
    await saveSyncMeta();
    setSyncState('idle');
    if (changedLocal) refreshAfterSync();
    if (manual) showToast(changedLocal || pushed ? `Abgeglichen${changedLocal ? ' – neue Daten geladen' : ''}` : 'Alles auf dem neuesten Stand');
    return true;
  } catch (e) {
    console.warn('Sync fehlgeschlagen', e);
    if (e.status === 401 || e.status === 403) {
      syncCfg.token = '';
      syncCfg.lastError = 'Anmeldung abgelaufen – bitte neu anmelden';
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

// Ansicht nach eingespielten Server-Daten neu zeichnen (Editor nur, wenn sein Zettel betroffen ist)
function refreshAfterSync() {
  if (currentView === 'editor') {
    if (!getActiveSheet()) showView('sheets');
    return;
  }
  if (['sheets', 'jobs', 'job', 'plan', 'hours', 'settings', 'order', 'staff', 'handover'].includes(currentView)) showView(currentView);
  updateLeaveBadge();
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
        <p class="muted small-text">Zettel, Aufträge, Monteure, Abwesenheiten, Einsätze und Dateien werden automatisch abgeglichen. Rolle und angemeldeter Name bleiben pro Gerät.</p>`
      : `
        <p class="muted small-text">Mit eigenem PocketBase-Server (z.B. Heimserver über Tailscale) haben Handy, Tablet und PC denselben Stand.</p>
        ${c.lastError ? `<p class="sync-err">${escapeHtml(c.lastError)}</p>` : ''}
        <label class="field"><span>Server-Adresse</span><input type="url" id="sync-url" value="${escapeHtml(c.url || SYNC_DEFAULT_URL)}" autocomplete="off"></label>
        <div class="grid-2">
          <label class="field"><span>E-Mail</span><input type="email" id="sync-email" value="${escapeHtml(c.email || '')}" autocomplete="username"></label>
          <label class="field"><span>Passwort</span><input type="password" id="sync-pass" autocomplete="current-password"
            onkeydown="if(event.key==='Enter'){event.preventDefault();syncLoginFromForm();}"></label>
        </div>
        <button class="btn btn-primary" onclick="syncLoginFromForm()">Anmelden &amp; abgleichen</button>
        <p class="muted small-text">Benutzer legst du im PocketBase-Admin unter „users“ an. Das Gerät braucht die Tailscale-App.</p>`}
    </div>`;
}

async function syncLoginFromForm() {
  const url = document.getElementById('sync-url').value.trim();
  const email = document.getElementById('sync-email').value.trim();
  const pass = document.getElementById('sync-pass').value;
  if (!url || !email || !pass) { showToast('Bitte Server, E-Mail und Passwort eingeben'); return; }
  if (typeof isDemo === 'function' && isDemo()) { showToast('Bitte zuerst die Demo beenden'); return; }
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
  clearInterval(window.__zjSyncLoop);
  window.__zjSyncLoop = setInterval(() => { if (!document.hidden) runSync(false); }, SYNC_INTERVAL_MS);
}

async function initSync() {
  await loadSyncState();
  setSyncState(syncActive() ? 'idle' : 'off');
  if (syncActive()) { runSync(false); startSyncLoop(); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(500); });
  window.addEventListener('online', () => scheduleSync(500));
}

window.runSync = runSync;
window.syncLoginFromForm = syncLoginFromForm;
window.syncLogout = syncLogout;
