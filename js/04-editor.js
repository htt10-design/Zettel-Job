// =====================================================================
// 04-editor: Zettel bearbeiten (Kopf, Tage mit Zeiten, Abwesenheit,
// Hotel, An-/Rückfahrt, Material, Abschluss, Unterschriften)
//
// Eingabefelder tragen data-bind="pfad.im.zettel" (z.B. "days.0.entries.2.from").
// Änderungen werden per Event-Delegation in den Zettel geschrieben und
// automatisch gespeichert.
// =====================================================================

let activeSheetId = null;
let editorReturn = null; // 'order' wenn aus der Zusammenstellung geöffnet

function getActiveSheet() {
  return appData.sheets.find(s => s.id === activeSheetId) || null;
}

function openEditor(id, from) {
  editorReturn = from || null;
  activeSheetId = id;
  showView('editor');
  activeSheetId = id; // showView setzt außerhalb des Editors zurück
  renderEditor();
}

function closeEditor() {
  flushSave();
  const back = editorReturn;
  editorReturn = null;
  if (back === 'order' && activeOrderNo) showView('order');
  else showView('sheets');
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
    opts.orderno ? `data-orderno="${opts.orderno}"` : '',
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
  return codes.map(c => `<option value="${escapeHtml(c.code)}" ${c.code === selected ? 'selected' : ''} title="${escapeHtml(c.label)}">${escapeHtml(c.code)}</option>`).join('');
}

// Anzeige links: nur Normalstunden; Pausen durchgestrichen mit voller Dauer
function lineDurText(line) {
  if (!line || !line.minutes) return '–';
  if (!line.counts) return formatHours(line.minutes);
  return line.normal ? formatHours(line.normal) : '–';
}

function entryRow(e, di, ei, line) {
  const p = `days.${di}.entries.${ei}`;
  const ot = line ? line.ot : 0;
  const isW = getActiveSheet().type === 'werkstatt';
  const bad = (e.from && parseTime(e.from) == null) || (e.to && parseTime(e.to) == null);
  const counts = codeCounts(e.code);
  return `
    <div class="entry ${bad ? 'invalid' : ''} ${counts ? '' : 'no-count'}">
      <div class="entry-times">
        <input class="t-in" data-bind="${p}.from" data-time="1" value="${escapeHtml(e.from || '')}" placeholder="0630" inputmode="numeric" autocomplete="off" aria-label="Von">
        <span class="dash">–</span>
        <input class="t-in" data-bind="${p}.to" data-time="1" value="${escapeHtml(e.to || '')}" placeholder="0700" inputmode="numeric" autocomplete="off" aria-label="Bis">
        ${isW ? `<span class="entry-spacer"><span class="entry-ot short" data-ot="${di}.${ei}" data-short="1" title="Überstunden" ${ot ? '' : 'hidden'}>${otText(ot, true)}</span></span>` : `<select class="code-sel" data-bind="${p}.code" data-rerender="1" aria-label="Zeitart">${codeOptions(e.code)}</select>`}
        <span class="entry-dur" data-dur="${di}.${ei}">${lineDurText(line)}</span>
        <button type="button" class="icon-btn small danger-hover" onclick="removeEntry(${di},${ei})" aria-label="Zeile löschen">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="entry-desc-row">
        ${isW ? `<input class="cost-in" data-bind="${p}.cost" data-orderno="cost" data-rerender="1" value="${escapeHtml(e.cost ?? '')}" placeholder="Kostenstelle" list="dl-costs" autocomplete="off" aria-label="Kostenstelle">` : ''}
        <input class="entry-desc" data-bind="${p}.desc" value="${escapeHtml(e.desc || '')}" placeholder="${escapeHtml(isW && getCostCenter(e.cost) ? getCostCenter(e.cost).label + ' – was wurde gemacht?' : 'Was wurde gemacht?')}" autocomplete="off">
        ${isW ? '' : `<span class="entry-ot" data-ot="${di}.${ei}" ${ot ? '' : 'hidden'}>${otText(ot)}</span>`}
      </div>
    </div>`;
}

function otText(min, short) {
  if (!min) return '';
  return short ? '+' + formatHours(min) : 'Überstd. ' + formatHours(min);
}

