// =====================================================================
// 06-special: Eigene Blätter – Endoskopie (V-Motor A/B, Bild),
// Düsen abdrücken, Seriennummern der Bauteile, Allgemeines Befundblatt.
// Jeweils Editor + Auswertung; Druck in 09-print (specialPrintHtml).
// =====================================================================

let endoSel = null; // ausgewählter Zylinder im Endoskopie-Blatt

const ENDO_TAGS = [
  { g: 'Laufbuchse', items: ['Honbild i.O.', 'Polierstellen', 'Riefen', 'Fresser', 'Ölkohle', 'Korrosion'] },
  { g: 'Kolben', items: ['Kolbenboden i.O.', 'Ablagerungen Kolben', 'Anschmelzungen', 'Erosion', 'Risse Kolben', 'Ventiltaschen-Kontakt'] },
  { g: 'Ventile', items: ['Ventile i.O.', 'Ablagerungen Ventile', 'Ventil verbrannt', 'Ventilsitz beschädigt'] },
  { g: 'Zylinderkopf', items: ['Flammdeck i.O.', 'Risse Flammdeck', 'Ablagerungen Flammdeck', 'Düsenspitze auffällig'] },
  { g: 'Brennraum', items: ['trocken / sauber', 'Öl im Brennraum', 'Wasser im Brennraum', 'Kraftstoff im Brennraum', 'Fremdkörper'] }
];

const NOZZLE_ACTIONS = ['', 'wiederverwendet', 'eingestellt', 'instandgesetzt', 'erneuert'];

const GENERAL_CHECK = [
  'Allgemeinzustand / Sauberkeit', 'Leckagen Schmieröl', 'Leckagen Kühlwasser', 'Leckagen Kraftstoff', 'Abgasanlage / Isolierung',
  'Turbolader (Spiel, Geräusch)', 'Ladeluftsystem', 'Riementriebe / Antriebe', 'Schläuche / Leitungen', 'Motorlagerung / Befestigungen',
  'Schwingungsdämpfer', 'Kurbelgehäuseentlüftung', 'Elektrik / Sensoren / Kabel', 'Öl- / Kühlmittelstand'
];
const GENERAL_REASONS = ['Durchsicht', 'Inspektion', 'Schadensaufnahme', 'Probelauf', 'Abnahme', 'Gutachten'];

// Standard-Bauteile für das Seriennummern-Blatt (count: Anzahl oder 'cyl' = je Zylinder)
function serialDefaults(e) {
  const v = isV(e);
  return [
    { label: 'Kraftstoff-Hochdruckpumpe', count: 1, prefix: 'HD-Pumpe ' },
    { label: 'Kraftstoff-Förderpumpe', count: 1, prefix: '' },
    { label: 'Turbolader', count: v ? 2 : 1, prefix: 'ATL ' },
    { label: 'Ladeluftkühler', count: v ? 2 : 1, prefix: 'LLK ' },
    { label: 'Pleuel', count: 'cyl', prefix: '' },
    { label: 'Kühlwasserpumpe (KW-Pumpe)', count: 1, prefix: '' },
    { label: 'Seewasserpumpe', count: 1, prefix: '' },
    { label: 'Zylinderköpfe', count: 'cyl', prefix: '' },
    { label: 'Schmierölpumpe (SÖ-Pumpe)', count: 1, prefix: '' }
  ];
}

function specialInit(order, sheet, src) {
  const t = getType(sheet.type);
  const e = order.engines[sheet.engine || 0] || newEngine();
  if (t.special === 'serials') {
    if (src && src.data.groups) {
      sheet.data.groups = src.data.groups.map(g => ({ id: uid(), label: g.label, rows: g.rows.map(r => ({ pos: r.pos })) }));
    } else {
      sheet.data.groups = serialDefaults(e).map(g => {
        const labels = g.count === 'cyl' ? positions(e, 'cyl') : Array.from({ length: g.count }, (_, i) => g.count > 1 || g.prefix ? g.prefix + (i + 1) : '');
        return { id: uid(), label: g.label, rows: labels.map(pos => ({ pos: g.count === 'cyl' ? 'Zyl. ' + pos : pos.trim() })) };
      });
    }
  }
  if (t.special === 'nozzles' && src && src.data.spec) sheet.data.spec = { ...src.data.spec };
  if (t.special === 'general') sheet.data.reason = sheet.data.reason || 'Durchsicht';
  if (t.special === 'parts' && !Array.isArray(sheet.data.items)) sheet.data.items = [];
}

function specialEditorHtml(order, sheet, kind) {
  if (kind === 'endoscopy') return endoEditorHtml(order, sheet);
  if (kind === 'nozzles') return nozzleEditorHtml(order, sheet);
  if (kind === 'serials') return serialEditorHtml(order, sheet);
  if (kind === 'general') return generalEditorHtml(order, sheet);
  if (kind === 'parts') return partsEditorHtml(order, sheet);
  return '';
}

