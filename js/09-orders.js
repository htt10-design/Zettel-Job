// =====================================================================
// 09-orders: „Auftrag zusammenstellen“ – fasst auf Wunsch alle
// Montagezettel mit gleicher Auftragsnummer zu einer Übersicht bzw.
// einem gemeinsamen Ausdruck zusammen. Die Einzelzettel bleiben unverändert.
// Unterschriften der Zusammenstellung liegen in appData.orders[auftragsnr].
//
// Ordner: Eine Zusammenstellung kann „in einen Ordner abgelegt“ werden
// (appData.orders[nr].folder). Dann erscheinen alle Zettel dieses Auftrags –
// auch spätere – nicht mehr einzeln in der Liste, sondern im Ordner.
// Vorbereitung für mehrere Monteure: jeder Zettel trägt sheet.worker.
// =====================================================================

let activeOrderNo = null;

function normOrderNo(no) {
  return String(no || '').trim();
}

function sameOrder(a, b) {
  return normOrderNo(a).toLowerCase() === normOrderNo(b).toLowerCase();
}

// Alle Montagezettel eines Auftrags, chronologisch
function orderSheets(no) {
  if (!normOrderNo(no)) return [];
  return appData.sheets
    .filter(s => s.type === 'montage' && sameOrder(s.orderNo, no))
    .sort((a, b) => (sheetFirstDate(a) || '').localeCompare(sheetFirstDate(b) || ''));
}

// Übersicht aller vorhandenen Auftragsnummern
function allOrders() {
  const map = new Map();
  appData.sheets.forEach(s => {
    const no = normOrderNo(s.orderNo);
    if (s.type !== 'montage' || !no) return;
    const key = no.toLowerCase();
    if (!map.has(key)) map.set(key, { no, sheets: [] });
    map.get(key).sheets.push(s);
  });
  return Array.from(map.values()).map(o => {
    const dates = o.sheets.flatMap(s => s.days.map(d => d.date)).filter(Boolean).sort();
    return { no: o.no, count: o.sheets.length, first: dates[0] || '', last: dates[dates.length - 1] || '', customer: o.sheets.map(s => s.customer).find(Boolean) || '', vessel: o.sheets.map(s => s.vessel).find(Boolean) || '' };
  }).sort((a, b) => (b.last || '').localeCompare(a.last || ''));
}

function orderRecord(no, create) {
  const key = normOrderNo(no).toLowerCase();
  if (!appData.orders[key] && create) appData.orders[key] = { signCustomer: null, signWorker: null };
  return appData.orders[key] || null;
}

// ---------- Ordner ----------
function isFolder(no) {
  const rec = normOrderNo(no) && appData.orders[normOrderNo(no).toLowerCase()];
  return !!(rec && rec.folder);
}

// Alle Ordner mit Kennzahlen (auch leere)
function folderList() {
  return Object.keys(appData.orders).filter(k => appData.orders[k] && appData.orders[k].folder).map(k => {
    const rec = appData.orders[k];
    const sheets = orderSheets(rec.folder.no || k);
    const dates = sheets.flatMap(s => s.days.map(d => d.date)).filter(Boolean).sort();
    return {
      no: normOrderNo(sheets[0] ? sheets[0].orderNo : rec.folder.no || k),
      sheets, rec,
      first: dates[0] || '', last: dates[dates.length - 1] || rec.folder.createdAt || '',
      customer: distinctJoin(sheets.map(s => s.customer)),
      vessel: distinctJoin(sheets.map(s => s.vessel)),
      workers: distinctJoin(sheets.map(s => s.worker))
    };
  });
}

