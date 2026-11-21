// =====================================================================
// 09-print: Druckansicht A4 – EIN einheitlicher Kopf für alle Blätter,
// danach der Inhalt je Blattart, Ergebnis, Unterschriften, Fußzeile.
// Mehrere Blätter optional mit Deckblatt (Übersicht + Handlungsbedarf).
// Über den Druckdialog auch als PDF speicherbar.
// =====================================================================

const SYM = { ok: '✓', obs: '!', bad: '✗' };

function pv(n, dec) { return n == null ? '' : formatNum(n, dec); }
function stCls(st) { return st ? 'st-' + st : ''; }
function symCell(st) { return `<td class="sym ${stCls(st)}">${st ? SYM[st] + ' ' + escapeHtml(ratingLabel(st)) : ''}</td>`; }

// ---------- Einheitlicher Kopf (wie SDT-Messblatt) ----------
// Logo mittig, Titel unterstrichen, Kopftabelle zweisprachig:
// Auftraggeber | Auftrags-Nr. | Neubau-Nr. | Klassifikation
// Motorfabrikat | Motortyp | Motornr. | Leistung
function printLogo() {
  const s = appData.settings;
  if (s.logo === '') return '';
  return `<img class="pr-logo" src="${s.logo || DEFAULT_LOGO}" alt="">`;
}

function labelCell(de, en) {
  return `<th><b>${escapeHtml(de)}</b><small>${escapeHtml(en)}</small></th>`;
}

function printHeadHtml(order, sheet, title) {
  const e = sheet ? order.engines[sheet.engine || 0] || {} : order.engines[0] || {};
  const power = [e.power ? e.power + ' kW' : '', e.rpm ? e.rpm + ' 1/min' : ''].filter(Boolean).join(' / ');
  const cust = `${escapeHtml(order.customer || '')}${order.vessel ? `<small>${escapeHtml(order.vessel)}</small>` : ''}`;
  // Zusätzliche Angaben (nur wenn vorhanden) in einer schmalen Zeile
  const info = [];
  if (sheet) {
    const t = getType(sheet.type);
    if (order.engines.length > 1) info.push(['Motor', engineLabel(order, sheet.engine || 0)]);
    const hours = (t.special === 'general' && sheet.data.hours) || e.hours;
    if (hours) info.push(['Betriebsstunden', hours]);
    (t.extra || []).forEach(x => { const v = (sheet.data.extra || {})[x.k]; if (v) info.push([x.label, v]); });
    if (t.special === 'endoscopy') info.push(['Endoskop', sheet.data.scope], ['Zugang', sheet.data.access]);
    if (t.special === 'nozzles') info.push(['Düsentyp', sheet.data.nozzleType], ['Prüfgerät', sheet.data.tester]);
    if (t.special === 'general') info.push(['Anlass', sheet.data.reason], ['Zustand', sheet.data.state]);
  }
  const infoHtml = info.filter(x => x[1]).map(x => `<span><b>${escapeHtml(x[0])}:</b> ${escapeHtml(x[1])}</span>`).join('');
  return `
    <div class="pr-head">
      ${printLogo()}
      <div class="pr-title">${escapeHtml(title)}</div>
    </div>
    <table class="pr-info">
      <tr>${labelCell('Auftraggeber', 'client')}${labelCell('Auftrags-Nr.', 'order-no')}${labelCell('Neubau-Nr.', 'shipbuilt-no')}${labelCell('Klassifikation', 'classification')}</tr>
      <tr class="val"><td>${cust}</td><td>${escapeHtml(order.orderNo || '')}</td><td>${escapeHtml(order.newbuild || '')}</td><td>${escapeHtml(order.classification || '')}</td></tr>
      <tr>${labelCell('Motorfabrikat', 'manufacturer of engine')}${labelCell('Motortyp', 'engine-type')}${labelCell('Motornr.', 'engine-no')}<th><b>Leistung <span class="pr-unit">KW/min-1</span></b><small>engine continous power</small></th></tr>
      <tr class="val"><td>${escapeHtml(e.make || '')}</td><td>${escapeHtml(e.model || '')}</td><td>${escapeHtml(e.number || '')}</td><td>${escapeHtml(power)}</td></tr>
    </table>
    ${infoHtml ? `<div class="pr-extra">${infoHtml}</div>` : ''}`;
}

