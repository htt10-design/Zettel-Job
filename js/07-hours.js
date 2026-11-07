// =====================================================================
// 07-hours: Persönliche Stundenübersicht, Überstundenkonto,
// freie Tage / Abwesenheiten / Korrekturen
// =====================================================================

const OFF_TYPES = {
  abbau: { label: 'Freier Tag (Überstundenabbau)', short: 'Freier Tag' },
  urlaub: { label: 'Urlaub', short: 'Urlaub' },
  krank: { label: 'Krank', short: 'Krank' },
  feiertag: { label: 'Feiertag', short: 'Feiertag' },
  korrektur: { label: 'Korrektur (z.B. Auszahlung)', short: 'Korrektur' }
};

let hoursMonth = null; // "YYYY-MM"

function shiftHoursMonth(n) {
  const [y, m] = hoursMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  hoursMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  renderHours();
}

function sheetShortName(sh) {
  if (sh.type === 'werkstatt') return 'Werkstatt';
  return sh.vessel || sh.customer || (sh.orderNo ? 'Auftrag ' + sh.orderNo : 'Montage');
}

function monthStats(prefix) {
  let worked = 0, target = 0, delta = 0, workDays = 0, offDays = 0;
  allRelevantDates().forEach(iso => {
    if (!iso.startsWith(prefix)) return;
    const i = dayInfo(iso);
    worked += i.worked; target += i.target; delta += i.delta;
    if (i.worked > 0) workDays++;
    if (i.offs.some(o => o.type !== 'korrektur')) offDays++;
  });
  return { worked, target, delta, workDays, offDays };
}

function renderHours() {
  if (!hoursMonth) hoursMonth = todayISO().slice(0, 7);
  const [y, m] = hoursMonth.split('-').map(Number);
  const balance = overtimeBalance();
  const st = monthStats(hoursMonth);
  const dates = allRelevantDates().filter(d => d.startsWith(hoursMonth));

  // Tage nach Kalenderwoche gruppieren
  const weeks = [];
  dates.forEach(iso => {
    const info = dayInfo(iso);
    if (!info.worked && !info.offs.length) return; // nur leere Zettel-Tage
    const kw = isoWeek(iso);
    let w = weeks[weeks.length - 1];
    if (!w || w.kw !== kw) { w = { kw, days: [] }; weeks.push(w); }
    w.days.push(info);
  });

  const dayRow = info => {
    const d = parseISODate(info.date);
    const labels = info.sources.map(s => `<span class="src">${escapeHtml(sheetShortName(s.sheet))}</span>`)
      .concat(info.offs.map(o => `<span class="src off off-${o.type}">${escapeHtml(OFF_TYPES[o.type] ? OFF_TYPES[o.type].short : o.type)}${o.type === 'korrektur' ? ' ' + formatHours(Math.round((Number(o.hours) || 0) * 60), true) : ''}</span>`))
      .join('');
    return `
      <button class="h-day ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}" onclick="openDayDetails('${info.date}')">
        <span class="h-date"><b>${WEEKDAYS_SHORT[d.getDay()]}</b> ${formatDateShort(info.date)}</span>
        <span class="h-src">${labels}</span>
        <span class="h-worked">${info.worked ? formatHours(info.worked) : '–'}</span>
        <span class="h-delta ${info.delta > 0 ? 'pos' : info.delta < 0 ? 'neg' : ''}">${info.delta ? formatHours(info.delta, true) : '±0'}</span>
      </button>`;
  };

  const weekHtml = weeks.length ? weeks.map(w => {
    const worked = w.days.reduce((s, i) => s + i.worked, 0);
    const delta = w.days.reduce((s, i) => s + i.delta, 0);
    return `
      <div class="h-week">
        <div class="h-week-head"><span>KW ${w.kw}</span><span>${formatHours(worked)} · <b class="${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${formatHours(delta, true)}</b></span></div>
        ${w.days.map(dayRow).join('')}
      </div>`;
  }).join('') : `<div class="empty small"><p>In diesem Monat ist noch nichts erfasst.</p></div>`;

  // Jahresübersicht
  const yearRows = MONTHS.map((name, idx) => {
    const prefix = y + '-' + String(idx + 1).padStart(2, '0');
    const s = monthStats(prefix);
    return { name, prefix, ...s };
  });
  const maxWorked = Math.max(1, ...yearRows.map(r => r.worked));
  const yearTotal = yearRows.reduce((a, r) => ({ worked: a.worked + r.worked, delta: a.delta + r.delta }), { worked: 0, delta: 0 });

  document.getElementById('hours-body').innerHTML = `
    <div class="balance-card">
      <div class="bc-label">Überstundenkonto gesamt</div>
      <div class="bc-value ${balance < 0 ? 'neg' : ''}">${formatHours(balance, true)}</div>
      <div class="bc-sub">inkl. Übertrag ${formatHours(Math.round((Number(appData.settings.startBalance) || 0) * 60), true)} · Soll Mo–Do ${appData.settings.targets[1]} h, Fr ${appData.settings.targets[5]} h</div>
      <button class="btn btn-white" onclick="openDayOffModal()">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Freien Tag / Abwesenheit eintragen
      </button>
    </div>

    <div class="month-nav">
      <button class="icon-btn" onclick="shiftHoursMonth(-1)" aria-label="Vorheriger Monat"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <strong>${MONTHS[m - 1]} ${y}</strong>
      <button class="icon-btn" onclick="shiftHoursMonth(1)" aria-label="Nächster Monat"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>

    <div class="stat-grid">
      <div class="stat"><span>Gearbeitet</span><strong>${formatHours(st.worked)}</strong></div>
      <div class="stat"><span>Soll</span><strong>${formatHours(st.target)}</strong></div>
      <div class="stat"><span>Überstunden</span><strong class="${st.delta > 0 ? 'pos' : st.delta < 0 ? 'neg' : ''}">${formatHours(st.delta, true)}</strong></div>
      <div class="stat"><span>Arbeitstage</span><strong>${st.workDays}${st.offDays ? ` <small>+ ${st.offDays} frei</small>` : ''}</strong></div>
    </div>

    <div class="card flush">${weekHtml}</div>

    <div class="section-head"><h3>Jahr ${y}</h3><span class="muted small-text">${formatHours(yearTotal.worked)} · ${formatHours(yearTotal.delta, true)}</span></div>
    <div class="card year-card">
      ${yearRows.map(r => `
        <button class="yr-row ${r.prefix === hoursMonth ? 'current' : ''}" onclick="hoursMonth='${r.prefix}';renderHours()">
          <span class="yr-name">${r.name.slice(0, 3)}</span>
          <span class="yr-bar"><i style="width:${Math.round(r.worked / maxWorked * 100)}%"></i></span>
          <span class="yr-val">${r.worked ? formatHours(r.worked) : '–'}</span>
          <span class="yr-delta ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''}">${r.delta ? formatHours(r.delta, true) : ''}</span>
        </button>`).join('')}
    </div>`;
}

