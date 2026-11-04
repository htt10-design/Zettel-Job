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
  if (q) {
    sheets = sheets.filter(s => [s.orderNo, s.customer, s.vessel, s.note,
      ...s.days.flatMap(d => d.entries.map(e => e.desc))]
      .some(v => String(v || '').toLowerCase().includes(q)));
  }
  sheets.sort((a, b) => (sheetFirstDate(b) || b.createdAt || '').localeCompare(sheetFirstDate(a) || a.createdAt || ''));

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
  if (!sheets.length) {
    list.innerHTML = `<div class="empty small"><p>Keine Zettel gefunden.</p></div>`;
    return;
  }

  list.innerHTML = sheets.map(s => {
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
  }).join('');
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

function createSheet(type) {
  const s = appData.settings;
  const sheet = {
    id: uid(),
    type,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    orderNo: '', customer: '', vessel: '',
    days: [newDay(todayISO())],
    travelOut: type === 'montage' ? { from: s.home || '', to: '', km: '', duration: '', vehicle: s.plate ? 'Firmenwagen' : '', plate: s.plate || '' } : {},
    travelBack: type === 'montage' ? { from: '', to: s.home || '', km: '', duration: '', vehicle: s.plate ? 'Firmenwagen' : '', plate: s.plate || '' } : {},
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

function duplicateSheet(id) {
  const src = appData.sheets.find(s => s.id === id);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  copy.createdAt = copy.updatedAt = new Date().toISOString();
  copy.signCustomer = null;
  copy.signWorker = null;
  copy.finished = null;
  copy.material = null;
  copy.materialNote = '';
  // Kopf + Anfahrt übernehmen, Tage neu mit heutigem Datum ohne Zeiten
  copy.days = [newDay(todayISO())];
  appData.sheets.push(copy);
  saveData(true);
  closeModal();
  openEditor(copy.id);
  showToast('Zettel kopiert (Kopf & Anfahrt übernommen)');
}

async function deleteSheet(id) {
  closeModal();
  const ok = await confirmDialog('Diesen Zettel wirklich löschen? Das kann nicht rückgängig gemacht werden.', 'Löschen', true);
  if (!ok) return;
  appData.sheets = appData.sheets.filter(s => s.id !== id);
  saveData(true);
  showView('sheets');
  showToast('Zettel gelöscht');
}

window.setSheetFilter = setSheetFilter;
window.openNewSheetModal = openNewSheetModal;
window.createSheet = createSheet;
window.duplicateSheet = duplicateSheet;
window.deleteSheet = deleteSheet;
window.renderSheetList = renderSheetList;