function folderCardHtml(f) {
  const totals = f.sheets.reduce((t, s) => { const x = sheetTotals(s); t.worked += x.worked; t.ot += x.ot; return t; }, { worked: 0, ot: 0 });
  const range = f.first ? (f.first === f.last ? formatDate(f.first) : formatDateShort(f.first) + ' – ' + formatDate(f.last, false)) : '';
  const badges = [
    f.rec.signCustomer ? '<span class="badge badge-ok">Unterschrieben</span>' : '',
    f.sheets.some(s => s.finished === true) ? '<span class="badge">Beendet</span>' : ''
  ].join('');
  return `
    <button class="sheet-card folder-card" onclick="openOrder(${escapeHtml(JSON.stringify(f.no))})">
      <div class="sc-top">
        <span class="type-pill"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> Ordner</span>
        <span class="sc-date">${escapeHtml(range)}</span>
      </div>
      <div class="sc-title">Auftrag ${escapeHtml(f.no)}</div>
      <div class="sc-sub">${escapeHtml([f.vessel, f.customer].filter(Boolean).join(' · ') || 'ohne Kunde')}</div>
      <div class="sc-bottom">
        <span class="sc-hours">${formatHours(totals.worked)} <small>· ${f.sheets.length} Zettel${totals.ot ? ' · ' + formatHours(totals.ot) + ' Überstd.' : ''}</small></span>
        <span class="sc-badges">${badges}</span>
      </div>
    </button>`;
}

function createFolder(no) {
  const rec = orderRecord(no, true);
  rec.folder = { no: normOrderNo(no), createdAt: new Date().toISOString() };
  saveData(true);
  renderOrder();
  showToast('Ordner „' + normOrderNo(no) + '“ angelegt – die Zettel liegen jetzt darin');
}

async function dissolveFolder(no) {
  const ok = await confirmDialog(`Ordner „${normOrderNo(no)}“ auflösen? Die Zettel erscheinen wieder einzeln in der Liste. Es wird nichts gelöscht.`, 'Auflösen');
  if (!ok) return;
  const rec = orderRecord(no, false);
  if (rec) rec.folder = null;
  saveData(true);
  if (orderSheets(no).length) renderOrder(); else showView('sheets');
  showToast('Ordner aufgelöst');
}

// Neuer Zettel im Ordner: Folgetag des letzten Zettels, sonst leerer Montagezettel mit Auftragsnummer
function newSheetInFolder(no) {
  const sheets = orderSheets(no);
  if (sheets.length) { nextDaySheet(sheets[sheets.length - 1].id, 'order'); return; }
  createSheet('montage');
  const s = getActiveSheet();
  if (s) { s.orderNo = normOrderNo(no); editorReturn = 'order'; saveData(true); renderEditor(); }
}

// Werte, die in allen Zetteln vorkommen (z.B. Kunde), eindeutig zusammenfassen
function distinctJoin(values) {
  const seen = [];
  values.map(v => String(v || '').trim()).filter(Boolean).forEach(v => { if (!seen.some(x => x.toLowerCase() === v.toLowerCase())) seen.push(v); });
  return seen.join(' / ');
}

// ---------- Auswahl ----------
function openComposeModal() {
  const orders = allOrders();
  const list = orders.length ? orders.map(o => `
      <button class="menu-row" onclick="closeModal();openOrder(${escapeHtml(JSON.stringify(o.no))})">
        <span><b>${isFolder(o.no) ? '<svg class="inline-ico" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> ' : ''}Auftrag ${escapeHtml(o.no)}</b><small>${escapeHtml([o.vessel, o.customer].filter(Boolean).join(' · ') || 'ohne Kunde')}</small></span>
        <span class="mr-right"><b>${o.count} Zettel</b><small>${o.first ? escapeHtml(o.first === o.last ? formatDateShort(o.first) : formatDateShort(o.first) + ' – ' + formatDateShort(o.last)) : ''}</small></span>
      </button>`).join('')
    : '<p class="muted">Noch keine Montagezettel mit Auftragsnummer vorhanden.</p>';
  openModal(`
    <h2 class="modal-title">Auftrag zusammenstellen</h2>
    <p class="modal-text muted">Alle Montagezettel mit derselben Auftragsnummer werden zu einer Übersicht und einem gemeinsamen Ausdruck zusammengefasst. Die einzelnen Zettel bleiben unverändert.</p>
    <div class="menu-rows">${list}</div>
    <div class="compose-manual">
      <label class="field"><span>Oder Auftragsnummer eingeben</span>
        <input type="text" id="compose-no" list="dl-orders" placeholder="SR26/000249 oder nur 249" autocomplete="off"
          onkeydown="if(event.key==='Enter'){event.preventDefault();composeFromInput();}">
      </label>
      <datalist id="dl-orders">${orders.map(o => `<option value="${escapeHtml(o.no)}">`).join('')}</datalist>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="composeFromInput()">Zusammenstellen</button>
    </div>`);
}

