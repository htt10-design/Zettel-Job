// =====================================================================
// 18-leave: Urlaub – Konto, Anträge der Monteure, Genehmigung durchs Büro
// appData.leaveRequests = [{ id, worker, from, to, days, note, status: 'pending'|'approved'|'rejected'|'cancelled',
//   createdAt, updatedAt, decidedAt, decidedBy, answer }]
// Genehmigt → je Urlaubstag eine Abwesenheit { type: 'urlaub', worker, requestId, by: 'office' } in appData.daysOff.
// Rechnung (Anspruch/genommen/beantragt) in 02-helpers: vacationSummary, leaveDayList.
// =====================================================================

const LEAVE_STATUS = {
  pending: { label: 'Beantragt', cls: 'badge-open' },
  approved: { label: 'Genehmigt', cls: 'badge-ok' },
  rejected: { label: 'Abgelehnt', cls: 'badge-no' },
  cancelled: { label: 'Storniert', cls: 'badge-no' }
};

function getLeave(id) { return appData.leaveRequests.find(r => r.id === id) || null; }

function leaveRangeText(r) {
  return r.from === r.to || !r.to ? formatDate(r.from) : formatDateShort(r.from) + ' – ' + formatDate(r.to, false);
}

function leaveDaysCount(r) {
  return r.status === 'approved' && r.days ? r.days : leaveDayList(r.worker, r.from, r.to).length;
}

function dayWord(n) { return n === 1 ? '1 Tag' : n + ' Tage'; }

function pendingLeaves() {
  return appData.leaveRequests.filter(r => r.status === 'pending').sort((a, b) => (a.from || '').localeCompare(b.from || ''));
}

// Anträge eines Monteurs, die ein Jahr berühren (neueste zuerst)
function leavesOf(name, year) {
  const y = String(year);
  return appData.leaveRequests.filter(r => nameEq(r.worker, name) && ((r.from || '').startsWith(y) || (r.to || '').startsWith(y)))
    .sort((a, b) => (b.from || '').localeCompare(a.from || ''));
}

// Balken: genommen | beantragt | frei
function vacationBarHtml(s) {
  const total = Math.max(1, s.total, s.used + s.pending);
  const pct = n => Math.max(0, Math.min(100, n / total * 100)).toFixed(1);
  return `<div class="vac-bar"><i class="used" style="width:${pct(s.used)}%"></i><i class="pend" style="width:${pct(s.pending)}%"></i></div>
    <div class="vac-legend"><span><i class="used"></i>${s.used} genommen</span><span><i class="pend"></i>${s.pending} beantragt</span><span><i></i>${Math.max(0, s.free)} frei</span></div>`;
}

function vacationHeadHtml(s, year) {
  return `
    <div class="vac-head">
      <div><span class="vac-label">Urlaub ${year}</span>
        <span class="muted small-text">${s.carry ? `Anspruch ${s.base} ${s.carry > 0 ? '+' : '−'} ${Math.abs(s.carry)} Übertrag = ${s.total} Tage` : `Anspruch ${s.total} Tage`}</span></div>
      <div class="vac-rest ${s.rest < 0 ? 'neg' : ''}"><b>${s.rest}</b><small>übrig</small></div>
    </div>
    ${vacationBarHtml(s)}`;
}

function leaveRowHtml(r, mode) {
  const st = LEAVE_STATUS[r.status] || LEAVE_STATUS.pending;
  const n = leaveDaysCount(r);
  const sub = [dayWord(n), r.note, r.status === 'rejected' && r.answer ? 'Büro: ' + r.answer : '',
    r.decidedAt && r.status !== 'pending' ? `${st.label.toLowerCase()} ${formatDateShort(r.decidedAt.slice(0, 10))}${r.decidedBy ? ' von ' + r.decidedBy : ''}` : ''].filter(Boolean).join(' · ');
  let actions = '';
  if (mode === 'tech' && r.status === 'pending') actions = `<button class="link-btn danger" onclick="withdrawLeave('${r.id}')">Zurückziehen</button>`;
  if (mode === 'office' && r.status === 'pending') actions = `<button class="link-btn danger" onclick="rejectLeave('${r.id}')">Ablehnen</button><button class="btn btn-soft" onclick="approveLeave('${r.id}')">Genehmigen</button>`;
  if (mode === 'office' && r.status === 'approved') actions = `<button class="link-btn danger" onclick="cancelLeave('${r.id}')">Stornieren</button>`;
  return `
    <div class="menu-row leave-row st-${r.status}">
      <span><b>${escapeHtml(leaveRangeText(r))}</b><small>${escapeHtml(sub)}</small></span>
      <span class="leave-actions"><span class="badge ${st.cls}">${st.label}</span>${actions}</span>
    </div>`;
}

