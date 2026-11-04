// =====================================================================
// 04-editor: Zettel bearbeiten (Kopf, Tage mit Zeiten, Abwesenheit,
// Hotel, An-/Rückfahrt, Material, Abschluss, Unterschriften)
//
// Eingabefelder tragen data-bind="pfad.im.zettel" (z.B. "days.0.entries.2.from").
// Änderungen werden per Event-Delegation in den Zettel geschrieben und
// automatisch gespeichert.
// =====================================================================

let activeSheetId = null;

function getActiveSheet() {
  return appData.sheets.find(s => s.id === activeSheetId) || null;
}

function openEditor(id) {
  activeSheetId = id;
  showView('editor');
  activeSheetId = id; // showView setzt außerhalb des Editors zurück
  renderEditor();
}

function closeEditor() {
  flushSave();
  showView('sheets');
}

// ---------- Pfad-Helfer ----------
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => {
    if (o[k] == null) o[k] = {};
    return o[k];
  }, obj);
  target[last] = value;
}

// ---------- Bausteine ----------
function field(label, bind, value, opts = {}) {
  const type = opts.type || 'text';
  const attrs = [
    `type="${type}"`,
    `data-bind="${bind}"`,
    `value="${escapeHtml(value ?? '')}"`,
    opts.placeholder ? `placeholder="${escapeHtml(opts.placeholder)}"` : '',
    opts.inputmode ? `inputmode="${opts.inputmode}"` : '',
    opts.list ? `list="${opts.list}"` : '',
    opts.rerender ? 'data-rerender="1"' : '',
    'autocomplete="off"'
  ].filter(Boolean).join(' ');
  return `<label class="field ${opts.cls || ''}"><span>${escapeHtml(label)}</span><input ${attrs}></label>`;
}

function yesNo(label, bind, value) {
  return `
    <div class="field yesno">
      <span>${escapeHtml(label)}</span>
      <div class="seg">
        <button type="button" class="${value === true ? 'on yes' : ''}" data-set="${bind}" data-val="true">Ja</button>
        <button type="button" class="${value === false ? 'on no' : ''}" data-set="${bind}" data-val="false">Nein</button>
      </div>
    </div>`;
}

function codeOptions(selected) {
  const codes = appData.settings.codes.slice();
  if (selected && !codes.some(c => c.code === selected)) codes.push({ code: selected, label: '(unbekannt)' });
  return codes.map(c => `<option value="${escapeHtml(c.code)}" ${c.code === selected ? 'selected' : ''} title="${escapeHtml(c.label)}">${escapeHtml(c.code)}${c.label ? ' · ' + escapeHtml(c.label) : ''}</option>`).join('');
}

function entryRow(e, di, ei) {
  const p = `days.${di}.entries.${ei}`;
  const mins = entryMinutes(e);
  const bad = (e.from && parseTime(e.from) == null) || (e.to && parseTime(e.to) == null);
  const counts = codeCounts(e.code);
  return `
    <div class="entry ${bad ? 'invalid' : ''} ${counts ? '' : 'no-count'}">
      <div class="entry-times">
        <input class="t-in" data-bind="${p}.from" data-time="1" value="${escapeHtml(e.from || '')}" placeholder="0630" inputmode="numeric" autocomplete="off" aria-label="Von">
        <span class="dash">–</span>
        <input class="t-in" data-bind="${p}.to" data-time="1" value="${escapeHtml(e.to || '')}" placeholder="0700" inputmode="numeric" autocomplete="off" aria-label="Bis">
        <select class="code-sel" data-bind="${p}.code" data-rerender="1" aria-label="Zeitart">${codeOptions(e.code)}</select>
        <span class="entry-dur" data-dur="${di}.${ei}">${mins ? formatHours(mins) : '–'}</span>
        <button type="button" class="icon-btn small danger-hover" onclick="removeEntry(${di},${ei})" aria-label="Zeile löschen">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <input class="entry-desc" data-bind="${p}.desc" value="${escapeHtml(e.desc || '')}" placeholder="Was wurde gemacht?" autocomplete="off">
    </div>`;
}