function composeFromInput() {
  const no = normOrderNo(formatOrderNo(document.getElementById('compose-no').value));
  if (!no) { showToast('Bitte Auftragsnummer wählen oder eingeben'); return; }
  if (!orderSheets(no).length) { showToast(`Keine Montagezettel mit Auftrag „${no}“`); return; }
  closeModal();
  openOrder(no);
}

function openOrder(no) {
  const sheets = orderSheets(no);
  if (!sheets.length && !isFolder(no)) { showToast('Keine Zettel zu diesem Auftrag'); return; }
  activeOrderNo = normOrderNo(sheets.length ? sheets[0].orderNo : no);
  flushSave();
  showView('order');
}

// Motoren aller Zettel eines Auftrags, je Position (BB/SB, A/B …) zusammengefasst;
// Betriebsstunden als Verlauf „erster → letzter“ Stand
function orderEngines(sheets) {
  const max = Math.max(1, ...sheets.map(s => (s.engines || []).length));
  const res = [];
  for (let i = 0; i < max; i++) {
    const list = sheets.map(s => (s.engines || [])[i]).filter(Boolean);
    const hours = list.map(e => String(e.hours || '').trim()).filter(Boolean);
    const labelSheet = sheets.find(s => (s.engines || []).length > 1) || sheets[0];
    res.push({
      label: (sheets.map(s => (s.engines || [])[i] && String(s.engines[i].name || '').trim()).filter(Boolean).pop())
        || (max > 1 ? engineLabel(labelSheet, i) || 'Motor ' + (i + 1) : ''),
      make: distinctJoin(list.map(e => e.make)),
      model: distinctJoin(list.map(e => e.model)),
      number: distinctJoin(list.map(e => e.number)),
      hours: hours.length > 1 && hours[0] !== hours[hours.length - 1] ? hours[0] + ' → ' + hours[hours.length - 1] : (hours[0] || '')
    });
  }
  return res;
}

// ---------- Übersicht ----------
function orderData(no) {
  const sheets = orderSheets(no);
  const items = [];
  sheets.forEach(sheet => sheet.days.forEach((d, di) => items.push({ sheet, di, day: d, split: daySplit(sheet, di) })));
  items.sort((a, b) => (a.day.date || '').localeCompare(b.day.date || ''));
  const totals = items.reduce((t, i) => ({ worked: t.worked + i.split.worked, normal: t.normal + i.split.normal, ot: t.ot + i.split.ot }), { worked: 0, normal: 0, ot: 0 });
  const travels = sheets.flatMap(sheetTravels).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const km = travels.reduce((s, t) => s + (parseFloat(String(t.t.km || '').replace(',', '.')) || 0), 0);
  const allowance = {
    away8: items.filter(i => i.day.away === '8h').length,
    away24: items.filter(i => i.day.away === '24h').length,
    hotel: items.filter(i => i.day.hotel).length,
    breakfast: items.filter(i => i.day.hotel && i.day.breakfast === true).length
  };
  const lastSheet = sheets[sheets.length - 1];
  return {
    no: normOrderNo(no), sheets, items, totals, travels, km, allowance,
    customer: distinctJoin(sheets.map(s => s.customer)),
    vessel: distinctJoin(sheets.map(s => s.vessel)),
    engines: orderEngines(sheets),
    material: sheets.some(s => s.material === true) ? true : (sheets.some(s => s.material === false) ? false : null),
    materialNotes: sheets.filter(s => s.material === true && s.materialNote).map(s => formatDateShort(sheetFirstDate(s)) + ' ' + s.materialNote),
    finished: lastSheet ? lastSheet.finished : null,
    notes: sheets.filter(s => s.note).map(s => formatDateShort(sheetFirstDate(s)) + ' ' + s.note),
    range: items.length ? (items[0].day.date === items[items.length - 1].day.date ? formatDate(items[0].day.date) : formatDateShort(items[0].day.date) + ' – ' + formatDate(items[items.length - 1].day.date, false)) : ''
  };
}

function allowanceText(a) {
  const parts = [];
  if (a.away8) parts.push(`≥ 8,25 h weg: ${a.away8} Tag${a.away8 > 1 ? 'e' : ''}`);
  if (a.away24) parts.push(`24 h weg: ${a.away24} Tag${a.away24 > 1 ? 'e' : ''}`);
  if (a.hotel) parts.push(`Hotel: ${a.hotel} ${a.hotel > 1 ? 'Nächte' : 'Nacht'}${a.hotel ? ` (Frühstück ${a.breakfast}×)` : ''}`);
  return parts;
}

