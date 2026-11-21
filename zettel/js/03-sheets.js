// =====================================================================
// 03-sheets: Zettel-Liste, Filter, Neuer Zettel, Duplizieren, Löschen
// =====================================================================

let sheetFilter = 'all';
let sheetRange = 'week'; // 'week' = nur aktuelle Woche, 'all' = alle Zettel

function setSheetRange(r) {
  sheetRange = r;
  renderSheetList();
}

function setSheetFilter(f) {
  sheetFilter = f;
  document.querySelectorAll('#sheet-filter .chip').forEach(c => c.classList.toggle('active', c.dataset.filter === f));
  renderSheetList();
}

function renderSheetList() {
  if (!appData) return;
  renderTechHome();
  // Techniker: bisherige Liste nur aufgeklappt („Alle Zettel & Suche“)
  const browser = document.getElementById('sheet-browser');
  if (browser) browser.hidden = !isOffice() && !homeShowList;
  const list = document.getElementById('sheet-list');
  const q = (document.getElementById('sheet-search').value || '').trim().toLowerCase();
  let sheets = appData.sheets.slice();
  if (sheetFilter !== 'all') sheets = sheets.filter(s => s.type === sheetFilter);
  const matches = s => !q || [s.orderNo, s.customer, s.vessel, s.note,
    ...s.days.flatMap(d => d.entries.map(e => e.desc))]
    .some(v => String(v || '').toLowerCase().includes(q));

  // Zettel, deren Auftrag in einem Ordner liegt, erscheinen nur im Ordner
  const folders = folderList()
    .filter(f => sheetFilter === 'all' || f.sheets.some(x => x.type === sheetFilter))
    .filter(f => (!q || f.no.toLowerCase().includes(q) || f.sheets.some(matches)) && (!f.sheets.length || f.sheets.some(sheetVisibleForRole)));
  renderOfficeHead();
  sheets = sheets.filter(s => sheetVisibleForRole(s) && !(s.type === 'montage' && isFolder(s.orderNo))
    && !(s.type === 'werkstatt' && workshopSheetInFolders(s)) && matches(s));

  renderMyJobs();
  // Aktuelle Woche (Mo–So); bei Suche immer alles durchsuchen
  const wStart = weekStartISO(todayISO());
  const wEnd = addDaysISO(wStart, 6);
  const inWeek = iso => !iso || (iso >= wStart && iso <= wEnd);
  const sheetInWeek = s => s.days.some(d => inWeek(d.date));
  const allEntries = sheets.map(s => ({ date: sheetFirstDate(s) || s.createdAt || '', html: sheetCardHtml(s), week: sheetInWeek(s) }))
    .concat(folders.map(f => ({ date: f.last || '', html: folderCardHtml(f), week: !f.sheets.length || f.sheets.some(sheetInWeek) })))
    .sort((a, b) => b.date.localeCompare(a.date));
  // Büro: Tag im Kalender gewählt → nur dieser Tag
  if (isOffice() && officeDay) {
    const daySheets = sheets.filter(s => s.days.some(d => d.date === officeDay));
    const head = `<div class="range-head"><span><b>${WEEKDAYS_LONG[parseISODate(officeDay).getDay()]}, ${formatDate(officeDay, false)}</b> · ${daySheets.length} Zettel</span><button class="link-btn" onclick="officeSelectDay('${officeDay}')">Alle anzeigen</button></div>`;
    list.innerHTML = head + (daySheets.length ? daySheets.map(sheetCardHtml).join('') : '<div class="empty small"><p>An diesem Tag keine Zettel.</p></div>');
    return;
  }
  const weekOnly = sheetRange === 'week' && !q;
  const entries = weekOnly ? allEntries.filter(e => e.week) : allEntries;
  const hidden = allEntries.length - entries.length;
  const rangeHead = q ? '' : `
    <div class="range-head">
      <span>${weekOnly ? `<b>Diese Woche</b> · KW ${isoWeek(wStart)} (${formatDateShort(wStart)}–${formatDateShort(wEnd)})` : '<b>Alle Zettel</b>'}</span>
      ${weekOnly
        ? (hidden ? `<button class="link-btn" onclick="setSheetRange('all')">Ältere anzeigen (${hidden})</button>` : '')
        : `<button class="link-btn" onclick="setSheetRange('week')">Nur diese Woche</button>`}
    </div>`;

  if (!appData.sheets.length && isOffice()) {
    list.innerHTML = `<div class="empty"><h3>Noch keine Zettel</h3><p>Hier erscheinen die Zettel aller Techniker.</p></div>`;
    return;
  }
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
    list.innerHTML = rangeHead + `<div class="empty small"><p>${weekOnly ? 'Diese Woche noch keine Zettel.' : 'Keine Zettel gefunden.'}</p></div>`;
    return;
  }

  list.innerHTML = rangeHead + entries.map(e => e.html).join('');
}