// ---------- Monteur: Karte in „Stunden“ ----------
function vacationCardHtml(year) {
  const me = appData.settings.name;
  if (!me) return `<div class="card vac-card"><h3 class="card-title">Urlaub</h3><p class="muted small-text">Bitte zuerst als Monteur anmelden – dann siehst du hier dein Urlaubskonto.</p></div>`;
  const s = vacationSummary(me, year);
  const list = leavesOf(me, year);
  return `
    <div class="card vac-card">
      ${vacationHeadHtml(s, year)}
      <button class="btn btn-primary block" onclick="openLeaveRequest()">
        <svg viewBox="0 0 24 24"><path d="M3 20h18"/><path d="M12 4c-4 0-7 3-7 6h14c0-3-3-6-7-6z"/><path d="M12 10v10"/></svg> Urlaub beantragen</button>
      ${list.length ? `<div class="menu-rows leave-list">${list.map(r => leaveRowHtml(r, 'tech')).join('')}</div>` : ''}
    </div>`;
}

// ---------- Antrag stellen (Monteur) / Urlaub eintragen (Büro) ----------
function openLeaveRequest(forName) {
  const office = isOffice();
  const name = forName || appData.settings.name;
  if (!name) { showToast('Bitte zuerst als Monteur anmelden'); return; }
  // Vorschlag: nächster Montag
  const today = todayISO();
  const start = addDaysISO(weekStartISO(today), 7);
  openModal(`
    <h2 class="modal-title">${office ? 'Urlaub eintragen' : 'Urlaub beantragen'}</h2>
    ${office ? `<p class="modal-text muted">${escapeHtml(name)} · wird sofort als genehmigt eingetragen.</p>` : ''}
    <div class="grid-2">
      <label class="field"><span>Von</span><input type="date" id="leave-from" value="${start}" oninput="updateLeaveCalc()"></label>
      <label class="field"><span>Bis</span><input type="date" id="leave-to" value="${addDaysISO(start, 4)}" oninput="updateLeaveCalc()"></label>
    </div>
    <label class="field"><span>Bemerkung</span><input type="text" id="leave-note" placeholder="Optional, z.B. Familienfeier" autocomplete="off"></label>
    <div class="leave-calc" id="leave-calc"></div>
    <input type="hidden" id="leave-name" value="${escapeHtml(name)}">
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="submitLeaveRequest()">${office ? 'Eintragen' : 'Antrag senden'}</button>
    </div>`);
  updateLeaveCalc();
}

function leaveOverlap(name, from, to, ignoreId) {
  return appData.leaveRequests.some(r => r.id !== ignoreId && nameEq(r.worker, name) && (r.status === 'pending' || r.status === 'approved')
    && r.from <= to && (r.to || r.from) >= from)
    || appData.daysOff.some(o => o.type === 'urlaub' && o.date >= from && o.date <= to && workerMatches(o.worker, name));
}

function updateLeaveCalc() {
  const el = document.getElementById('leave-calc');
  if (!el) return;
  const name = document.getElementById('leave-name').value;
  const from = document.getElementById('leave-from').value;
  let to = document.getElementById('leave-to').value || from;
  if (!from) { el.innerHTML = ''; return; }
  if (to < from) { el.innerHTML = '<p class="warn-text">„Bis“ liegt vor „Von“.</p>'; return; }
  const days = leaveDayList(name, from, to);
  const year = Number(from.slice(0, 4));
  const s = vacationSummary(name, year);
  const after = s.free - days.filter(iso => iso.startsWith(String(year))).length;
  el.innerHTML = `
    <div class="leave-sum"><b>${dayWord(days.length)}</b><span>Urlaub (Wochenenden und Feiertage zählen nicht)</span></div>
    <p class="muted small-text">Danach noch <b class="${after < 0 ? 'neg' : ''}">${after}</b> von ${s.total} Tagen ${year} frei${s.pending ? ' (inkl. offener Anträge)' : ''}.</p>
    ${after < 0 ? '<p class="warn-text">Mehr Tage als noch frei sind.</p>' : ''}
    ${leaveOverlap(name, from, to) ? '<p class="warn-text">In diesem Zeitraum ist schon Urlaub eingetragen oder beantragt.</p>' : ''}`;
}

