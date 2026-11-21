// =====================================================================
// Service-App – Startseite
// Kacheln zu den Bereichen (zettel/, befunde/) und ein kleiner Überblick.
// Liest die IndexedDBs „zettel-job“ und „befunde“ NUR LESEND (gleiche Herkunft);
// legt keine Datenbank an und schreibt nichts. Stundenrechnung über
// zettel/js/02-helpers.js (braucht die globale Variable appData).
// =====================================================================

let appData = null;          // Daten des Stundennachweises (für 02-helpers)
let installEvent = null;
let zjRaw = null;            // Zettel-Job-Daten wie gespeichert (für Namen/Monteurliste)
let bfData = null;
let whoRole = 'tech';        // im Auswahlfenster gewählte Rolle

// ---------- Wer arbeitet? (gemeinsame Anmeldung) ----------
// localStorage „serviceApp.identity“ = { role: 'tech'|'office', name, at }. Stundennachweis und Befunde
// übernehmen sie beim nächsten Öffnen (zettel/js/10-jobs.js applySharedIdentity, befunde/js/01-core.js).
const IDENTITY_KEY = 'serviceApp.identity';

function readIdentity() {
  try { return JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null'); } catch { return null; }
}

// Aktuell gültige Auswahl: neuere von Startseite und Stundennachweis
function currentIdentity(zj) {
  const id = readIdentity();
  let stamp = 0;
  try { stamp = Number(localStorage.getItem('serviceApp.applied.zettel')) || 0; } catch { /* egal */ }
  if (id && (id.role === 'tech' || id.role === 'office') && (!zj || Number(id.at) > stamp)) return { role: id.role, name: id.name || '' };
  if (zj && zj.role) return { role: zj.role, name: (zj.role === 'office' ? zj.settings.officeName : zj.settings.name) || '' };
  return id && id.role ? { role: id.role, name: id.name || '' } : null;
}

// Bekannte Monteure: angelegte + aus Zetteln/Aufträgen
function knownNames(zj) {
  const map = new Map();
  const add = n => { const v = String(n || '').trim(); if (v && !map.has(v.toLowerCase())) map.set(v.toLowerCase(), v); };
  if (zj) {
    (zj.technicians || []).forEach(t => add(t.name));
    (zj.sheets || []).forEach(s => add(s.worker));
    (zj.jobs || []).forEach(j => { (j.assigned || []).forEach(add); (j.slots || []).forEach(s => add(s.name)); });
    add(zj.settings && zj.settings.name);
  }
  const id = readIdentity();
  if (id && id.role === 'tech') add(id.name);
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'de'));
}