function sheetCardHtml(s) {
  {
    const total = sheetWorkedMinutes(s);
    const isMontage = s.type === 'montage';
    const title = isMontage
      ? (s.customer || s.vessel || 'Montage ohne Kunde')
      : (s.days[0] && s.days[0].entries.find(e => e.desc) ? s.days[0].entries.find(e => e.desc).desc : 'Werkstatt');
    const sub = [isMontage && s.vessel && s.customer ? s.vessel : '', isMontage && s.orderNo ? 'Auftrag ' + s.orderNo : '', isOffice() ? (s.worker || 'ohne Namen') : ''].filter(Boolean).join(' · ');
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
// date: Datum des neuen Zettels (z.B. aus der Wochenleiste), sonst heute
function openNewSheetModal(date) {
  newSheetDate = date || null;
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

// Werkstatt: vorbelegte Pause-Zeile (Einstellungen → Werkstatt-Pause)
function workshopPauseEntries() {
  const p = appData.settings.workshopPause || {};
  if (!p.on || parseTime(p.from) == null || parseTime(p.to) == null) return [];
  return [{ id: uid(), from: formatClock(parseTime(p.from)), to: formatClock(parseTime(p.to)), code: 'AZ', cost: 'P', desc: '', auto: true }];
}

function createSheet(type) {
  const sheet = {
    id: uid(),
    type,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    orderNo: '', customer: '', vessel: '',
    worker: appData.settings.name || '',
    days: [newDay(takeNewSheetDate())],
    travelOut: type === 'montage' ? defaultTravel('travelOut') : {},
    travelBack: type === 'montage' ? defaultTravel('travelBack') : {},
    material: null, materialNote: '',
    finished: null,
    note: '',
    signCustomer: null,
    signWorker: null
  };
  if (type === 'werkstatt') sheet.days[0].entries = workshopPauseEntries();
  appData.sheets.push(sheet);
  saveData(true);
  closeModal();
  openEditor(sheet.id);
}

// Neuer Zettel für den nächsten Tag desselben Auftrags:
// übernimmt Auftrag, Kunde, Schiff, Abwesenheit und Hotel – keine Zeiten, keine Fahrten
// Kopie der Motordaten eines Zettels
function copyEngines(engines) {
  return (engines && engines.length ? engines : [{}]).map(e => ({
    name: e.name || '', make: e.make || '', model: e.model || '', number: e.number || '', hours: e.hours || ''
  }));
}

// Neuer Zettel bekommt eine schon vorhandene Auftragsnummer → leere Kopfdaten
// (Kunde, Schiff, Motoren) vom letzten Zettel dieses Auftrags übernehmen
function fillFromOrder(sheet) {
  if (sheet.type !== 'montage' || !normOrderNo(sheet.orderNo)) return false;
  // letzter Zettel des Auftrags, sonst der vom Büro angelegte Auftrag
  const src = orderSheets(sheet.orderNo).filter(s => s !== sheet).pop() || jobForOrder(sheet.orderNo);
  if (!src) return false;
  let changed = false;
  if (!sheet.customer && src.customer) { sheet.customer = src.customer; changed = true; }
  if (!sheet.vessel && src.vessel) { sheet.vessel = src.vessel; changed = true; }
  if (!(sheet.engines || []).some(engineHasData) && (src.engines || []).some(engineHasData)) {
    sheet.engines = copyEngines(src.engines);
    if (src.engineNaming) sheet.engineNaming = src.engineNaming;
    changed = true;
  }
  return changed;
}

function nextDaySheet(id, from) {
  const src = appData.sheets.find(s => s.id === id);
  if (!src) return;
  // Aus dem Ordner / der Zusammenstellung heraus → danach dorthin zurück
  const ret = from || (currentView === 'order' || editorReturn === 'order' ? 'order'
    : (currentView === 'job' || editorReturn === 'job' ? 'job' : null));
  const dates = src.days.map(d => d.date).filter(Boolean).sort();
  const lastDay = src.days[src.days.length - 1] || {};
  // Datum: vorgegeben (Wochenleiste) oder Folgetag des Quell-Zettels
  const day = newDay(newSheetDate ? takeNewSheetDate() : (dates.length ? addDaysISO(dates[dates.length - 1], 1) : todayISO()));
  if (src.type === 'werkstatt') day.entries = workshopPauseEntries();
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
    // Motoren komplett übernehmen (Betriebsstunden als Vorschlag zum Überschreiben),
    // damit auch jeder Einzelzettel alle Daten enthält
    engines: copyEngines(src.engines),
    engineNaming: src.engineNaming || '',
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
  const ok = await confirmDialog('Diesen Zettel wirklich löschen?', 'Löschen', true);
  if (!ok) return;
  const index = appData.sheets.findIndex(s => s.id === id);
  const removed = appData.sheets[index];
  appData.sheets = appData.sheets.filter(s => s.id !== id);
  saveData(true);
  // Aus einem Ordner gelöscht → zurück in den Ordner
  const back = editorReturn === 'order' && activeOrderNo ? 'order' : (editorReturn === 'job' && getActiveJob() ? 'job' : 'sheets');
  editorReturn = null;
  showView(back);
  showToast('Zettel gelöscht', removed && {
    label: 'Rückgängig',
    fn: () => {
      appData.sheets.splice(Math.min(index, appData.sheets.length), 0, removed);
      saveData(true);
      showView(currentView === 'editor' ? 'sheets' : currentView);
      showToast('Zettel wiederhergestellt');
    }
  });
}

window.setSheetFilter = setSheetFilter;
window.setSheetRange = setSheetRange;
window.openNewSheetModal = openNewSheetModal;
window.createSheet = createSheet;
window.nextDaySheet = nextDaySheet;
window.fillFromOrder = fillFromOrder;
window.deleteSheet = deleteSheet;
window.renderSheetList = renderSheetList;
