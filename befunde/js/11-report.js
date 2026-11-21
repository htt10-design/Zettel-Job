// =====================================================================
// 11-report: Zusammengefasster Befundbericht für den ganzen Auftrag.
// Ein Button am Auftrag → Dialog (Stand der Blätter, Fazit, Empfehlung,
// Gesamtbewertung, Optionen) → Druck: Kopf, Anlass, Ergebnis, Ergebnisse
// je Prüfung (automatisch zusammengefasst), Handlungsbedarf, Empfehlung,
// Fotodokumentation, Unterschrift, optional alle Blätter als Anlage.
// =====================================================================

// Kurzfassung eines Blatts in wenigen Zeilen
function sheetDigest(order, sheet) {
  const t = getType(sheet.type);
  const e = order.engines[sheet.engine || 0] || newEngine();
  const lines = [];
  const list = arr => arr.join(', ');
  const posWord = cfg => cfg.posKind === 'cyl' ? 'Zyl.' : 'Lager';

  if (showMeasure(sheet)) t.measure.forEach(cfg0 => {
    const d = sheet.data[cfg0.key] || {};
    const cfg = effCfg(cfg0, d);
    const pos = tablePositions(order, sheet, cfg);
    const res = computeTable(cfg, d, pos);
    const dec = cfg.dec || 3;
    if (!res.measured) { lines.push(`${cfg.title}: nicht gemessen`); return; }
    const parts = [`${res.measured}/${pos.length} gemessen`];
    if (cfg.kind === 'grid') {
      const all = res.rows.filter(r => r.min != null);
      parts.push(`Bereich ${formatNum(Math.min(...all.map(r => r.min)), dec)} – ${formatNum(Math.max(...all.map(r => r.max)), dec)} mm`);
      const ov = res.rows.filter(r => r.oval.n != null).sort((a, b) => b.oval.n - a.oval.n)[0];
      if (ov) parts.push(`Ovalität max. ${formatNum(ov.oval.n, dec)} (${ov.pos})`);
      const co = res.rows.filter(r => r.conic.n != null).sort((a, b) => b.conic.n - a.conic.n)[0];
      if (co) parts.push(`Konizität max. ${formatNum(co.conic.n, dec)} (${co.pos})`);
    } else if (cfg.kind === 'points') {
      const ms = res.rows.filter(r => r.mean.n != null);
      if (ms.length) parts.push(`${cfg.points.length > 1 ? 'Mittelwerte' : 'Werte'} ${formatNum(Math.min(...ms.map(r => r.mean.n)), dec)} – ${formatNum(Math.max(...ms.map(r => r.mean.n)), dec)} mm`);
    } else {
      cfg.pairs.forEach(pr => {
        const vals = res.rows.map(r => r.pairs.find(p => p.k === pr.k));
        if (cfg.boreOnly) {
          const ns = vals.flatMap(p => p.bore.map(x => x.n)).filter(n => n != null);
          if (ns.length) parts.push(`${pr.label}: ${pr.bore} ${formatNum(Math.min(...ns), dec)} – ${formatNum(Math.max(...ns), dec)} mm`);
        } else {
          const ns = vals.map(p => p.clr.n).filter(n => n != null);
          if (ns.length) parts.push(`${cfg.pairs.length > 1 ? pr.label + ': ' : ''}Spiel ${formatNum(Math.min(...ns), dec)} – ${formatNum(Math.max(...ns), dec)} mm`);
        }
      });
    }
    const bad = res.rows.filter(r => r.st === 'bad').map(r => r.pos);
    const obs = res.rows.filter(r => r.st === 'obs').map(r => r.pos);
    if (bad.length) parts.push(`außer Toleranz: ${posWord(cfg)} ${list(bad)}`);
    if (obs.length) parts.push(`an Verschleißgrenze: ${posWord(cfg)} ${list(obs)}`);
    if (!bad.length && !obs.length && specFilled(d.spec)) parts.push('alle Werte in Toleranz');
    lines.push(`${cfg.title}: ${parts.join(' · ')}`);
  });

  // Sichtbefund / Endoskopie / Checkliste: Zählung mit Positionen
  const countLine = (label, entries) => {
    const rated = entries.filter(x => x.r);
    if (!rated.length) return;
    const by = v => rated.filter(x => x.r === v).map(x => x.p);
    const parts = [];
    if (by('ok').length) parts.push(`${by('ok').length}× i.O.`);
    if (by('obs').length) parts.push(`${by('obs').length}× beobachten (${list(by('obs'))})`);
    if (by('bad').length) parts.push(`${by('bad').length}× n.i.O. (${list(by('bad'))})`);
    lines.push(`${label}: ${parts.join(' · ')}${rated.length < entries.length ? ` · ${entries.length - rated.length} ohne Bewertung` : ''}`);
  };
  if (showInspect(sheet)) t.inspect.forEach(cfg => {
    const rows = (sheet.data[cfg.key] || {}).rows || {};
    countLine(cfg.title, tablePositions(order, sheet, cfg).map(p => ({ p, r: (rows[p] || {}).rating })));
  });
  if (t.special === 'endoscopy') {
    const cyl = sheet.data.cyl || {};
    countLine('Zylinder', positions(e, 'cyl').map(p => ({ p, r: (cyl[p] || {}).rating })));
  }
  if (t.special === 'nozzles') {
    const rows = nozzleRows(order, sheet);
    const bad = rows.filter(r => r.st === 'bad').map(r => r.pos);
    const ren = rows.filter(r => r.r.action === 'erneuert').map(r => r.pos);
    const adj = rows.filter(r => r.r.action === 'eingestellt' || r.r.action === 'instandgesetzt').map(r => r.pos);
    const parts = [`${rows.filter(r => r.tested).length}/${rows.length} Düsen geprüft`];
    if (bad.length) parts.push(`n.i.O.: Zyl. ${list(bad)}`);
    if (adj.length) parts.push(`eingestellt/instandgesetzt: ${list(adj)}`);
    if (ren.length) parts.push(`erneuert: ${list(ren)}`);
    lines.push(parts.join(' · '));
  }
  if (t.special === 'serials') {
    const groups = sheet.data.groups || [];
    const n = groups.reduce((s, g) => s + g.rows.filter(r => r.sn || r.snNew).length, 0);
    const swapped = groups.flatMap(g => g.rows.filter(r => r.snNew).map(r => `${g.label}${r.pos ? ' ' + r.pos : ''}`));
    if (n || swapped.length) lines.push(`${n} Seriennummern erfasst${swapped.length ? ` · getauscht: ${list(swapped)}` : ''}`);
  }
  if (t.special === 'parts') {
    const items = partItems(sheet).filter(it => it.part || it.reason);
    const by = v => items.filter(it => it.status === v).map(it => [it.qty && it.qty !== '1' ? it.qty + '×' : '', it.part, it.pos ? '(' + it.pos + ')' : ''].filter(Boolean).join(' '));
    if (by('order').length) lines.push('Zu bestellen: ' + list(by('order')));
    if (by('open').length) lines.push('Noch zu klären: ' + list(by('open')));
    if (by('ordered').length) lines.push('Bereits bestellt: ' + list(by('ordered')));
    if (!items.length) lines.push('keine Bauteile erfasst');
  }
  if (t.special === 'general') {
    const check = sheet.data.check || {};
    countLine('Checkliste', GENERAL_CHECK.map((c, i) => ({ p: c, r: (check[i] || {}).rating })).filter(x => x.r));
  }
  const fl = sheet.findings.filter(f => f.part || f.text);
  if (fl.length) lines.push(`${fl.length} ${fl.length === 1 ? 'Feststellung' : 'Feststellungen'}: ${fl.map(f => [f.part, f.text].filter(Boolean).join(' – ')).join('; ')}`);
  if (sheet.summary) lines.push(sheet.summary);
  return lines;
}

