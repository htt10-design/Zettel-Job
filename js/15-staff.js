// =====================================================================
// 15-staff: Monteur-Akte (nur Büro)
// - Stammdaten je Monteur in appData.technicians: name, phone, startDate
//   (Eintritt), startBalance (Übertrag in Std.), targets (Soll je Wochentag)
// - Überstundenkonto ab Eintritt aus den Zetteln des Monteurs
// - Stunden eines Tages ändern / Überstunden streichen / Tag streichen und
//   Buchungen (Auszahlung, Gutschrift …) als Korrektur-Einträge in
//   appData.daysOff { type:'korrektur', worker, hours, note, by:'office', kind }
//   → der Monteur sieht sie in seinen Stunden, nichts an seinen Zetteln wird verändert.
// =====================================================================

let activeStaffId = null;
let staffMonth = null; // "YYYY-MM"

const BOOKING_KINDS = {
  auszahlung: { label: 'Auszahlung', sign: -1 },
  gutschrift: { label: 'Gutschrift', sign: 1 },
  abzug: { label: 'Abzug', sign: -1 }
};

function getStaff() {
  return appData.technicians.find(t => t.id === activeStaffId) || null;
}

function staffTargets(t) {
  return Array.isArray(t.targets) && t.targets.length === 7 ? t.targets : appData.settings.targets;
}

// Gehört der Eintrag (Zettel/Abwesenheit) zu diesem Monteur?
function belongsTo(workerField, name) {
  return workerField ? sameName(workerField, name) : sameName(appData.settings.name, name);
}

// Tagesübersicht für einen beliebigen Monteur (gleiche Regeln wie dayInfo)
function staffDayInfo(t, iso) {
  const sheets = appData.sheets.filter(s => belongsTo(s.worker, t.name) && s.days.some(d => d.date === iso));
  let worked = 0;
  sheets.forEach(s => s.days.forEach((d, di) => { if (d.date === iso) worked += daySplit(s, di).worked; }));
  const offs = appData.daysOff.filter(o => o.date === iso && belongsTo(o.worker, t.name));
  const wd = parseISODate(iso).getDay();
  let target = Math.round((Number(staffTargets(t)[wd]) || 0) * 60);
  let correction = 0, counted = worked > 0;
  offs.forEach(o => {
    if (o.type === 'abbau') counted = true;
    else if (o.type === 'korrektur') correction += Math.round((Number(o.hours) || 0) * 60);
    else target = 0;
  });
  const delta = (counted ? worked - target : 0) + correction;
  return { iso, worked, target: counted ? target : 0, delta, correction, sheets, offs };
}

function staffDates(t) {
  const set = new Set();
  appData.sheets.forEach(s => { if (belongsTo(s.worker, t.name)) s.days.forEach(d => d.date && set.add(d.date)); });
  appData.daysOff.forEach(o => { if (o.date && belongsTo(o.worker, t.name)) set.add(o.date); });
  return Array.from(set).sort().filter(iso => !t.startDate || iso >= t.startDate);
}

function staffBalance(t) {
  return Math.round((Number(t.startBalance) || 0) * 60) + staffDates(t).reduce((sum, iso) => sum + staffDayInfo(t, iso).delta, 0);
}

// Vom Büro festgelegte Werte auf den angemeldeten Monteur übertragen
function applyStaffToSettings(t) {
  if (!t) return;
  if (sameName(appData.settings.name, t.name)) {
    if (t.startBalance !== undefined && t.startBalance !== null && t.startBalance !== '') appData.settings.startBalance = Number(t.startBalance) || 0;
    if (Array.isArray(t.targets)) appData.settings.targets = t.targets.slice();
  }
  const key = t.name.trim().toLowerCase();
  const p = appData.profiles[key] || (appData.profiles[key] = {});
  if (t.startBalance !== undefined && t.startBalance !== '') p.startBalance = Number(t.startBalance) || 0;
  if (Array.isArray(t.targets)) p.targets = t.targets.slice();
}

// Vom Büro verwalteter Datensatz des angemeldeten Monteurs (oder null)
function currentStaffRecord() {
  return appData.technicians.find(t => sameName(t.name, appData.settings.name)) || null;
}

// ---------- Ansicht ----------
function openStaff(id) {
  activeStaffId = id;
  staffMonth = todayISO().slice(0, 7);
  showView('staff');
}

function staffShiftMonth(n) {
  const [y, m] = staffMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  staffMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  renderStaff();
}

