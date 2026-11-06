// =====================================================================
// 11-home: Startseite für Techniker
//   1. Wochenleiste (Stunden + Status je Tag, ‹ › blättern, Tag antippen)
//   2. Gewählter Tag (Standard heute): Zettel des Tages, „+ Zettel für
//      diesen Tag“, Abwesenheit
//   3. Zu erledigen: fehlende Zettel, fehlende Kundenunterschriften,
//      zugeteilte Aufträge
//   4. Woche: Fortschritt Ist/Soll + Überstundenkonto
//   5. „Alle Zettel & Suche“ (bisherige Liste) zum Aufklappen
// =====================================================================

let homeWeekStart = null;   // Montag der angezeigten Woche
let homeSelected = null;    // gewählter Tag (ISO)
let homeShowList = false;   // bisherige Liste aufgeklappt?
let newSheetDate = null;    // Datum für den nächsten neu angelegten Zettel (sonst heute)

const MISSING_LOOKBACK_DAYS = 14;

// Datum für den nächsten Zettel abholen (und zurücksetzen)
function takeNewSheetDate() {
  const d = newSheetDate;
  newSheetDate = null;
  return d || todayISO();
}

function homeSelectedISO() {
  return homeSelected || todayISO();
}

// Eigene Zettel eines Tages
function ownSheetsOn(iso) {
  return appData.sheets.filter(s => isOwnSheet(s) && s.days.some(d => d.date === iso));
}

// Status eines Tages für die Wochenleiste
// ok = Zettel mit Zeiten · draft = Zettel ohne Zeiten · off = frei/Urlaub/krank/Feiertag
// missing = Arbeitstag in der Vergangenheit ohne Zettel · '' = nichts
function dayStatus(iso) {
  const sheets = ownSheetsOn(iso);
  const offs = daysOffFor(iso).filter(o => o.type !== 'korrektur');
  const worked = dayInfo(iso).worked;
  if (worked > 0) return 'ok';
  if (sheets.length) return 'draft';
  if (offs.length) return 'off';
  if (baseTargetMinutes(iso) > 0 && iso < todayISO()) return 'missing';
  return '';
}

const STATUS_MARK = { ok: '✓', draft: '…', off: '–', missing: '!' };

function homeShiftWeek(n) {
  homeWeekStart = addDaysISO(homeWeekStart || weekStartISO(todayISO()), n * 7);
  const today = todayISO();
  // in der aktuellen Woche heute wählen, sonst den Montag
  homeSelected = weekStartISO(today) === homeWeekStart ? today : homeWeekStart;
  renderTechHome();
}

function homeSelectDay(iso) {
  homeSelected = iso;
  homeWeekStart = weekStartISO(iso);
  renderTechHome();
}

