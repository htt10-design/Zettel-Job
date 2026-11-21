// =====================================================================
// 14-apps: Verknüpfung mit dem Bereich „Befunde“ der Service-App (Mess- & Befundblätter)
// - Befunde liegt im Nachbarordner (../befunde/) → gleiche Herkunft,
//   deshalb kann Zettel-Job deren IndexedDB „befunde“ NUR LESEND abfragen
//   (Blätter je Auftragsnummer). Es wird nie etwas in Befunde geschrieben
//   und die Datenbank wird nicht angelegt, wenn es sie nicht gibt.
// - Direktlinks von Befunde: #auftrag=<Nr.> und #bericht=<Nr.>
// =====================================================================

const BEFUNDE_PATH = '../befunde/';
let befundeCache = null;      // { orders: [...] } oder null (nicht vorhanden)
let befundeCacheAt = 0;

function befundeUrl(hash) {
  const u = new URL(BEFUNDE_PATH, location.href);
  u.search = '';
  u.hash = hash || '';
  return u.href;
}

function openBefunde(hash) {
  flushSave();
  location.href = befundeUrl(hash);
}

// Befunde-Daten nur lesen (falls die App auf diesem Gerät schon benutzt wurde)
async function loadBefundeData(force) {
  if (!force && befundeCacheAt && Date.now() - befundeCacheAt < 30000) return befundeCache;
  befundeCacheAt = Date.now();
  befundeCache = null;
  try {
    if (!indexedDB.databases) return null; // ohne diese Abfrage nichts anlegen
    const dbs = await indexedDB.databases();
    if (!dbs.some(d => d.name === 'befunde')) return null;
    const db = await new Promise((res, rej) => { const r = indexedDB.open('befunde'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    if (!db.objectStoreNames.contains('store')) { db.close(); return null; }
    const data = await new Promise((res, rej) => {
      const tx = db.transaction('store', 'readonly');
      const req = tx.objectStore('store').get('appData');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    db.close();
    befundeCache = data && Array.isArray(data.orders) ? { orders: data.orders } : null;
  } catch (e) {
    console.warn('Befunde nicht lesbar', e);
    befundeCache = null;
  }
  return befundeCache;
}

// Box „Befunde“ für einen Auftrag; wird nach dem Laden in das Element mit der ID eingesetzt
function befundeBox(orderNo, elId) {
  const no = normOrderNo(orderNo);
  if (!no) return '';
  loadBefundeData().then(data => {
    const el = document.getElementById(elId);
    if (!el) return;
    const orders = data ? data.orders.filter(o => sameOrder(o.orderNo, no)) : [];
    const sheets = orders.reduce((n, o) => n + (o.sheets || []).length, 0);
    const link = encodeURIComponent(no);
    el.innerHTML = orders.length ? `
      <div class="befunde-box">
        <span class="bf-icon">${BEFUNDE_ICON}</span>
        <span class="bf-text"><b>Befunde</b><small>${sheets} ${sheets === 1 ? 'Mess-/Befundblatt' : 'Mess-/Befundblätter'}${orders[0].status === 'fertig' ? ' · fertig' : ''}</small></span>
        <button class="btn btn-soft" onclick="openBefunde('auftrag=${link}')">Öffnen</button>
        <button class="btn btn-ghost" onclick="openBefunde('bericht=${link}')">Bericht</button>
      </div>` : `
      <div class="befunde-box empty">
        <span class="bf-icon">${BEFUNDE_ICON}</span>
        <span class="bf-text"><b>Befunde</b><small>Noch keine Mess- oder Befundblätter</small></span>
        <button class="btn btn-soft" onclick="openBefunde()">In Befunde anlegen</button>
      </div>`;
  });
  return `<div id="${elId}" class="befunde-slot"></div>`;
}

const BEFUNDE_ICON = '<svg viewBox="0 0 24 24"><path d="M9 3h6v3H9z"/><path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2"/><path d="M9 13l2 2 4-4"/></svg>';

window.openBefunde = openBefunde;