function initialsOf(name) {
  return String(name || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase() || '?';
}

function renderWho(id) {
  document.getElementById('who-avatar').textContent = id && id.name ? initialsOf(id.name) : '?';
  document.getElementById('who-role').textContent = id ? (id.role === 'office' ? 'Büro / Sachbearbeiter' : 'Monteur') : 'Wer arbeitet?';
  document.getElementById('who-name').textContent = id ? (id.name || 'ohne Namen') : 'Bitte auswählen';
  document.getElementById('who').classList.toggle('empty', !id);
}

function openWho() {
  const id = currentIdentity(zjRaw);
  whoRole = id ? id.role : 'tech';
  renderWhoBody();
  document.getElementById('who-sheet').classList.add('open');
}

function closeWho() { document.getElementById('who-sheet').classList.remove('open'); }

function setWhoRole(role) { whoRole = role; renderWhoBody(); }

function renderWhoBody() {
  document.querySelectorAll('#who-seg button').forEach(b => b.classList.toggle('on', b.dataset.role === whoRole));
  const id = currentIdentity(zjRaw);
  const body = document.getElementById('who-body');
  if (whoRole === 'office') {
    const name = id && id.role === 'office' ? id.name : (zjRaw && zjRaw.settings.officeName) || '';
    body.innerHTML = `
      <label class="field"><span>Dein Name</span>
        <input type="text" id="who-input" value="${escapeHtml(name)}" placeholder="Vor- und Nachname" autocomplete="name"
          onkeydown="if(event.key==='Enter'){event.preventDefault();pickWho();}"></label>
      <p class="muted small">Büro: Aufträge anlegen, Einsätze planen, alle Zettel einsehen.</p>
      <button type="button" class="btn primary block" onclick="pickWho()">Als Büro anmelden</button>`;
    return;
  }
  const names = knownNames(zjRaw);
  const cur = id && id.role === 'tech' ? id.name : '';
  body.innerHTML = `
    ${names.length ? `<div class="pick">${names.map(n => `
      <button type="button" class="pick-btn ${cur && cur.toLowerCase() === n.toLowerCase() ? 'current' : ''}" onclick="pickWho(${escapeHtml(JSON.stringify(n))})">
        <span class="avatar small">${escapeHtml(initialsOf(n))}</span><b>${escapeHtml(n)}</b></button>`).join('')}</div>`
      : '<p class="muted small">Noch keine Monteure bekannt – Namen eingeben. Das Büro kann Monteure im Stundennachweis unter Einstellungen anlegen.</p>'}
    <label class="field"><span>${names.length ? 'Oder anderer Name' : 'Dein Name'}</span>
      <input type="text" id="who-input" placeholder="Vor- und Nachname" autocomplete="name"
        onkeydown="if(event.key==='Enter'){event.preventDefault();pickWho();}"></label>
    <button type="button" class="btn primary block" onclick="pickWho()">Als Monteur anmelden</button>`;
}

function pickWho(picked) {
  const input = document.getElementById('who-input');
  const name = String(picked || (input ? input.value : '')).trim();
  if (!name) { if (input) input.focus(); return; }
  try { localStorage.setItem(IDENTITY_KEY, JSON.stringify({ role: whoRole, name, at: Date.now() })); }
  catch { alert('Auswahl konnte nicht gespeichert werden (Speicher gesperrt).'); return; }
  closeWho();
  initStart();
}

// Daten so vorbereiten, als hätte der Stundennachweis die Auswahl schon übernommen (nur im Speicher)
function applyIdentityInMemory(zj, id) {
  if (!zj || !id) return;
  zj.role = id.role;
  if (id.role === 'office') { zj.settings.officeName = id.name; return; }
  const old = String(zj.settings.name || '').trim();
  if (id.name && old.toLowerCase() !== id.name.toLowerCase()) {
    zj.sheets.forEach(s => { if (!s.worker && old) s.worker = old; });
    zj.daysOff.forEach(o => { if (!o.worker && old) o.worker = old; });
    const p = (zj.profiles || {})[id.name.toLowerCase()] || {};
    const t = (zj.technicians || []).find(x => String(x.name).trim().toLowerCase() === id.name.toLowerCase());
    zj.settings.startBalance = t && t.startBalance !== undefined && t.startBalance !== '' ? Number(t.startBalance) || 0 : Number(p.startBalance) || 0;
    if (t && Array.isArray(t.targets)) zj.settings.targets = t.targets.slice();
    else if (Array.isArray(p.targets) && p.targets.length === 7) zj.settings.targets = p.targets.slice();
  }
  zj.settings.name = id.name;
}

function readDb(name, store, key) {
  return new Promise(resolve => {
    try {
      const r = indexedDB.open(name);
      r.onupgradeneeded = () => { r.transaction.abort(); resolve(null); }; // gibt es nicht → nicht anlegen
      r.onerror = () => resolve(null);
      r.onsuccess = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(store)) { db.close(); resolve(null); return; }
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => { db.close(); resolve(req.result || null); };
        req.onerror = () => { db.close(); resolve(null); };
      };
    } catch (e) { resolve(null); }
  });
}

// Fehlende Felder ergänzen, damit die Rechenfunktionen nicht stolpern
function prepareZettel(d) {
  if (!d || typeof d !== 'object') return null;
  d.settings = d.settings || {};
  if (!Array.isArray(d.settings.targets) || d.settings.targets.length !== 7) d.settings.targets = [0, 8, 8, 8, 8, 5, 0];
  if (!Array.isArray(d.settings.codes)) d.settings.codes = [];
  ['sheets', 'daysOff', 'jobs'].forEach(k => { if (!Array.isArray(d[k])) d[k] = []; });
  d.sheets.forEach(s => {
    if (!Array.isArray(s.days)) s.days = [];
    s.days.forEach(day => { if (!Array.isArray(day.entries)) day.entries = []; });
    s.travelOut = s.travelOut || {}; s.travelBack = s.travelBack || {};
  });
  return d;
}