function homeToggleList() {
  homeShowList = !homeShowList;
  if (homeShowList) sheetRange = 'all';
  renderSheetList();
  if (homeShowList) {
    const t = document.getElementById('sheet-browser');
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Neuer Zettel für einen bestimmten Tag
function newSheetForDay(iso) {
  openNewSheetModal(iso);
}

// Zugeteilten Auftrag für den gewählten Tag schreiben
function homeWriteJob(id) {
  createSheetFromJob(id, null, homeSelectedISO());
}

// Fehlende Zettel: Arbeitstage der letzten 14 Tage (bis gestern) ohne Zettel/Abwesenheit
function missingDays() {
  const res = [];
  const today = todayISO();
  for (let i = MISSING_LOOKBACK_DAYS; i >= 1; i--) {
    const iso = addDaysISO(today, -i);
    if (dayStatus(iso) === 'missing') res.push(iso);
  }
  return res;
}

// Eigene Montagezettel (letzte 60 Tage) ohne Kundenunterschrift, die schon Zeiten haben
function unsignedSheets() {
  const from = addDaysISO(todayISO(), -60);
  return appData.sheets.filter(s => s.type === 'montage' && isOwnSheet(s) && !(s.signCustomer && s.signCustomer.img)
    && sheetWorkedMinutes(s) > 0 && (sheetFirstDate(s) || '') >= from)
    .sort((a, b) => (sheetFirstDate(a) || '').localeCompare(sheetFirstDate(b) || ''));
}

function miniSheetCard(s) {
  const t = sheetTotals(s);
  const isM = s.type === 'montage';
  const title = isM ? (s.vessel || s.customer || 'Montage') : 'Werkstatt';
  const sub = isM
    ? [s.orderNo, s.vessel && s.customer ? s.customer : ''].filter(Boolean).join(' · ')
    : distinctJoin(s.days.flatMap(d => d.entries.map(e => e.cost)).filter(c => c && !isPauseCost(c)));
  return `
    <button class="mini-sheet ${isM ? 'is-montage' : 'is-werkstatt'}" onclick="openEditor('${s.id}')">
      <span class="ms-main">
        <span class="ms-type">${isM ? 'Montage' : 'Werkstatt'}${s.signCustomer && s.signCustomer.img ? ' · ✓ unterschrieben' : ''}</span>
        <b>${escapeHtml(title)}</b>
        ${sub ? `<small>${escapeHtml(sub)}</small>` : ''}
      </span>
      <span class="ms-hours"><b>${formatHours(t.worked)}</b>${t.ot ? `<small>+${formatHours(t.ot)} Ü</small>` : ''}</span>
    </button>`;
}

function renderTechHome() {
  const el = document.getElementById('tech-home');
  if (!el) return;
  if (isOffice()) { el.innerHTML = ''; return; }
  const today = todayISO();
  if (!homeWeekStart) homeWeekStart = weekStartISO(today);
  if (!homeSelected) homeSelected = today;
  const sel = homeSelected;
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(homeWeekStart, i));

  // ---- Wochenleiste ----
  let weekWorked = 0, weekTarget = 0;
  const cells = days.map(iso => {
    const info = dayInfo(iso);
    const st = dayStatus(iso);
    weekWorked += info.worked;
    weekTarget += dayTargetMinutes(iso);
    const d = parseISODate(iso);
    const hrs = info.worked ? (info.worked / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '';
    return `
      <button class="wk-day ${iso === sel ? 'sel' : ''} ${iso === today ? 'today' : ''} st-${st || 'none'} ${d.getDay() === 0 || d.getDay() === 6 ? 'we' : ''}" onclick="homeSelectDay('${iso}')">
        <span class="wk-wd">${WEEKDAYS_SHORT[d.getDay()]}</span>
        <span class="wk-date">${d.getDate()}.</span>
        <span class="wk-h">${hrs || '&nbsp;'}</span>
        <span class="wk-st">${STATUS_MARK[st] || '&nbsp;'}</span>
      </button>`;
  }).join('');
  const isCurrentWeek = homeWeekStart === weekStartISO(today);

  // ---- Gewählter Tag ----
  const selDate = parseISODate(sel);
  const selSheets = ownSheetsOn(sel).sort((a, b) => (a.type === b.type ? 0 : a.type === 'montage' ? -1 : 1));
  const selOffs = daysOffFor(sel);
  const offTypes = typeof OFF_TYPES !== 'undefined' ? OFF_TYPES : {};
  const dayJobs = appData.jobs.filter(j => j.status !== 'erledigt' && isAssignedToMe(j)
    && (!j.planFrom || j.planFrom <= sel) && (!j.planTo || j.planTo >= sel)
    && !jobAllSheets(j).some(s => isOwnSheet(s) && s.days.some(d => d.date === sel)));
  const selInfo = dayInfo(sel);

  // ---- Zu erledigen ----
  const missing = missingDays();
  const unsigned = unsignedSheets();
  const todo = [];
  if (missing.length) {
    todo.push(`
      <div class="todo-item warn">
        <div class="todo-head"><b>${missing.length} Tag${missing.length > 1 ? 'e' : ''} ohne Zettel</b><span class="muted small-text">letzte ${MISSING_LOOKBACK_DAYS} Tage</span></div>
        <div class="todo-chips">${missing.map(iso => `<button class="chip mini" onclick="homeSelectDay('${iso}')">${WEEKDAYS_SHORT[parseISODate(iso).getDay()]} ${formatDateShort(iso)}</button>`).join('')}</div>
      </div>`);
  }
  if (unsigned.length) {
    todo.push(`
      <div class="todo-item">
        <div class="todo-head"><b>${unsigned.length} Montagezettel ohne Kundenunterschrift</b></div>
        <div class="todo-chips">${unsigned.slice(0, 8).map(s => `<button class="chip mini" onclick="openEditor('${s.id}')">${formatDateShort(sheetFirstDate(s))} ${escapeHtml(s.vessel || s.orderNo || '')}</button>`).join('')}${unsigned.length > 8 ? `<span class="muted small-text">+ ${unsigned.length - 8} weitere</span>` : ''}</div>
      </div>`);
  }

  const assigned = appData.jobs.filter(j => j.status !== 'erledigt' && isAssignedToMe(j))
    .sort((a, b) => (a.planFrom || '9999').localeCompare(b.planFrom || '9999'));
  if (assigned.length) {
    todo.push(`
      <div class="todo-item">
        <div class="todo-head"><b>${assigned.length} Auftr${assigned.length > 1 ? 'äge' : 'ag'} dir zugeteilt</b><button class="link-btn" onclick="showView('jobs')">Alle Aufträge</button></div>
        <div class="todo-chips">${assigned.map(j => `<button class="chip mini" onclick="openJob('${j.id}')">${escapeHtml(j.orderNo || 'Auftrag')}${j.vessel ? ' · ' + escapeHtml(j.vessel) : ''}${planText(j) ? ' · ' + escapeHtml(planText(j)) : ''}</button>`).join('')}</div>
      </div>`);
  }

  // ---- Woche ----
  const pct = weekTarget ? Math.min(100, Math.round(weekWorked / weekTarget * 100)) : (weekWorked ? 100 : 0);
  const balance = overtimeBalance();

  el.innerHTML = `
    <div class="card week-card">
      <div class="wk-nav">
        <button class="icon-btn small" onclick="homeShiftWeek(-1)" aria-label="Vorherige Woche"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="wk-title"><b>KW ${isoWeek(homeWeekStart)}</b> <span class="muted">${formatDateShort(homeWeekStart)}–${formatDate(days[6], false)}</span></div>
        <button class="icon-btn small" onclick="homeShiftWeek(1)" aria-label="Nächste Woche"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <div class="wk-grid">${cells}</div>
      ${isCurrentWeek ? '' : `<button class="link-btn wk-today" onclick="homeSelectDay('${today}')">Zur aktuellen Woche</button>`}
      <div class="wk-sum" onclick="showView('hours')">
        <div class="wk-bar"><i style="width:${pct}%"></i></div>
        <div class="wk-sum-row">
          <span><b>${formatHours(weekWorked)}</b> von ${formatHours(weekTarget)}</span>
          <span>Überstunden gesamt <b class="${balance < 0 ? 'neg' : 'pos'}">${formatHours(balance, true)}</b></span>
        </div>
      </div>
    </div>

    <div class="card day-panel">
      <div class="dp-head">
        <div><span class="dp-label">${sel === today ? 'Heute' : sel === addDaysISO(today, -1) ? 'Gestern' : sel === addDaysISO(today, 1) ? 'Morgen' : ''}</span>
          <b>${WEEKDAYS_LONG[selDate.getDay()]}, ${formatDate(sel, false)}</b></div>
        ${selInfo.worked ? `<span class="dp-hours">${formatHours(selInfo.worked)}${selInfo.delta > 0 ? ` <small>+${formatHours(selInfo.delta)} Ü</small>` : ''}</span>` : ''}
      </div>
      ${selOffs.length ? `<div class="dp-offs">${selOffs.map(o => `<span class="src off off-${o.type}">${escapeHtml((offTypes[o.type] || {}).short || o.type)}</span>`).join('')}</div>` : ''}
      ${selSheets.length ? `<div class="mini-list">${selSheets.map(miniSheetCard).join('')}</div>` : `<p class="muted small-text dp-empty">${dayStatus(sel) === 'missing' ? 'Für diesen Tag fehlt noch ein Zettel.' : 'Noch kein Zettel für diesen Tag.'}</p>`}
      ${dayJobs.length ? `<div class="dp-jobs"><span class="muted small-text">Dir zugeteilt:</span>${dayJobs.map(j => `
        <button class="btn btn-soft dp-job" onclick="homeWriteJob('${j.id}')">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          <span><b>${escapeHtml(j.orderNo || 'Auftrag')}</b> ${escapeHtml(j.vessel || j.customer || '')}${j.kind !== 'montage' ? ` · ${JOB_KINDS[j.kind]}` : ''}</span>
        </button>`).join('')}</div>` : ''}
      <div class="dp-actions">
        <button class="btn btn-primary" onclick="newSheetForDay('${sel}')"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Neuer Zettel</button>
        ${selOffs.length ? '' : `<button class="btn btn-ghost" onclick="openDayOffModal('${sel}')">Frei / Urlaub</button>`}
      </div>
    </div>

    ${todo.length ? `<div class="card todo-card"><h3 class="card-title">Zu erledigen</h3>${todo.join('')}</div>` : ''}

    <button class="btn btn-ghost block list-toggle" onclick="homeToggleList()">
      ${homeShowList ? 'Liste ausblenden' : 'Alle Zettel &amp; Suche anzeigen'}
    </button>`;
  document.body.classList.toggle('home-list-hidden', !homeShowList);
}

window.homeShiftWeek = homeShiftWeek;
window.homeSelectDay = homeSelectDay;
window.homeToggleList = homeToggleList;
window.newSheetForDay = newSheetForDay;
window.homeWriteJob = homeWriteJob;
window.renderTechHome = renderTechHome;
