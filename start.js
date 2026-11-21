// =====================================================================
// Service-App – Startseite
// Kacheln zu den Bereichen (zettel/, befunde/) und ein kleiner Überblick.
// Liest die IndexedDBs „zettel-job“ und „befunde“ NUR LESEND (gleiche Herkunft);
// legt keine Datenbank an und schreibt nichts. Stundenrechnung über
// zettel/js/02-helpers.js (braucht die globale Variable appData).
// =====================================================================

let appData = null;          // Daten von Zettel-Job (für 02-helpers)
let installEvent = null;

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

  if (zj) {
    appData = zj;
    const office = zj.role === 'office';
    const name = office ? zj.settings.officeName : zj.settings.name;
    const hour = d.getHours();
    const greet = hour < 11 ? 'Moin' : hour < 18 ? 'Hallo' : 'Guten Abend';
    document.getElementById('hello-title').textContent = name ? `${greet}, ${String(name).split(' ')[0]}!` : `${greet}!`;
    if (office) {
      const open = zj.jobs.filter(j => j.status !== 'erledigt');
      zStats.push(chip(open.length + ' offene Aufträge'));
      const unassigned = open.filter(j => !(j.assigned || []).length && !(j.slots || []).length);
      if (unassigned.length) todos.push(todoRow('zettel/', unassigned.length + (unassigned.length === 1 ? ' Auftrag' : ' Aufträge') + ' ohne Monteur', 'Zettel-Job · Aufträge zuteilen'));
    } else {
      const mon = weekStartISO(today);
      let week = 0;
      for (let i = 0; i < 7; i++) week += dayInfo(addDaysISO(mon, i)).worked;
      zStats.push(chip('Woche ' + formatHours(week)));
      zStats.push(chip('Konto ' + formatHours(overtimeBalance(today), true), 'acc'));
      const todayInfo = dayInfo(today);
      if (!todayInfo.sources.length && !todayInfo.offs.length && baseTargetMinutes(today) > 0)
        todos.push(todoRow('zettel/', 'Heute noch kein Zettel', 'Zettel-Job'));
      const from = addDaysISO(today, -60);
      const unsigned = zj.sheets.filter(s => s.type === 'montage' && isOwnSheet(s) && !(s.signCustomer && s.signCustomer.img)
        && sheetWorkedMinutes(s) > 0 && (sheetFirstDate(s) || '') >= from).length;
      if (unsigned) todos.push(todoRow('zettel/', unsigned + (unsigned === 1 ? ' Zettel' : ' Zettel') + ' ohne Kundenunterschrift', 'Zettel-Job · letzte 60 Tage', 'warn'));
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
  const zj = prepareZettel(await readDb('zettel-job', 'store', 'appData'));
  const bf = await readDb('befunde', 'store', 'appData');
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
window.installApp = installApp;