// Titel wie auf den Papierblättern: „Messblatt Überstand Laufbuchse“
function printDocTitle(sheet) {
  const t = getType(sheet.type);
  const name = t.printLabel || t.label;
  let title;
  if (t.special === 'general') title = 'Befundblatt ' + (sheet.data.reason && sheet.data.reason !== 'Durchsicht' ? sheet.data.reason : 'Durchsicht');
  else if (t.special === 'serials') title = 'Seriennummern Bauteile';
  else if (t.special === 'parts') title = 'Ersatzteilliste / Bestellung';
  else if (t.special === 'endoscopy') title = 'Befundblatt Endoskopie';
  else if (t.special === 'nozzles') title = 'Prüfprotokoll Einspritzdüsen';
  else if (!typeModes(t) || sheet.mode === 'mess') title = 'Messblatt ' + name;
  else if (sheet.mode === 'befund') title = 'Befundblatt ' + name;
  else title = 'Mess- und Befundblatt ' + name;
  return title + (sheet.subtitle ? ' – ' + sheet.subtitle : '');
}

// ---------- Messtabellen ----------
function printSpecLine(cfg, spec) {
  spec = spec || {};
  const u = ' mm';
  if (cfg.kind === 'grid') return [
    spec.nom ? 'Nennmaß ' + spec.nom + u : '',
    spec.min || spec.max ? 'Toleranz ' + (spec.min || '…') + ' – ' + (spec.max || '…') + u : '',
    spec.wear ? 'Verschleißgrenze ' + spec.wear + u : '',
    spec.ovalMax ? 'Ovalität ≤ ' + spec.ovalMax : '',
    spec.conMax ? 'Konizität ≤ ' + spec.conMax : '',
    spec.extraMax && cfg.extraCol ? cfg.extraCol.label + ' ≤ ' + spec.extraMax : ''
  ].filter(Boolean).join(' · ');
  if (cfg.kind === 'points') return [
    spec.min || spec.max ? 'Soll ' + (spec.min || '…') + ' – ' + (spec.max || '…') + u : '',
    spec.spreadMax && cfg.points.length > 1 ? 'Streuung ≤ ' + spec.spreadMax : '',
    spec.neighborMax ? 'Δ Nachbar ≤ ' + spec.neighborMax : ''
  ].filter(Boolean).join(' · ');
  return cfg.pairs.map(pr => {
    const s = spec[pr.k] || {};
    const parts = [
      s.boreMin || s.boreMax ? pr.bore + ' ' + (s.boreMin || '…') + ' – ' + (s.boreMax || '…') : '',
      !cfg.boreOnly && (s.shaftMin || s.shaftMax) ? pr.shaft + ' ' + (s.shaftMin || '…') + ' – ' + (s.shaftMax || '…') : '',
      !cfg.boreOnly && (s.clrMin || s.clrMax) ? 'Spiel ' + (s.clrMin || '…') + ' – ' + (s.clrMax || '…') : ''
    ].filter(Boolean);
    return parts.length ? (cfg.pairs.length > 1 ? pr.label + ': ' : '') + parts.join(' · ') : '';
  }).filter(Boolean).join('  |  ');
}