function specialOnChange(sheet, el, ev) {
  if (el.closest('.nozzle-card')) refreshNozzles();
}

function specialAutoRating(order, sheet) {
  const t = getType(sheet.type);
  const e = order.engines[sheet.engine || 0] || newEngine();
  if (t.special === 'endoscopy') return positions(e, 'cyl').map(p => ((sheet.data.cyl || {})[p] || {}).rating).filter(Boolean);
  if (t.special === 'nozzles') return nozzleRows(order, sheet).map(r => r.st).filter(Boolean);
  if (t.special === 'general') return Object.values(sheet.data.check || {}).map(c => c && c.rating).filter(Boolean);
  if (t.special === 'parts') return partItems(sheet).map(it => partStatus(it.status).rating).filter(Boolean);
  return [];
}

function specialProgress(order, sheet) {
  const t = getType(sheet.type);
  const e = order.engines[sheet.engine || 0] || newEngine();
  if (t.special === 'endoscopy') { const p = positions(e, 'cyl'); return p.filter(x => ((sheet.data.cyl || {})[x] || {}).rating).length + '/' + p.length + ' Zylinder'; }
  if (t.special === 'nozzles') { const r = nozzleRows(order, sheet); return r.filter(x => x.tested).length + '/' + r.length + ' Düsen geprüft'; }
  if (t.special === 'serials') { const g = sheet.data.groups || []; return g.reduce((s, x) => s + x.rows.filter(r => r.sn || r.snNew).length, 0) + ' Seriennummern'; }
  if (t.special === 'general') { const n = Object.values(sheet.data.check || {}).filter(c => c && c.rating).length; return n ? n + ' Punkte geprüft' : ''; }
  if (t.special === 'parts') return partsSummaryText(sheet);
  return '';
}

