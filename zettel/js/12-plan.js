// =====================================================================
// 12-plan: Einsatzplanung
//
// Datenmodell: job.slots = [{ id, name, from, to }] – ein Monteur ist von–bis
// für einen Auftrag eingeplant. Fallback (ältere Aufträge): zugeteilte
// Monteure (job.assigned) gelten im Zeitraum job.planFrom–planTo als eingeplant.
//
// Büro: Wochentafel Monteure × Tage, Zelle antippen → einplanen/entfernen,
//       Warnungen (doppelt verplant, Abwesenheit), „Noch nicht eingeplant“,
//       Druck des Wochenplans.
// Monteur: „Meine nächsten Einsätze“ (14 Tage) + Team-Tafel zum Ansehen.
// =====================================================================

let planWeekStart = null;
const PLAN_AGENDA_DAYS = 14;

// ---------- Abfragen ----------
// Ist der Monteur an diesem Tag für den Auftrag eingeplant?
function jobPlannedOn(job, name, iso) {
  const slots = (job.slots || []).filter(s => sameName(s.name, name));
  if (slots.length) return slots.some(s => s.from <= iso && (s.to || s.from) >= iso);
  if (!(job.assigned || []).some(n => sameName(n, name))) return false;
  if (!job.planFrom && !job.planTo) return false;
  return (!job.planFrom || job.planFrom <= iso) && (!job.planTo || job.planTo >= iso);
}

// Hat der Auftrag für diesen Monteur überhaupt Termine?
function jobHasDatesFor(job, name) {
  return (job.slots || []).some(s => sameName(s.name, name))
    || (!!(job.planFrom || job.planTo) && (job.assigned || []).some(n => sameName(n, name)));
}

function plannedJobsFor(name, iso) {
  return appData.jobs.filter(j => jobPlannedOn(j, name, iso));
}

// Abwesenheiten eines Monteurs (Einträge ohne Namen gehören dem Techniker dieses Geräts)
function absencesFor(name, iso) {
  return appData.daysOff.filter(o => o.date === iso && o.type !== 'korrektur'
    && (o.worker ? sameName(o.worker, name) : sameName(appData.settings.name, name)));
}

// Geschriebene Stunden eines Monteurs an einem Tag
function workedFor(name, iso) {
  let min = 0;
  appData.sheets.forEach(s => {
    if (!(s.worker ? sameName(s.worker, name) : sameName(appData.settings.name, name))) return;
    s.days.forEach((d, di) => { if (d.date === iso) min += daySplit(s, di).worked; });
  });
  return min;
}

// Monteure für die Tafel: alle bekannten, eigener Name (Monteur) zuerst
function planPeople() {
  const names = knownTechnicians();
  const me = !isOffice() ? currentUserName() : '';
  if (me) {
    const i = names.findIndex(n => sameName(n, me));
    if (i > 0) names.unshift(names.splice(i, 1)[0]);
    if (i < 0) names.unshift(me);
  }
  return names;
}

// Offene Aufträge ohne jeden Termin
function unplannedJobs() {
  return appData.jobs.filter(j => j.status !== 'erledigt' && !(j.slots || []).length && !j.planFrom && !j.planTo);
}

// ---------- Ansicht ----------
function planShiftWeek(n) {
  planWeekStart = n === 0 ? weekStartISO(todayISO()) : addDaysISO(planWeekStart || weekStartISO(todayISO()), n * 7);
  renderPlan();
}

function planChip(job, extra) {
  return `<span class="plan-chip kind-${job.kind || 'montage'} ${job.status === 'erledigt' ? 'done' : ''} ${extra || ''}" title="${escapeHtml([job.orderNo, job.vessel, job.customer].filter(Boolean).join(' · '))}">
    <b>${escapeHtml(job.orderNo ? job.orderNo.replace(/^SR\d{2}\//, '') : 'Auftrag')}</b>${job.vessel || job.customer ? `<small>${escapeHtml(job.vessel || job.customer)}</small>` : ''}</span>`;
}

