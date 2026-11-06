// =====================================================================
// 10-jobs: Rollen (Servicetechniker / Sachbearbeiter) und Aufträge
//
// - Beim Start wählt man, als was man sich anmeldet (appData.role).
//   Alles läuft lokal auf diesem Gerät – für mehrere Geräte/Techniker
//   braucht es später einen Server; sheet.worker / job.assigned sind
//   dafür schon vorbereitet.
// - Sachbearbeiter: legt Aufträge an (Auftragsnummer, Kunde, Schiff,
//   Motoren, Beschreibung, PDF/Fotos), sieht alle Zettel aller Techniker.
// - Techniker: sieht offene Aufträge, legt daraus mit einem Tipp einen
//   vorausgefüllten Montagezettel an, kann Beschreibung/PDF ansehen.
// Dateien liegen im IndexedDB-Store "files" (saveFile/getFile in 01-core),
// job.files enthält nur { id, name, type, size }.
// =====================================================================

let activeJobId = null;
let jobFilter = 'offen';
let workerFilter = '';

const MAX_FILE_MB = 25;

function isOffice() { return appData.role === 'office'; }

// Angemeldeter Name je Rolle
function currentUserName() {
  return isOffice() ? (appData.settings.officeName || '') : (appData.settings.name || '');
}

// ---------- Rolle / Anmeldung ----------
function applyRole() {
  const role = appData.role || 'tech';
  document.body.classList.toggle('role-office', role === 'office');
  document.body.classList.toggle('role-tech', role !== 'office');
  const badge = document.getElementById('role-badge');
  if (badge) {
    badge.textContent = appData.role ? (role === 'office' ? 'Büro' : 'Technik') : '';
    badge.hidden = !appData.role;
  }
}

// Schritt 1: Rolle wählen
function openRoleChooser() {
  const first = !appData.role;
  openModal(`
    <h2 class="modal-title">${first ? 'Willkommen bei Zettel-Job' : 'Rolle wechseln'}</h2>
    <p class="modal-text muted">Als was möchtest du dich anmelden?</p>
    <div class="type-choice">
      <button class="type-btn ${appData.role === 'tech' ? 'current' : ''}" onclick="chooseRole('tech')">
        <svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/></svg>
        <strong>Servicetechniker</strong>
        <span>Eigene Zeiten und Arbeiten erfassen, Zettel, Stunden, Aufträge ansehen</span>
      </button>
      <button class="type-btn ${appData.role === 'office' ? 'current' : ''}" onclick="chooseRole('office')">
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        <strong>Sachbearbeiter</strong>
        <span>Aufträge anlegen (Motordaten, Beschreibung, PDF), alle Zettel aller Techniker einsehen</span>
      </button>
    </div>
    <p class="muted small-text">Hinweis: Die Daten liegen auf diesem Gerät. Der Austausch zwischen mehreren Geräten folgt später.</p>
    ${first ? '' : '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button></div>'}`, { locked: first });
}

// Schritt 2: Name für die gewählte Rolle (vorausgefüllt mit dem zuletzt benutzten)
function chooseRole(role) {
  const s = appData.settings;
  const name = role === 'office' ? s.officeName || '' : s.name || '';
  openModal(`
    <h2 class="modal-title">${role === 'office' ? 'Sachbearbeiter' : 'Servicetechniker'}</h2>
    <label class="field"><span>Dein Name</span>
      <input type="text" id="login-name" value="${escapeHtml(name)}" placeholder="Vor- und Nachname" autocomplete="name" autofocus
        onkeydown="if(event.key==='Enter'){event.preventDefault();loginAs('${role}');}">
    </label>
    <p class="muted small-text">${role === 'office' ? 'Erscheint z.B. als Ersteller der Aufträge.' : 'Steht als Monteur auf deinen Zetteln.'}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="openRoleChooser()">Zurück</button>
      <button class="btn btn-primary" onclick="loginAs('${role}')">Anmelden</button>
    </div>`, { locked: !appData.role });
}

function loginAs(role) {
  const input = document.getElementById('login-name');
  const name = input ? input.value.trim() : '';
  appData.role = role;
  if (name) {
    if (role === 'office') appData.settings.officeName = name;
    else appData.settings.name = name;
  }
  saveData(true);
  applyRole();
  closeModal();
  showView(role === 'office' ? 'jobs' : 'sheets');
  showToast(`Angemeldet als ${role === 'office' ? 'Sachbearbeiter' : 'Servicetechniker'}${name ? ' – ' + name : ''}`);
}