// =====================================================================
// Endoskopie
// =====================================================================
// Draufsicht: KS links. Blick von KS → links = A-Seite (oben im Bild), rechts = B-Seite.
// Zählweise: ab KS (MTU) → Zylinder 1 an der KS, ab KGS → Zylinder 1 an der KGS.
function endoDiagramSvg(e, cylData, sel, interactive, print) {
  const v = isV(e);
  const pos = positions(e, 'cyl');
  const per = v ? Math.ceil(pos.length / 2) : pos.length;
  const step = 58, r = 21, x0 = 110, w = x0 + per * step + 70;
  const rowsY = v ? [52, 152] : [92];
  const h = v ? 210 : 150;
  const fromKGS = e.count === 'KGS';
  const banks = v ? [pos.slice(0, per), pos.slice(per)] : [pos];
  const fill = st => print ? '#fff' : ({ ok: 'var(--c-ok)', obs: 'var(--c-obs)', bad: 'var(--c-bad)' }[st] || 'var(--surface)');
  let s = `<svg class="endo-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
  // Kurbelgehäuse + Kurbelwelle
  const cy = v ? 102 : 92;
  s += `<rect x="${x0 - 34}" y="${v ? 18 : 58}" width="${per * step + 10}" height="${v ? 168 : 68}" rx="18" class="endo-block"/>`;
  s += `<line x1="22" y1="${cy}" x2="${w - 12}" y2="${cy}" class="endo-axis"/>`;
  // KS (Schwungrad) links, KGS rechts
  s += `<rect x="12" y="${cy - 34}" width="34" height="68" rx="8" class="endo-ks"/><text x="29" y="${cy + 4}" class="endo-ks-t">KS</text>`;
  s += `<text x="${w - 30}" y="${cy - 10}" class="endo-small" text-anchor="middle">KGS</text>`;
  if (v) {
    s += `<text x="${x0 - 26}" y="${rowsY[0] + 5}" class="endo-bank" text-anchor="end">A</text>`;
    s += `<text x="${x0 - 26}" y="${rowsY[1] + 5}" class="endo-bank" text-anchor="end">B</text>`;
  }
  banks.forEach((bank, bi) => bank.forEach((p, i) => {
    const idx = fromKGS ? per - 1 - i : i;
    const x = x0 + idx * step + 10, y = rowsY[bi];
    const d = cylData[p] || {};
    const st = d.rating;
    const symb = print && st ? SYM[st] : '';
    s += `<g class="endo-cyl ${sel === p ? 'sel' : ''} st-${st || 'none'}" ${interactive ? `data-cyl="${escapeHtml(p)}" onclick="selectCyl('${escapeHtml(p)}')"` : ''}>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${fill(st)}" class="endo-c"/>
      <text x="${x}" y="${y + (symb ? -1 : 5)}" class="endo-t">${escapeHtml(p)}</text>
      ${symb ? `<text x="${x}" y="${y + 14}" class="endo-sym">${symb}</text>` : ''}
      ${(d.photos || []).length && !print ? `<circle cx="${x + 16}" cy="${y - 16}" r="7" class="endo-cam"/><text x="${x + 16}" y="${y - 12.5}" class="endo-cam-t">${d.photos.length}</text>` : ''}
    </g>`;
  }));
  // Blickrichtung
  s += `<path d="M58 ${h - 14} h44 m-8 -5 l8 5 l-8 5" class="endo-arrow"/><text x="108" y="${h - 10}" class="endo-small">Blick von KS: ${v ? 'links = A-Seite, rechts = B-Seite · ' : ''}Zyl. 1 ${fromKGS ? 'an KGS' : 'an KS'}</text>`;
  return s + '</svg>';
}

function endoEditorHtml(order, sheet) {
  const e = order.engines[sheet.engine || 0] || newEngine();
  const pos = positions(e, 'cyl');
  const cyl = sheet.data.cyl = sheet.data.cyl || {};
  if (!endoSel || !pos.includes(endoSel)) endoSel = pos.find(p => !(cyl[p] || {}).rating) || pos[0];
  const d = cyl[endoSel] || {};
  const p = 'data.cyl.' + endoSel;
  const i = pos.indexOf(endoSel);
  const tags = d.tags || [];
  const rated = pos.filter(x => (cyl[x] || {}).rating).length;
  return `
    <div class="card special">
      <h3 class="card-title">Durchführung</h3>
      <div class="grid-2">
        ${field('Endoskop', 'data.scope', sheet.data.scope, { placeholder: 'z.B. Olympus IPLEX' })}
        ${selectField('Zugang', 'data.access', sheet.data.access || '', [['', '–'], 'Einspritzdüsenbohrung', 'Glühkerzen-/Indikatorbohrung', 'Zylinderkopf demontiert', 'Ladeluftseite / Einlasskanal', 'Auslasskanal'])}
      </div>
    </div>
    <div class="card special endo-card">
      <div class="mc-head"><h3 class="card-title">Zylinder antippen</h3><span class="mc-sum">${rated}/${pos.length} bewertet</span></div>
      <div class="endo-wrap">${endoDiagramSvg(e, cyl, endoSel, true)}</div>
      <div class="legend"><span class="lg lg-ok">i.O.</span><span class="lg lg-obs">beobachten</span><span class="lg lg-bad">n.i.O.</span><span class="lg lg-none">offen</span></div>
      <div class="btn-row"><button type="button" class="btn btn-soft" onclick="endoRestOk()">✓ Alle übrigen i.O.</button></div>
    </div>
    <div class="card special endo-detail">
      <div class="endo-nav">
        <button type="button" class="btn btn-ghost" ${i > 0 ? `onclick="selectCyl('${pos[i - 1]}')"` : 'disabled'}>◀ ${escapeHtml(pos[i - 1] || '')}</button>
        <div class="endo-cur"><span>Zylinder</span><b>${escapeHtml(endoSel)}</b></div>
        <button type="button" class="btn btn-ghost" ${i < pos.length - 1 ? `onclick="selectCyl('${pos[i + 1]}')"` : 'disabled'}>${escapeHtml(pos[i + 1] || '')} ▶</button>
      </div>
      ${ratingSeg(p + '.rating', d.rating)}
      ${ENDO_TAGS.map(gr => `
        <div class="tag-group"><span>${escapeHtml(gr.g)}</span>
          <div class="tag-chips">${gr.items.map(it => `<button type="button" class="tag ${tags.includes(it) ? 'on' : ''}" data-tag="${p}.tags" data-val="${escapeHtml(it)}">${escapeHtml(it)}</button>`).join('')}</div>
        </div>`).join('')}
      <label class="field"><span>Bemerkung ${escapeHtml(endoSel)}</span><textarea data-bind="${p}.note" rows="2" placeholder="Was ist zu sehen?">${escapeHtml(d.note || '')}</textarea></label>
      ${photoStripHtml(p + '.photos', d.photos, 'Endoskop-Bild ' + endoSel)}
      ${i < pos.length - 1 ? `<button type="button" class="btn btn-primary block" style="margin-top:12px" onclick="selectCyl('${pos[i + 1]}')">Weiter zu ${escapeHtml(pos[i + 1])} ▶</button>` : ''}
    </div>`;
}

function selectCyl(p) {
  endoSel = p;
  renderSheet();
  const det = document.querySelector('.endo-detail');
  if (det && det.getBoundingClientRect().top > window.innerHeight * 0.7) det.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function endoRestOk() {
  const order = getActiveOrder(), sheet = getActiveSheet();
  const e = order.engines[sheet.engine || 0];
  const cyl = sheet.data.cyl = sheet.data.cyl || {};
  let n = 0;
  positions(e, 'cyl').forEach(p => { cyl[p] = cyl[p] || {}; if (!cyl[p].rating) { cyl[p].rating = 'ok'; n++; } });
  touchSheet(sheet);
  renderSheet();
  showToast(n ? n + ' Zylinder auf i.O. gesetzt' : 'Alle Zylinder sind schon bewertet');
}

// =====================================================================
// Düsen abdrücken
// =====================================================================
function nozzleRows(order, sheet) {
  const e = order.engines[sheet.engine || 0] || newEngine();
  const sp = specNums(sheet.data.spec);
  const rows = sheet.data.rows || {};
  return positions(e, 'cyl').map(pos => {
    const r = rows[pos] || {};
    const p1 = parseNum(r.p1), p2 = parseNum(r.p2);
    const p1St = evalRange(p1, sp.min, sp.max);
    const p2St = evalRange(p2, sp.min, sp.max);
    const checks = ['spray', 'tight', 'chatter'].map(k => r[k]).filter(Boolean);
    const sts = checks.map(c => c === 'ok' ? 'ok' : 'bad');
    // Nach Einstellung/Instandsetzung zählt der zweite Druck
    const pressSt = p2 != null ? p2St : (p1St === 'bad' && r.action ? 'obs' : p1St);
    if (pressSt) sts.push(pressSt);
    let st = worstRating(sts);
    if (r.action === 'erneuert') st = st ? 'obs' : null;
    return { pos, r, p1: { n: p1, st: p1St }, p2: { n: p2, st: p2St }, st, tested: p1 != null || checks.length > 0 };
  });
}

function nozzleEditorHtml(order, sheet) {
  const spec = sheet.data.spec || {};
  const rows = nozzleRows(order, sheet);
  const tog = (bind, val) => `<div class="mini-seg">
      <button type="button" class="r-ok ${val === 'ok' ? 'on' : ''}" data-set="${bind}" data-val="ok">i.O.</button>
      <button type="button" class="r-bad ${val === 'bad' ? 'on' : ''}" data-set="${bind}" data-val="bad">n.i.O.</button></div>`;
  return `
    <div class="card special">
      <h3 class="card-title">Prüfbedingungen</h3>
      <div class="grid-2">
        ${field('Düsentyp / Sachnummer', 'data.nozzleType', sheet.data.nozzleType)}
        ${field('Prüfgerät', 'data.tester', sheet.data.tester, { placeholder: 'z.B. Düsenprüfgerät' })}
      </div>
      <div class="spec-grid">
        <label class="field spec-field"><span>Öffnungsdruck min (bar)</span><input class="spec-in" data-bind="data.spec.min" value="${escapeHtml(spec.min || '')}" inputmode="decimal" autocomplete="off" placeholder="z.B. 300"></label>
        <label class="field spec-field"><span>Öffnungsdruck max (bar)</span><input class="spec-in" data-bind="data.spec.max" value="${escapeHtml(spec.max || '')}" inputmode="decimal" autocomplete="off" placeholder="z.B. 320"></label>
      </div>
    </div>
    <div class="card special nozzle-card">
      <div class="mc-head"><h3 class="card-title">Düsen je Zylinder</h3><span class="mc-sum" id="nozzle-sum"></span></div>
      <p class="hint">Öffnungsdruck eintragen, dann Strahlbild, Dichtheit (Nachtropfen) und Schnarren antippen.</p>
      <div class="nz-list">
        ${rows.map(({ pos, r }) => {
          const p = 'data.rows.' + pos;
          return `
          <div class="nz-row" data-nz="${escapeHtml(pos)}">
            <div class="nz-top">
              <span class="pos-badge">${escapeHtml(pos)}</span>
              <input class="nz-sn" data-bind="${p}.sn" value="${escapeHtml(r.sn || '')}" placeholder="Düsen-Nr. / SN" autocomplete="off">
              <label class="nz-p"><span>bar</span><input class="m-in nz-p1" data-bind="${p}.p1" value="${escapeHtml(r.p1 || '')}" inputmode="decimal" placeholder="Ist" autocomplete="off"></label>
            </div>
            <div class="nz-checks">
              <div><span>Strahlbild</span>${tog(p + '.spray', r.spray)}</div>
              <div><span>Dicht</span>${tog(p + '.tight', r.tight)}</div>
              <div><span>Schnarren</span>${tog(p + '.chatter', r.chatter)}</div>
            </div>
            <div class="nz-bottom">
              <select data-bind="${p}.action" data-rerender="1">${NOZZLE_ACTIONS.map(a => `<option value="${a}" ${r.action === a ? 'selected' : ''}>${a ? escapeHtml(a) : 'Maßnahme …'}</option>`).join('')}</select>
              ${r.action === 'eingestellt' || r.action === 'instandgesetzt' || r.p2 ? `<label class="nz-p"><span>neu bar</span><input class="m-in nz-p2" data-bind="${p}.p2" value="${escapeHtml(r.p2 || '')}" inputmode="decimal" placeholder="nach" autocomplete="off"></label>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function refreshNozzles() {
  const order = getActiveOrder(), sheet = getActiveSheet();
  if (!order || !sheet || getType(sheet.type).special !== 'nozzles') return;
  const rows = nozzleRows(order, sheet);
  const setSt = (el, st) => { if (!el) return; el.classList.remove('st-ok', 'st-obs', 'st-bad'); if (st) el.classList.add('st-' + st); };
  rows.forEach(r => {
    const row = document.querySelector(`[data-nz="${CSS.escape(r.pos)}"]`);
    if (!row) return;
    setSt(row.querySelector('.nz-p1'), r.p1.st);
    setSt(row.querySelector('.nz-p2'), r.p2.st);
    row.className = 'nz-row rate-' + (r.st || 'none');
  });
  const sum = document.getElementById('nozzle-sum');
  const bad = rows.filter(r => r.st === 'bad').length;
  if (sum) sum.innerHTML = `${rows.filter(r => r.tested).length}/${rows.length} geprüft${bad ? ` · <b class="txt-bad">${bad}× n.i.O.</b>` : ''}`;
}

// =====================================================================
// Seriennummern
// =====================================================================
function serialEditorHtml(order, sheet) {
  const groups = sheet.data.groups = sheet.data.groups || [];
  return `
    <div class="card special">
      <h3 class="card-title">Bauteile & Seriennummern</h3>
      <p class="hint">„SN ausgebaut / vorhanden“ = was im Motor ist bzw. war. „SN eingebaut“ nur ausfüllen, wenn getauscht wurde.</p>
      ${groups.map((g, gi) => {
        const filled = g.rows.filter(r => r.sn || r.snNew).length;
        return `
        <details class="serial-group" ${filled || g.rows.length <= 2 ? 'open' : ''}>
          <summary><b>${escapeHtml(g.label)}</b> <span class="muted small-text">${filled}/${g.rows.length}</span></summary>
          <input class="sg-label" data-bind="data.groups.${gi}.label" value="${escapeHtml(g.label)}" aria-label="Bezeichnung" autocomplete="off">
          ${g.rows.map((r, ri) => {
            const p = `data.groups.${gi}.rows.${ri}`;
            return `
            <div class="serial-row">
              <input class="sr-pos" data-bind="${p}.pos" value="${escapeHtml(r.pos || '')}" placeholder="Position" autocomplete="off">
              <input data-bind="${p}.partNo" aria-label="Typ / Typenschild" value="${escapeHtml(r.partNo || '')}" placeholder="Typ / Typenschild" autocomplete="off">
              <input data-bind="${p}.sn" value="${escapeHtml(r.sn || '')}" placeholder="SN ausgebaut / vorhanden" autocomplete="off">
              <input data-bind="${p}.snNew" value="${escapeHtml(r.snNew || '')}" placeholder="SN eingebaut (neu)" autocomplete="off">
              <input class="sr-note" data-bind="${p}.note" value="${escapeHtml(r.note || '')}" placeholder="Bemerkung" autocomplete="off">
              <button type="button" class="icon-btn small danger-hover" onclick="serialRemoveRow(${gi},${ri})" aria-label="Zeile löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
            </div>`;
          }).join('')}
          <div class="btn-row">
            <button type="button" class="chip mini" onclick="serialAddRow(${gi})">＋ Zeile</button>
            <button type="button" class="link-btn danger" onclick="serialRemoveGroup(${gi})">Bauteil entfernen</button>
          </div>
        </details>`;
      }).join('')}
      <button type="button" class="btn btn-soft" onclick="serialAddGroup()">＋ weiteres Bauteil</button>
    </div>`;
}

function serialAddRow(gi) {
  const sheet = getActiveSheet();
  const g = sheet.data.groups[gi];
  const last = g.rows[g.rows.length - 1];
  let pos = '';
  if (last && /\d+$/.test(last.pos || '')) pos = last.pos.replace(/\d+$/, n => String(parseInt(n, 10) + 1));
  g.rows.push({ pos });
  touchSheet(sheet);
  renderSheet();
}
function serialRemoveRow(gi, ri) {
  const sheet = getActiveSheet();
  sheet.data.groups[gi].rows.splice(ri, 1);
  touchSheet(sheet);
  renderSheet();
}
function serialAddGroup() {
  const sheet = getActiveSheet();
  sheet.data.groups.push({ id: uid(), label: 'Neues Bauteil', rows: [{ pos: '' }] });
  touchSheet(sheet);
  renderSheet();
  const all = document.querySelectorAll('.sg-label');
  if (all.length) { all[all.length - 1].focus(); all[all.length - 1].select(); }
}
async function serialRemoveGroup(gi) {
  const sheet = getActiveSheet();
  if (!await confirmDialog('„' + sheet.data.groups[gi].label + '“ entfernen?', 'Entfernen', true)) return;
  sheet.data.groups.splice(gi, 1);
  touchSheet(sheet);
  renderSheet();
}

// =====================================================================
// Allgemeines Befundblatt (Durchsicht)
// =====================================================================
function generalEditorHtml(order, sheet) {
  const check = sheet.data.check = sheet.data.check || {};
  const done = GENERAL_CHECK.filter((c, i) => (check[i] || {}).rating).length;
  return `
    <div class="card special">
      <h3 class="card-title">Anlass</h3>
      <div class="chips wrap">${GENERAL_REASONS.map(r => `<button type="button" class="chip ${sheet.data.reason === r ? 'active' : ''}" data-set="data.reason" data-val="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('')}</div>
      <div class="grid-2" style="margin-top:12px">
        ${field('Betriebsstunden bei Prüfung', 'data.hours', sheet.data.hours || (order.engines[sheet.engine || 0] || {}).hours, { inputmode: 'numeric' })}
        ${field('Motor lief / Zustand', 'data.state', sheet.data.state, { placeholder: 'z.B. warm, Probelauf 30 min' })}
      </div>
    </div>
    <details class="card special" ${done ? 'open' : ''}>
      <summary class="card-title">Durchsicht-Checkliste <span class="muted small-text">${done}/${GENERAL_CHECK.length} · optional</span></summary>
      <div class="check-list">
        ${GENERAL_CHECK.map((c, i) => {
          // Schlüssel = Index in GENERAL_CHECK
          const d = check[i] || {};
          const p = 'data.check.' + i;
          return `
          <div class="check-row rate-${d.rating || 'none'}">
            <span class="cr-label">${escapeHtml(c)}</span>
            ${ratingSeg(p + '.rating', d.rating, { small: true })}
            ${d.rating && d.rating !== 'ok' ? `<input class="cr-note" data-bind="${p}.note" value="${escapeHtml(d.note || '')}" placeholder="Bemerkung" autocomplete="off">` : ''}
          </div>`;
        }).join('')}
      </div>
    </details>`;
}

// =====================================================================
// Skizzen für Messblöcke (Editor + Druck)
// =====================================================================
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

function sketchSvg(cfg) {
  if (cfg.sketch === 'liner') return linerSketch(cfg.planes.length);
  if (cfg.sketch === 'piston') return pistonSketch(cfg.points.length);
  if (cfg.sketch === 'fit') return fitSketch(cfg.boreOnly);
  return '';
}

// Laufbuchse: links Schnitt mit Messebenen, rechts Draufsicht mit A (längs) / B (quer)
function linerSketch(n) {
  const top = 34, bot = 128;
  const ys = n === 1 ? [top] : Array.from({ length: n }, (_, i) => top + i * (bot - top) / (n - 1));
  let s = `<svg class="sk-svg" viewBox="0 0 330 150" xmlns="http://www.w3.org/2000/svg">`;
  // Schnitt Laufbuchse
  s += `<path d="M28 14 H122 V24 H108 V142 H42 V24 H28 Z" class="sk-body"/>`;
  s += `<path d="M42 24 V142 M108 24 V142" class="sk-line"/>`;
  ys.forEach((y, i) => {
    s += `<line x1="34" y1="${y}" x2="116" y2="${y}" class="sk-plane"/><text x="124" y="${y + 4}" class="sk-t b">${ROMAN[i]}</text>`;
  });
  s += `<text x="75" y="10" class="sk-t s mid">oben (OT)</text><text x="75" y="149" class="sk-t s mid">unten</text>`;
  s += abTopView(245, 76);
  return s + '</svg>';
}

// Draufsicht Bohrung mit Messrichtungen A (längs, parallel KW-Achse) und B (quer)
function abTopView(cx, cy) {
  const r = 50;
  let s = `<line x1="${cx - 75}" y1="${cy}" x2="${cx + 77}" y2="${cy}" class="sk-axis"/>`;
  s += `<text x="${cx - 77}" y="${cy - 6}" class="sk-t s">KS</text><text x="${cx + 77}" y="${cy - 6}" class="sk-t s end">KGS</text>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" class="sk-body"/><circle cx="${cx}" cy="${cy}" r="${r - 8}" class="sk-line" fill="none"/>`;
  s += `<path d="M${cx - 34} ${cy} H${cx + 34} M${cx - 26} ${cy - 6} L${cx - 34} ${cy} L${cx - 26} ${cy + 6} M${cx + 26} ${cy - 6} L${cx + 34} ${cy} L${cx + 26} ${cy + 6}" class="sk-arrow b"/>`;
  s += `<path d="M${cx} ${cy - 34} V${cy + 34} M${cx - 6} ${cy - 26} L${cx} ${cy - 34} L${cx + 6} ${cy - 26} M${cx - 6} ${cy + 26} L${cx} ${cy + 34} L${cx + 6} ${cy + 26}" class="sk-arrow a"/>`;
  s += `<text x="${cx + 8}" y="${cy - 22}" class="sk-t b">A</text><text x="${cx + 22}" y="${cy - 7}" class="sk-t b">B</text>`;
  s += `<text x="${cx}" y="${cy + 70}" class="sk-t s mid">A = quer · B = längs (KS–KGS)</text>`;
  return s;
}

// Laufbuchse einpassen: Schnitt Kurbelgehäuse mit Sitz oben (Bund) und unten (Führung),
// rechts Draufsicht A/B. Nur Gehäusebohrung → Buchse nur gestrichelt angedeutet.
function fitSketch(boreOnly) {
  let s = `<svg class="sk-svg" viewBox="0 0 372 160" xmlns="http://www.w3.org/2000/svg">`;
  // Gehäuse links/rechts: oben Sitz für den Bund, Mitte Kühlraum, unten Führung
  const half = 'M10 22 H30 V44 H40 V54 H22 V108 H44 V150 H10 Z';
  s += `<path d="${half}" class="sk-house"/><path d="${half}" class="sk-house" transform="translate(160 0) scale(-1 1)"/>`;
  // Laufbuchse mit Bund
  s += `<path d="M30 14 H130 V44 H116 V150 H44 V44 H30 Z" class="${boreOnly ? 'sk-ghost' : 'sk-body'}"/>`;
  s += `<path d="M52 44 V150 M108 44 V150" class="${boreOnly ? 'sk-ghost-line' : 'sk-line'}"/>`;
  s += `<text x="80" y="102" class="sk-t s mid">${boreOnly ? 'Buchse (neu)' : 'Buchse'}</text>`;
  s += `<text x="33" y="81" class="sk-t s mid" transform="rotate(-90 33 81)">Kühlraum</text>`;
  // Messebenen
  s += `<line x1="4" y1="33" x2="156" y2="33" class="sk-plane"/><text x="160" y="31" class="sk-t s">oben</text><text x="160" y="41" class="sk-t s">(Bund)</text>`;
  s += `<line x1="4" y1="130" x2="156" y2="130" class="sk-plane"/><text x="160" y="128" class="sk-t s">unten</text><text x="160" y="138" class="sk-t s">(Führung)</text>`;
  s += `<text x="80" y="9" class="sk-t s mid">Schnitt Kurbelgehäuse</text>`;
  s += abTopView(284, 76);
  return s + '</svg>';
}

// Kolben (Draufsicht): Lage der Messpunkte, Pkt. 1 an der KS, dann im Uhrzeigersinn
function pistonSketch(n) {
  const cx = 90, cy = 74, r = 56;
  let s = `<svg class="sk-svg" viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">`;
  s += `<line x1="8" y1="${cy}" x2="192" y2="${cy}" class="sk-axis"/><text x="8" y="${cy - 6}" class="sk-t s">KS</text><text x="192" y="${cy - 6}" class="sk-t s end">KGS</text>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" class="sk-body"/><circle cx="${cx}" cy="${cy}" r="${r - 18}" class="sk-line" fill="none" stroke-dasharray="4 3"/>`;
  const pts = n === 1 ? [[cx, cy]] : Array.from({ length: n }, (_, i) => {
    const a = Math.PI + i * 2 * Math.PI / n; // Start KS (links), im Uhrzeigersinn (Draufsicht)
    return [cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)];
  });
  pts.forEach(([x, y], i) => {
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" class="sk-pt"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" class="sk-t pt mid">${n === 1 ? 'OT' : i + 1}</text>`;
  });
  s += `<text x="${cx}" y="146" class="sk-t s mid">Draufsicht Kolben</text>`;
  return s + '</svg>';
}

// =====================================================================
// Ersatzteile / Bestellliste
// =====================================================================
// Status je Bauteil – Reihenfolge = Reihenfolge im Druck
const PART_STATUS = [
  { v: 'order', label: 'Bestellen', long: 'Muss bestellt werden', rating: 'bad' },
  { v: 'open', label: 'Klären', long: 'Noch offen / zu klären', rating: 'obs' },
  { v: 'ordered', label: 'Bestellt', long: 'Bereits bestellt', rating: null },
  { v: 'none', label: 'Nicht nötig', long: 'Nicht nötig / vorhanden', rating: null }
];
function partItems(sheet) { return Array.isArray(sheet.data.items) ? sheet.data.items : []; }
function partStatus(v) { return PART_STATUS.find(x => x.v === v) || { v: '', label: 'ohne Status', long: 'Ohne Status', rating: null }; }

function partsSummaryText(sheet) {
  const items = partItems(sheet).filter(it => it.part || it.reason);
  if (!items.length) return '';
  const n = v => items.filter(it => it.status === v).length;
  return [n('order') ? n('order') + '× bestellen' : '', n('open') ? n('open') + '× klären' : '', n('ordered') ? n('ordered') + '× bestellt' : ''].filter(Boolean).join(' · ') || items.length + ' Bauteile';
}

function partsEditorHtml(order, sheet) {
  if (!Array.isArray(sheet.data.items)) sheet.data.items = [];
  const items = sheet.data.items;
  const count = v => items.filter(it => it.status === v).length;
  return `
    <div class="card special parts-card">
      <div class="mc-head"><h3 class="card-title">Bauteile</h3><span class="mc-sum">${escapeHtml(partsSummaryText(sheet) || 'noch leer')}</span></div>
      ${items.length ? `<div class="parts-kpis">${PART_STATUS.slice(0, 3).map(st => `<span class="pk pk-${st.v}"><b>${count(st.v)}</b>${escapeHtml(st.label)}</span>`).join('')}</div>`
        : '<p class="muted small-text">Defekte oder fehlende Bauteile erfassen – mit Status, ob sie bestellt werden müssen, und Fotos.</p>'}
      <div class="part-list">
        ${items.map((it, i) => {
          const p = 'data.items.' + i;
          return `
          <div class="part ps-${it.status || 'none-set'}">
            <div class="f-head">
              <span class="f-no">${i + 1}</span>
              <input class="f-part" data-bind="${p}.part" value="${escapeHtml(it.part || '')}" placeholder="Bauteil (z.B. Kolbenring, Dichtung …)" list="dl-parts" autocomplete="off">
              <button type="button" class="icon-btn small danger-hover" onclick="removePart(${i})" aria-label="Bauteil löschen"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>
            </div>
            <div class="part-grid">
              <input data-bind="${p}.pos" value="${escapeHtml(it.pos || '')}" placeholder="Position (z.B. A3)" autocomplete="off" aria-label="Position">
              <input data-bind="${p}.qty" value="${escapeHtml(it.qty || '')}" placeholder="Menge" inputmode="numeric" autocomplete="off" aria-label="Menge">
              <input data-bind="${p}.partNo" value="${escapeHtml(it.partNo || '')}" placeholder="Teile-Nr. / Typ" autocomplete="off" aria-label="Teile-Nr. / Typ">
            </div>
            <textarea data-bind="${p}.reason" rows="2" placeholder="Schaden / Grund (z.B. gerissen, verschlissen, fehlt)">${escapeHtml(it.reason || '')}</textarea>
            <div class="part-status">${PART_STATUS.map(st => `<button type="button" class="pst-${st.v} ${it.status === st.v ? 'on' : ''}" data-set="${p}.status" data-val="${st.v}">${escapeHtml(st.label)}</button>`).join('')}</div>
            ${it.status === 'ordered' ? `<input data-bind="${p}.orderRef" value="${escapeHtml(it.orderRef || '')}" placeholder="Bestell-Nr. / Lieferant / Liefertermin" autocomplete="off">` : ''}
            ${it.status === 'open' ? `<input data-bind="${p}.note" value="${escapeHtml(it.note || '')}" placeholder="Was ist noch zu klären? (z.B. Rücksprache Kunde)" autocomplete="off">` : ''}
            ${photoStripHtml(p + '.photos', it.photos, 'Foto ' + (it.part || 'Bauteil'))}
          </div>`;
        }).join('')}
      </div>
      <datalist id="dl-parts">${PART_SUGGEST.map(x => `<option value="${escapeHtml(x)}">`).join('')}</datalist>
      <button type="button" class="btn btn-primary" onclick="addPart()">＋ Bauteil hinzufügen</button>
    </div>`;
}

function addPart() {
  const sheet = getActiveSheet();
  if (!Array.isArray(sheet.data.items)) sheet.data.items = [];
  const items = sheet.data.items;
  items.push({ id: uid(), part: '', pos: '', qty: '1', partNo: '', reason: '', status: 'order', photos: [] });
  touchSheet(sheet);
  renderSheet();
  const all = document.querySelectorAll('.part .f-part');
  if (all.length) all[all.length - 1].focus();
}

async function removePart(i) {
  const sheet = getActiveSheet();
  const it = sheet.data.items[i];
  if ((it.part || it.reason || (it.photos || []).length) && !await confirmDialog('Bauteil „' + (it.part || 'ohne Namen') + '“ löschen?', 'Löschen', true)) return;
  (it.photos || []).forEach(id => deleteFile(id).catch(() => {}));
  sheet.data.items.splice(i, 1);
  touchSheet(sheet);
  renderSheet();
}

Object.assign(window, { addPart, removePart });

Object.assign(window, { selectCyl, endoRestOk, serialAddRow, serialRemoveRow, serialAddGroup, serialRemoveGroup });