function planCell(name, iso) {
  const jobs = plannedJobsFor(name, iso);
  const abs = absencesFor(name, iso);
  const worked = workedFor(name, iso);
  const offTypes = typeof OFF_TYPES !== 'undefined' ? OFF_TYPES : {};
  const conflict = jobs.filter(j => j.status !== 'erledigt').length > 1 || (abs.length && jobs.length);
  const d = parseISODate(iso);
  const we = d.getDay() === 0 || d.getDay() === 6;
  return `
    <button class="plan-cell ${iso === todayISO() ? 'today' : ''} ${we ? 'we' : ''} ${conflict ? 'conflict' : ''}" onclick="openPlanCell(${escapeHtml(JSON.stringify(name))},'${iso}')">
      ${abs.map(o => `<span class="plan-abs off-${o.type}">${escapeHtml((offTypes[o.type] || {}).short || o.type)}</span>`).join('')}
      ${jobs.map(j => planChip(j)).join('')}
      ${worked ? `<span class="plan-worked">${(worked / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 })} h ✓</span>`
        : (iso < todayISO() && !abs.length && jobs.some(j => j.status !== 'erledigt') ? '<span class="plan-missing">kein Zettel</span>' : '')}
      ${conflict ? '<span class="plan-warn" title="Doppelt verplant oder abwesend">!</span>' : ''}
    </button>`;
}

function renderPlan() {
  const office = isOffice();
  const today = todayISO();
  if (!planWeekStart) planWeekStart = weekStartISO(today);
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(planWeekStart, i));
  const people = planPeople();
  const me = currentUserName();

  // ---- Monteur: Meine nächsten Einsätze ----
  let agenda = '';
  if (!office) {
    const rows = [];
    for (let i = 0; i < PLAN_AGENDA_DAYS; i++) {
      const iso = addDaysISO(today, i);
      const jobs = me ? plannedJobsFor(me, iso).filter(j => j.status !== 'erledigt') : [];
      const abs = me ? absencesFor(me, iso) : [];
      if (!jobs.length && !abs.length) continue;
      const d = parseISODate(iso);
      rows.push(`
        <div class="agenda-day ${iso === today ? 'today' : ''}">
          <div class="ag-date"><b>${i === 0 ? 'Heute' : i === 1 ? 'Morgen' : WEEKDAYS_SHORT[d.getDay()]}</b><small>${formatDateShort(iso)}</small></div>
          <div class="ag-items">
            ${abs.map(o => `<span class="plan-abs off-${o.type}">${escapeHtml((OFF_TYPES[o.type] || {}).label || o.type)}</span>`).join('')}
            ${jobs.map(j => `
              <button class="ag-job kind-${j.kind || 'montage'}" onclick="openJob('${j.id}')">
                <span><b>${escapeHtml(j.orderNo || 'Auftrag')}</b> · ${escapeHtml(JOB_KINDS[j.kind] || 'Montage')}</span>
                <small>${escapeHtml([j.vessel, j.customer].filter(Boolean).join(' · ') || '')}</small>
              </button>`).join('')}
          </div>
        </div>`);
    }
    agenda = `
      <div class="card">
        <h3 class="card-title">Meine nächsten Einsätze</h3>
        ${!me ? '<p class="muted small-text">Bitte in den Einstellungen deinen Namen eintragen – danach erscheinen hier deine Einsätze.</p>'
          : rows.length ? rows.join('') : `<p class="muted small-text">In den nächsten ${PLAN_AGENDA_DAYS} Tagen ist für dich nichts eingeplant.</p>`}
      </div>`;
  }

  // ---- Tafel ----
  const head = `<div class="plan-corner"></div>` + days.map(iso => {
    const d = parseISODate(iso);
    return `<div class="plan-dayhead ${iso === today ? 'today' : ''}"><b>${WEEKDAYS_SHORT[d.getDay()]}</b><small>${formatDateShort(iso)}</small></div>`;
  }).join('');
  const rows = people.map(name => {
    const planned = days.filter(iso => plannedJobsFor(name, iso).length).length;
    return `<div class="plan-name ${!office && sameName(name, me) ? 'me' : ''}"><b>${escapeHtml(name)}</b><small>${planned ? planned + ' T. verplant' : 'frei'}</small></div>`
      + days.map(iso => planCell(name, iso)).join('');
  }).join('');

  const unplanned = office ? unplannedJobs() : [];
  document.getElementById('plan-body').innerHTML = `
    ${agenda}
    <div class="card plan-card">
      <div class="wk-nav">
        <button class="icon-btn small" onclick="planShiftWeek(-1)" aria-label="Vorherige Woche"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="wk-title"><b>${office ? 'Einsatzplan' : 'Team'} · KW ${isoWeek(planWeekStart)}</b> <span class="muted">${formatDateShort(days[0])}–${formatDate(days[6], false)}</span></div>
        <button class="icon-btn small" onclick="planShiftWeek(1)" aria-label="Nächste Woche"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      ${planWeekStart !== weekStartISO(today) ? '<button class="link-btn wk-today" onclick="planShiftWeek(0)">Zur aktuellen Woche</button>' : ''}
      ${people.length ? `<div class="plan-scroll"><div class="plan-grid">${head}${rows}</div></div>`
        : '<p class="muted small-text">Noch keine Monteure bekannt. Monteure erscheinen, sobald sie Aufträgen zugeteilt sind oder Zettel geschrieben haben.</p>'}
      <div class="plan-legend">
        <span class="plan-chip kind-montage"><b>Montage</b></span>
        <span class="plan-chip kind-werkstatt"><b>Werkstatt</b></span>
        <span class="plan-chip kind-mix"><b>Gemischt</b></span>
        <span class="plan-worked">8 h ✓ = geschrieben</span>
        <span class="plan-missing">kein Zettel</span>
        <span class="plan-warn-l"><i>!</i> doppelt / abwesend</span>
      </div>
      ${office ? '<p class="muted small-text">Zelle antippen zum Einplanen. Neue Monteure: im Auftrag unter „Monteure zuteilen“ eintragen.</p>' : ''}
    </div>

    ${office ? `
    <div class="card">
      <h3 class="card-title">Noch nicht eingeplant</h3>
      ${unplanned.length ? `<div class="menu-rows">${unplanned.map(j => `
        <div class="menu-row">
          <span><b>${escapeHtml(j.orderNo || 'ohne Auftragsnummer')} · ${escapeHtml(JOB_KINDS[j.kind] || 'Montage')}</b><small>${escapeHtml([j.vessel, j.customer].filter(Boolean).join(' · ') || 'ohne Kunde')}${(j.assigned || []).length ? ' · ' + escapeHtml(j.assigned.join(', ')) : ''}</small></span>
          <button class="btn btn-soft" onclick="openPlanJob('${j.id}')">Einplanen</button>
        </div>`).join('')}</div>` : '<p class="muted small-text">Alle offenen Aufträge haben einen Termin.</p>'}
    </div>` : ''}`;
}