// Stand eines Blatts für den Dialog: fertig / ohne Bewertung / leer
function sheetState(order, sheet) {
  const prog = sheetProgress(order, sheet);
  if (prog === 'noch leer') return { cls: 'empty', text: 'noch leer' };
  if (!sheetRating(order, sheet)) return { cls: 'open', text: 'ohne Bewertung' };
  return { cls: 'done', text: prog };
}

// ---------- Dialog ----------
function openReportDialog() {
  const order = getActiveOrder();
  if (!order.sheets.length) { showToast('Noch keine Blätter im Auftrag'); return; }
  const auto = worstRating(order.sheets.map(s => sheetRating(order, s)).filter(Boolean));
  const states = order.sheets.map(s => sheetState(order, s));
  const openCount = states.filter(s => s.cls !== 'done').length;
  const r = order.reportRating;
  openModal(`
    <h2 class="modal-title">Befundbericht</h2>
    <p class="muted small-text">Fasst alle Blätter dieses Auftrags auf wenigen Seiten zusammen – mit Ergebnis je Prüfung, Handlungsbedarf und Empfehlung.</p>
    <div class="modal-sub">Stand der Blätter</div>
    <div class="rep-list">${order.sheets.map((s, i) => `
      <button class="rep-item st-${states[i].cls}" onclick="closeModal();openSheet('${s.id}')">
        <span class="rep-dot"></span>
        <span class="rep-name"><b>${escapeHtml(getType(s.type).label)}</b><small>${escapeHtml(states[i].text)}${order.engines.length > 1 ? ' · ' + escapeHtml(engineLabel(order, s.engine || 0)) : ''}</small></span>
        ${ratingBadge(sheetRating(order, s), sheetRating(order, s) ? null : '–')}
      </button>`).join('')}</div>
    ${openCount ? `<p class="warn-text">⚠️ ${openCount} ${openCount === 1 ? 'Blatt ist' : 'Blätter sind'} noch leer oder ohne Bewertung – antippen zum Ergänzen, oder trotzdem drucken.</p>` : ''}
    <div class="modal-sub">Gesamtbewertung</div>
    <div class="rate-seg">${RATINGS.map(x => `<button type="button" class="r-${x.v} ${r === x.v ? 'on' : ''}" onclick="setReportRating('${x.v}')">${escapeHtml(x.label)}</button>`).join('')}</div>
    <p class="muted small-text">${r ? '' : auto ? 'Automatisch aus den Blättern: ' + escapeHtml(ratingLabel(auto)) : 'Noch keine Bewertung in den Blättern.'}</p>
    <label class="field"><span>Fazit / Zusammenfassung</span><textarea rows="3" oninput="setReportText('reportSummary', this.value)" placeholder="z.B. Motor in gutem Allgemeinzustand. Laufbuchse A2 außer Toleranz, Rest i.O.">${escapeHtml(order.reportSummary || '')}</textarea></label>
    <label class="field"><span>Empfehlung / weiteres Vorgehen</span><textarea rows="3" oninput="setReportText('reportAdvice', this.value)" placeholder="z.B. Laufbuchse A2 erneuern, Düsen A1 tauschen, nächste Kontrolle in 2.000 Bh">${escapeHtml(order.reportAdvice || '')}</textarea></label>
    <label class="check"><input type="checkbox" id="rep-photos" ${order.reportPhotos === false ? '' : 'checked'}> Fotodokumentation einfügen</label>
    <label class="check"><input type="checkbox" id="rep-attach" ${order.reportAttach ? 'checked' : ''}> Alle Mess- und Befundblätter als Anlage anhängen</label>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="viewReportFromDialog()">👁 Ansehen</button>
      <button class="btn btn-primary" onclick="printReportFromDialog()">🖨️ Bericht drucken</button>
    </div>`, { wide: true });
}