// Fahrzeit aus An-/Rückfahrt als feste (nicht editierbare) Zeile im Tag
function travelLine(line, di) {
  const t = getActiveSheet()[line.key] || {};
  const route = [t.from, t.to].filter(Boolean).join(' → ');
  return `
    <div class="entry travel-line">
      <div class="entry-times">
        <svg viewBox="0 0 24 24"><path d="M5 17h14l-1.5-6h-11z"/><circle cx="8" cy="17.5" r="1.5"/><circle cx="16" cy="17.5" r="1.5"/><path d="M7 11l1.5-4h7L17 11"/></svg>
        <span class="tl-label"><b>${escapeHtml(line.label)}</b> · FZ${route ? ' · ' + escapeHtml(route) : ''}</span>
        <span class="entry-dur" data-tl="${di}.${line.key}">${lineDurText(line)}</span>
      </div>
      <div class="entry-desc-row">
        <span class="muted small-text tl-hint">Fahrzeit ${formatHours(line.minutes)} – wird aus „${escapeHtml(line.label)}“ unten übernommen</span>
        <span class="entry-ot" data-tlot="${di}.${line.key}" ${line.ot ? '' : 'hidden'}>${otText(line.ot)}</span>
      </div>
    </div>`;
}

function dayCard(day, di, sheet) {
  const isMontage = sheet.type === 'montage';
  const split = daySplit(sheet, di);
  const d = parseISODate(day.date);
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
          <strong data-daysum="${di}">${formatHours(split.normal)}</strong>
          <small data-daydelta="${di}">${dayDeltaText(split)}</small>
        </div>
        ${sheet.days.length > 1 ? `<button type="button" class="icon-btn small danger-hover" onclick="removeDay(${di})" aria-label="Tag löschen">
          <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>` : ''}
      </div>
      <div class="entries">
        ${split.travel.travelOut ? travelLine(split.travel.travelOut, di) : ''}
        ${day.entries.length ? day.entries.map((e, ei) => entryRow(e, di, ei, split.byEntry[ei])).join('') : '<p class="muted small-text">Noch keine Zeiten eingetragen.</p>'}
        ${split.travel.travelBack ? travelLine(split.travel.travelBack, di) : ''}
      </div>
      <div class="entry-add">
        <button type="button" class="btn btn-soft" onclick="addEntry(${di})">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Zeile
        </button>
        <div class="quick-codes">
          ${sheet.type === 'werkstatt'
            ? recentCosts(true).slice(0, 4).map(c => `<button type="button" class="chip mini" onclick="addEntry(${di},null,${escapeHtml(JSON.stringify(c))})" title="${escapeHtml((getCostCenter(c) || {}).label || '')}">+${escapeHtml(c)}</button>`).join('')
            : appData.settings.codes.slice(0, 5).map(c => `<button type="button" class="chip mini" onclick="addEntry(${di},'${escapeHtml(c.code)}')" title="${escapeHtml(c.label)}">+${escapeHtml(c.code)}</button>`).join('')}
        </div>
      </div>
      ${montageExtras}
    </div>`;
}

// Text unter den Normalstunden eines Tages
function dayDeltaText(split) {
  const { worked, target, ot } = split;
  if (!worked) return target ? 'Soll ' + formatHours(target) : 'Soll 0 h';
  if (ot > 0) return `+ ${formatHours(ot)} Überstd.`;
  if (worked < target) return `${formatHours(target - worked)} unter Soll`;
  return 'Soll erfüllt';
}

function travelBlock(title, key, t, withDate) {
  const p = key;
  return `
    <div class="sub-block">
      <h4>${title}</h4>
      <div class="grid-2">
        ${field('Von', `${p}.from`, t.from, { placeholder: 'Ort', list: 'dl-places' })}
        ${field('Nach', `${p}.to`, t.to, { placeholder: 'Ort', list: 'dl-places' })}
        ${withDate ? field('Datum', `${p}.date`, t.date, { type: 'date', rerender: true }) : ''}
        ${field('Kilometer', `${p}.km`, t.km, { inputmode: 'decimal', placeholder: 'km' })}
        ${field('Fahrzeit (Std.)', `${p}.duration`, t.duration, { placeholder: 'z.B. 2:30', inputmode: 'text', rerender: true })}
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
  const costs = `<datalist id="dl-costs">${recentCosts().map(c => { const cc = getCostCenter(c); return `<option value="${escapeHtml(c)}">${cc && cc.label ? escapeHtml(cc.label) : ''}</option>`; }).join('')}<option value="P">Pause</option></datalist>`;
  return dl('dl-places', places) + dl('dl-hotels', hotels) + dl('dl-customers', customers) + dl('dl-vessels', vessels) + costs;
}