function submitLeaveRequest() {
  const name = document.getElementById('leave-name').value;
  const from = document.getElementById('leave-from').value;
  const to = document.getElementById('leave-to').value || from;
  const note = document.getElementById('leave-note').value.trim();
  if (!from) { showToast('Bitte Datum wählen'); return; }
  if (to < from) { showToast('„Bis“ liegt vor „Von“'); return; }
  const days = leaveDayList(name, from, to);
  if (!days.length) { showToast('Im Zeitraum liegen keine Arbeitstage'); return; }
  const now = new Date().toISOString();
  const r = { id: uid(), worker: name, from, to, days: days.length, note, status: 'pending', createdAt: now, updatedAt: now };
  appData.leaveRequests.push(r);
  if (isOffice()) {
    approveLeaveNow(r);
    closeModal();
    refreshLeaveViews();
    showToast(`${dayWord(r.days)} Urlaub für ${name} eingetragen`);
    return;
  }
  saveData(true);
  closeModal();
  refreshLeaveViews();
  showToast(typeof syncCfg !== 'undefined' && !(syncCfg && syncCfg.token)
    ? 'Antrag gespeichert – das Büro sieht ihn nach dem Abgleich (Einstellungen → Synchronisation)'
    : 'Antrag gesendet – das Büro wird ihn bestätigen');
}

async function withdrawLeave(id) {
  const r = getLeave(id);
  if (!r || r.status !== 'pending') return;
  if (!(await confirmDialog(`Urlaubsantrag ${leaveRangeText(r)} zurückziehen?`, 'Zurückziehen', true))) return;
  appData.leaveRequests = appData.leaveRequests.filter(x => x.id !== id);
  saveData(true);
  refreshLeaveViews();
  showToast('Antrag zurückgezogen');
}

// ---------- Büro: genehmigen / ablehnen / stornieren ----------
function approveLeaveNow(r) {
  const days = leaveDayList(r.worker, r.from, r.to);
  days.forEach(iso => {
    if (appData.daysOff.some(o => o.date === iso && o.type === 'urlaub' && workerMatches(o.worker, r.worker))) return;
    appData.daysOff.push({ id: uid(), date: iso, type: 'urlaub', note: r.note || 'Urlaubsantrag', hours: null, worker: r.worker, requestId: r.id, by: 'office' });
  });
  const now = new Date().toISOString();
  Object.assign(r, { status: 'approved', days: days.length, decidedAt: now, decidedBy: appData.settings.officeName || '', answer: '', updatedAt: now });
  saveData(true);
}

function approveLeave(id) {
  const r = getLeave(id);
  if (!r || r.status !== 'pending' || !isOffice()) return;
  closeModal();
  approveLeaveNow(r);
  refreshLeaveViews();
  showToast(`Urlaub für ${r.worker} genehmigt (${dayWord(r.days)})`);
}

function rejectLeave(id) {
  const r = getLeave(id);
  if (!r || !isOffice()) return;
  openModal(`
    <h2 class="modal-title">Urlaub ablehnen</h2>
    <p class="modal-text muted">${escapeHtml(r.worker)} · ${escapeHtml(leaveRangeText(r))} · ${dayWord(leaveDaysCount(r))}</p>
    <label class="field"><span>Begründung für den Monteur</span><input type="text" id="leave-answer" placeholder="Optional, z.B. Einsatz MS Hanna" autocomplete="off"></label>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-danger" onclick="confirmRejectLeave('${r.id}')">Ablehnen</button>
    </div>`);
}

function confirmRejectLeave(id) {
  const r = getLeave(id);
  if (!r) return;
  const now = new Date().toISOString();
  Object.assign(r, { status: 'rejected', answer: document.getElementById('leave-answer').value.trim(), decidedAt: now, decidedBy: appData.settings.officeName || '', updatedAt: now });
  saveData(true);
  closeModal();
  refreshLeaveViews();
  showToast('Antrag abgelehnt');
}

async function cancelLeave(id) {
  const r = getLeave(id);
  if (!r || r.status !== 'approved' || !isOffice()) return;
  if (!(await confirmDialog(`Genehmigten Urlaub von ${r.worker} (${leaveRangeText(r)}) stornieren? Die Urlaubstage werden wieder gutgeschrieben.`, 'Stornieren', true))) return;
  appData.daysOff = appData.daysOff.filter(o => o.requestId !== r.id);
  const now = new Date().toISOString();
  Object.assign(r, { status: 'cancelled', decidedAt: now, decidedBy: appData.settings.officeName || '', updatedAt: now });
  saveData(true);
  refreshLeaveViews();
  showToast('Urlaub storniert');
}