// ---------- Tagesdetails ----------
function openDayDetails(iso) {
  const info = dayInfo(iso);
  const sheetsHtml = info.sources.map(s => `
    <button class="menu-row" onclick="closeModal();openEditor('${s.sheet.id}')">
      <span><b>${escapeHtml(sheetShortName(s.sheet))}</b>${s.sheet.orderNo ? `<small>Auftrag ${escapeHtml(s.sheet.orderNo)}</small>` : ''}</span>
      <span>${formatHours(s.minutes)}</span>
    </button>`).join('');
  const offsHtml = info.offs.map(o => `
    <div class="menu-row">
      <span><b>${escapeHtml(OFF_TYPES[o.type] ? OFF_TYPES[o.type].label : o.type)}</b>${o.type === 'korrektur' ? `<small>${formatHours(Math.round((Number(o.hours) || 0) * 60), true)}</small>` : ''}${o.note ? `<small>${escapeHtml(o.note)}</small>` : ''}</span>
      <button class="link-btn danger" onclick="deleteDayOff('${o.id}')">Entfernen</button>
    </div>`).join('');
  openModal(`
    <h2 class="modal-title">${escapeHtml(WEEKDAYS_LONG[parseISODate(iso).getDay()])}, ${formatDate(iso, false)}</h2>
    <div class="detail-sums">
      <div><span>Gearbeitet</span><b>${formatHours(info.worked)}</b></div>
      <div><span>Soll</span><b>${formatHours(info.target)}</b></div>
      <div><span>Überstunden</span><b class="${info.delta > 0 ? 'pos' : info.delta < 0 ? 'neg' : ''}">${formatHours(info.delta, true)}</b></div>
    </div>
    ${sheetsHtml ? `<h4 class="modal-sub">Zettel</h4><div class="menu-rows">${sheetsHtml}</div>` : ''}
    ${offsHtml ? `<h4 class="modal-sub">Abwesenheit</h4><div class="menu-rows">${offsHtml}</div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="openDayOffModal('${iso}')">+ Abwesenheit</button>
      <button class="btn btn-primary" onclick="closeModal()">Schließen</button>
    </div>`);
}

// ---------- Freie Tage eintragen ----------
function openDayOffModal(date) {
  const d = date || todayISO();
  openModal(`
    <h2 class="modal-title">Freien Tag / Abwesenheit</h2>
    <label class="field"><span>Art</span>
      <select id="off-type" onchange="updateDayOffForm()">
        ${Object.keys(OFF_TYPES).map(k => `<option value="${k}">${escapeHtml(OFF_TYPES[k].label)}</option>`).join('')}
      </select>
    </label>
    <div class="grid-2">
      <label class="field"><span>Von</span><input type="date" id="off-from" value="${d}"></label>
      <label class="field" id="off-to-wrap"><span>Bis</span><input type="date" id="off-to" value="${d}"></label>
    </div>
    <label class="field" id="off-hours-wrap" hidden><span>Stunden (+ / −)</span><input type="text" id="off-hours" inputmode="decimal" placeholder="z.B. -20 bei Auszahlung"></label>
    <label class="field"><span>Notiz</span><input type="text" id="off-note" placeholder="Optional"></label>
    <p class="muted small-text" id="off-hint"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="saveDayOff()">Speichern</button>
    </div>`);
  updateDayOffForm();
}

function updateDayOffForm() {
  const type = document.getElementById('off-type').value;
  const isKorr = type === 'korrektur';
  document.getElementById('off-hours-wrap').hidden = !isKorr;
  document.getElementById('off-to-wrap').hidden = isKorr;
  const hints = {
    abbau: 'Die Sollzeit des Tages wird vom Überstundenkonto abgezogen. Wochenenden werden übersprungen.',
    urlaub: 'Urlaub verändert das Überstundenkonto nicht. Wochenenden werden übersprungen.',
    krank: 'Krankheit verändert das Überstundenkonto nicht. Wochenenden werden übersprungen.',
    feiertag: 'An Feiertagen ist das Soll 0 – gearbeitete Zeit zählt komplett als Überstunden.',
    korrektur: 'Fester Wert, z.B. −20 für ausgezahlte Überstunden oder +3 als Nachtrag.'
  };
  document.getElementById('off-hint').textContent = hints[type];
}

function saveDayOff() {
  const type = document.getElementById('off-type').value;
  const from = document.getElementById('off-from').value;
  const to = type === 'korrektur' ? from : (document.getElementById('off-to').value || from);
  const note = document.getElementById('off-note').value.trim();
  if (!from) { showToast('Bitte Datum wählen'); return; }
  if (to < from) { showToast('„Bis“ liegt vor „Von“'); return; }
  let hours = null;
  if (type === 'korrektur') {
    hours = parseFloat(String(document.getElementById('off-hours').value).replace(',', '.'));
    if (isNaN(hours) || !hours) { showToast('Bitte Stunden angeben'); return; }
  }
  let count = 0;
  for (let iso = from; iso <= to; iso = addDaysISO(iso, 1)) {
    // Bei Zeiträumen Tage ohne Soll (Wochenende) überspringen
    if (from !== to && baseTargetMinutes(iso) === 0 && type !== 'feiertag') continue;
    // gleiche Art am selben Tag nicht doppelt
    if (type !== 'korrektur' && appData.daysOff.some(o => o.date === iso && o.type === type)) continue;
    appData.daysOff.push({ id: uid(), date: iso, type, note, hours, worker: appData.settings.name || '' });
    count++;
    if (count > 366) break;
  }
  saveData(true);
  closeModal();
  hoursMonth = from.slice(0, 7);
  if (currentView === 'hours') renderHours(); else showView('hours');
  showToast(count === 1 ? 'Eingetragen' : `${count} Tage eingetragen`);
}

async function deleteDayOff(id) {
  const o = appData.daysOff.find(x => x.id === id);
  if (!o) return;
  closeModal();
  if (!(await confirmDialog(`${OFF_TYPES[o.type] ? OFF_TYPES[o.type].label : o.type} am ${formatDate(o.date)} entfernen?`, 'Entfernen', true))) return;
  appData.daysOff = appData.daysOff.filter(x => x.id !== id);
  saveData(true);
  renderHours();
}

window.renderHours = renderHours;
window.shiftHoursMonth = shiftHoursMonth;
window.openDayDetails = openDayDetails;
window.openDayOffModal = openDayOffModal;
window.updateDayOffForm = updateDayOffForm;
window.saveDayOff = saveDayOff;
window.deleteDayOff = deleteDayOff;