// ---------- Zelle antippen ----------
function openPlanCell(name, iso) {
  const office = isOffice();
  const jobs = plannedJobsFor(name, iso);
  const abs = absencesFor(name, iso);
  const worked = workedFor(name, iso);
  const d = parseISODate(iso);
  const nameJs = escapeHtml(JSON.stringify(name));
  const openJobs = appData.jobs.filter(j => j.status !== 'erledigt' && !jobs.includes(j))
    .sort((a, b) => (a.orderNo || '').localeCompare(b.orderNo || ''));
  openModal(`
    <h2 class="modal-title">${escapeHtml(name)}</h2>
    <p class="modal-text muted">${WEEKDAYS_LONG[d.getDay()]}, ${formatDate(iso, false)}${worked ? ` · ${formatHours(worked)} geschrieben` : ''}</p>
    ${abs.length ? `<div class="dp-offs">${abs.map(o => `<span class="src off off-${o.type}">${escapeHtml((OFF_TYPES[o.type] || {}).label || o.type)}</span>`).join('')}</div>` : ''}
    ${jobs.length ? `<h4 class="modal-sub">Eingeplant</h4><div class="menu-rows">${jobs.map(j => `
      <div class="menu-row">
        <button class="plain-btn" onclick="closeModal();openJob('${j.id}')"><b>${escapeHtml(j.orderNo || 'Auftrag')} · ${escapeHtml(JOB_KINDS[j.kind] || 'Montage')}</b><small>${escapeHtml([j.vessel, j.customer].filter(Boolean).join(' · '))}${slotRangeText(j, name, iso)}</small></button>
        ${office ? `<span class="row-actions">
          <button class="link-btn danger" onclick="unplanDay('${j.id}',${nameJs},'${iso}')">Tag entfernen</button>
          <button class="link-btn danger" onclick="unplanSlot('${j.id}',${nameJs},'${iso}')">Ganzer Einsatz</button></span>` : ''}
      </div>`).join('')}</div>` : '<p class="muted small-text">An diesem Tag nicht eingeplant.</p>'}
    ${office ? `
      <h4 class="modal-sub">Einplanen</h4>
      ${openJobs.length ? `
      <label class="field"><span>Auftrag</span>
        <select id="plan-job">${openJobs.map(j => `<option value="${j.id}">${escapeHtml(j.orderNo || 'ohne Nr.')} · ${escapeHtml(j.vessel || j.customer || '')} (${escapeHtml(JOB_KINDS[j.kind] || 'Montage')})</option>`).join('')}</select>
      </label>
      <div class="grid-2">
        <label class="field"><span>Von</span><input type="date" id="plan-from" value="${iso}"></label>
        <label class="field"><span>Bis</span><input type="date" id="plan-to" value="${iso}"></label>
      </div>
      <button class="btn btn-primary block" onclick="savePlanSlot(${nameJs})">Einplanen</button>` : '<p class="muted small-text">Keine offenen Aufträge vorhanden – zuerst unter „Aufträge“ anlegen.</p>'}` : ''}
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Schließen</button></div>`);
}