// Kostenstellen-Vorschläge: zuletzt benutzte zuerst, dann die aus den Einstellungen
function recentCosts(usedOnly) {
  const used = [];
  appData.sheets.filter(s => s.type === 'werkstatt')
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .forEach(s => s.days.forEach(d => d.entries.forEach(e => {
      const c = String(e.cost || '').trim();
      if (c && !isPauseCost(c) && !used.includes(c)) used.push(c);
    })));
  if (usedOnly) return used;
  (appData.settings.costCenters || []).forEach(c => { const n = String(c.no || '').trim(); if (n && !used.includes(n)) used.push(n); });
  return used;
}

// ---------- Rendern ----------
function renderEditor(keepScroll) {
  const sheet = getActiveSheet();
  if (!sheet) { showView('sheets'); return; }
  const scrollY = window.scrollY;
  const isMontage = sheet.type === 'montage';
  const locked = !!(sheet.signCustomer && sheet.signCustomer.img);
  setTopbarTitle(isMontage ? 'Montagezettel' : 'Werkstattzettel');

  const totals = sheetTotals(sheet);
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
      <div class="sum-item"><span class="muted">Normalstunden</span><strong data-totalnormal>${formatHours(totals.normal)}</strong></div>
      <div class="sum-item sum-ot"><span class="muted">Überstunden</span><strong data-totalot>${formatHours(totals.ot)}</strong></div>
      <div class="sum-item sum-all"><span class="muted">Gesamt</span><strong data-total>${formatHours(totals.worked)}</strong></div>
      <div class="code-chips" data-codesum>${codeSummary || '<span class="muted">Noch keine Zeiten</span>'}</div>
    </div>`;

  // Kopf
  if (isMontage) {
    html += `
      <div class="card">
        <h3 class="card-title">Auftrag</h3>
        <div class="grid-2">
          ${field('Auftragsnummer', 'orderNo', sheet.orderNo, { placeholder: 'SR26/000249 oder nur 249', inputmode: 'text', rerender: true, list: 'dl-orders-ed', orderno: 'order' })}
          ${field('Auftraggeber / Kunde', 'customer', sheet.customer, { placeholder: 'Firma', list: 'dl-customers' })}
          ${field('Schiffsname / Anlage', 'vessel', sheet.vessel, { placeholder: 'z.B. MS Hanna', list: 'dl-vessels', cls: 'span-2' })}
        </div>
        ${isFolder(sheet.orderNo) ? `<p class="folder-hint">Dieser Zettel liegt im Ordner <b>Auftrag ${escapeHtml(normOrderNo(sheet.orderNo))}</b>.</p>` : ''}
        <datalist id="dl-orders-ed">${allOrders().map(o => `<option value="${escapeHtml(o.no)}">`).join('')}</datalist>
      </div>`;
  }

  // Tage
  html += `<div class="section-head"><h3>Zeiten &amp; Arbeiten</h3><span class="muted small-text">${isMontage ? 'Zeit als 0630 eintippen' : 'Kostenstelle je Zeile · Pause = P'}</span></div>`;
  html += sheet.days.map((d, di) => dayCard(d, di, sheet)).join('');

  if (isMontage) {
    const multiDay = sheet.days.length > 1;
    const travelPart = (label, key) => travelActive(sheet[key])
      ? travelBlock(label, key, sheet[key], multiDay) + `<button type="button" class="link-btn danger" onclick="setTravel('${key}', false)">${label} entfernen</button>`
      : `<button type="button" class="btn btn-soft travel-add" onclick="setTravel('${key}', true)">
           <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> ${label} an diesem Tag</button>`;
    html += `
      <div class="card">
        <h3 class="card-title">Anfahrt &amp; Rückfahrt</h3>
        <div class="travel-parts">
          ${travelPart('Anfahrt', 'travelOut')}
          ${travelPart('Rückfahrt', 'travelBack')}
        </div>
        <p class="muted small-text">Die Fahrzeit wird automatisch als FZ mitgezählt (Anfahrt am Anfang, Rückfahrt am Ende des Tages) – also nicht zusätzlich als FZ-Zeile eintragen.</p>
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
      ${isMontage ? `<button type="button" class="btn btn-soft" onclick="nextDaySheet('${sheet.id}')">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Nächster Tag</button>` : ''}
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
  const setOt = (el, min) => { if (el) { el.textContent = otText(min, !!el.dataset.short); el.hidden = !min; } };
  sheet.days.forEach((d, di) => {
    const split = daySplit(sheet, di);
    const s = body.querySelector(`[data-daysum="${di}"]`);
    if (s) s.textContent = formatHours(split.normal);
    const dd = body.querySelector(`[data-daydelta="${di}"]`);
    if (dd) dd.textContent = dayDeltaText(split);
    split.byEntry.forEach((line, ei) => {
      const el = body.querySelector(`[data-dur="${di}.${ei}"]`);
      if (el) el.textContent = lineDurText(line);
      setOt(body.querySelector(`[data-ot="${di}.${ei}"]`), line.ot);
    });
    Object.values(split.travel).forEach(line => {
      const el = body.querySelector(`[data-tl="${di}.${line.key}"]`);
      if (el) el.textContent = lineDurText(line);
      setOt(body.querySelector(`[data-tlot="${di}.${line.key}"]`), line.ot);
    });
  });
  const totals = sheetTotals(sheet);
  const set = (sel, v) => { const el = body.querySelector(sel); if (el) el.textContent = formatHours(v); };
  set('[data-total]', totals.worked);
  set('[data-totalnormal]', totals.normal);
  set('[data-totalot]', totals.ot);
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
  if (ev.type === 'change' && el.dataset.orderno) {
    const day = sheet.days[0];
    let v = formatOrderNo(el.value, day && day.date, el.dataset.orderno === 'order');
    if (el.dataset.orderno === 'cost' && isPauseCost(v)) v = 'P';
    if (el.dataset.orderno === 'cost' && getCostCenter(v)) v = getCostCenter(v).no;
    if (v !== el.value) { el.value = v; setPath(sheet, bind, v); touchSheet(sheet); }
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
function addEntry(di, code, cost) {
  const sheet = getActiveSheet();
  const day = sheet.days[di];
  const last = day.entries[day.entries.length - 1];
  const entry = {
    id: uid(),
    from: last && last.to ? last.to : '',
    to: '',
    code: code || (last ? last.code : 'AZ'),
    desc: ''
  };
  // Werkstatt: Kostenstelle statt Zeitart (letzte wird übernommen)
  if (sheet.type === 'werkstatt') entry.cost = cost != null ? cost : (last && last.cost != null ? last.cost : '');
  day.entries.push(entry);
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

// An-/Rückfahrt für diesen Zettel ein- oder ausschalten.
// Rückfahrt wird mit der Anfahrt desselben Auftrags (umgekehrt) vorbelegt.
function setTravel(key, on) {
  const sheet = getActiveSheet();
  if (!sheet[key]) sheet[key] = defaultTravel(key);
  const t = sheet[key];
  if (on && key === 'travelBack' && !t.duration && !t.km) {
    const out = [sheet, ...appData.sheets.filter(s => s !== sheet && s.orderNo && s.orderNo === sheet.orderNo)]
      .map(s => s.travelOut).find(o => travelActive(o));
    if (out) Object.assign(t, { from: out.to || '', to: out.from || '', km: out.km || '', duration: out.duration || '', vehicle: out.vehicle || '', plate: out.plate || '' });
  }
  t.on = !!on;
  touchSheet(sheet);
  renderEditor(true);
}

function openSheetMenu() {
  const sheet = getActiveSheet();
  if (!sheet) return;
  openModal(`
    <h2 class="modal-title">Zettel</h2>
    <div class="menu-list">
      <button onclick="closeModal();printActiveSheet()">Drucken / als PDF speichern</button>
      ${sheet.type === 'montage' ? `<button onclick="nextDaySheet('${sheet.id}')">Nächster Tag (gleicher Auftrag)</button>` : ''}
      ${sheet.type === 'montage' && sheet.orderNo ? `<button onclick="closeModal();openOrder(${escapeHtml(JSON.stringify(sheet.orderNo))})">Auftrag ${escapeHtml(sheet.orderNo)} zusammenstellen</button>` : ''}
      <button class="danger" onclick="deleteSheet('${sheet.id}')">Zettel löschen</button>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Schließen</button></div>`);
}

window.openEditor = openEditor;
window.closeEditor = closeEditor;
window.addEntry = addEntry;
window.removeEntry = removeEntry;
window.removeDay = removeDay;
window.setTravel = setTravel;
window.openSheetMenu = openSheetMenu;