// ---------- Zuteilung ----------
function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function isAssignedToMe(job) {
  const me = currentUserName();
  return !!me && (job.assigned || []).some(n => sameName(n, me));
}

// Alle bekannten Monteure (aus Zetteln, Zuteilungen, eigenem Namen)
function knownTechnicians() {
  const names = [];
  const add = n => { n = String(n || '').trim(); if (n && !names.some(x => sameName(x, n))) names.push(n); };
  appData.sheets.forEach(s => add(s.worker));
  appData.jobs.forEach(j => (j.assigned || []).forEach(add));
  add(appData.settings.name);
  return names.sort((a, b) => a.localeCompare(b, 'de'));
}

function planText(job) {
  if (!job.planFrom && !job.planTo) return '';
  if (job.planFrom && job.planTo && job.planFrom !== job.planTo) return formatDateShort(job.planFrom) + '–' + formatDate(job.planTo, false);
  return formatDate(job.planFrom || job.planTo);
}

function addAssignee() {
  const job = getActiveJob();
  const input = document.getElementById('assign-name');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  if (!job.assigned.some(n => sameName(n, name))) job.assigned.push(name);
  saveData(true);
  renderJob();
  const n = document.getElementById('assign-name');
  if (n) n.focus();
}

function removeAssignee(i) {
  const job = getActiveJob();
  job.assigned.splice(i, 1);
  saveData(true);
  renderJob();
}

