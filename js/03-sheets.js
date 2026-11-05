// =====================================================================
// 03-sheets: Zettel-Liste, Filter, Neuer Zettel, Duplizieren, Löschen
// =====================================================================

let sheetFilter = 'all';

function setSheetFilter(f) {
  sheetFilter = f;
  document.querySelectorAll('#sheet-filter .chip').forEach(c => c.classList.toggle('active', c.dataset.filter === f));
  renderSheetList();
}

function renderBalanceStrip() {
  const el = document.getElementById('sheets-balance');
  if (!el) return;
  const bal = overtimeBalance();
  const now = new Date();
  const monthPrefix = toISODate(now).slice(0, 7);
  let monthWorked = 0;
  allRelevantDates().forEach(iso => { if (iso.startsWith(monthPrefix)) monthWorked += dayInfo(iso).worked; });
  el.innerHTML = `
    <div class="bs-item">
      <span class="bs-label">Überstunden gesamt</span>
      <span class="bs-value ${bal < 0 ? 'neg' : 'pos'}">${formatHours(bal, true)}</span>
    </div>
    <div class="bs-item">
      <span class="bs-label">${MONTHS[now.getMonth()]} gearbeitet</span>
      <span class="bs-value">${formatHours(monthWorked)}</span>
    </div>
    <svg class="bs-arrow" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>`;
}