function printMeasureHtml(order, sheet, cfg) {
  const d = sheet.data[cfg.key] || {};
  cfg = effCfg(cfg, d);
  const pos = tablePositions(order, sheet, cfg);
  const res = computeTable(cfg, d, pos);
  const dec = cfg.dec || 3;
  const rows = d.rows || {};
  const v = (st, text) => `<td class="num ${stCls(st)}">${escapeHtml(text)}</td>`;
  let prevBank = null;
  const trCls = p => { const b = bankOf(p); const c = prevBank !== null && b !== prevBank ? 'bank-start' : ''; prevBank = b; return c; };
  let table = '';
  if (cfg.kind === 'grid') {
    table = `<table class="pr-m"><thead>
      <tr><th rowspan="2" class="pos">${cfg.posKind === 'cyl' ? 'Zyl.' : 'Lager'}</th>${cfg.planes.map(pl => `<th colspan="${cfg.dirs.length}">${escapeHtml(pl.label)}</th>`).join('')}<th rowspan="2">Oval.</th>${cfg.planes.length > 1 ? '<th rowspan="2">Koniz.</th>' : ''}${cfg.extraCol ? `<th rowspan="2">${escapeHtml(cfg.extraCol.label)}</th>` : ''}<th rowspan="2" class="sym">Befund</th></tr>
      <tr>${cfg.planes.map(() => cfg.dirs.map(dr => `<th>${escapeHtml(dr.label)}</th>`).join('')).join('')}</tr></thead><tbody>
      ${res.rows.map(r => `<tr class="${trCls(r.pos)}"><th class="pos">${escapeHtml(r.pos)}</th>
        ${cfg.planes.map(pl => cfg.dirs.map(dr => { const x = r.vals[pl.k + '_' + dr.k]; return v(x.st, (rows[r.pos] || {})[pl.k + '_' + dr.k] ? pv(x.n, dec) : ''); }).join('')).join('')}
        ${v(r.oval.st, pv(r.oval.n, dec))}${cfg.planes.length > 1 ? v(r.conic.st, pv(r.conic.n, dec)) : ''}
        ${cfg.extraCol ? v(r.extra && r.extra.st, (rows[r.pos] || {})[cfg.extraCol.k] || '') : ''}${symCell(r.st)}</tr>`).join('')}
      </tbody></table>`;
  } else if (cfg.kind === 'points') {
    const one = cfg.points.length === 1;
    table = `<table class="pr-m"><thead><tr><th class="pos">${cfg.posKind === 'cyl' ? 'Zylindernr.' : 'Pos.'}</th>${one ? `<th>${escapeHtml(cfg.points[0])} (mm)</th>` : cfg.points.map(p => `<th>${escapeHtml(p)}</th>`).join('') + '<th>Mittel</th><th>Streuung</th>'}${cfg.neighbor ? '<th>Δ Nachbar</th>' : ''}${cfg.extraCol ? `<th>${escapeHtml(cfg.extraCol.label)}</th>` : ''}<th class="sym">Befund</th>${cfg.note ? '<th class="note">Bemerkung</th>' : ''}</tr></thead><tbody>
      ${res.rows.map(r => `<tr class="${trCls(r.pos)}"><th class="pos">${escapeHtml(r.pos)}</th>
        ${r.vals.map(x => v(x.st, pv(x.n, dec))).join('')}${one ? '' : v(r.mean.st, pv(r.mean.n, dec)) + v(r.spread.st, pv(r.spread.n, dec))}
        ${cfg.neighbor ? v(r.neighbor.st, pv(r.neighbor.n, dec)) : ''}${cfg.extraCol ? `<td>${escapeHtml(r.extraText)}</td>` : ''}${symCell(r.st)}${cfg.note ? `<td>${escapeHtml((rows[r.pos] || {}).note || '')}</td>` : ''}</tr>`).join('')}
      </tbody></table>`;
  } else {
    table = `<table class="pr-m"><thead>
      <tr><th rowspan="2" class="pos">${cfg.posKind === 'cyl' ? 'Zyl.' : 'Lager'}</th>${cfg.pairs.map(pr => `<th colspan="${cfg.boreOnly ? cfg.dirs.length : cfg.dirs.length * 2 + 1}">${escapeHtml(pr.label)}</th>`).join('')}<th rowspan="2" class="sym">Befund</th></tr>
      <tr>${cfg.pairs.map(pr => cfg.dirs.map(dr => `<th>${escapeHtml(pr.bore)} ${escapeHtml(dr.label)}</th>`).join('') + (cfg.boreOnly ? '' : cfg.dirs.map(dr => `<th>${escapeHtml(pr.shaft)} ${escapeHtml(dr.label)}</th>`).join('') + '<th>Spiel</th>')).join('')}</tr></thead><tbody>
      ${res.rows.map(r => `<tr class="${trCls(r.pos)}"><th class="pos">${escapeHtml(r.pos)}</th>
        ${r.pairs.map(pr => pr.bore.concat(pr.shaft).map(x => v(x.st, pv(x.n, dec))).join('') + (cfg.boreOnly ? '' : v(pr.clr.st, pv(pr.clr.n, dec)))).join('')}${symCell(r.st)}</tr>`).join('')}
      </tbody></table>`;
  }
  const specLine = (cfg.boreOnly ? 'nur Gehäusebohrung gemessen' + (printSpecLine(cfg, d.spec) ? ' · ' : '') : '') + printSpecLine(cfg, d.spec);
  const sum = `${res.measured}/${pos.length} gemessen${res.bad ? ' · ' + res.bad + '× außer Toleranz' : ''}${res.obs ? ' · ' + res.obs + '× Verschleißgrenze' : ''}`;
  return `
    <div class="pr-block">
      <div class="pr-block-head"><span>${escapeHtml(cfg.title)} <small>(Maße in mm)</small></span><span class="pr-block-sum">${escapeHtml(sum)}</span></div>
      ${specLine ? `<div class="pr-spec">Sollwerte: ${escapeHtml(specLine)}</div>` : '<div class="pr-spec">Sollwerte: ______________________________________________</div>'}
      ${cfg.sketch ? `<div class="pr-sketch">${sketchSvg(cfg)}<span>${escapeHtml(cfg.sketch === 'liner' ? cfg.planes.length + ' Messebenen · Richtung A = quer, B = längs (parallel KW)' : cfg.sketch === 'fit' ? 'Messebenen: Sitz oben (Bund) und Sitz unten (Führung) · Richtung A = quer, B = längs (parallel KW)' + (cfg.boreOnly ? ' · nur Gehäusebohrung' : '') : (cfg.points.length === 1 ? 'Messung im OT' : cfg.points.length + ' Messpunkte, Pkt. 1 an KS, im Uhrzeigersinn'))}</span></div>` : ''}
      ${table}
    </div>`;
}