function renderOrder() {
  const body = document.getElementById('order-body');
  if (!activeOrderNo) { showView('sheets'); return; }
  const o = orderData(activeOrderNo);
  setTopbarTitle('Auftrag ' + o.no);
  const folder = isFolder(o.no);
  if (!o.sheets.length) {
    body.innerHTML = `<div class="empty"><h3>Keine Zettel</h3><p>Zu diesem Auftrag gibt es keine Montagezettel mehr.</p>
      ${folder ? `<div class="btn-row center"><button class="btn btn-primary tech-only" onclick="newSheetInFolder(${escapeHtml(JSON.stringify(o.no))})">Neuer Zettel im Ordner</button>
      <button class="btn btn-ghost" onclick="dissolveFolder(${escapeHtml(JSON.stringify(o.no))})">Ordner auflösen</button></div>` : ''}</div>`;
    return;
  }
  const noJs = escapeHtml(JSON.stringify(o.no));
  const workers = distinctJoin(o.sheets.map(s => s.worker));
  const rec = orderRecord(o.no, false) || {};
  const changedAfterSign = rec.signCustomer && o.sheets.some(s => s.updatedAt && s.updatedAt > rec.signCustomer.at);
  const allow = allowanceText(o.allowance);

  const rows = o.items.map(i => {
    const d = parseISODate(i.day.date);
    const badges = [];
    if (i.split.travel.travelOut) badges.push('<span class="src">Anfahrt</span>');
    if (i.split.travel.travelBack) badges.push('<span class="src">Rückfahrt</span>');
    if (i.day.away) badges.push(`<span class="src off">${i.day.away === '24h' ? '24 h' : '≥ 8,25 h'}</span>`);
    if (i.day.hotel) badges.push('<span class="src off">Hotel</span>');
    if (i.sheet.signCustomer) badges.push('<span class="src ok">unterschr.</span>');
    return `
      <button class="o-day" onclick="openEditor('${i.sheet.id}','order')">
        <span class="h-date"><b>${d ? WEEKDAYS_SHORT[d.getDay()] : ''}</b> ${formatDateShort(i.day.date)}</span>
        <span class="h-src">${badges.join('')}</span>
        <span class="o-num">${formatHours(i.split.normal)}</span>
        <span class="o-num ot">${i.split.ot ? formatHours(i.split.ot) : '–'}</span>
      </button>`;
  }).join('');

  body.innerHTML = `
    <div class="card order-head">
      <div class="oh-top">
        <div>
          <div class="type-pill">${folder ? '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> Ordner' : 'Zusammenstellung'}</div>
          <div class="oh-title">Auftrag ${escapeHtml(o.no)}</div>
          <div class="muted">${escapeHtml([o.vessel, o.customer].filter(Boolean).join(' · ') || 'ohne Kunde')}</div>
          ${workers ? `<div class="muted small-text">Monteur: ${escapeHtml(workers)}</div>` : ''}
        </div>
        <div class="oh-range"><b>${o.items.length}</b> Tag${o.items.length > 1 ? 'e' : ''}<small>${escapeHtml(o.range)}</small></div>
      </div>
      ${folder
        ? `<div class="folder-actions">
             <button class="btn btn-soft tech-only" onclick="newSheetInFolder(${noJs})"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Neuer Zettel im Ordner</button>
             <button class="link-btn" onclick="dissolveFolder(${noJs})">Ordner auflösen</button>
           </div>
           <p class="muted small-text">Alle Zettel mit Auftragsnummer ${escapeHtml(o.no)} – auch neue – liegen in diesem Ordner.</p>`
        : `<div class="folder-actions">
             <button class="btn btn-primary" onclick="createFolder(${noJs})"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> In Ordner ablegen</button>
           </div>
           <p class="muted small-text">Legt einen Ordner „${escapeHtml(o.no)}“ an. Die Zettel verschwinden dann aus der Liste und liegen im Ordner – neue Zettel mit dieser Auftragsnummer kommen automatisch dazu.</p>`}
    </div>

    <div class="sum-bar">
      <div class="sum-item"><span class="muted">Normalstunden</span><strong>${formatHours(o.totals.normal)}</strong></div>
      <div class="sum-item sum-ot"><span class="muted">Überstunden</span><strong>${formatHours(o.totals.ot)}</strong></div>
      <div class="sum-item sum-all"><span class="muted">Gesamt</span><strong>${formatHours(o.totals.worked)}</strong></div>
    </div>

    <div class="card flush">
      <div class="h-week-head"><span>Tage (antippen zum Bearbeiten)</span><span>Normal · Überst.</span></div>
      ${rows}
    </div>

    <div class="card">
      <h3 class="card-title">Auslöse &amp; Fahrten</h3>
      ${allow.length ? `<div class="allow-list">${allow.map(t => `<span class="code-chip">${escapeHtml(t)}</span>`).join('')}</div>` : '<p class="muted small-text">Keine Abwesenheit oder Hotel eingetragen.</p>'}
      ${o.travels.length ? `<div class="menu-rows o-travels">${o.travels.map(t => `
        <div class="menu-row"><span><b>${escapeHtml(t.label)}</b><small>${escapeHtml(formatDateShort(t.date))} · ${escapeHtml([t.t.from, t.t.to].filter(Boolean).join(' → ') || '–')}</small></span>
        <span class="mr-right"><b>${parseDuration(t.t.duration) != null ? formatHours(parseDuration(t.t.duration)) : '–'}</b><small>${escapeHtml(t.t.km ? t.t.km + ' km' : '')}</small></span></div>`).join('')}</div>
        ${o.km ? `<p class="muted small-text">Gesamt ${o.km.toLocaleString('de-DE')} km</p>` : ''}` : '<p class="muted small-text">Keine Fahrten eingetragen.</p>'}
    </div>

    <div class="card">
      <h3 class="card-title">Unterschriften für den gesamten Auftrag</h3>
      ${changedAfterSign ? `<p class="warn-text">Achtung: Einzelne Zettel wurden nach der Kunden-Unterschrift geändert.</p>` : ''}
      <div class="sign-grid">
        ${signatureBox('Monteur', rec.signWorker, 'orderWorker')}
        ${signatureBox('Kunde / Auftraggeber', rec.signCustomer, 'orderCustomer')}
      </div>
      <p class="muted small-text">Optional – z.B. wenn der Kunde am Ende den ganzen Auftrag auf einmal unterschreibt.</p>
    </div>

    <div class="editor-footer">
      <button type="button" class="btn btn-ghost" onclick="showView('sheets')">Schließen</button>
      <button type="button" class="btn btn-primary" onclick="printActiveOrder()">
        <svg viewBox="0 0 24 24"><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg> Drucken / PDF</button>
    </div>`;
}