function applyTheme(t) {
  const dark = t === 'dark' || (t !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#10243a' : '#3aa8e6';
}

function chip(text, cls) { return `<span class="stat ${cls || ''}">${escapeHtml(text)}</span>`; }

function todoRow(href, text, sub, cls) {
  return `<a class="todo ${cls || ''}" href="${href}"><span><b>${escapeHtml(text)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>
    <svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></a>`;
}

function renderStart(zj, bf) {
  const today = todayISO();
  const d = new Date();
  document.getElementById('hello-date').textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const todos = [];
  const zStats = [];

  const ident = currentIdentity(zjRaw);
  renderWho(ident);
  const hour = d.getHours();
  const greet = hour < 11 ? 'Moin' : hour < 18 ? 'Hallo' : 'Guten Abend';
  document.getElementById('hello-title').textContent = ident && ident.name ? `${greet}, ${String(ident.name).split(' ')[0]}!` : `${greet}!`;
  if (zj && ident) applyIdentityInMemory(zj, ident);

  if (zj) {
    appData = zj;
    const office = zj.role === 'office';
    const name = office ? zj.settings.officeName : zj.settings.name;
    if (office) {
      const open = zj.jobs.filter(j => j.status !== 'erledigt');
      zStats.push(chip(open.length + ' offene Aufträge'));
      const unassigned = open.filter(j => !(j.assigned || []).length && !(j.slots || []).length);
      if (unassigned.length) todos.push(todoRow('zettel/', unassigned.length + (unassigned.length === 1 ? ' Auftrag' : ' Aufträge') + ' ohne Monteur', 'Stundennachweis · Aufträge zuteilen'));
    } else {
      const mon = weekStartISO(today);
      let week = 0;
      for (let i = 0; i < 7; i++) week += dayInfo(addDaysISO(mon, i)).worked;
      zStats.push(chip('Woche ' + formatHours(week)));
      zStats.push(chip('Konto ' + formatHours(overtimeBalance(today), true), 'acc'));
      const todayInfo = dayInfo(today);
      if (!todayInfo.sources.length && !todayInfo.offs.length && baseTargetMinutes(today) > 0)
        todos.push(todoRow('zettel/', 'Heute noch kein Zettel', 'Stundennachweis'));
      const from = addDaysISO(today, -60);
      const unsigned = zj.sheets.filter(s => s.type === 'montage' && isOwnSheet(s) && !(s.signCustomer && s.signCustomer.img)
        && sheetWorkedMinutes(s) > 0 && (sheetFirstDate(s) || '') >= from).length;
      if (unsigned) todos.push(todoRow('zettel/', unsigned + (unsigned === 1 ? ' Zettel' : ' Zettel') + ' ohne Kundenunterschrift', 'Stundennachweis · letzte 60 Tage', 'warn'));
      const me = String(name || '').trim().toLowerCase();
      const mine = me ? zj.jobs.filter(j => j.status !== 'erledigt' && (j.assigned || []).some(n => String(n).trim().toLowerCase() === me)) : [];
      if (mine.length) todos.push(todoRow('zettel/', mine.length + (mine.length === 1 ? ' Auftrag' : ' Aufträge') + ' dir zugeteilt', mine.slice(0, 3).map(j => j.orderNo || j.vessel || j.customer).filter(Boolean).join(', ')));
    }
  } else {
    zStats.push(chip('Noch nicht benutzt', 'dim'));
  }
  document.getElementById('stats-zettel').innerHTML = zStats.join('');

  const bStats = [];
  if (bf && Array.isArray(bf.orders)) {
    const orders = bf.orders.filter(o => !o.demo);
    const open = orders.filter(o => o.status !== 'fertig');
    const sheets = orders.reduce((n, o) => n + (o.sheets || []).length, 0);
    bStats.push(chip(open.length + ' offen'));
    bStats.push(chip(sheets + (sheets === 1 ? ' Blatt' : ' Blätter'), 'dim'));
    const toOrder = open.reduce((n, o) => n + (o.sheets || []).reduce((m, s) => m + ((s.data && Array.isArray(s.data.items)) ? s.data.items.filter(it => it && it.status === 'order').length : 0), 0), 0);
    if (toOrder) todos.push(todoRow('befunde/', toOrder + (toOrder === 1 ? ' Ersatzteil' : ' Ersatzteile') + ' zu bestellen', 'Befunde · Ersatzteile / Bestellliste', 'warn'));
    if (open.length) todos.push(todoRow('befunde/', open.length + (open.length === 1 ? ' Befund-Auftrag' : ' Befund-Aufträge') + ' offen', open.slice(0, 3).map(o => o.orderNo || o.vessel).filter(Boolean).join(', ')));
  } else {
    bStats.push(chip('Noch nicht benutzt', 'dim'));
  }
  document.getElementById('stats-befunde').innerHTML = bStats.join('');

  document.getElementById('todo-card').hidden = !todos.length;
  document.getElementById('todo-list').innerHTML = todos.join('');
}

async function initStart() {
  const raw = await readDb('zettel-job', 'store', 'appData');
  zjRaw = prepareZettel(raw ? JSON.parse(JSON.stringify(raw)) : null);
  const zj = prepareZettel(raw);
  const bf = bfData = await readDb('befunde', 'store', 'appData');
  applyTheme(zj && zj.settings.theme);
  try { renderStart(zj, bf); }
  catch (e) { console.warn('Überblick nicht berechenbar', e); renderStart(null, bf); }
}

function installApp() {
  if (!installEvent) return;
  installEvent.prompt();
  installEvent.userChoice.finally(() => { installEvent = null; document.getElementById('btn-install').hidden = true; });
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvent = e;
  document.getElementById('btn-install').hidden = false;
});

document.addEventListener('DOMContentLoaded', () => {
  applyTheme('auto');
  initStart();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW-Registrierung fehlgeschlagen', e));
  }
});
// Beim Zurückkommen aus einem Bereich (bfcache) neu einlesen
window.addEventListener('pageshow', e => { if (e.persisted) initStart(); });
Object.assign(window, { installApp, openWho, closeWho, setWhoRole, pickWho });