function printInspectHtml(order, sheet, cfg) {
  const d = sheet.data[cfg.key] || {};
  const rows = d.rows || {};
  const pos = tablePositions(order, sheet, cfg);
  return `
    <div class="pr-block">
      <div class="pr-block-head"><span>${escapeHtml(cfg.title)}</span></div>
      <table class="pr-list"><colgroup><col style="width:8%"><col style="width:14%"><col style="width:46%"><col></colgroup>
        <thead><tr><th>Pos.</th><th>Bewertung</th><th>Befund</th><th>Bemerkung</th></tr></thead>
        <tbody>${pos.map(p => { const r = rows[p] || {}; return `<tr><th class="pos">${escapeHtml(p)}</th><td class="${stCls(r.rating)}">${r.rating ? SYM[r.rating] + ' ' + escapeHtml(ratingLabel(r.rating)) : ''}</td><td>${escapeHtml((r.tags || []).join(', '))}</td><td>${escapeHtml(r.note || '')}</td></tr>`; }).join('')}</tbody>
      </table>
    </div>`;
}

function printPhotosHtml(items) {
  // items: [{ id, caption }]
  items = items.filter(x => photoUrls.get(x.id));
  if (!items.length) return '';
  return `<div class="pr-photos">${items.map(x => `<figure><img src="${photoUrls.get(x.id)}" alt=""><figcaption>${escapeHtml(x.caption)}</figcaption></figure>`).join('')}</div>`;
}

function printFindingsHtml(sheet) {
  const t = getType(sheet.type);
  const list = sheet.findings.filter(f => f.part || f.text || f.action || f.rating || (f.photos || []).length);
  if (!list.length) return '';
  const photos = [];
  list.forEach((f, i) => (f.photos || []).forEach((id, k) => photos.push({ id, caption: `${i + 1}${f.photos.length > 1 ? String.fromCharCode(97 + k) : ''} – ${f.part || 'Befund'}` })));
  return `
    <div class="pr-block">
      <div class="pr-block-head"><span>${t.special === 'general' ? 'Feststellungen' : 'Befunde'}</span></div>
      <table class="pr-list"><colgroup><col style="width:5%"><col style="width:17%"><col><col style="width:13%"><col style="width:24%"></colgroup>
        <thead><tr><th>Nr.</th><th>Bauteil / Pos.</th><th>Befund</th><th>Bewertung</th><th>Maßnahme / Empfehlung</th></tr></thead>
        <tbody>${list.map((f, i) => `<tr><td>${i + 1}${(f.photos || []).length ? ' 📷' : ''}</td><td>${escapeHtml(f.part || '')}</td><td class="pre">${escapeHtml(f.text || '')}</td><td class="${stCls(f.rating)}">${f.rating ? SYM[f.rating] + ' ' + escapeHtml(ratingLabel(f.rating)) : ''}</td><td>${escapeHtml(f.action || '')}</td></tr>`).join('')}</tbody>
      </table>
      ${printPhotosHtml(photos)}
    </div>`;
}