// ---------- Büro: Posteingang (Plan) und Monteur-Akte ----------
function leaveInboxHtml() {
  const list = pendingLeaves();
  if (!list.length) return '';
  return `
    <div class="card leave-inbox">
      <h3 class="card-title">Urlaubsanträge <span class="badge badge-open">${list.length} offen</span></h3>
      ${list.map(r => {
        const n = leaveDaysCount(r);
        const year = Number(r.from.slice(0, 4));
        const s = vacationSummary(r.worker, year);
        const rest = s.rest - n;
        return `
        <div class="leave-req">
          <span class="avatar small">${escapeHtml(initials(r.worker))}</span>
          <div class="lr-main">
            <b>${escapeHtml(r.worker)}</b>
            <span>${escapeHtml(leaveRangeText(r))} · <b>${dayWord(n)}</b></span>
            <small class="muted">${r.note ? escapeHtml(r.note) + ' · ' : ''}danach ${rest} von ${s.total} Tagen übrig${leaveConflicts(r) ? ' · <span class="neg">Einsatz geplant!</span>' : ''}</small>
          </div>
          <div class="lr-actions">
            <button class="btn btn-ghost" onclick="rejectLeave('${r.id}')">Ablehnen</button>
            <button class="btn btn-primary" onclick="approveLeave('${r.id}')">Genehmigen</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

// Ist im Urlaubszeitraum schon ein Einsatz geplant?
function leaveConflicts(r) {
  if (typeof plannedJobsFor !== 'function') return false;
  return leaveDayList(r.worker, r.from, r.to).some(iso => plannedJobsFor(r.worker, iso).some(j => j.status !== 'erledigt'));
}

function staffVacationHtml(t, year) {
  const s = vacationSummary(t.name, year);
  const list = leavesOf(t.name, year);
  const carry = t.vacationCarry && t.vacationCarry[year] !== undefined ? t.vacationCarry[year] : '';
  return `
    <div class="card vac-card">
      ${vacationHeadHtml(s, year)}
      <div class="grid-2">
        <label class="field"><span>Urlaubsanspruch pro Jahr (Tage)</span><input type="text" inputmode="decimal" value="${t.vacationDays ?? ''}" placeholder="${VACATION_DEFAULT_DAYS}" onchange="setStaffVacation('vacationDays', this.value)"></label>
        <label class="field"><span>Übertrag / Korrektur ${year} (Tage)</span><input type="text" inputmode="decimal" value="${carry}" placeholder="0" onchange="setStaffVacation('carry', this.value, ${year})"></label>
      </div>
      <p class="muted small-text">Übertrag z.B. Resturlaub aus dem Vorjahr (+) oder anteiliger Anspruch im Eintrittsjahr (−).</p>
      ${list.length ? `<div class="menu-rows leave-list">${list.map(r => leaveRowHtml(r, 'office')).join('')}</div>` : ''}
      <button class="btn btn-soft" onclick="openLeaveRequest(${escapeHtml(JSON.stringify(t.name))})">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Urlaub eintragen</button>
    </div>`;
}

function setStaffVacation(field, value, year) {
  const t = getStaff();
  if (!t) return;
  const raw = String(value).trim().replace(',', '.');
  const n = parseFloat(raw);
  if (field === 'vacationDays') {
    if (raw === '') delete t.vacationDays; else if (!isNaN(n) && n >= 0) t.vacationDays = n;
  } else {
    t.vacationCarry = t.vacationCarry && typeof t.vacationCarry === 'object' ? t.vacationCarry : {};
    if (raw === '' || isNaN(n)) delete t.vacationCarry[year]; else t.vacationCarry[year] = n;
  }
  t.updatedAt = new Date().toISOString();
  saveData(true);
  renderStaff();
}

// ---------- Anzeige auffrischen ----------
function updateLeaveBadge() {
  const el = document.getElementById('plan-badge');
  if (!el || !appData) return;
  const n = isOffice() ? pendingLeaves().length : 0;
  el.textContent = n;
  el.hidden = !n;
}

function refreshLeaveViews() {
  if (currentView === 'hours') renderHours();
  else if (currentView === 'plan') renderPlan();
  else if (currentView === 'staff') renderStaff();
  else if (currentView === 'sheets') renderSheetList();
  updateLeaveBadge();
}

// Monteur: kürzlich entschiedene Anträge (für „Zu erledigen“)
function recentLeaveDecisions() {
  const me = appData.settings.name;
  if (!me || isOffice()) return [];
  const since = addDaysISO(todayISO(), -7);
  return appData.leaveRequests.filter(r => nameEq(r.worker, me) && r.status !== 'pending' && (r.decidedAt || '').slice(0, 10) >= since && (r.to || r.from) >= todayISO());
}

window.openLeaveRequest = openLeaveRequest;
window.updateLeaveCalc = updateLeaveCalc;
window.submitLeaveRequest = submitLeaveRequest;
window.withdrawLeave = withdrawLeave;
window.approveLeave = approveLeave;
window.rejectLeave = rejectLeave;
window.confirmRejectLeave = confirmRejectLeave;
window.cancelLeave = cancelLeave;
window.setStaffVacation = setStaffVacation;