function renderStaff() {
  const t = getStaff();
  if (!t) { showView('settings'); return; }
  setTopbarTitle(t.name);
  const bal = staffBalance(t);
  const targets = staffTargets(t);
  const wdOrder = [1, 2, 3, 4, 5, 6, 0];
  const [y, m] = staffMonth.split('-').map(Number);
  const dates = staffDates(t).filter(iso => iso.startsWith(staffMonth));
  let mWorked = 0, mDelta = 0;
  const rows = dates.map(iso => {
    const i = staffDayInfo(t, iso);
    mWorked += i.worked; mDelta += i.delta;
    const d = parseISODate(iso);
    const labels = i.sheets.map(s => `<span class="src">${escapeHtml(s.type === 'werkstatt' ? 'Werkstatt' : (s.vessel || s.orderNo || 'Montage'))}</span>`)
      .concat(i.offs.map(o => `<span class="src off off-${o.type}">${escapeHtml(o.type === 'korrektur' ? (o.by === 'office' ? 'Büro ' : '') + formatHours(Math.round((Number(o.hours) || 0) * 60), true) : (OFF_TYPES[o.type] || {}).short || o.type)}</span>`)).join('');
    return `
      <button class="h-day ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}" onclick="openStaffDay('${iso}')">
        <span class="h-date"><b>${WEEKDAYS_SHORT[d.getDay()]}</b> ${formatDateShort(iso)}</span>
        <span class="h-src">${labels}</span>
        <span class="h-worked">${i.worked ? formatHours(i.worked) : '–'}</span>
        <span class="h-delta ${i.delta > 0 ? 'pos' : i.delta < 0 ? 'neg' : ''}">${i.delta ? formatHours(i.delta, true) : '±0'}</span>
      </button>`;
  }).join('');

  const bookings = appData.daysOff.filter(o => o.type === 'korrektur' && belongsTo(o.worker, t.name))
    .sort((a, b) => b.date.localeCompare(a.date));

  document.getElementById('staff-body').innerHTML = `
    <div class="card staff-head">
      <span class="avatar big">${escapeHtml(initials(t.name))}</span>
      <div class="staff-id">
        <b>${escapeHtml(t.name)}</b>
        <span class="muted small-text">${t.startDate ? 'seit ' + formatDate(t.startDate, false) : 'Eintritt nicht eingetragen'}${t.phone ? ' · ' + escapeHtml(t.phone) : ''}</span>
      </div>
      ${t.phone ? `<a class="btn btn-soft" href="tel:${escapeHtml(t.phone.replace(/[^\d+]/g, ''))}">Anrufen</a>` : ''}
    </div>

    <div class="balance-card">
      <div class="bc-label">Überstundenkonto ${t.startDate ? 'seit ' + formatDateShort(t.startDate) : 'gesamt'}</div>
      <div class="bc-value ${bal < 0 ? 'neg' : ''}">${formatHours(bal, true)}</div>
      <div class="bc-sub">inkl. Übertrag ${formatHours(Math.round((Number(t.startBalance) || 0) * 60), true)} · Soll Mo–Do ${targets[1]} h, Fr ${targets[5]} h</div>
      <button class="btn btn-white" onclick="openBooking()">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Buchung (Auszahlung, Gutschrift …)
      </button>
    </div>

    <div class="month-nav">
      <button class="icon-btn" onclick="staffShiftMonth(-1)" aria-label="Vorheriger Monat"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <strong>${MONTHS[m - 1]} ${y}</strong>
      <button class="icon-btn" onclick="staffShiftMonth(1)" aria-label="Nächster Monat"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    <div class="card flush">
      <div class="h-week-head"><span>Tag antippen zum Ändern</span><span>${formatHours(mWorked)} · <b class="${mDelta > 0 ? 'pos' : mDelta < 0 ? 'neg' : ''}">${formatHours(mDelta, true)}</b></span></div>
      ${rows || '<div class="empty small"><p>In diesem Monat nichts erfasst.</p></div>'}
    </div>

    <div class="card">
      <h3 class="card-title">Buchungen &amp; Korrekturen</h3>
      ${bookings.length ? `<div class="menu-rows">${bookings.map(o => `
        <div class="menu-row">
          <span><b>${formatHours(Math.round((Number(o.hours) || 0) * 60), true)} · ${escapeHtml(o.kind && BOOKING_KINDS[o.kind] ? BOOKING_KINDS[o.kind].label : (o.by === 'office' ? 'Korrektur Büro' : 'Korrektur'))}</b>
            <small>${formatDate(o.date)}${o.note ? ' · ' + escapeHtml(o.note) : ''}</small></span>
          <button class="link-btn danger" onclick="removeBooking('${o.id}')">Entfernen</button>
        </div>`).join('')}</div>` : '<p class="muted small-text">Keine Buchungen.</p>'}
    </div>

    <div class="card">
      <h3 class="card-title">Stammdaten</h3>
      <div class="grid-2">
        <label class="field"><span>Name</span><input type="text" value="${escapeHtml(t.name)}" onchange="updateTechnician('${t.id}', 'name', this.value); renderStaff()"></label>
        <label class="field"><span>Telefon</span><input type="tel" value="${escapeHtml(t.phone || '')}" onchange="setStaffField('phone', this.value)" placeholder="optional"></label>
        <label class="field"><span>Eintritt (angefangen am)</span><input type="date" value="${escapeHtml(t.startDate || '')}" onchange="setStaffField('startDate', this.value)"></label>
        <label class="field"><span>Übertrag Überstunden beim Start (Std.)</span><input type="text" inputmode="decimal" value="${String(t.startBalance ?? '').replace('.', ',')}" onchange="setStaffField('startBalance', this.value)" placeholder="0"></label>
      </div>
      <p class="muted small-text">Sollstunden je Wochentag</p>
      <div class="target-grid">
        ${wdOrder.map(i => `
          <label class="field"><span>${WEEKDAYS_SHORT[i]}</span>
            <input type="text" inputmode="decimal" value="${String(targets[i]).replace('.', ',')}" onchange="setStaffTarget(${i}, this.value)">
          </label>`).join('')}
      </div>
      <p class="muted small-text">Tage vor dem Eintritt zählen nicht zum Überstundenkonto. Diese Werte gelten auch in der App des Monteurs.</p>
    </div>`;
}