function setReportText(key, v) {
  const order = getActiveOrder();
  order[key] = v;
  touchOrder(order);
}

function setReportRating(v) {
  const order = getActiveOrder();
  order.reportRating = order.reportRating === v ? null : v;
  touchOrder(order);
  // Dialog neu zeichnen, eingegebene Texte stehen schon im Auftrag
  openReportDialog();
}

function viewReportFromDialog() {
  const order = getActiveOrder();
  order.reportPhotos = document.getElementById('rep-photos').checked;
  order.reportAttach = document.getElementById('rep-attach').checked;
  touchOrder(order);
  openReportView(order.id, order.reportAttach ? 'all' : 'report');
}

function printReportFromDialog() {
  const order = getActiveOrder();
  order.reportPhotos = document.getElementById('rep-photos').checked;
  order.reportAttach = document.getElementById('rep-attach').checked;
  touchOrder(order);
  closeModal();
  printReport(order, { photos: order.reportPhotos, attach: order.reportAttach });
}

// ---------- Druck ----------
function reportHtml(order, opts) {
  const s = appData.settings;
  const sheets = order.sheets;
  const ratings = sheets.map(sh => sheetRating(order, sh));
  const overall = order.reportRating || worstRating(ratings.filter(Boolean));
  const box = v => `<span class="pr-box">${overall === v ? '☒' : '☐'} ${escapeHtml(ratingInfo(v).label)}</span>`;
  const issues = [];
  sheets.forEach(sh => sheetIssues(order, sh).forEach(x => issues.push({ ...x, sheet: getType(sh.type).label })));
  issues.sort((a, b) => (a.st === 'bad' ? 0 : 1) - (b.st === 'bad' ? 0 : 1));
  const advices = sheets.filter(sh => sh.advice).map(sh => ({ sheet: getType(sh.type).label, text: sh.advice }));

  // Fotos aller Blätter mit Bildunterschrift
  const photos = [];
  if (opts.photos) sheets.forEach(sh => {
    const name = getType(sh.type).label;
    sh.findings.forEach(f => (f.photos || []).forEach(id => photos.push({ id, caption: `${name}: ${f.part || 'Befund'}${f.text ? ' – ' + f.text : ''}` })));
    partItems(sh).forEach(it => (it.photos || []).forEach(id => photos.push({ id, caption: `${name}: ${it.part || 'Bauteil'}${it.pos ? ' (' + it.pos + ')' : ''} – ${partStatus(it.status).label}` })));
    if (sh.data.cyl) Object.keys(sh.data.cyl).forEach(p => (sh.data.cyl[p].photos || []).forEach(id => photos.push({ id, caption: `${name} Zyl. ${p}${(sh.data.cyl[p].tags || []).length ? ' – ' + sh.data.cyl[p].tags.slice(0, 2).join(', ') : ''}` })));
  });

  const engRows = order.engines.map((e, i) => `<tr><th>${escapeHtml(engineLabel(order, i))}</th><td>${escapeHtml(engineTypeText(e))}</td><th>Motornr. / Betriebsstd.</th><td>${escapeHtml([e.number, e.hours ? e.hours + ' Bh' : ''].filter(Boolean).join(' · '))}</td></tr>`).join('');
  const sig = s.ownSignature;
  const dates = sheets.map(sh => sh.date).filter(Boolean).sort();
  const period = dates.length ? (dates[0] === dates[dates.length - 1] ? formatDate(dates[0]) : formatDate(dates[0]) + ' – ' + formatDate(dates[dates.length - 1])) : formatDate(order.date);

  return `
    <div class="pr-page pr-report">
      ${printHeadHtml(order, null, 'Befundbericht')}
      <table class="pr-list pr-engines">
        ${engRows}
        <tr><th>Prüfzeitraum</th><td>${escapeHtml(period)}</td><th>Ort / Werft</th><td>${escapeHtml(order.location || '')}</td></tr>
        ${order.reason ? `<tr><th>Anlass / Auftrag</th><td colspan="3" class="pre">${escapeHtml(order.reason)}</td></tr>` : ''}
      </table>

      <div class="pr-block">
        <div class="pr-block-head"><span>1. Ergebnis</span><span class="pr-rating">${box('ok')} ${box('obs')} ${box('bad')}</span></div>
        <div class="pr-text pre">${escapeHtml(order.reportSummary || '')}${order.reportSummary ? '' : '<span class="pr-none">' + escapeHtml(issues.length ? `${issues.filter(x => x.st === 'bad').length}× n.i.O. und ${issues.filter(x => x.st === 'obs').length}× beobachten festgestellt – Einzelheiten siehe unten.` : 'Keine Auffälligkeiten festgestellt.') + '</span>'}</div>
      </div>

      <div class="pr-block">
        <div class="pr-block-head"><span>2. Durchgeführte Prüfungen und Ergebnisse</span></div>
        <table class="pr-list"><colgroup><col style="width:5%"><col style="width:22%"><col><col style="width:14%"></colgroup>
          <thead><tr><th>Nr.</th><th>Prüfung</th><th>Ergebnis</th><th>Bewertung</th></tr></thead>
          <tbody>${sheets.map((sh, i) => {
            const lines = sheetDigest(order, sh);
            return `<tr><td>2.${i + 1}</td><td><b>${escapeHtml(getType(sh.type).label)}</b>${sh.subtitle ? '<br>' + escapeHtml(sh.subtitle) : ''}<br><small>${escapeHtml(sheetKindText(sh))} · ${escapeHtml(formatDate(sh.date))}${order.engines.length > 1 ? ' · ' + escapeHtml(engineLabel(order, sh.engine || 0)) : ''}</small></td>
              <td>${lines.length ? `<ul class="pr-ul">${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : '<i>keine Eintragungen</i>'}</td>
              <td class="${stCls(ratings[i])}">${ratings[i] ? SYM[ratings[i]] + ' ' + escapeHtml(ratingLabel(ratings[i])) : '–'}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>

      <div class="pr-block">
        <div class="pr-block-head"><span>3. Handlungsbedarf</span><span class="pr-block-sum">${issues.filter(x => x.st === 'bad').length}× n.i.O. · ${issues.filter(x => x.st === 'obs').length}× beobachten</span></div>
        ${issues.length ? `<table class="pr-list"><colgroup><col style="width:14%"><col style="width:22%"><col></colgroup>
          <thead><tr><th>Priorität</th><th>Prüfung</th><th>Befund</th></tr></thead><tbody>
          ${issues.map(x => `<tr><td class="${stCls(x.st)}">${x.st === 'bad' ? SYM.bad + ' n.i.O.' : SYM.obs + ' beobachten'}</td><td>${escapeHtml(x.sheet)}</td><td>${escapeHtml(x.text)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="pr-text pr-none">Kein Handlungsbedarf.</p>'}
      </div>

      <div class="pr-block">
        <div class="pr-block-head"><span>4. Empfehlung / weiteres Vorgehen</span></div>
        <div class="pr-text">
          ${order.reportAdvice ? `<div class="pre">${escapeHtml(order.reportAdvice)}</div>` : ''}
          ${advices.length ? `<ul class="pr-ul">${advices.map(a => `<li><b>${escapeHtml(a.sheet)}:</b> ${escapeHtml(a.text)}</li>`).join('')}</ul>` : ''}
          ${!order.reportAdvice && !advices.length ? '<span class="pr-none">–</span>' : ''}
        </div>
      </div>

      ${photos.length ? `
      <div class="pr-block pr-photo-block">
        <div class="pr-block-head"><span>5. Fotodokumentation</span><span class="pr-block-sum">${photos.length} ${photos.length === 1 ? 'Foto' : 'Fotos'}</span></div>
        ${printPhotosHtml(photos.map((p, i) => ({ id: p.id, caption: `Bild ${i + 1}: ${p.caption}` })))}
      </div>` : ''}

      ${opts.attach ? `<p class="pr-text"><b>Anlagen:</b> ${sheets.map((sh, i) => `Blatt ${i + 2} ${escapeHtml(printDocTitle(sh))}`).join(' · ')}</p>` : ''}

      <table class="pr-footbox">
        <colgroup><col style="width:30%"><col style="width:40%"><col></colgroup>
        <tr class="pr-sigrow">
          <td><b>Ort, Datum:</b><div class="pr-hand">${escapeHtml([order.location, formatDate(todayISO())].filter(Boolean).join(', '))}</div></td>
          <td><b>Unterschrift Prüfer:</b><div class="pr-sig">${sig ? `<img src="${sig}" alt="">` : ''}</div><small>${escapeHtml(s.name || '')}</small></td>
          <td><b>Kenntnisnahme Kunde:</b></td>
        </tr>
      </table>
      <div class="pr-pageno">Befundbericht ${escapeHtml(order.orderNo || '')}${opts.attach ? ` · Blatt 1 von ${sheets.length + 1}` : ''}</div>
    </div>`;
}

async function printReport(order, opts = {}) {
  flushSave();
  await Promise.all(collectPhotoIds(order).map(id => photoUrl(id)));
  const total = order.sheets.length + 1;
  let html = reportHtml(order, opts);
  if (opts.attach) html += order.sheets.map((sh, i) => printSheetHtml(order, sh, i + 2, total)).join('');
  const area = document.getElementById('print-area');
  area.innerHTML = html;
  await Promise.all([...area.querySelectorAll('img')].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
  const title = document.title;
  document.title = ['Befundbericht', order.orderNo, order.vessel].filter(Boolean).join(' ').replace(/[\\/:]/g, '-');
  setTimeout(() => { window.print(); document.title = title; }, 60);
}

// =====================================================================
// Berichtsansicht in der App (digital lesen, z.B. im Büro)
// Gleiche Darstellung wie der Druck – als Papierseiten auf dem Bildschirm.
// =====================================================================
let reportViewMode = 'report'; // 'report' = nur Bericht · 'all' = Bericht + alle Blätter
let paperObserver = null;

function openReportView(id, mode) {
  commitFocus();
  if (id) activeOrderId = id;
  if (mode) reportViewMode = mode;
  closeModal();
  showView('report');
}

function reportViewOpts(order) {
  return { photos: order.reportPhotos !== false, attach: reportViewMode === 'all' };
}

async function renderReportView() {
  const order = getActiveOrder();
  const body = document.getElementById('report-body');
  if (!order) { showView('orders'); return; }
  setTopbarTitle('Bericht ' + (order.orderNo || ''));
  if (!order.sheets.length) {
    body.innerHTML = `<div class="empty"><div class="empty-icon">${icon('doc')}</div><h3>Noch keine Blätter</h3><p>Für diesen Auftrag wurde noch nichts erfasst.</p></div>`;
    return;
  }
  const states = order.sheets.map(sh => sheetState(order, sh));
  const open = states.filter(x => x.cls !== 'done').length;
  const last = [order.updated, ...order.sheets.map(sh => sh.updated)].filter(Boolean).sort().pop();
  body.innerHTML = `
    <div class="rv-bar">
      <div class="chips">
        <button class="chip ${reportViewMode === 'report' ? 'active' : ''}" onclick="setReportViewMode('report')">Bericht</button>
        <button class="chip ${reportViewMode === 'all' ? 'active' : ''}" onclick="setReportViewMode('all')">Alle Blätter</button>
      </div>
      <button class="btn btn-soft" onclick="shareOrder()">📤 Senden</button>
      <button class="btn btn-primary" onclick="printReportView()">🖨️ PDF</button>
    </div>
    <div class="rv-meta">${escapeHtml([order.customer, order.vessel].filter(Boolean).join(' · '))}${last ? ' · Stand ' + escapeHtml(new Date(last).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })) : ''} · ${order.sheets.length} Blätter${open ? ` · <b class="txt-obs">${open} noch offen</b>` : ''}</div>
    <div class="paper-wrap"><div class="paper-doc paper-screen" id="paper"></div></div>`;
  await Promise.all(collectPhotoIds(order).map(id => photoUrl(id)));
  if (currentView !== 'report') return;
  const opts = reportViewOpts(order);
  let html = reportHtml(order, opts);
  if (opts.attach) html += order.sheets.map((sh, i) => printSheetHtml(order, sh, i + 2, order.sheets.length + 1)).join('');
  const paper = document.getElementById('paper');
  paper.innerHTML = html;
  // Seiten auf Bildschirmbreite verkleinern (A4 = 794 px)
  if (paperObserver) paperObserver.disconnect();
  if (window.ResizeObserver) { paperObserver = new ResizeObserver(fitPaper); paperObserver.observe(paper); }
  paper.querySelectorAll('img').forEach(img => img.addEventListener('load', fitPaper));
  fitPaper();
}

function fitPaper() {
  const wrap = document.querySelector('#view-report .paper-wrap');
  const paper = document.getElementById('paper');
  if (!wrap || !paper) return;
  const k = Math.min(1, wrap.clientWidth / 794);
  paper.style.transform = `scale(${k})`;
  wrap.style.height = Math.ceil(paper.offsetHeight * k) + 'px';
}
window.addEventListener('resize', () => { if (currentView === 'report') fitPaper(); });

function setReportViewMode(m) {
  reportViewMode = m;
  renderReportView();
}

function printReportView() {
  const order = getActiveOrder();
  if (order) printReport(order, reportViewOpts(order));
}

function reportLink(order) {
  return location.origin + location.pathname + '#bericht=' + encodeURIComponent(order.orderNo || order.id);
}

function openReportViewMenu() {
  const order = getActiveOrder();
  openModal(`
    <h2 class="modal-title">Bericht ${escapeHtml(order.orderNo || '')}</h2>
    <div class="menu-list">
      <button onclick="closeModal();printReportView()">🖨️ Drucken / als PDF speichern</button>
      <button onclick="closeModal();shareOrder()">📤 Auftrag ans Büro senden (Datei mit Fotos)</button>
      <button onclick="copyReportLink()">🔗 Link zu diesem Bericht kopieren</button>
      <button onclick="openReportDialog()">✏️ Fazit / Empfehlung bearbeiten</button>
    </div>
    <p class="muted small-text">Der Link öffnet den Bericht direkt – auf jedem Gerät, auf dem dieser Auftrag gespeichert ist (z.B. später aus Zettel-Job heraus).</p>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Schließen</button></div>`);
}

async function copyReportLink() {
  const order = getActiveOrder();
  const link = reportLink(order);
  try { await navigator.clipboard.writeText(link); showToast('Link kopiert'); }
  catch (e) { prompt('Link zum Bericht:', link); }
  closeModal();
}

// Auftrag als Datei (inkl. Fotos) teilen – Büro öffnet sie in Befunde mit „Auftrag laden“
async function shareOrder() {
  const order = getActiveOrder();
  if (!order) return;
  flushSave();
  showToast('Datei wird vorbereitet …');
  const files = await filesFor(collectPhotoIds(order));
  const data = { type: 'befunde-order', version: 1, at: new Date().toISOString(), order, files };
  const name = 'Befund-' + (order.orderNo || 'Auftrag').replace(/[\\/:]/g, '-') + '.json';
  try {
    const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Befund ' + (order.orderNo || ''), text: 'Befund ' + (order.orderNo || '') + ' – in der Befunde-App mit „Auftrag laden“ öffnen.' });
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  downloadJson(data, name);
  showToast('Datei gespeichert – per Mail / Teams ans Büro schicken');
}

// Direktlink: …/index.html#bericht=SR26/000249 (Bericht) oder #auftrag=… (Auftrag öffnen)
function openFromLink() {
  const src = (location.hash || '').replace(/^#/, '') || (location.search || '').replace(/^\?/, '');
  const params = new URLSearchParams(src);
  const key = params.has('bericht') ? 'bericht' : params.has('auftrag') ? 'auftrag' : null;
  if (!key) return;
  const raw = params.get(key) || '';
  const no = formatOrderNo(raw).toLowerCase();
  const order = appData.orders.filter(o => o.id === raw || (o.orderNo || '').toLowerCase() === no)
    .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))[0];
  if (!order) {
    showToast('Auftrag ' + raw + ' ist auf diesem Gerät nicht gespeichert');
    return;
  }
  if (key === 'bericht') openReportView(order.id, 'report'); else openOrder(order.id);
}

Object.assign(window, {
  openReportDialog, setReportText, setReportRating, printReportFromDialog,
  viewReportFromDialog, openReportView, setReportViewMode, printReportView, openReportViewMenu, copyReportLink, shareOrder
});