// Startseite Monteur: offene Aufträge, die mir zugeteilt sind
function renderMyJobs() {
  const el = document.getElementById('my-jobs');
  if (!el) return;
  if (isOffice()) { el.innerHTML = ''; return; }
  const jobs = appData.jobs.filter(j => j.status !== 'erledigt' && isAssignedToMe(j))
    .sort((a, b) => (a.planFrom || '9999').localeCompare(b.planFrom || '9999'));
  if (!jobs.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="my-jobs">
      <div class="range-head"><span><b>Dir zugeteilt</b> · ${jobs.length} Auftrag${jobs.length > 1 ? 'e' : ''}</span>
        <button class="link-btn" onclick="showView('jobs')">Alle Aufträge</button></div>
      ${jobs.map(j => {
        const n = jobAllSheets(j).filter(isOwnSheet).length;
        return `
        <div class="my-job" onclick="openJob('${j.id}')">
          <div class="mj-main">
            <b>${escapeHtml(j.orderNo || 'ohne Auftragsnummer')}${j.kind !== 'montage' ? ` <em class="kind-tag">${JOB_KINDS[j.kind]}</em>` : ''}</b>
            <span>${escapeHtml([j.vessel, j.customer].filter(Boolean).join(' · ') || 'ohne Kunde')}</span>
            <small>${escapeHtml([planText(j), n ? n + ' Zettel geschrieben' : '', j.files.length ? '📎 ' + j.files.length : ''].filter(Boolean).join(' · '))}</small>
          </div>
          <button class="btn btn-primary" onclick="event.stopPropagation();createSheetFromJob('${j.id}', null, homeSelectedISO())">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Zettel schreiben</button>
        </div>`;
      }).join('')}
    </div>`;
}

// ---------- Hilfsfunktionen Aufträge ----------
function getJob(id) {
  return appData.jobs.find(j => j.id === id) || null;
}

function getActiveJob() {
  return getJob(activeJobId);
}

// Auftrag zu einer Auftragsnummer (für Zettel)
function jobForOrder(no) {
  if (!normOrderNo(no)) return null;
  return appData.jobs.find(j => sameOrder(j.orderNo, no)) || null;
}

// Alle Montagezettel zu einem Auftrag
function jobSheets(job) {
  return normOrderNo(job.orderNo) ? orderSheets(job.orderNo) : [];
}

const JOB_KINDS = { montage: 'Montage', werkstatt: 'Werkstatt', mix: 'Gemischt' };

// Werkstattzettel mit mindestens einer Zeile, deren Kostenstelle die Auftragsnummer ist
function jobWorkshopSheets(job) {
  if (!normOrderNo(job.orderNo)) return [];
  return appData.sheets.filter(s => s.type === 'werkstatt' && s.days.some(d => d.entries.some(e => sameOrder(e.cost, job.orderNo))))
    .sort((a, b) => (sheetFirstDate(a) || '').localeCompare(sheetFirstDate(b) || ''));
}

// Alle Zettel zum Auftrag (Montage + Werkstatt), chronologisch
function jobAllSheets(job) {
  return jobSheets(job).concat(jobWorkshopSheets(job))
    .sort((a, b) => (sheetFirstDate(a) || '').localeCompare(sheetFirstDate(b) || ''));
}

// Stunden eines Zettels für diesen Auftrag: Montage = ganzer Zettel,
// Werkstatt = nur Zeilen mit der Auftragsnummer als Kostenstelle
function jobSheetHours(job, sheet) {
  if (sheet.type !== 'werkstatt') return sheetTotals(sheet);
  const t = { worked: 0, normal: 0, ot: 0 };
  sheet.days.forEach((d, di) => daySplit(sheet, di).lines.forEach(l => {
    if (l.kind === 'entry' && l.counts && sameOrder(l.code, job.orderNo)) { t.worked += l.minutes; t.normal += l.normal; t.ot += l.ot; }
  }));
  return t;
}

function jobHours(job, sheets) {
  return (sheets || jobAllSheets(job)).reduce((t, s) => { const x = jobSheetHours(job, s); t.worked += x.worked; t.normal += x.normal; t.ot += x.ot; return t; }, { worked: 0, normal: 0, ot: 0 });
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' MB';
}

function fileIcon(type) {
  return /pdf/i.test(type || '')
    ? '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9 14h1.5a1.5 1.5 0 0 0 0-3H9v6"/></svg>'
    : '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-8 8"/></svg>';
}

// Liste der Anhänge (Öffnen für alle, Löschen nur im Büro)
function fileListHtml(job, canDelete) {
  if (!job.files.length) return '<p class="muted small-text">Keine Dateien angehängt.</p>';
  return `<div class="file-list">${job.files.map(f => `
    <div class="file-row">
      <button type="button" class="file-open" onclick="openJobFile('${f.id}')">
        ${fileIcon(f.type)}<span><b>${escapeHtml(f.name)}</b><small>${escapeHtml(formatFileSize(f.size))}</small></span>
      </button>
      ${canDelete ? `<button type="button" class="icon-btn small danger-hover" onclick="removeJobFile('${job.id}','${f.id}')" aria-label="Datei entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ''}
    </div>`).join('')}</div>`;
}

async function openJobFile(fileId) {
  try {
    const blob = await getFile(fileId);
    if (!blob) { showToast('Datei nicht gefunden'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60000);
  } catch (e) {
    console.error(e);
    showToast('Datei konnte nicht geöffnet werden');
  }
}

// ---------- Liste ----------
function setJobFilter(f) {
  jobFilter = f;
  renderJobs();
}

function renderJobs() {
  const office = isOffice();
  const q = (document.getElementById('job-search') || {}).value || '';
  const ql = q.trim().toLowerCase();
  let jobs = appData.jobs.slice();
  if (jobFilter !== 'alle') jobs = jobs.filter(j => (j.status || 'offen') === jobFilter);
  if (ql) jobs = jobs.filter(j => [j.orderNo, j.customer, j.vessel, j.description, (j.assigned || []).join(' ')].some(v => String(v || '').toLowerCase().includes(ql)));
  jobs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (!office) jobs.sort((a, b) => (isAssignedToMe(b) ? 1 : 0) - (isAssignedToMe(a) ? 1 : 0));
  const counts = { offen: 0, erledigt: 0 };
  appData.jobs.forEach(j => { counts[j.status || 'offen'] = (counts[j.status || 'offen'] || 0) + 1; });

  const cards = jobs.map(j => {
    const sheets = jobAllSheets(j);
    const hours = jobHours(j, sheets).worked;
    const workers = distinctJoin(sheets.map(s => s.worker));
    const mine = !office && isAssignedToMe(j);
    return `
      <button class="sheet-card job-card ${j.status === 'erledigt' ? 'done' : ''}" onclick="openJob('${j.id}')">
        <div class="sc-top">
          <span class="type-pill">${JOB_KINDS[j.kind] || 'Auftrag'}${mine ? ' · für dich' : ''}</span>
          <span class="badge ${j.status === 'erledigt' ? 'badge-ok' : 'badge-open'}">${j.status === 'erledigt' ? 'Erledigt' : 'Offen'}</span>
        </div>
        <div class="sc-title">${escapeHtml(j.orderNo || 'ohne Auftragsnummer')}</div>
        <div class="sc-sub">${escapeHtml([j.vessel, j.customer].filter(Boolean).join(' · ') || 'ohne Kunde')}${planText(j) ? ' · ' + escapeHtml(planText(j)) : ''}</div>
        ${j.description ? `<div class="job-desc-snip">${escapeHtml(j.description.slice(0, 140))}${j.description.length > 140 ? '…' : ''}</div>` : ''}
        <div class="sc-bottom">
          <span class="sc-hours">${sheets.length ? formatHours(hours) + ` <small>· ${sheets.length} Zettel${workers ? ' · ' + escapeHtml(workers) : ''}</small>` : '<small>noch keine Zettel</small>'}</span>
          <span class="sc-badges">${j.files.length ? `<span class="badge">📎 ${j.files.length}</span>` : ''}${(j.assigned || []).map(n => `<span class="badge">${escapeHtml(n)}</span>`).join('')}</span>
        </div>
      </button>`;
  }).join('');

  document.getElementById('jobs-body').innerHTML = `
    ${office ? `<button class="btn btn-primary block" onclick="createJob()">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Neuen Auftrag anlegen</button>` : ''}
    <div class="toolbar">
      <div class="search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input type="search" id="job-search" placeholder="Suchen: Auftrag, Kunde, Schiff …" value="${escapeHtml(q)}" oninput="renderJobsKeepFocus()">
      </div>
      <div class="chips">
        <button class="chip ${jobFilter === 'offen' ? 'active' : ''}" onclick="setJobFilter('offen')">Offen (${counts.offen || 0})</button>
        <button class="chip ${jobFilter === 'erledigt' ? 'active' : ''}" onclick="setJobFilter('erledigt')">Erledigt (${counts.erledigt || 0})</button>
        <button class="chip ${jobFilter === 'alle' ? 'active' : ''}" onclick="setJobFilter('alle')">Alle</button>
      </div>
    </div>
    <div class="sheet-list">${cards || `<div class="empty small"><p>${appData.jobs.length ? 'Keine Aufträge in dieser Ansicht.' : office ? 'Noch keine Aufträge angelegt.' : 'Noch keine Aufträge vom Büro vorhanden.'}</p></div>`}</div>`;
}

// Suche ohne Fokusverlust
function renderJobsKeepFocus() {
  const el = document.getElementById('job-search');
  const pos = el ? el.selectionStart : 0;
  renderJobs();
  const n = document.getElementById('job-search');
  if (n) { n.focus(); n.setSelectionRange(pos, pos); }
}

// ---------- Anlegen / Öffnen ----------
function createJob() {
  const job = {
    id: uid(),
    createdAt: new Date().toISOString(),
    createdBy: appData.settings.officeName || '',
    orderNo: '', customer: '', vessel: '',
    engines: [{}],
    description: '',
    files: [],
    status: 'offen',
    kind: 'montage',
    assigned: [],
    planFrom: '', planTo: ''
  };
  appData.jobs.push(job);
  saveData(true);
  openJob(job.id);
}

function openJob(id) {
  activeJobId = id;
  showView('job');
}

// ---------- Detail ----------
function renderJob() {
  const job = getActiveJob();
  if (!job) { showView('jobs'); return; }
  const office = isOffice();
  setTopbarTitle(job.orderNo ? 'Auftrag ' + job.orderNo : 'Neuer Auftrag');
  const sheets = jobAllSheets(job);
  const montageSheets = sheets.filter(s => s.type === 'montage');
  const workers = knownTechnicians().filter(n => !(job.assigned || []).some(a => sameName(a, n)));

  // Zettel zum Auftrag, nach Techniker gruppiert
  const byWorker = {};
  sheets.forEach(s => { const w = s.worker || 'ohne Namen'; (byWorker[w] = byWorker[w] || []).push(s); });
  const sheetsHtml = sheets.length ? Object.keys(byWorker).map(w => {
    const list = byWorker[w];
    const t = jobHours(job, list);
    return `
      <div class="job-worker">
        <div class="h-week-head"><span>${escapeHtml(w)}</span><span>${formatHours(t.worked)}${t.ot ? ' · ' + formatHours(t.ot) + ' Überstd.' : ''}</span></div>
        ${list.map(s => `
          <button class="o-day" onclick="openEditor('${s.id}','job')">
            <span class="h-date">${escapeHtml(sheetDateRange(s))}</span>
            <span class="h-src"><span class="src ${s.type === 'werkstatt' ? 'off' : ''}">${s.type === 'werkstatt' ? 'Werkstatt' : 'Montage'}</span>${s.signCustomer ? '<span class="src ok">unterschr.</span>' : ''}${s.finished === true ? '<span class="src">beendet</span>' : ''}</span>
            <span class="o-num">${formatHours(jobSheetHours(job, s).normal)}</span>
            <span class="o-num ot">${jobSheetHours(job, s).ot ? formatHours(jobSheetHours(job, s).ot) : '–'}</span>
          </button>`).join('')}
      </div>`;
  }).join('') + (sheets.some(s => s.type === 'werkstatt') ? '<p class="muted small-text">Werkstatt: gezählt werden nur Zeilen mit dieser Auftragsnummer als Kostenstelle.</p>' : '')
    : '<p class="muted small-text">Zu dieser Auftragsnummer gibt es noch keine Zettel.</p>';

  let html;
  if (office) {
    html = `
      <div class="card">
        <label class="field"><span>Auftragsart</span>
          <div class="seg">
            ${Object.keys(JOB_KINDS).map(k => `<button type="button" class="${job.kind === k ? 'on' : ''}" onclick="setJobKind('${k}')">${JOB_KINDS[k]}</button>`).join('')}
          </div>
        </label>
        <div class="job-status-row">
          <h3 class="card-title">Auftrag</h3>
          <div class="seg mini-seg">
            <button type="button" class="${job.status !== 'erledigt' ? 'on' : ''}" onclick="setJobStatus('offen')">Offen</button>
            <button type="button" class="${job.status === 'erledigt' ? 'on' : ''}" onclick="setJobStatus('erledigt')">Erledigt</button>
          </div>
        </div>
        <div class="grid-2">
          ${field('Auftragsnummer', 'orderNo', job.orderNo, { placeholder: 'SR26/000249 oder nur 249', orderno: 'order', rerender: true })}
          ${field('Auftraggeber / Kunde', 'customer', job.customer, { placeholder: 'Firma', list: 'dl-job-customers' })}
          ${job.kind !== 'werkstatt' ? field('Schiffsname / Anlage', 'vessel', job.vessel, { placeholder: 'z.B. MS Hanna', list: 'dl-job-vessels' }) : ''}
        </div>
        <h4 class="sub-title">Monteure zuteilen</h4>
        <div class="assign-chips">
          ${job.assigned.length ? job.assigned.map((n, i) => `<span class="assign-chip">${escapeHtml(n)}<button type="button" onclick="removeAssignee(${i})" aria-label="${escapeHtml(n)} entfernen">×</button></span>`).join('') : '<span class="muted small-text">Noch niemand zugeteilt.</span>'}
        </div>
        <div class="assign-add">
          <input type="text" id="assign-name" list="dl-job-workers" placeholder="Name des Monteurs" autocomplete="off"
            onkeydown="if(event.key==='Enter'){event.preventDefault();addAssignee();}">
          <button type="button" class="btn btn-soft" onclick="addAssignee()">Zuteilen</button>
        </div>
        <div class="grid-2 plan-dates">
          ${field('Einsatz von (optional)', 'planFrom', job.planFrom, { type: 'date', rerender: true })}
          ${field('bis', 'planTo', job.planTo, { type: 'date', rerender: true })}
        </div>
        ${engineSection(job, 'jobAddEngine', 'jobRemoveEngine')}
      </div>

      <div class="card">
        <h3 class="card-title">Beschreibung</h3>
        <label class="field"><textarea data-bind="description" rows="6" placeholder="Was ist zu tun? Ansprechpartner, Liegeplatz, Besonderheiten …">${escapeHtml(job.description || '')}</textarea></label>
        <h4 class="sub-title">Dateien (PDF, Fotos)</h4>
        ${fileListHtml(job, true)}
        <button type="button" class="btn btn-soft" onclick="document.getElementById('job-file').click()">
          <svg viewBox="0 0 24 24"><path d="M21 12.5l-8.5 8.5a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-3-3L15 8.5"/></svg> Datei anhängen</button>
        <input type="file" id="job-file" accept="application/pdf,image/*" multiple hidden onchange="addJobFiles(this)">
      </div>

      <div class="card">
        <h3 class="card-title">Zettel der Techniker</h3>
        ${sheetsHtml}
        ${montageSheets.length ? `<button type="button" class="btn btn-soft" onclick="openOrder(${escapeHtml(JSON.stringify(normOrderNo(job.orderNo)))})">Zusammenstellung &amp; Druck</button>` : ''}
      </div>

      <div class="editor-footer">
        <button type="button" class="btn btn-danger-ghost" onclick="deleteJob('${job.id}')">Auftrag löschen</button>
        <button type="button" class="btn btn-primary" onclick="showView('jobs')">Fertig</button>
      </div>
      <datalist id="dl-job-customers">${Array.from(new Set(appData.sheets.concat(appData.jobs).map(x => x.customer).filter(Boolean))).map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
      <datalist id="dl-job-vessels">${Array.from(new Set(appData.sheets.concat(appData.jobs).map(x => x.vessel).filter(Boolean))).map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
      <datalist id="dl-job-workers">${workers.map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
      ${engineDatalists()}`;
  } else {
    // Techniker: nur ansehen + Zettel anlegen
    const engines = (job.engines || []).filter(engineHasData);
    const mySheets = sheets.filter(isOwnSheet);
    html = `
      <div class="card">
        <div class="job-status-row">
          <h3 class="card-title">${escapeHtml(JOB_KINDS[job.kind] || 'Auftrag')} ${escapeHtml(job.orderNo || '')}</h3>
          <span class="badge ${job.status === 'erledigt' ? 'badge-ok' : 'badge-open'}">${job.status === 'erledigt' ? 'Erledigt' : 'Offen'}</span>
        </div>
        <dl class="job-facts">
          <dt>Kunde</dt><dd>${escapeHtml(job.customer || '–')}</dd>
          <dt>Schiff / Anlage</dt><dd>${escapeHtml(job.vessel || '–')}</dd>
          ${job.assigned.length ? `<dt>Monteure</dt><dd>${escapeHtml(job.assigned.join(', '))}</dd>` : ''}
          ${planText(job) ? `<dt>Einsatz</dt><dd>${escapeHtml(planText(job))}</dd>` : ''}
        </dl>
        ${engines.length ? `<h4 class="sub-title">${engines.length > 1 ? engines.length + ' Motoren' : 'Motor'}</h4>
          <div class="engine-facts">${engines.map((e, i) => `
            <div class="engine-fact"><b>${escapeHtml(e.name || (engines.length > 1 ? 'Motor ' + (i + 1) : 'Motor'))}</b>
              <span>${escapeHtml([e.make, e.model].filter(Boolean).join(' ') || '–')}</span>
              <span>Nr. ${escapeHtml(e.number || '–')} · Betriebsstd. ${escapeHtml(e.hours || '–')}</span></div>`).join('')}</div>` : ''}
      </div>
      <div class="card">
        <h3 class="card-title">Beschreibung</h3>
        <p class="job-desc">${job.description ? escapeHtml(job.description) : '<span class="muted">Keine Beschreibung.</span>'}</p>
        ${job.files.length ? `<h4 class="sub-title">Dateien</h4>${fileListHtml(job, false)}` : ''}
      </div>
      <button type="button" class="btn btn-primary block" onclick="createSheetFromJob('${job.id}')">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> ${job.kind === 'werkstatt' ? 'Werkstattzeit für diesen Auftrag eintragen' : 'Zettel für diesen Auftrag anlegen'}</button>
      ${mySheets.length ? `<div class="card"><h3 class="card-title">Meine Zettel zu diesem Auftrag</h3>${mySheets.map(s => `
        <button class="o-day" onclick="openEditor('${s.id}','job')">
          <span class="h-date">${escapeHtml(sheetDateRange(s))}</span><span class="h-src"></span>
          <span class="o-num">${formatHours(jobSheetHours(job, s).normal)}</span>
          <span class="o-num ot">${jobSheetHours(job, s).ot ? formatHours(jobSheetHours(job, s).ot) : '–'}</span>
        </button>`).join('')}</div>` : ''}`;
  }
  document.getElementById('job-body').innerHTML = html;
}

// Vorschlagslisten für Motordaten (wie im Zettel-Editor)
function engineDatalists() {
  const sets = { name: new Set(['BB', 'SB', 'Backbord', 'Steuerbord']), make: new Set(), model: new Set(), number: new Set() };
  appData.sheets.concat(appData.jobs).forEach(x => (x.engines || []).forEach(e => Object.keys(sets).forEach(k => { if (e[k]) sets[k].add(e[k]); })));
  const ids = { name: 'dl-eng-name', make: 'dl-eng-make', model: 'dl-eng-model', number: 'dl-eng-number' };
  return Object.keys(sets).map(k => `<datalist id="${ids[k]}">${Array.from(sets[k]).map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>`).join('');
}

// ---------- Eingaben im Auftrag (Büro) ----------
function handleJobInput(ev) {
  const el = ev.target;
  const bind = el.dataset && el.dataset.bind;
  if (!bind) return;
  const job = getActiveJob();
  if (!job || !isOffice()) return;
  setPath(job, bind, el.value);
  if (ev.type === 'change' && el.dataset.orderno) {
    const v = formatOrderNo(el.value, todayISO(), true);
    if (v !== el.value) { el.value = v; setPath(job, bind, v); }
  }
  job.updatedAt = new Date().toISOString();
  saveData();
  if (ev.type === 'change' && el.dataset.rerender) renderJob();
}

document.addEventListener('DOMContentLoaded', () => {
  const body = document.getElementById('job-body');
  body.addEventListener('input', handleJobInput);
  body.addEventListener('change', handleJobInput);
});

function setJobStatus(status) {
  const job = getActiveJob();
  job.status = status;
  saveData(true);
  renderJob();
}

function jobAddEngine() {
  const job = getActiveJob();
  const first = job.engines[0] || {};
  job.engines.push({ name: '', make: first.make || '', model: first.model || '', number: '', hours: '' });
  saveData();
  renderJob();
}

async function jobRemoveEngine(i) {
  const job = getActiveJob();
  if (engineHasData(job.engines[i]) && !(await confirmDialog('Motor mit den eingetragenen Daten entfernen?', 'Entfernen', true))) return;
  job.engines.splice(i, 1);
  if (!job.engines.length) job.engines = [{}];
  saveData();
  renderJob();
}

async function addJobFiles(input) {
  const job = getActiveJob();
  const files = Array.from(input.files || []);
  input.value = '';
  let added = 0;
  for (const f of files) {
    if (f.size > MAX_FILE_MB * 1024 * 1024) { showToast(`„${f.name}“ ist größer als ${MAX_FILE_MB} MB`); continue; }
    const id = uid();
    try {
      await saveFile(id, f);
      job.files.push({ id, name: f.name, type: f.type || '', size: f.size });
      added++;
    } catch (e) {
      console.error(e);
      showToast(`„${f.name}“ konnte nicht gespeichert werden`);
    }
  }
  saveData(true);
  renderJob();
  if (added) showToast(added === 1 ? 'Datei angehängt' : `${added} Dateien angehängt`);
}

async function removeJobFile(jobId, fileId) {
  const job = getJob(jobId);
  const f = job && job.files.find(x => x.id === fileId);
  if (!f || !(await confirmDialog(`Datei „${f.name}“ entfernen?`, 'Entfernen', true))) return;
  job.files = job.files.filter(x => x.id !== fileId);
  deleteFile(fileId).catch(() => {});
  saveData(true);
  renderJob();
}

async function deleteJob(id) {
  const job = getJob(id);
  if (!job) return;
  if (!(await confirmDialog(`Auftrag ${job.orderNo || ''} löschen? Die Zettel der Techniker bleiben erhalten.`, 'Löschen', true))) return;
  job.files.forEach(f => deleteFile(f.id).catch(() => {}));
  appData.jobs = appData.jobs.filter(j => j.id !== id);
  saveData(true);
  showView('jobs');
  showToast('Auftrag gelöscht');
}

// ---------- Techniker: Zettel aus Auftrag ----------
// kind: bei gemischten Aufträgen 'montage' | 'werkstatt' (sonst wird gefragt)
// date: Datum des Zettels (Wochenleiste), sonst heute bzw. Folgetag
function createSheetFromJob(id, kind, date) {
  const job = getJob(id);
  if (!job) return;
  newSheetDate = date || null;
  const dateArg = date ? `'${date}'` : 'null';
  const from = currentView === 'job' ? 'job' : null;
  const k = job.kind === 'mix' ? kind : (job.kind || 'montage');
  if (!k) {
    openModal(`
      <h2 class="modal-title">Auftrag ${escapeHtml(job.orderNo || '')}</h2>
      <p class="modal-text muted">Gemischter Auftrag – was machst du heute?</p>
      <div class="type-choice">
        <button class="type-btn" onclick="closeModal();createSheetFromJob('${job.id}','montage',${dateArg})">
          <svg viewBox="0 0 24 24"><path d="M3 17h18l-2 4H5z"/><path d="M5 17V9h8l3 4v4"/><path d="M8 9V5h3v4"/></svg>
          <strong>Montage</strong><span>Montagezettel mit Anfahrt, Hotel, Auslöse, Unterschrift</span>
        </button>
        <button class="type-btn" onclick="closeModal();createSheetFromJob('${job.id}','werkstatt',${dateArg})">
          <svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/></svg>
          <strong>Werkstatt</strong><span>Zeile im heutigen Werkstattzettel mit der Auftragsnummer als Kostenstelle</span>
        </button>
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button></div>`);
    return;
  }
  if (k === 'werkstatt') { addWorkshopEntryForJob(job, from); return; }
  // Montage: Gibt es schon eigene Montagezettel zum Auftrag? → Folgetag des letzten
  const own = jobSheets(job).filter(isOwnSheet);
  if (own.length) { nextDaySheet(own[own.length - 1].id, from); return; }
  createSheet('montage');
  const sheet = getActiveSheet();
  sheet.orderNo = normOrderNo(job.orderNo);
  sheet.customer = job.customer || '';
  sheet.vessel = job.vessel || '';
  sheet.engines = copyEngines(job.engines);
  editorReturn = from;
  saveData(true);
  renderEditor();
  showToast('Zettel mit den Auftragsdaten angelegt');
}

// Werkstatt: neue Zeile mit der Auftragsnummer als Kostenstelle im eigenen
// Werkstattzettel von heute (wird bei Bedarf angelegt)
function addWorkshopEntryForJob(job, from) {
  const today = takeNewSheetDate(); // gewählter Tag oder heute
  const existing = appData.sheets.find(s => s.type === 'werkstatt' && isOwnSheet(s) && s.days.some(d => d.date === today));
  if (existing) openEditor(existing.id, from);
  else { newSheetDate = today; createSheet('werkstatt'); editorReturn = from; }
  const sheet = getActiveSheet();
  const di = Math.max(0, sheet.days.findIndex(d => d.date === today));
  addEntry(di, null, normOrderNo(job.orderNo));
  showToast(`Werkstatt-Zeile für ${normOrderNo(job.orderNo) || 'den Auftrag'} angelegt`);
}

function setJobKind(k) {
  const job = getActiveJob();
  if (!JOB_KINDS[k]) return;
  job.kind = k;
  saveData(true);
  renderJob();
}

// ---------- Büro: Kopf der Zettel-Liste mit Techniker-Filter ----------
function renderOfficeHead() {
  const el = document.getElementById('office-head');
  if (!el) return;
  if (!isOffice()) { el.innerHTML = ''; return; }
  const workers = Array.from(new Set(appData.sheets.map(s => s.worker || '').filter(Boolean))).sort();
  const total = appData.sheets.filter(s => !workerFilter || (s.worker || '') === workerFilter);
  el.innerHTML = `
    <div class="card office-card">
      <div><b>Alle Zettel aller Techniker</b><span class="muted small-text"> · ${total.length} Zettel · nur ansehen</span></div>
      <label class="field"><span>Techniker</span>
        <select onchange="workerFilter = this.value; renderSheetList()">
          <option value="">Alle Techniker</option>
          ${workers.map(w => `<option ${w === workerFilter ? 'selected' : ''}>${escapeHtml(w)}</option>`).join('')}
          ${appData.sheets.some(s => !s.worker) ? `<option value="__none" ${workerFilter === '__none' ? 'selected' : ''}>ohne Namen</option>` : ''}
        </select>
      </label>
    </div>`;
}

// Filter der Zettel-Liste je Rolle:
// Büro → Techniker-Auswahl; Techniker → nur eigene Zettel (bzw. ohne Namen)
function sheetVisibleForRole(s) {
  if (isOffice()) {
    if (!workerFilter) return true;
    if (workerFilter === '__none') return !s.worker;
    return (s.worker || '') === workerFilter;
  }
  const me = currentUserName().toLowerCase();
  return !s.worker || !me || s.worker.toLowerCase() === me;
}

window.openRoleChooser = openRoleChooser;
window.loginAs = loginAs;
window.chooseRole = chooseRole;
window.renderJobs = renderJobs;
window.renderJobsKeepFocus = renderJobsKeepFocus;
window.setJobFilter = setJobFilter;
window.createJob = createJob;
window.openJob = openJob;
window.setJobStatus = setJobStatus;
window.jobAddEngine = jobAddEngine;
window.jobRemoveEngine = jobRemoveEngine;
window.addJobFiles = addJobFiles;
window.removeJobFile = removeJobFile;
window.openJobFile = openJobFile;
window.deleteJob = deleteJob;
window.createSheetFromJob = createSheetFromJob;
window.setJobKind = setJobKind;
window.addAssignee = addAssignee;
window.removeAssignee = removeAssignee;