function setStaffField(key, value) {
  const t = getStaff();
  if (key === 'startBalance') {
    const n = parseFloat(String(value).replace(',', '.'));
    t.startBalance = isNaN(n) ? 0 : n;
  } else t[key] = String(value).trim();
  applyStaffToSettings(t);
  saveData(true);
  renderStaff();
}

function setStaffTarget(i, value) {
  const t = getStaff();
  const targets = staffTargets(t).slice();
  const n = parseFloat(String(value).replace(',', '.'));
  targets[i] = isNaN(n) ? 0 : Math.max(0, Math.min(24, n));
  t.targets = targets;
  applyStaffToSettings(t);
  saveData(true);
  renderStaff();
}

// ---------- Tag ändern ----------
function openStaffDay(iso) {
  const t = getStaff();
  const i = staffDayInfo(t, iso);
  const d = parseISODate(iso);
  const dayCorr = i.offs.filter(o => o.type === 'korrektur' && o.by === 'office' && o.kind === 'tag');
  const otherCorr = i.correction - dayCorr.reduce((s, o) => s + Math.round((Number(o.hours) || 0) * 60), 0);
  // aktuell gültige Stunden = geschrieben + Tageskorrektur des Büros
  const valid = i.worked + dayCorr.reduce((s, o) => s + Math.round((Number(o.hours) || 0) * 60), 0);
  const fmt = min => (min / 60).toLocaleString('de-DE', { maximumFractionDigits: 2 });
  openModal(`
    <h2 class="modal-title">${escapeHtml(t.name)} · ${WEEKDAYS_SHORT[d.getDay()]} ${formatDate(iso, false)}</h2>
    <div class="detail-sums">
      <div><span>Geschrieben</span><b>${formatHours(i.worked)}</b></div>
      <div><span>Soll</span><b>${formatHours(i.target || Math.round((Number(staffTargets(t)[d.getDay()]) || 0) * 60))}</b></div>
      <div><span>Überstunden</span><b class="${i.delta > 0 ? 'pos' : i.delta < 0 ? 'neg' : ''}">${formatHours(i.delta, true)}</b></div>
    </div>
    ${i.sheets.length ? `<h4 class="modal-sub">Zettel</h4><div class="menu-rows">${i.sheets.map(s => `
      <button class="menu-row" onclick="closeModal();openEditor('${s.id}','staff')"><span><b>${escapeHtml(s.type === 'werkstatt' ? 'Werkstatt' : (s.vessel || s.customer || 'Montage'))}</b><small>${escapeHtml(s.orderNo || '')}</small></span><span>${formatHours(sheetTotals(s).worked)}</span></button>`).join('')}</div>` : ''}
    <h4 class="modal-sub">Gültige Stunden für diesen Tag</h4>
    <div class="staff-edit">
      <input type="text" id="staff-valid" inputmode="decimal" value="${fmt(valid)}">
      <span class="muted">h</span>
    </div>
    <div class="todo-chips staff-quick">
      <button class="chip mini" onclick="document.getElementById('staff-valid').value='${fmt(Math.min(i.worked, Math.round((Number(staffTargets(t)[d.getDay()]) || 0) * 60)))}'">Überstunden streichen</button>
      <button class="chip mini" onclick="document.getElementById('staff-valid').value='0'">Tag streichen</button>
      <button class="chip mini" onclick="document.getElementById('staff-valid').value='${fmt(i.worked)}'">wie geschrieben</button>
    </div>
    <label class="field"><span>Grund</span><input type="text" id="staff-note" value="${escapeHtml(dayCorr[0] ? dayCorr[0].note || '' : '')}" placeholder="z.B. Pause nicht eingetragen, Fahrzeit zu lang …"></label>
    ${otherCorr ? `<p class="muted small-text">Weitere Buchungen an diesem Tag: ${formatHours(otherCorr, true)}</p>` : ''}
    <p class="muted small-text">Der Zettel des Monteurs bleibt unverändert – die Änderung wird als Korrektur gebucht und ist für ihn sichtbar.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="saveStaffDay('${iso}')">Speichern</button>
    </div>`);
}