function slotRangeText(job, name, iso) {
  const s = (job.slots || []).find(x => sameName(x.name, name) && x.from <= iso && (x.to || x.from) >= iso);
  const from = s ? s.from : job.planFrom, to = s ? (s.to || s.from) : job.planTo;
  if (!from && !to) return '';
  return ' · ' + (from === to ? formatDateShort(from) : formatDateShort(from || to) + '–' + formatDateShort(to || from));
}

// Fallback-Zeitraum (planFrom/planTo) eines Monteurs in eigene Slots umwandeln, damit er einzeln bearbeitet werden kann
function ensureSlotsFor(job, name) {
  job.slots = job.slots || [];
  if (!job.slots.some(s => sameName(s.name, name)) && (job.planFrom || job.planTo) && (job.assigned || []).some(n => sameName(n, name))) {
    job.slots.push({ id: uid(), name, from: job.planFrom || job.planTo, to: job.planTo || job.planFrom });
  }
}

function addPlanSlot(job, name, from, to) {
  if (!from) return false;
  if (to && to < from) [from, to] = [to, from];
  job.slots = job.slots || [];
  ensureSlotsFor(job, name);
  job.slots.push({ id: uid(), name, from, to: to || from });
  if (!(job.assigned || []).some(n => sameName(n, name))) (job.assigned = job.assigned || []).push(name);
  return true;
}

function savePlanSlot(name) {
  const job = getJob(document.getElementById('plan-job').value);
  const from = document.getElementById('plan-from').value;
  const to = document.getElementById('plan-to').value || from;
  if (!job || !addPlanSlot(job, name, from, to)) { showToast('Bitte Auftrag und Datum wählen'); return; }
  saveData(true);
  closeModal();
  renderPlan();
  showToast(`${name} für ${job.orderNo || 'den Auftrag'} eingeplant`);
}

// Einen Tag aus dem Einsatz nehmen (Zeitraum wird ggf. geteilt)
function unplanDay(jobId, name, iso) {
  const job = getJob(jobId);
  ensureSlotsFor(job, name);
  const s = job.slots.find(x => sameName(x.name, name) && x.from <= iso && (x.to || x.from) >= iso);
  if (s) {
    const to = s.to || s.from;
    if (s.from === iso && to === iso) job.slots = job.slots.filter(x => x !== s);
    else if (s.from === iso) s.from = addDaysISO(iso, 1);
    else if (to === iso) s.to = addDaysISO(iso, -1);
    else { job.slots.push({ id: uid(), name, from: addDaysISO(iso, 1), to }); s.to = addDaysISO(iso, -1); }
  }
  saveData(true);
  closeModal();
  renderPlan();
}

async function unplanSlot(jobId, name, iso) {
  const job = getJob(jobId);
  ensureSlotsFor(job, name);
  const s = job.slots.find(x => sameName(x.name, name) && x.from <= iso && (x.to || x.from) >= iso);
  if (!s) return;
  closeModal();
  if (!(await confirmDialog(`Einsatz von ${name} für ${job.orderNo || 'den Auftrag'} (${formatDateShort(s.from)}–${formatDateShort(s.to || s.from)}) entfernen?`, 'Entfernen', true))) return;
  job.slots = job.slots.filter(x => x !== s);
  saveData(true);
  renderPlan();
}