function renderSheetList() {
  if (!appData) return;
  renderBalanceStrip();
  const list = document.getElementById('sheet-list');
  const q = (document.getElementById('sheet-search').value || '').trim().toLowerCase();
  let sheets = appData.sheets.slice();
  if (sheetFilter !== 'all') sheets = sheets.filter(s => s.type === sheetFilter);
  const matches = s => !q || [s.orderNo, s.customer, s.vessel, s.note,
    ...s.days.flatMap(d => d.entries.map(e => e.desc))]
    .some(v => String(v || '').toLowerCase().includes(q));

  // Zettel, deren Auftrag in einem Ordner liegt, erscheinen nur im Ordner
  const folders = sheetFilter === 'werkstatt' ? [] : folderList()
    .filter(f => !q || f.no.toLowerCase().includes(q) || f.sheets.some(matches));
  sheets = sheets.filter(s => !(s.type === 'montage' && isFolder(s.orderNo)) && matches(s));

  const entries = sheets.map(s => ({ date: sheetFirstDate(s) || s.createdAt || '', html: sheetCardHtml(s) }))
    .concat(folders.map(f => ({ date: f.last || '', html: folderCardHtml(f) })))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!appData.sheets.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg></div>
        <h3>Noch keine Zettel</h3>
        <p>Lege deinen ersten Montage- oder Werkstattzettel an.</p>
        <button class="btn btn-primary" onclick="openNewSheetModal()">Neuer Zettel</button>
      </div>`;
    return;
  }
  if (!entries.length) {
    list.innerHTML = `<div class="empty small"><p>Keine Zettel gefunden.</p></div>`;
    return;
  }

  list.innerHTML = entries.map(e => e.html).join('');
}

function sheetCardHtml(s) {
  {
    const total = sheetWorkedMinutes(s);
    const isMontage = s.type === 'montage';
    const title = isMontage
      ? (s.customer || s.vessel || 'Montage ohne Kunde')
      : (s.days[0] && s.days[0].entries.find(e => e.desc) ? s.days[0].entries.find(e => e.desc).desc : 'Werkstatt');
    const sub = isMontage ? [s.vessel && s.customer ? s.vessel : '', s.orderNo ? 'Auftrag ' + s.orderNo : ''].filter(Boolean).join(' · ') : '';
    let status = '';
    if (isMontage) {
      if (s.signCustomer) status = '<span class="badge badge-ok">Unterschrieben</span>';
      else status = '<span class="badge badge-open">Offen</span>';
      if (s.finished === true) status += '<span class="badge">Beendet</span>';
    }
    return `
      <button class="sheet-card ${isMontage ? 'is-montage' : 'is-werkstatt'}" onclick="openEditor('${s.id}')">
        <div class="sc-top">
          <span class="type-pill">${isMontage ? 'Montage' : 'Werkstatt'}</span>
          <span class="sc-date">${escapeHtml(sheetDateRange(s))}</span>
        </div>
        <div class="sc-title">${escapeHtml(title)}</div>
        ${sub ? `<div class="sc-sub">${escapeHtml(sub)}</div>` : ''}
        <div class="sc-bottom">
          <span class="sc-hours">${formatHours(total)}</span>
          <span class="sc-badges">${status}</span>
        </div>
      </button>`;
  }
}

// ---------- Neuer Zettel ----------
function openNewSheetModal() {
  openModal(`
    <h2 class="modal-title">Neuer Zettel</h2>
    <p class="modal-text muted">Wo wurde gearbeitet?</p>
    <div class="type-choice">
      <button class="type-btn" onclick="createSheet('montage')">
        <svg viewBox="0 0 24 24"><path d="M3 17h18l-2 4H5z"/><path d="M5 17V9h8l3 4v4"/><path d="M8 9V5h3v4"/></svg>
        <strong>Montage</strong>
        <span>Kunde, Schiff/Anlage, Anfahrt, Hotel, Auslöse, Unterschrift</span>
      </button>
      <button class="type-btn" onclick="createSheet('werkstatt')">
        <svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/></svg>
        <strong>Werkstatt</strong>
        <span>Nur Stunden und ausgeführte Arbeiten</span>
      </button>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button></div>`);
}

function newDay(date) {
  return { id: uid(), date: date || todayISO(), entries: [], away: '', hotel: false, hotelName: '', breakfast: null };
}

// Leere An-/Rückfahrt (ausgeschaltet) mit Vorschlägen aus den Einstellungen
function defaultTravel(key) {
  const s = appData.settings;
  return {
    on: false,
    from: key === 'travelOut' ? s.home || '' : '',
    to: key === 'travelBack' ? s.home || '' : '',
    km: '', duration: '',
    vehicle: s.plate ? 'Firmenwagen' : '',
    plate: s.plate || ''
  };
}

function createSheet(type) {
  const sheet = {
    id: uid(),
    type,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    orderNo: '', customer: '', vessel: '',
    worker: appData.settings.name || '',
    days: [newDay(todayISO())],
    travelOut: type === 'montage' ? defaultTravel('travelOut') : {},
    travelBack: type === 'montage' ? defaultTravel('travelBack') : {},
    material: null, materialNote: '',
    finished: null,
    note: '',
    signCustomer: null,
    signWorker: null
  };
  appData.sheets.push(sheet);
  saveData(true);
  closeModal();
  openEditor(sheet.id);
}

// Neuer Zettel für den nächsten Tag desselben Auftrags:
// übernimmt Auftrag, Kunde, Schiff, Abwesenheit und Hotel – keine Zeiten, keine Fahrten
function nextDaySheet(id, from) {
  const src = appData.sheets.find(s => s.id === id);
  if (!src) return;
  // Aus dem Ordner / der Zusammenstellung heraus → danach dorthin zurück
  const ret = from || (currentView === 'order' || editorReturn === 'order' ? 'order' : null);
  const dates = src.days.map(d => d.date).filter(Boolean).sort();
  const lastDay = src.days[src.days.length - 1] || {};
  const day = newDay(dates.length ? addDaysISO(dates[dates.length - 1], 1) : todayISO());
  if (src.type === 'montage') {
    day.away = lastDay.away || '';
    day.hotel = !!lastDay.hotel;
    day.hotelName = lastDay.hotelName || '';
    day.breakfast = lastDay.breakfast ?? null;
  }
  const sheet = {
    id: uid(),
    type: src.type,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    orderNo: src.orderNo || '', customer: src.customer || '', vessel: src.vessel || '',
    worker: appData.settings.name || '',
    days: [day],
    travelOut: src.type === 'montage' ? defaultTravel('travelOut') : {},
    travelBack: src.type === 'montage' ? defaultTravel('travelBack') : {},
    material: null, materialNote: '',
    finished: null,
    note: '',
    signCustomer: null,
    signWorker: null
  };
  appData.sheets.push(sheet);
  saveData(true);
  closeModal();
  openEditor(sheet.id, ret);
  showToast('Zettel für ' + formatDate(day.date) + ' angelegt' + (src.type === 'montage' && isFolder(src.orderNo) ? ' (im Ordner ' + normOrderNo(src.orderNo) + ')' : ''));
}

async function deleteSheet(id) {
  closeModal();
  const ok = await confirmDialog('Diesen Zettel wirklich löschen? Das kann nicht rückgängig gemacht werden.', 'Löschen', true);
  if (!ok) return;
  appData.sheets = appData.sheets.filter(s => s.id !== id);
  saveData(true);
  // Aus einem Ordner gelöscht → zurück in den Ordner
  const back = editorReturn === 'order' && activeOrderNo ? 'order' : 'sheets';
  editorReturn = null;
  showView(back);
  showToast('Zettel gelöscht');
}

window.setSheetFilter = setSheetFilter;
window.openNewSheetModal = openNewSheetModal;
window.createSheet = createSheet;
window.nextDaySheet = nextDaySheet;
window.deleteSheet = deleteSheet;
window.renderSheetList = renderSheetList;