function saveStaffDay(iso) {
  const t = getStaff();
  const i = staffDayInfo(t, iso);
  const v = parseFloat(String(document.getElementById('staff-valid').value).replace(',', '.'));
  if (isNaN(v) || v < 0) { showToast('Bitte gültige Stunden eingeben'); return; }
  const note = document.getElementById('staff-note').value.trim();
  // bisherige Tageskorrektur des Büros ersetzen
  appData.daysOff = appData.daysOff.filter(o => !(o.date === iso && o.type === 'korrektur' && o.by === 'office' && o.kind === 'tag' && belongsTo(o.worker, t.name)));
  const diff = Math.round(v * 60) - i.worked;
  if (diff) appData.daysOff.push({ id: uid(), date: iso, type: 'korrektur', hours: Math.round(diff / 60 * 100) / 100, note: note || 'Stunden geändert', worker: t.name, by: 'office', kind: 'tag' });
  saveData(true);
  closeModal();
  renderStaff();
  showToast(diff ? `Gebucht: ${formatHours(diff, true)}` : 'Wie geschrieben – keine Korrektur');
}

// ---------- Buchungen ----------
function openBooking() {
  const t = getStaff();
  openModal(`
    <h2 class="modal-title">Buchung · ${escapeHtml(t.name)}</h2>
    <label class="field"><span>Art</span>
      <select id="bk-kind">${Object.keys(BOOKING_KINDS).map(k => `<option value="${k}">${BOOKING_KINDS[k].label}</option>`).join('')}</select>
    </label>
    <div class="grid-2">
      <label class="field"><span>Stunden</span><input type="text" id="bk-hours" inputmode="decimal" placeholder="z.B. 20"></label>
      <label class="field"><span>Datum</span><input type="date" id="bk-date" value="${todayISO()}"></label>
    </div>
    <label class="field"><span>Grund / Notiz</span><input type="text" id="bk-note" placeholder="z.B. Auszahlung mit Novemberlohn"></label>
    <p class="muted small-text">Auszahlung und Abzug verringern das Konto, Gutschrift erhöht es.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="saveBooking()">Buchen</button>
    </div>`);
}

function saveBooking() {
  const t = getStaff();
  const kind = document.getElementById('bk-kind').value;
  const h = Math.abs(parseFloat(String(document.getElementById('bk-hours').value).replace(',', '.')));
  const date = document.getElementById('bk-date').value || todayISO();
  if (!h) { showToast('Bitte Stunden eingeben'); return; }
  appData.daysOff.push({ id: uid(), date, type: 'korrektur', hours: h * BOOKING_KINDS[kind].sign, note: document.getElementById('bk-note').value.trim(), worker: t.name, by: 'office', kind });
  saveData(true);
  closeModal();
  renderStaff();
  showToast(`${BOOKING_KINDS[kind].label} gebucht`);
}

async function removeBooking(id) {
  const o = appData.daysOff.find(x => x.id === id);
  if (!o || !(await confirmDialog(`Buchung ${formatHours(Math.round((Number(o.hours) || 0) * 60), true)} vom ${formatDate(o.date)} entfernen?`, 'Entfernen', true))) return;
  appData.daysOff = appData.daysOff.filter(x => x.id !== id);
  saveData(true);
  renderStaff();
}

window.openStaff = openStaff;
window.staffShiftMonth = staffShiftMonth;
window.renderStaff = renderStaff;
window.setStaffField = setStaffField;
window.setStaffTarget = setStaffTarget;
window.openStaffDay = openStaffDay;
window.saveStaffDay = saveStaffDay;
window.openBooking = openBooking;
window.saveBooking = saveBooking;
window.removeBooking = removeBooking;