// ---------- Spezielle Blätter ----------
function specialPrintHtml(order, sheet) {
  const t = getType(sheet.type);
  const e = order.engines[sheet.engine || 0] || newEngine();
  if (t.special === 'endoscopy') {
    const cyl = sheet.data.cyl || {};
    const pos = positions(e, 'cyl');
    const photos = [];
    pos.forEach(p => ((cyl[p] || {}).photos || []).forEach((id, k, arr) => photos.push({ id, caption: 'Zyl. ' + p + (arr.length > 1 ? ' (' + (k + 1) + ')' : '') + ((cyl[p] || {}).tags || []).filter(x => !/i\.O\.|sauber/.test(x)).slice(0, 2).map(x => ' – ' + x).join('') })));
    return `
      <div class="pr-block">
        <div class="pr-block-head"><span>Übersicht Zylinder</span><span class="pr-block-sum">✓ i.O. · ! beobachten · ✗ n.i.O.</span></div>
        <div class="pr-endo">${endoDiagramSvg(e, cyl, null, false, true)}</div>
      </div>
      <div class="pr-block">
        <table class="pr-list"><colgroup><col style="width:7%"><col style="width:13%"><col style="width:45%"><col></colgroup>
          <thead><tr><th>Zyl.</th><th>Bewertung</th><th>Befund</th><th>Bemerkung</th></tr></thead>
          <tbody>${pos.map(p => { const r = cyl[p] || {}; return `<tr class="${bankOf(p) === 'B' && p === 'B1' ? 'bank-start' : ''}"><th class="pos">${escapeHtml(p)}</th><td class="${stCls(r.rating)}">${r.rating ? SYM[r.rating] + ' ' + escapeHtml(ratingLabel(r.rating)) : ''}</td><td>${escapeHtml((r.tags || []).join(', '))}</td><td>${escapeHtml(r.note || '')}${(r.photos || []).length ? ' 📷' + r.photos.length : ''}</td></tr>`; }).join('')}</tbody>
        </table>
        ${printPhotosHtml(photos)}
      </div>`;
  }
  if (t.special === 'nozzles') {
    const sp = sheet.data.spec || {};
    const rows = nozzleRows(order, sheet);
    const ck = v => v ? `<td class="${v === 'ok' ? 'st-ok' : 'st-bad'}">${v === 'ok' ? '✓ i.O.' : '✗ n.i.O.'}</td>` : '<td></td>';
    return `
      <div class="pr-block">
        <div class="pr-block-head"><span>Prüfung Einspritzdüsen</span><span class="pr-block-sum">${rows.filter(r => r.tested).length}/${rows.length} geprüft</span></div>
        <div class="pr-spec">Sollwert Öffnungsdruck: ${sp.min || sp.max ? escapeHtml((sp.min || '…') + ' – ' + (sp.max || '…') + ' bar') : '__________ bar'}</div>
        <table class="pr-m"><thead><tr><th class="pos">Zyl.</th><th>Düsen-Nr. / SN</th><th>Öffn.-Druck bar</th><th>Strahlbild</th><th>Dichtheit</th><th>Schnarren</th><th>Maßnahme</th><th>Druck neu bar</th><th class="sym">Befund</th></tr></thead>
          <tbody>${rows.map(r => `<tr class="${r.pos === 'B1' ? 'bank-start' : ''}"><th class="pos">${escapeHtml(r.pos)}</th><td>${escapeHtml(r.r.sn || '')}</td><td class="num ${stCls(r.p1.st)}">${escapeHtml(r.r.p1 || '')}</td>${ck(r.r.spray)}${ck(r.r.tight)}${ck(r.r.chatter)}<td>${escapeHtml(r.r.action || '')}</td><td class="num ${stCls(r.p2.st)}">${escapeHtml(r.r.p2 || '')}</td>${symCell(r.st)}</tr>`).join('')}</tbody>
        </table>
      </div>`;
  }
  if (t.special === 'serials') {
    const groups = sheet.data.groups || [];
    return `
      <div class="pr-block">
        <table class="pr-list pr-serials"><colgroup><col style="width:14%"><col style="width:19%"><col style="width:22%"><col style="width:22%"><col></colgroup>
          <thead><tr><th>Position</th><th>Typ / Typenschild</th><th>SN ausgebaut / vorhanden</th><th>SN eingebaut (neu)</th><th>Bemerkung</th></tr></thead>
          <tbody>${groups.map(g => `<tr class="grp"><td colspan="5">${escapeHtml(g.label)}</td></tr>` + g.rows.map(r => `<tr><td>${escapeHtml(r.pos || '')}</td><td>${escapeHtml(r.partNo || '')}</td><td class="mono">${escapeHtml(r.sn || '')}</td><td class="mono">${escapeHtml(r.snNew || '')}</td><td>${escapeHtml(r.note || '')}</td></tr>`).join('')).join('')}</tbody>
        </table>
      </div>`;
  }
  if (t.special === 'parts') {
    const items = partItems(sheet).map((it, i) => ({ ...it, no: i + 1 })).filter(it => it.part || it.reason || (it.photos || []).length);
    const groups = PART_STATUS.concat([partStatus('')]).map(st => ({ st, list: items.filter(it => (it.status || '') === st.v) })).filter(g => g.list.length);
    const photos = [];
    items.forEach(it => (it.photos || []).forEach((id, k, arr) => photos.push({ id, caption: `${it.no}${arr.length > 1 ? String.fromCharCode(97 + k) : ''} – ${it.part || 'Bauteil'}${it.pos ? ' (' + it.pos + ')' : ''}` })));
    return `
      <div class="pr-block">
        <div class="pr-block-head"><span>Bauteile</span><span class="pr-block-sum">${escapeHtml(partsSummaryText(sheet) || '–')}</span></div>
        <table class="pr-list pr-parts"><colgroup><col style="width:5%"><col style="width:20%"><col style="width:8%"><col style="width:7%"><col style="width:16%"><col><col style="width:13%"></colgroup>
          <thead><tr><th>Nr.</th><th>Bauteil</th><th>Pos.</th><th>Menge</th><th>Teile-Nr. / Typ</th><th>Schaden / Grund</th><th>Status</th></tr></thead>
          <tbody>${groups.length ? groups.map(g => `<tr class="grp"><td colspan="7">${escapeHtml(g.st.long)} (${g.list.length})</td></tr>` + g.list.map(it => `<tr><td>${it.no}${(it.photos || []).length ? ' 📷' : ''}</td><td><b>${escapeHtml(it.part || '')}</b></td><td>${escapeHtml(it.pos || '')}</td><td>${escapeHtml(it.qty || '')}</td><td class="mono">${escapeHtml(it.partNo || '')}</td><td class="pre">${escapeHtml([it.reason, it.status === 'open' && it.note ? 'Zu klären: ' + it.note : '', it.status === 'ordered' && it.orderRef ? 'Bestellt: ' + it.orderRef : ''].filter(Boolean).join('\n'))}</td><td class="${stCls(partStatus(it.status).rating)}">${escapeHtml(partStatus(it.status).label)}</td></tr>`).join('')).join('')
          : Array.from({ length: 8 }, (_, i) => `<tr><td>${i + 1}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')}</tbody>
        </table>
        ${printPhotosHtml(photos)}
      </div>`;
  }
  if (t.special === 'general') {
    const check = sheet.data.check || {};
    const rated = GENERAL_CHECK.map((c, i) => ({ c, d: check[i] || {} })).filter(x => x.d.rating);
    return rated.length ? `
      <div class="pr-block">
        <div class="pr-block-head"><span>Durchsicht-Checkliste</span></div>
        <table class="pr-list"><colgroup><col style="width:38%"><col style="width:16%"><col></colgroup>
          <thead><tr><th>Prüfpunkt</th><th>Bewertung</th><th>Bemerkung</th></tr></thead>
          <tbody>${rated.map(x => `<tr><td>${escapeHtml(x.c)}</td><td class="${stCls(x.d.rating)}">${SYM[x.d.rating]} ${escapeHtml(ratingLabel(x.d.rating))}</td><td>${escapeHtml(x.d.note || '')}</td></tr>`).join('')}</tbody>
        </table>
      </div>` : '';
  }
  return '';
}

// ---------- Fuß wie SDT-Messblatt ----------
// Bemerkung / Empfehlung (mit Gesamtbewertung) · Messwerkzeug | Seitenzahl · Datum | Unterschrift | Sonstiges
function printFootBlock(order, sheet, idx, total) {
  const r = sheet ? sheetRating(order, sheet) : null;
  const box = v => `<span class="pr-box">${r === v ? '☒' : '☐'} ${escapeHtml(ratingInfo(v).label)}</span>`;
  const sig = sheet && sheet.signWorker;
  const cust = sheet && sheet.signCustomer;
  const tool = sheet && showMeasure(sheet) ? [sheet.data.tool, sheet.data.toolNo ? 'Nr. ' + sheet.data.toolNo : '', sheet.data.temp ? sheet.data.temp + ' °C' : ''].filter(Boolean).join(' · ') : '';
  const remark = sheet ? [sheet.summary, sheet.advice].filter(Boolean).join('\n') : '';
  return `
    <table class="pr-footbox">
      <colgroup><col style="width:22%"><col style="width:42%"><col></colgroup>
      <tr class="pr-remark"><td colspan="3"><b>Bemerkung / Empfehlung:</b>
        ${sheet ? `<span class="pr-rating">${box('ok')} ${box('obs')} ${box('bad')}</span>` : ''}
        <div class="pre">${escapeHtml(remark)}</div></td></tr>
      <tr class="pr-tool"><td colspan="2"><b>Messwerkzeug:</b><div class="pr-hand">${escapeHtml(tool)}</div></td><td><b>Seitenzahl</b><div class="pr-hand">${idx} von ${total}</div></td></tr>
      <tr class="pr-sigrow">
        <td><b>Datum:</b><div class="pr-hand">${escapeHtml(formatDate(sheet ? sheet.date : order.date))}</div></td>
        <td><b>Unterschrift:</b><div class="pr-sig">${sig && sig.img ? `<img src="${sig.img}" alt="">` : ''}</div><small>${escapeHtml((sig && sig.name) || appData.settings.name || '')}</small></td>
        <td><b>Sonstiges:</b>${cust && cust.img ? `<div class="pr-sig small"><img src="${cust.img}" alt=""></div><small>Abnahme Kunde${cust.name ? ': ' + escapeHtml(cust.name) : ''}</small>` : ''}</td>
      </tr>
    </table>
    <div class="pr-pageno">Seite ${idx} von ${total}</div>`;
}

function printSheetHtml(order, sheet, idx, total) {
  const t = getType(sheet.type);
  let body = '';
  if (showMeasure(sheet)) body += t.measure.map(cfg => printMeasureHtml(order, sheet, cfg)).join('');
  if (showInspect(sheet)) body += t.inspect.map(cfg => printInspectHtml(order, sheet, cfg)).join('');
  if (t.special) body += specialPrintHtml(order, sheet);
  body += printFindingsHtml(sheet);
  return `
    <div class="pr-page">
      ${printHeadHtml(order, sheet, printDocTitle(sheet))}
      ${body}
      ${printFootBlock(order, sheet, idx, total)}
    </div>`;
}

// ---------- Deckblatt: Übersicht + Handlungsbedarf ----------
function sheetIssues(order, sheet) {
  const t = getType(sheet.type);
  const e = order.engines[sheet.engine || 0] || newEngine();
  const out = [];
  if (showMeasure(sheet)) t.measure.forEach(cfg => {
    const res = computeTable(cfg, sheet.data[cfg.key], tablePositions(order, sheet, cfg));
    ['bad', 'obs'].forEach(st => {
      const list = res.rows.filter(r => r.st === st).map(r => r.pos);
      if (list.length) out.push({ st, text: `${cfg.title}: ${st === 'bad' ? 'außer Toleranz' : 'an Verschleißgrenze'} – ${cfg.posKind === 'cyl' ? 'Zyl.' : 'Lager'} ${list.join(', ')}` });
    });
  });
  if (showInspect(sheet)) t.inspect.forEach(cfg => {
    const rows = (sheet.data[cfg.key] || {}).rows || {};
    tablePositions(order, sheet, cfg).forEach(p => {
      const r = rows[p] || {};
      if (r.rating === 'bad' || r.rating === 'obs') out.push({ st: r.rating, text: `${cfg.title} ${p}: ${[(r.tags || []).join(', '), r.note].filter(Boolean).join(' – ') || ratingLabel(r.rating)}` });
    });
  });
  if (t.special === 'endoscopy') positions(e, 'cyl').forEach(p => {
    const r = (sheet.data.cyl || {})[p] || {};
    if (r.rating === 'bad' || r.rating === 'obs') out.push({ st: r.rating, text: `Endoskopie Zyl. ${p}: ${[(r.tags || []).join(', '), r.note].filter(Boolean).join(' – ') || ratingLabel(r.rating)}` });
  });
  if (t.special === 'nozzles') {
    const bad = nozzleRows(order, sheet).filter(r => r.st === 'bad').map(r => r.pos);
    if (bad.length) out.push({ st: 'bad', text: 'Einspritzdüsen n.i.O.: Zyl. ' + bad.join(', ') });
  }
  if (t.special === 'general') GENERAL_CHECK.forEach((c, i) => {
    const r = (sheet.data.check || {})[i] || {};
    if (r.rating === 'bad' || r.rating === 'obs') out.push({ st: r.rating, text: c + (r.note ? ': ' + r.note : '') });
  });
  if (t.special === 'parts') partItems(sheet).forEach(it => {
    const st = partStatus(it.status);
    if (!st.rating || !(it.part || it.reason)) return;
    out.push({ st: st.rating, text: `${st.v === 'order' ? 'Bestellen' : 'Klären'}: ${[it.qty && it.qty !== '1' ? it.qty + '×' : '', it.part, it.pos ? '(' + it.pos + ')' : ''].filter(Boolean).join(' ')}${it.reason ? ' – ' + it.reason : ''}${st.v === 'open' && it.note ? ' – ' + it.note : ''}` });
  });
  sheet.findings.forEach(f => { if (f.rating === 'bad' || f.rating === 'obs') out.push({ st: f.rating, text: [f.part, f.text].filter(Boolean).join(': ') + (f.action ? ' → ' + f.action : '') }); });
  return out;
}

function printCoverHtml(order, sheets) {
  const issues = [];
  sheets.forEach(s => sheetIssues(order, s).forEach(x => issues.push({ ...x, sheet: getType(s.type).label })));
  issues.sort((a, b) => (a.st === 'bad' ? 0 : 1) - (b.st === 'bad' ? 0 : 1));
  const advice = sheets.filter(s => s.advice).map(s => ({ sheet: getType(s.type).label, text: s.advice }));
  const all = sheets.map(s => sheetRating(order, s));
  const overall = worstRating(all.filter(Boolean));
  return `
    <div class="pr-page pr-cover">
      ${printHeadHtml(order, null, 'Befundbericht' + (order.vessel ? ' ' + order.vessel : ''))}
      <table class="pr-list pr-engines">
        ${order.engines.map((e, i) => `<tr><th>${escapeHtml(engineLabel(order, i))}</th><td>${escapeHtml(engineTypeText(e))}</td><th>Motornr. / Bh</th><td>${escapeHtml([e.number, e.hours ? e.hours + ' Bh' : ''].filter(Boolean).join(' · '))}</td></tr>`).join('')}
        ${order.reason ? `<tr><th>Anlass / Auftrag</th><td colspan="3" class="pre">${escapeHtml(order.reason)}</td></tr>` : ''}
      </table>
      <div class="pr-block">
        <div class="pr-block-head"><span>Inhalt</span><span class="pr-block-sum">Gesamt: ${overall ? SYM[overall] + ' ' + escapeHtml(ratingLabel(overall)) : 'offen'}</span></div>
        <table class="pr-list"><colgroup><col style="width:6%"><col><col style="width:16%"><col style="width:13%"><col style="width:15%"></colgroup>
          <thead><tr><th>Blatt</th><th>Inhalt</th><th>Art</th><th>Datum</th><th>Bewertung</th></tr></thead>
          <tbody>${sheets.map((s, i) => { const r = all[i]; return `<tr><td>${i + 2}</td><td>${escapeHtml(getType(s.type).label + (s.subtitle ? ' – ' + s.subtitle : ''))}${order.engines.length > 1 ? ' <small>(' + escapeHtml(engineLabel(order, s.engine || 0)) + ')</small>' : ''}</td><td>${escapeHtml(sheetKindText(s))}</td><td>${escapeHtml(formatDate(s.date))}</td><td class="${stCls(r)}">${r ? SYM[r] + ' ' + escapeHtml(ratingLabel(r)) : '–'}</td></tr>`; }).join('')}</tbody>
        </table>
      </div>
      <div class="pr-block">
        <div class="pr-block-head"><span>Handlungsbedarf</span><span class="pr-block-sum">${issues.filter(x => x.st === 'bad').length}× n.i.O. · ${issues.filter(x => x.st === 'obs').length}× beobachten</span></div>
        ${issues.length ? `<table class="pr-list"><colgroup><col style="width:6%"><col style="width:22%"><col></colgroup><tbody>
          ${issues.map(x => `<tr><td class="sym ${stCls(x.st)}">${SYM[x.st]}</td><td>${escapeHtml(x.sheet)}</td><td>${escapeHtml(x.text)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="pr-none">Keine Auffälligkeiten festgestellt.</p>'}
      </div>
      ${advice.length ? `<div class="pr-block"><div class="pr-block-head"><span>Empfehlungen</span></div><table class="pr-list"><colgroup><col style="width:28%"><col></colgroup><tbody>${advice.map(a => `<tr><td>${escapeHtml(a.sheet)}</td><td class="pre">${escapeHtml(a.text)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${printFootBlock(order, null, 1, sheets.length + 1)}
    </div>`;
}

// ---------- Drucken ----------
async function printSheets(sheets, opts = {}) {
  const order = getActiveOrder();
  sheets = (sheets || []).filter(Boolean);
  if (!order || !sheets.length) return;
  flushSave();
  // Fotos vorladen, damit sie im Druck sicher erscheinen
  await Promise.all(collectPhotoIds({ sheets }).map(id => photoUrl(id)));
  const cover = opts.cover && sheets.length >= 1;
  const off = cover ? 1 : 0;
  const total = sheets.length + off;
  let html = cover ? printCoverHtml(order, sheets) : '';
  html += sheets.map((s, i) => printSheetHtml(order, s, i + 1 + off, total)).join('');
  const area = document.getElementById('print-area');
  area.innerHTML = html;
  await Promise.all([...area.querySelectorAll('img')].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
  const title = document.title;
  document.title = ['Befund', order.orderNo, sheets.length === 1 ? getType(sheets[0].type).label : 'Bericht'].filter(Boolean).join(' ').replace(/[\\/:]/g, '-');
  setTimeout(() => {
    window.print();
    document.title = title;
  }, 60);
}

function openPrintChooser() {
  const order = getActiveOrder();
  if (!order.sheets.length) { showToast('Noch keine Blätter im Auftrag'); return; }
  openModal(`
    <h2 class="modal-title">Drucken / PDF</h2>
    <p class="muted small-text">Im Druckdialog „Als PDF speichern“ wählen, um eine PDF-Datei zu erhalten.</p>
    <label class="check"><input type="checkbox" id="pc-cover" checked> Deckblatt mit Übersicht & Handlungsbedarf</label>
    <div class="modal-sub">Blätter</div>
    <div class="pc-list">${order.sheets.map(s => `
      <label class="check pc-item"><input type="checkbox" value="${s.id}" checked> ${escapeHtml(getType(s.type).label)}${s.subtitle ? ' – ' + escapeHtml(s.subtitle) : ''} <small class="muted">${escapeHtml(sheetKindText(s))}${order.engines.length > 1 ? ' · ' + escapeHtml(engineLabel(order, s.engine || 0)) : ''}</small></label>`).join('')}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="printChosen()">Drucken</button>
    </div>`);
}

function printChosen() {
  const order = getActiveOrder();
  const ids = [...document.querySelectorAll('.pc-item input:checked')].map(i => i.value);
  const cover = document.getElementById('pc-cover').checked;
  closeModal();
  printSheets(order.sheets.filter(s => ids.includes(s.id)), { cover });
}

Object.assign(window, { printSheets, openPrintChooser, printChosen });