// Aus „Noch nicht eingeplant“ oder dem Auftrag heraus: Monteur + Zeitraum wählen
function openPlanJob(jobId) {
  const job = getJob(jobId);
  const people = knownTechnicians();
  openModal(`
    <h2 class="modal-title">Einplanen · ${escapeHtml(job.orderNo || 'Auftrag')}</h2>
    <p class="modal-text muted">${escapeHtml([JOB_KINDS[job.kind] || 'Montage', job.vessel, job.customer].filter(Boolean).join(' · '))}</p>
    <label class="field"><span>Monteur</span>
      <input type="text" id="plan-name" list="dl-plan-people" value="${escapeHtml((job.assigned || [])[0] || '')}" placeholder="Name" autocomplete="off">
      <datalist id="dl-plan-people">${people.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
    </label>
    <div class="grid-2">
      <label class="field"><span>Von</span><input type="date" id="plan-from" value="${job.planFrom || todayISO()}"></label>
      <label class="field"><span>Bis</span><input type="date" id="plan-to" value="${job.planTo || job.planFrom || todayISO()}"></label>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="savePlanJob('${job.id}')">Einplanen</button>
    </div>`);
}

function savePlanJob(jobId) {
  const job = getJob(jobId);
  const name = document.getElementById('plan-name').value.trim();
  const from = document.getElementById('plan-from').value;
  const to = document.getElementById('plan-to').value || from;
  if (!name) { showToast('Bitte Monteur eintragen'); return; }
  if (!addPlanSlot(job, name, from, to)) { showToast('Bitte Datum wählen'); return; }
  saveData(true);
  closeModal();
  if (currentView === 'job') renderJob(); else renderPlan();
  showToast(`${name} eingeplant`);
}

// Einsätze eines Auftrags (für die Auftragsansicht im Büro)
function jobSlotsHtml(job) {
  const slots = (job.slots || []).slice().sort((a, b) => a.from.localeCompare(b.from));
  return `
    <h4 class="sub-title">Einsatzplanung</h4>
    ${slots.length ? `<div class="menu-rows">${slots.map(s => `
      <div class="menu-row"><span><b>${escapeHtml(s.name)}</b><small>${s.from === (s.to || s.from) ? formatDate(s.from) : formatDateShort(s.from) + ' – ' + formatDate(s.to, false)}</small></span>
        <button class="link-btn danger" onclick="removeSlot('${job.id}','${s.id}')">Entfernen</button></div>`).join('')}</div>`
      : '<p class="muted small-text">Noch keine Einsätze geplant.</p>'}
    <button type="button" class="btn btn-soft" onclick="openPlanJob('${job.id}')">Monteur einplanen</button>`;
}

function removeSlot(jobId, slotId) {
  const job = getJob(jobId);
  job.slots = (job.slots || []).filter(s => s.id !== slotId);
  saveData(true);
  renderJob();
}

// ---------- Druck ----------
function buildPlanPrintHtml() {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(planWeekStart || weekStartISO(todayISO()), i));
  const people = planPeople();
  return `
    <div class="pr-page">
      <div class="pr-head"><div><div class="pr-title">Einsatzplan KW ${isoWeek(days[0])}</div><div class="pr-sub">${formatDate(days[0], false)} – ${formatDate(days[6], false)}</div></div></div>
      <table class="pr-plan">
        <thead><tr><th>Monteur</th>${days.map(iso => `<th>${WEEKDAYS_SHORT[parseISODate(iso).getDay()]} ${formatDateShort(iso)}</th>`).join('')}</tr></thead>
        <tbody>${people.map(name => `<tr><th>${escapeHtml(name)}</th>${days.map(iso => {
          const parts = absencesFor(name, iso).map(o => (OFF_TYPES[o.type] || {}).short || o.type)
            .concat(plannedJobsFor(name, iso).map(j => [j.orderNo, j.vessel || j.customer].filter(Boolean).join(' ')));
          return `<td>${escapeHtml(parts.join('\n'))}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table>
      <div class="pr-foot">Erstellt mit Zettel-Job · ${escapeHtml(new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}</div>
    </div>`;
}

function printPlan() {
  printHtml(buildPlanPrintHtml(), 'Einsatzplan_KW' + isoWeek(planWeekStart || weekStartISO(todayISO())));
}

window.renderPlan = renderPlan;
window.planShiftWeek = planShiftWeek;
window.openPlanCell = openPlanCell;
window.savePlanSlot = savePlanSlot;
window.unplanDay = unplanDay;
window.unplanSlot = unplanSlot;
window.openPlanJob = openPlanJob;
window.savePlanJob = savePlanJob;
window.removeSlot = removeSlot;
window.printPlan = printPlan;