// ---------- Gemeinsamer Ausdruck ----------
function buildOrderPrintHtml(no) {
  const o = orderData(no);
  const rec = orderRecord(o.no, false) || {};
  const allow = allowanceText(o.allowance);
  return buildPrintDoc({
    title: 'Montagezettel – Auftrag ' + o.no,
    subtitle: o.range + ' · ' + o.items.length + ' Tag' + (o.items.length > 1 ? 'e' : ''),
    isMontage: true,
    orderNo: o.no, customer: o.customer, vessel: o.vessel,
    engines: o.engines,
    items: o.items.map(i => ({ sheet: i.sheet, di: i.di })),
    travels: o.travels,
    material: o.material,
    materialNotes: o.materialNotes,
    finished: o.finished,
    notes: o.notes,
    signWorker: rec.signWorker,
    signCustomer: rec.signCustomer,
    summary: allow.length ? `<table class="pr-info"><tr><th>Auslöse</th><td>${escapeHtml(allow.join('   ·   '))}</td></tr></table>` : ''
  });
}

function printActiveOrder() {
  if (!activeOrderNo) return;
  const o = orderData(activeOrderNo);
  printHtml(buildOrderPrintHtml(activeOrderNo), ['Montagezettel', 'Auftrag', o.no, o.vessel || o.customer].filter(Boolean).join('_'));
}

window.openComposeModal = openComposeModal;
window.createFolder = createFolder;
window.dissolveFolder = dissolveFolder;
window.newSheetInFolder = newSheetInFolder;
window.composeFromInput = composeFromInput;
window.openOrder = openOrder;
window.renderOrder = renderOrder;
window.printActiveOrder = printActiveOrder;