function dayCard(day, di, sheet) {
  const isMontage = sheet.type === 'montage';
  const worked = dayWorkedMinutes(day);
  const d = parseISODate(day.date);
  const target = baseTargetMinutes(day.date);
  let montageExtras = '';
  if (isMontage) {
    montageExtras = `
      <div class="day-extras">
        <label class="field">
          <span>Abwesenheit (Auslöse)</span>
          <select data-bind="days.${di}.away">
            ${AWAY_OPTIONS.map(o => `<option value="${o.value}" ${day.away === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </label>
        <label class="check">
          <input type="checkbox" data-bind="days.${di}.hotel" data-rerender="1" ${day.hotel ? 'checked' : ''}>
          <span>Übernachtung im Hotel</span>
        </label>
        ${day.hotel ? `
          <div class="grid-2">
            ${field('Hotel', `days.${di}.hotelName`, day.hotelName, { placeholder: 'Name / Ort', list: 'dl-hotels' })}
            ${yesNo('Frühstück', `days.${di}.breakfast`, day.breakfast)}
          </div>` : ''}
      </div>`;
  }
  return `
    <div class="card day-card" data-day="${di}">
      <div class="day-head">
        <div class="day-date">
          <input type="date" data-bind="days.${di}.date" data-rerender="1" value="${escapeHtml(day.date || '')}" aria-label="Datum">
          <span class="day-wd">${d ? WEEKDAYS_LONG[d.getDay()] : ''}</span>
        </div>
        <div class="day-sum">
          <strong data-daysum="${di}">${formatHours(worked)}</strong>
          <small data-daydelta="${di}">${dayDeltaText(worked, target)}</small>
        </div>
        ${sheet.days.length > 1 ? `<button type="button" class="icon-btn small danger-hover" onclick="removeDay(${di})" aria-label="Tag löschen">
          <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>` : ''}
      </div>
      <div class="entries">
        ${day.entries.length ? day.entries.map((e, ei) => entryRow(e, di, ei)).join('') : '<p class="muted small-text">Noch keine Zeiten eingetragen.</p>'}
      </div>
      <div class="entry-add">
        <button type="button" class="btn btn-soft" onclick="addEntry(${di})">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Zeile
        </button>
        <div class="quick-codes">
          ${appData.settings.codes.slice(0, 5).map(c => `<button type="button" class="chip mini" onclick="addEntry(${di},'${escapeHtml(c.code)}')" title="${escapeHtml(c.label)}">+${escapeHtml(c.code)}</button>`).join('')}
        </div>
      </div>
      ${montageExtras}
    </div>`;
}

function dayDeltaText(worked, target) {
  if (!worked) return target ? 'Soll ' + formatHours(target) : '';
  const diff = worked - target;
  if (diff > 0) return `davon ${formatHours(diff)} Überstd.`;
  if (diff < 0) return `${formatHours(-diff)} unter Soll`;
  return 'Soll erfüllt';
}

function travelBlock(title, key, t) {
  const p = key;
  return `
    <div class="sub-block">
      <h4>${title}</h4>
      <div class="grid-2">
        ${field('Von', `${p}.from`, t.from, { placeholder: 'Ort', list: 'dl-places' })}
        ${field('Nach', `${p}.to`, t.to, { placeholder: 'Ort', list: 'dl-places' })}
        ${field('Datum', `${p}.date`, t.date, { type: 'date' })}
        ${field('Kilometer', `${p}.km`, t.km, { inputmode: 'decimal', placeholder: 'km' })}
        ${field('Zeit (Std.)', `${p}.duration`, t.duration, { placeholder: 'z.B. 2:30', inputmode: 'text' })}
        <label class="field">
          <span>Verkehrsmittel</span>
          <select data-bind="${p}.vehicle" data-rerender="1">
            <option value="">– wählen –</option>
            ${VEHICLE_OPTIONS.map(v => `<option ${t.vehicle === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
        ${t.vehicle === 'Firmenwagen' ? field('Kennzeichen', `${p}.plate`, t.plate, { placeholder: 'z.B. HH-AB 123', cls: 'span-2' }) : ''}
      </div>
    </div>`;
}

function signatureBox(label, sign, who) {
  if (sign && sign.img) {
    return `
      <div class="sign-box signed">
        <span class="sign-label">${escapeHtml(label)}</span>
        <img src="${sign.img}" alt="Unterschrift">
        <div class="sign-meta">${escapeHtml(sign.name || '')}${sign.name ? ' · ' : ''}${escapeHtml(new Date(sign.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}</div>
        <button type="button" class="link-btn" onclick="removeSignature('${who}')">Unterschrift entfernen</button>
      </div>`;
  }
  return `
    <button type="button" class="sign-box empty" onclick="startSignature('${who}')">
      <span class="sign-label">${escapeHtml(label)}</span>
      <svg viewBox="0 0 24 24"><path d="M3 17c3-4 5-6 7-6s0 6 2 6 3-3 5-3 2 2 4 2"/><path d="M3 21h18"/></svg>
      <span>Tippen zum Unterschreiben</span>
    </button>`;
}

function datalists() {
  const places = new Set(), hotels = new Set(), customers = new Set(), vessels = new Set();
  appData.sheets.forEach(s => {
    ['travelOut', 'travelBack'].forEach(k => { if (s[k]) { if (s[k].from) places.add(s[k].from); if (s[k].to) places.add(s[k].to); } });
    s.days.forEach(d => { if (d.hotelName) hotels.add(d.hotelName); });
    if (s.customer) customers.add(s.customer);
    if (s.vessel) vessels.add(s.vessel);
  });
  if (appData.settings.home) places.add(appData.settings.home);
  const dl = (id, set) => `<datalist id="${id}">${Array.from(set).map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>`;
  return dl('dl-places', places) + dl('dl-hotels', hotels) + dl('dl-customers', customers) + dl('dl-vessels', vessels);
}

// ---------- Rendern ----------
function renderEditor(keepScroll) {
  const sheet = getActiveSheet();
  if (!sheet) { showView('sheets'); return; }
  const scrollY = window.scrollY;
  const isMontage = sheet.type === 'montage';
  const locked = !!(sheet.signCustomer && sheet.signCustomer.img);
  setTopbarTitle(isMontage ? 'Montagezettel' : 'Werkstattzettel');

  const total = sheetWorkedMinutes(sheet);
  const byCode = sheetMinutesByCode(sheet);
  const codeSummary = Object.keys(byCode).map(k => `<span class="code-chip ${codeCounts(k) ? '' : 'no-count'}"><b>${escapeHtml(k)}</b> ${formatHours(byCode[k])}</span>`).join('');

  let html = datalists();

  if (locked) {
    html += `
      <div class="lock-banner">
        <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        <div><strong>Vom Kunden unterschrieben</strong><span>Der Zettel ist gesperrt. Zum Ändern muss die Unterschrift entfernt werden.</span></div>
      </div>`;
  }

  html += `<fieldset class="editor-form" ${locked ? 'disabled' : ''}>`;

  // Summenleiste
  html += `
    <div class="sum-bar">
      <div><span class="muted">Gesamt</span><strong data-total>${formatHours(total)}</strong></div>
      <div class="code-chips" data-codesum>${codeSummary || '<span class="muted">Noch keine Zeiten</span>'}</div>
    </div>`;

  // Kopf
  if (isMontage) {
    html += `
      <div class="card">
        <h3 class="card-title">Auftrag</h3>
        <div class="grid-2">
          ${field('Auftragsnummer', 'orderNo', sheet.orderNo, { placeholder: 'z.B. 24-1187', inputmode: 'text' })}
          ${field('Auftraggeber / Kunde', 'customer', sheet.customer, { placeholder: 'Firma', list: 'dl-customers' })}
          ${field('Schiffsname / Anlage', 'vessel', sheet.vessel, { placeholder: 'z.B. MS Hanna', list: 'dl-vessels', cls: 'span-2' })}
        </div>
      </div>`;
  }

  // Tage
  html += `<div class="section-head"><h3>Zeiten &amp; Arbeiten</h3><span class="muted small-text">Zeit als 0630 eintippen</span></div>`;
  html += sheet.days.map((d, di) => dayCard(d, di, sheet)).join('');
  html += `<button type="button" class="btn btn-soft block" onclick="addDay()">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Weiteren Tag hinzufügen</button>`;

  if (isMontage) {
    const tb = sheet.travelBack || {};
    html += `
      <div class="card">
        <h3 class="card-title">Anfahrt &amp; Rückfahrt</h3>
        ${travelBlock('Anfahrt', 'travelOut', sheet.travelOut || {})}
        ${travelBlock('Rückfahrt', 'travelBack', tb)}
        <button type="button" class="link-btn" onclick="copyTravelBack()">Rückfahrt = Anfahrt umgekehrt übernehmen</button>
        <p class="muted small-text">Fahr-/Lenkzeiten für die Stunden bitte als FZ/LZ-Zeile bei den Zeiten eintragen.</p>
      </div>

      <div class="card">
        <h3 class="card-title">Abschluss</h3>
        <div class="grid-2">
          ${yesNo('Material verwendet', 'material', sheet.material)}
          ${yesNo('Montage beendet', 'finished', sheet.finished)}
        </div>
        ${sheet.material === true ? `<label class="field"><span>Verwendetes Material</span><textarea data-bind="materialNote" rows="3" placeholder="z.B. 2x Dichtung DN50, 10m Kabel …">${escapeHtml(sheet.materialNote || '')}</textarea></label>` : ''}
        <label class="field"><span>Bemerkung</span><textarea data-bind="note" rows="3" placeholder="Optional">${escapeHtml(sheet.note || '')}</textarea></label>
      </div>`;
  } else {
    html += `
      <div class="card">
        <label class="field"><span>Bemerkung</span><textarea data-bind="note" rows="2" placeholder="Optional">${escapeHtml(sheet.note || '')}</textarea></label>
      </div>`;
  }

  html += `</fieldset>`;

  if (isMontage) {
    html += `
      <div class="card">
        <h3 class="card-title">Unterschriften</h3>
        <div class="sign-grid">
          ${signatureBox('Monteur', sheet.signWorker, 'worker')}
          ${signatureBox('Kunde / Auftraggeber', sheet.signCustomer, 'customer')}
        </div>
      </div>`;
  }

  html += `
    <div class="editor-footer">
      <button type="button" class="btn btn-ghost" onclick="printActiveSheet()">
        <svg viewBox="0 0 24 24"><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg> Drucken / PDF</button>
      <button type="button" class="btn btn-primary" onclick="closeEditor()">Fertig</button>
    </div>`;

  document.getElementById('editor-body').innerHTML = html;
  if (keepScroll) window.scrollTo(0, scrollY);
}

// Summen aktualisieren, ohne die Eingabefelder neu zu zeichnen (Fokus bleibt)
function refreshEditorSums() {
  const sheet = getActiveSheet();
  if (!sheet) return;
  const body = document.getElementById('editor-body');
  sheet.days.forEach((d, di) => {
    const w = dayWorkedMinutes(d);
    const s = body.querySelector(`[data-daysum="${di}"]`);
    if (s) s.textContent = formatHours(w);
    const dd = body.querySelector(`[data-daydelta="${di}"]`);
    if (dd) dd.textContent = dayDeltaText(w, baseTargetMinutes(d.date));
    d.entries.forEach((e, ei) => {
      const el = body.querySelector(`[data-dur="${di}.${ei}"]`);
      const m = entryMinutes(e);
      if (el) el.textContent = m ? formatHours(m) : '–';
    });
  });
  const t = body.querySelector('[data-total]');
  if (t) t.textContent = formatHours(sheetWorkedMinutes(sheet));
  const cs = body.querySelector('[data-codesum]');
  if (cs) {
    const byCode = sheetMinutesByCode(sheet);
    cs.innerHTML = Object.keys(byCode).map(k => `<span class="code-chip ${codeCounts(k) ? '' : 'no-count'}"><b>${escapeHtml(k)}</b> ${formatHours(byCode[k])}</span>`).join('') || '<span class="muted">Noch keine Zeiten</span>';
  }
}

function touchSheet(sheet) {
  sheet.updatedAt = new Date().toISOString();
  saveData();
}

// ---------- Event-Delegation ----------
function handleEditorInput(ev) {
  const el = ev.target;
  const bind = el.dataset && el.dataset.bind;
  if (!bind) return;
  const sheet = getActiveSheet();
  if (!sheet) return;
  let value = el.type === 'checkbox' ? el.checked : el.value;
  setPath(sheet, bind, value);
  touchSheet(sheet);
  if (ev.type === 'change' && el.dataset.time) {
    // Zeit normalisieren: "630" → "06:30"
    const m = parseTime(el.value);
    if (m != null) { el.value = formatClock(m); setPath(sheet, bind, el.value); }
    el.closest('.entry').classList.toggle('invalid', !!el.value && m == null);
  }
  if (ev.type === 'change' && el.dataset.rerender) { renderEditor(true); return; }
  refreshEditorSums();
}

function handleEditorClick(ev) {
  const btn = ev.target.closest('[data-set]');
  if (!btn || btn.closest('fieldset[disabled]')) return;
  const sheet = getActiveSheet();
  if (!sheet) return;
  const path = btn.dataset.set;
  const val = btn.dataset.val === 'true';
  // Nochmal tippen = Auswahl zurücknehmen
  setPath(sheet, path, getPath(sheet, path) === val ? null : val);
  touchSheet(sheet);
  renderEditor(true);
}

document.addEventListener('DOMContentLoaded', () => {
  const body = document.getElementById('editor-body');
  body.addEventListener('input', handleEditorInput);
  body.addEventListener('change', handleEditorInput);
  body.addEventListener('click', handleEditorClick);
  // Enter in einem Zeitfeld springt ins nächste Feld
  body.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || !ev.target.matches('input')) return;
    ev.preventDefault();
    const inputs = Array.from(body.querySelectorAll('input:not([type=checkbox]):not([disabled]), select, textarea'));
    const i = inputs.indexOf(ev.target);
    if (inputs[i + 1]) inputs[i + 1].focus();
  });
});

// ---------- Aktionen ----------
function addEntry(di, code) {
  const sheet = getActiveSheet();
  const day = sheet.days[di];
  const last = day.entries[day.entries.length - 1];
  day.entries.push({
    id: uid(),
    from: last && last.to ? last.to : '',
    to: '',
    code: code || (last ? last.code : 'AZ'),
    desc: ''
  });
  touchSheet(sheet);
  renderEditor(true);
  // Fokus auf das passende Feld der neuen Zeile
  const rows = document.querySelectorAll(`.day-card[data-day="${di}"] .entry`);
  const row = rows[rows.length - 1];
  if (row) {
    const inputs = row.querySelectorAll('.t-in');
    (inputs[0].value ? inputs[1] : inputs[0]).focus();
  }
}

function removeEntry(di, ei) {
  const sheet = getActiveSheet();
  sheet.days[di].entries.splice(ei, 1);
  touchSheet(sheet);
  renderEditor(true);
}

function addDay() {
  const sheet = getActiveSheet();
  const dates = sheet.days.map(d => d.date).filter(Boolean).sort();
  const next = dates.length ? addDaysISO(dates[dates.length - 1], 1) : todayISO();
  const prev = sheet.days[sheet.days.length - 1];
  const day = newDay(next);
  if (prev) { day.away = prev.away; day.hotel = prev.hotel; day.hotelName = prev.hotelName; day.breakfast = prev.breakfast; }
  sheet.days.push(day);
  touchSheet(sheet);
  renderEditor(true);
  const cards = document.querySelectorAll('.day-card');
  if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function removeDay(di) {
  const sheet = getActiveSheet();
  const d = sheet.days[di];
  if (d.entries.length) {
    const ok = await confirmDialog(`Tag ${formatDate(d.date)} mit ${d.entries.length} Zeile(n) löschen?`, 'Löschen', true);
    if (!ok) return;
  }
  sheet.days.splice(di, 1);
  touchSheet(sheet);
  renderEditor(true);
}

function copyTravelBack() {
  const sheet = getActiveSheet();
  const o = sheet.travelOut || {};
  sheet.travelBack = Object.assign({}, sheet.travelBack, {
    from: o.to || '', to: o.from || '', km: o.km || '', duration: o.duration || '', vehicle: o.vehicle || '', plate: o.plate || ''
  });
  touchSheet(sheet);
  renderEditor(true);
  showToast('Rückfahrt übernommen');
}

function openSheetMenu() {
  const sheet = getActiveSheet();
  if (!sheet) return;
  openModal(`
    <h2 class="modal-title">Zettel</h2>
    <div class="menu-list">
      <button onclick="closeModal();printActiveSheet()">Drucken / als PDF speichern</button>
      <button onclick="duplicateSheet('${sheet.id}')">Kopieren (Kopf &amp; Anfahrt übernehmen)</button>
      <button class="danger" onclick="deleteSheet('${sheet.id}')">Zettel löschen</button>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Schließen</button></div>`);
}

window.openEditor = openEditor;
window.closeEditor = closeEditor;
window.addEntry = addEntry;
window.removeEntry = removeEntry;
window.addDay = addDay;
window.removeDay = removeDay;
window.copyTravelBack = copyTravelBack;
window.openSheetMenu = openSheetMenu;
