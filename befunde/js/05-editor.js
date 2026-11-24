// =====================================================================
// 05-editor: Blatt bearbeiten – Kopf, Messmittel, Messtabellen mit
// Live-Auswertung, Sichtbefund je Position, Befunde & Fotos, Abschluss.
//
// Eingaben tragen data-bind="pfad" relativ zum Blatt (bzw. Auftrag).
// bindForm() verdrahtet Eingaben einmal je Container per Event-Delegation.
// =====================================================================

const expandedInspect = new Set(); // aufgeklappte Sichtbefund-Zeilen "key|pos"

function getActiveSheet() {
  const o = getActiveOrder();
  return o ? o.sheets.find(s => s.id === activeSheetId) || null : null;
}

function openSheet(id) {
  commitFocus();
  activeSheetId = id;
  showView('sheet');
}

function touchSheet(sheet) {
  if (sheet) sheet.updated = new Date().toISOString();
  touchOrder(getActiveOrder());
}

// ---------- Generische Formular-Bindung ----------
const formBindings = {};
function bindForm(container, getRoot, onChange) {
  formBindings[container.id] = { getRoot, onChange };
  if (container.dataset.bound) return;
  container.dataset.bound = '1';
  const handler = ev => {
    const b = formBindings[container.id];
    const el = ev.target.closest('[data-bind]');
    if (!el || !container.contains(el) || !el.isConnected) return;
    const root = b.getRoot();
    if (!root) return;
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (ev.type === 'change' && el.dataset.orderno) {
      const v = formatOrderNo(value, root.date);
      if (v !== value) { el.value = v; value = v; }
    }
    if (ev.type === 'change' && el.dataset.nom) {
      const v = quickValue(root, el);
      if (v != null) { el.value = v; value = v; }
    }
    if (el.dataset.num && ev.type === 'change') value = String(value).replace('.', ',').replace(/[−–]/g, '-');
    if (el.dataset.num && ev.type === 'change' && el.value !== value) el.value = value;
    setPath(root, el.dataset.bind, value);
    b.onChange(root, el, ev);
  };
  container.addEventListener('input', handler);
  container.addEventListener('change', handler);
  container.addEventListener('click', ev => {
    const b = formBindings[container.id];
    const btn = ev.target.closest('[data-set],[data-tag]');
    if (!btn || !container.contains(btn) || btn.closest('fieldset[disabled]')) return;
    const root = b.getRoot();
    if (!root) return;
    if (btn.dataset.tag) {
      const path = btn.dataset.tag;
      const arr = Array.isArray(getPath(root, path)) ? getPath(root, path).slice() : [];
      const i = arr.indexOf(btn.dataset.val);
      if (i >= 0) arr.splice(i, 1); else arr.push(btn.dataset.val);
      setPath(root, path, arr);
    } else {
      const path = btn.dataset.set;
      let val = btn.dataset.val;
      if (val === 'true') val = true; else if (val === 'false') val = false;
      const cur = getPath(root, path);
      setPath(root, path, cur === val && !btn.dataset.keep ? null : val);
    }
    b.onChange(root, btn, ev);
  });
  // Enter → nächstes Messfeld
  container.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || !ev.target.classList.contains('m-in')) return;
    ev.preventDefault();
    const all = [...container.querySelectorAll('.m-in')];
    const next = all[all.indexOf(ev.target) + 1];
    if (next) { next.focus(); next.select && next.select(); } else ev.target.blur();
  });
}

// Schnelleingabe µm: data-nom="pfad.zum.nennmaß"
function quickValue(root, el) {
  const nominal = parseNum(getPath(root, el.dataset.nom));
  return expandQuick(el.value, nominal, parseInt(el.dataset.dec || '3', 10));
}

// ---------- Editor ----------
function renderSheet() {
  const order = getActiveOrder();
  const sheet = getActiveSheet();
  const body = document.getElementById('sheet-body');
  if (!order || !sheet) { showView(order ? 'order' : 'orders'); return; }
  const t = getType(sheet.type);
  const e = order.engines[sheet.engine || 0] || newEngine();
  setTopbarTitle(t.label);
  const scrollY = window.scrollY;

  let html = `
    <div class="card sheet-head">
      <div class="sh-top">
        <span class="sh-icon">${icon(t.icon)}</span>
        <div class="sh-text">
          <div class="type-pill">${escapeHtml(sheetKindText(sheet))}</div>
          <div class="oh-title">${escapeHtml(sheetTitle(sheet))}</div>
          <div class="muted small-text">${escapeHtml(order.orderNo || '–')} · ${escapeHtml(order.vessel || order.customer || '')} · ${escapeHtml(order.engines.length > 1 ? engineLabel(order, sheet.engine || 0) + ': ' : '')}${escapeHtml(engineTypeText(e))}${e.number ? ' · Nr. ' + escapeHtml(e.number) : ''}</div>
        </div>
      </div>
      ${typeModes(t) ? `
      <div class="seg wide mode-seg">
        <button type="button" class="${sheet.mode === 'beides' ? 'on' : ''}" data-set="mode" data-val="beides" data-keep="1">Mess + Befund</button>
        <button type="button" class="${sheet.mode === 'mess' ? 'on' : ''}" data-set="mode" data-val="mess" data-keep="1">Messblatt</button>
        <button type="button" class="${sheet.mode === 'befund' ? 'on' : ''}" data-set="mode" data-val="befund" data-keep="1">Befundblatt</button>
      </div>` : ''}
      <div class="grid-2">
        ${field('Datum', 'date', sheet.date, { type: 'date' })}
        ${field('Zusatz im Titel (optional)', 'subtitle', sheet.subtitle, { placeholder: 'z.B. A-Seite, nach Montage …', rerender: false })}
      </div>
    </div>`;

  // Messmittel & Zusatzangaben
  const extra = t.extra || [];
  if (showMeasure(sheet) || extra.length) {
    html += `
    <div class="card">
      <h3 class="card-title">Angaben</h3>
      <div class="grid-2">
        ${showMeasure(sheet) ? `
        ${field('Messmittel', 'data.tool', sheet.data.tool, { list: 'dl-tools' })}
        ${field('Prüfmittel-Nr.', 'data.toolNo', sheet.data.toolNo)}
        ${field('Bauteiltemperatur °C', 'data.temp', sheet.data.temp, { inputmode: 'decimal', placeholder: '20' })}` : ''}
        ${extra.map(x => x.options
          ? selectField(x.label, 'data.extra.' + x.k, (sheet.data.extra || {})[x.k] || '', [''].concat(x.options).map(o => [o, o || '–']))
          : field(x.label, 'data.extra.' + x.k, (sheet.data.extra || {})[x.k])).join('')}
      </div>
      <datalist id="dl-tools">${TOOL_LIST.map(x => `<option value="${escapeHtml(x)}">`).join('')}</datalist>
    </div>`;
  }

  if (showMeasure(sheet)) html += t.measure.map(cfg => measureCardHtml(order, sheet, cfg, e)).join('');
  if (showInspect(sheet)) html += t.inspect.map(cfg => inspectCardHtml(order, sheet, cfg)).join('');
  if (t.special) html += specialEditorHtml(order, sheet, t.special);
  if (t.special !== 'parts') html += findingsCardHtml(sheet, t);
  html += closingCardHtml(order, sheet);
  html += `
    <div class="editor-footer">
      <button class="btn btn-ghost" onclick="printSheets([getActiveSheet()])">${'<svg viewBox="0 0 24 24"><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>'} Drucken</button>
      <button class="btn btn-primary" onclick="goBack()">Fertig</button>
    </div>`;

  body.innerHTML = html;
  bindForm(body, getActiveSheet, onSheetChange);
  refreshMeasure();
  refreshNozzles(); // Düsen-Bewertung direkt anzeigen (prüft selbst die Blattart)
  hydratePhotos(body);
  window.scrollTo(0, scrollY);
}

function onSheetChange(sheet, el, ev) {
  touchSheet(sheet);
  if (ev.type === 'click') { renderSheet(); return; }
  if (ev.type === 'change' && el.dataset.rerender) { renderSheet(); return; }
  if (el.closest('.special')) { specialOnChange(sheet, el, ev); return; }
  // Während der µm-Schnelleingabe ("23") noch nicht bewerten – erst beim Verlassen des Feldes
  if (ev.type === 'input' && el.dataset.nom && /^[-+]?\d{1,3}$/.test(el.value.trim()) && quickValue(sheet, el) != null) return;
  if (el.classList.contains('m-in') || el.classList.contains('spec-in')) refreshMeasure();
}

// ---------- Messtabellen ----------
function specInput(label, bind, value, opts = {}) {
  return `<label class="field spec-field"><span>${escapeHtml(label)}</span><input class="spec-in" data-bind="${bind}" value="${escapeHtml(value ?? '')}" inputmode="decimal" autocomplete="off" data-num="1" ${opts.nom ? `data-nom="${opts.nom}" data-dec="${opts.dec || 3}"` : ''} placeholder="${escapeHtml(opts.placeholder || '')}"></label>`;
}

function measureCardHtml(order, sheet, cfg, engine) {
  const d = sheet.data[cfg.key] || (sheet.data[cfg.key] = {});
  cfg = effCfg(cfg, d);
  const spec = d.spec || {};
  const p = 'data.' + cfg.key;
  const pos = tablePositions(order, sheet, cfg);
  const dec = cfg.dec || 3;
  const nomPath = p + '.spec.nom';

  let specHtml = '';
  if (cfg.kind === 'grid') {
    specHtml = `
      ${specInput('Nennmaß', p + '.spec.nom', spec.nom, { placeholder: 'z.B. 165,000' })}
      ${specInput('Toleranz min', p + '.spec.min', spec.min, { nom: nomPath, dec })}
      ${specInput('Toleranz max', p + '.spec.max', spec.max, { nom: nomPath, dec })}
      ${specInput('Verschleißgrenze', p + '.spec.wear', spec.wear, { nom: nomPath, dec, placeholder: 'optional' })}
      ${specInput('Ovalität max', p + '.spec.ovalMax', spec.ovalMax, { placeholder: 'z.B. 0,030' })}
      ${cfg.planes.length > 1 ? specInput('Konizität max', p + '.spec.conMax', spec.conMax, { placeholder: 'z.B. 0,030' }) : ''}
      ${cfg.extraCol && cfg.extraCol.limit ? specInput(cfg.extraCol.label + ' max', p + '.spec.extraMax', spec.extraMax, { placeholder: 'z.B. 0,020' }) : ''}`;
  } else if (cfg.kind === 'points') {
    specHtml = `
      ${specInput('Soll min', p + '.spec.min', spec.min, { placeholder: 'z.B. 0,05' })}
      ${specInput('Soll max', p + '.spec.max', spec.max, { placeholder: 'z.B. 0,12' })}
      ${cfg.points.length > 1 ? specInput('Streuung max', p + '.spec.spreadMax', spec.spreadMax, { placeholder: 'optional' }) : ''}
      ${cfg.neighbor ? specInput('Δ Nachbar max', p + '.spec.neighborMax', spec.neighborMax, { placeholder: 'optional' }) : ''}`;
  } else {
    specHtml = cfg.pairs.map(pr => {
      const s = (spec[pr.k] = spec[pr.k] || {});
      const sp = p + '.spec.' + pr.k;
      return `
      ${cfg.pairs.length > 1 ? `<div class="spec-sub span-all">${escapeHtml(pr.label)}</div>` : ''}
      ${specInput('Nennmaß', sp + '.nom', s.nom, { placeholder: 'z.B. 90,000' })}
      ${specInput(pr.bore + ' min', sp + '.boreMin', s.boreMin, { nom: sp + '.nom', dec })}
      ${specInput(pr.bore + ' max', sp + '.boreMax', s.boreMax, { nom: sp + '.nom', dec })}
      ${cfg.boreOnly ? '' : `
      ${specInput(pr.shaft + ' min', sp + '.shaftMin', s.shaftMin, { nom: sp + '.nom', dec })}
      ${specInput(pr.shaft + ' max', sp + '.shaftMax', s.shaftMax, { nom: sp + '.nom', dec })}
      ${specInput('Spiel min', sp + '.clrMin', s.clrMin, { placeholder: 'z.B. 0,060' })}
      ${specInput('Spiel max', sp + '.clrMax', s.clrMax, { placeholder: 'z.B. 0,120' })}`}`;
    }).join('');
  }
  const hasSpec = specFilled(spec);
  const quickHint = cfg.kind !== 'points' && appData.settings.quickInput
    ? `<p class="hint">⚡ Schnelleingabe: Bei eingetragenem Nennmaß reicht die Abweichung in µm – <b>23</b> wird zu Nennmaß + 0,023, <b>-8</b> zu Nennmaß − 0,008. Mit Komma = genauer Wert.</p>` : '';

  return `
    <div class="card measure-card" data-mkey="${cfg.key}">
      <div class="mc-head">
        <h3 class="card-title">${escapeHtml(cfg.title)}</h3>
        <span class="mc-sum" data-msum="${cfg.key}"></span>
      </div>
      ${cfg.posKind !== 'cyl' ? `
      <div class="count-row">
        <span>Anzahl ${cfg.posKind === 'main' ? 'Grundlager' : cfg.posKind === 'rod' ? 'Hublagerzapfen' : 'Lager'}</span>
        <input class="count-in" type="number" min="1" max="30" data-bind="${p}.count" data-rerender="1" value="${escapeHtml(d.count || pos.length)}">
        <span class="muted small-text">Lager 1 = KS</span>
      </div>` : ''}
      ${cfg.sideOption ? `
      <div class="cfg-row">
        <div class="field"><span>Was wird gemessen?</span>
          <div class="seg wide">
            <button type="button" class="${!cfg.boreOnly ? 'on' : ''}" data-set="${p}.sides" data-val="both" data-keep="1">Gehäuse + Buchse</button>
            <button type="button" class="${cfg.boreOnly ? 'on' : ''}" data-set="${p}.sides" data-val="bore" data-keep="1">Nur Gehäusebohrung</button>
          </div>
        </div>
        ${cfg.boreOnly ? '<p class="muted small-text side-hint">Buchsenmaß und Spiel entfallen – z.B. wenn neue Buchsen eingebaut werden.</p>' : ''}
      </div>
      ${cfg.sketch && !cfg.planeOptions && !cfg.pointOptions ? `<div class="sketch sketch-wide">${sketchSvg(cfg)}</div>` : ''}` : ''}
      ${cfg.planeOptions || cfg.pointOptions ? `
      <div class="cfg-row">
        <div class="field"><span>${cfg.planeOptions ? 'Anzahl Messebenen' : 'Anzahl Messpunkte'}</span>
          <div class="seg">${(cfg.planeOptions || cfg.pointOptions).map(n => `<button type="button" class="${(cfg.nPlanes || cfg.nPoints) === n ? 'on' : ''}" data-set="${p}.${cfg.planeOptions ? 'planes' : 'points'}" data-val="${n}" data-keep="1">${n}</button>`).join('')}</div>
        </div>
        ${cfg.sketch ? `<div class="sketch">${sketchSvg(cfg)}</div>` : ''}
      </div>` : ''}
      <details class="spec-box" ${hasSpec ? '' : 'open'}>
        <summary>Sollwerte / Toleranzen <span class="muted small-text">${hasSpec ? specSummary(cfg, spec) : 'aus Handbuch eintragen – dann wird automatisch bewertet'}</span></summary>
        <div class="spec-grid">${specHtml}</div>
        <div class="spec-actions">
          <button type="button" class="link-btn" onclick="saveSpecTemplate()">★ Sollwerte für ${escapeHtml([engine.make, engine.model].filter(Boolean).join(' ') || 'diesen Motortyp')} merken</button>
        </div>
      </details>
      ${quickHint}
      ${cfg.dirHint || cfg.pointHint || cfg.clrHint ? `<p class="hint">ℹ️ ${escapeHtml(cfg.dirHint || cfg.pointHint || (cfg.boreOnly ? cfg.clrHint.split('. Spiel')[0] : cfg.clrHint))}</p>` : ''}
      <div class="mtable-wrap">${measureTableHtml(cfg, d, pos, p)}</div>
      <div class="legend"><span class="lg lg-ok">i.O.</span><span class="lg lg-obs">Verschleißgrenze / beobachten</span><span class="lg lg-bad">außer Toleranz</span></div>
    </div>`;
}

// Ist irgendein Sollwert eingetragen?
function specFilled(spec) {
  if (spec == null) return false;
  if (typeof spec === 'object') return Object.values(spec).some(specFilled);
  return String(spec).trim() !== '';
}

function specSummary(cfg, spec) {
  if (cfg.kind === 'grid') return [spec.min || spec.max ? `${spec.min || '…'} – ${spec.max || '…'}` : '', spec.ovalMax ? 'Oval ≤ ' + spec.ovalMax : ''].filter(Boolean).join(' · ');
  if (cfg.kind === 'points') return spec.min || spec.max ? `${spec.min || '…'} – ${spec.max || '…'} mm` : '';
  return cfg.pairs.map(pr => { const s = spec[pr.k] || {}; return s.clrMin || s.clrMax ? `Spiel ${s.clrMin || '…'} – ${s.clrMax || '…'}` : ''; }).filter(Boolean).join(' · ');
}

function mIn(bind, val, nomPath, dec, label) {
  return `<input class="m-in" data-bind="${bind}" value="${escapeHtml(val ?? '')}" inputmode="decimal" autocomplete="off" data-num="1" ${nomPath ? `data-nom="${nomPath}" data-dec="${dec}"` : ''} aria-label="${escapeHtml(label)}">`;
}

function measureTableHtml(cfg, d, pos, p) {
  const rows = d.rows || {};
  const dec = cfg.dec || 3;
  let prevBank = null;
  const posTh = label => {
    const b = bankOf(label);
    const cls = prevBank !== null && b !== prevBank ? 'bank-start' : '';
    prevBank = b;
    return { cls, th: `<th class="pos" data-mrow="${cfg.key}|${escapeHtml(label)}">${escapeHtml(label)}</th>` };
  };
  if (cfg.kind === 'grid') {
    const nom = p + '.spec.nom';
    const head1 = cfg.planes.map(pl => `<th colspan="${cfg.dirs.length}" class="grp">${escapeHtml(pl.label)}</th>`).join('');
    const head2 = cfg.planes.map(() => cfg.dirs.map(dr => `<th>${escapeHtml(dr.label)}</th>`).join('')).join('');
    const body = pos.map(ps => {
      const r = rows[ps] || {};
      const { cls, th } = posTh(ps);
      return `<tr class="${cls}">${th}${cfg.planes.map(pl => cfg.dirs.map(dr =>
        `<td>${mIn(`${p}.rows.${ps}.${pl.k}_${dr.k}`, r[pl.k + '_' + dr.k], nom, dec, ps + ' ' + pl.label + ' ' + dr.label)}</td>`).join('')).join('')}
        <td class="m-d" data-d="${cfg.key}|${escapeHtml(ps)}|oval"></td>
        ${cfg.planes.length > 1 ? `<td class="m-d" data-d="${cfg.key}|${escapeHtml(ps)}|conic"></td>` : ''}
        ${cfg.extraCol ? `<td>${mIn(`${p}.rows.${ps}.${cfg.extraCol.k}`, r[cfg.extraCol.k], null, dec, ps + ' ' + cfg.extraCol.label)}</td>` : ''}
      </tr>`;
    }).join('');
    return `<table class="mtable"><thead>
      <tr><th rowspan="2" class="pos">${cfg.posKind === 'cyl' ? 'Zyl.' : 'Lager'}</th>${head1}<th rowspan="2">Ovalität</th>${cfg.planes.length > 1 ? '<th rowspan="2">Konizität</th>' : ''}${cfg.extraCol ? `<th rowspan="2">${escapeHtml(cfg.extraCol.label)}</th>` : ''}</tr>
      <tr>${head2}</tr></thead><tbody>${body}</tbody></table>`;
  }
  if (cfg.kind === 'points') {
    const one = cfg.points.length === 1;
    const body = pos.map(ps => {
      const r = rows[ps] || {};
      const { cls, th } = posTh(ps);
      return `<tr class="${cls}">${th}${cfg.points.map((pt, i) => `<td>${mIn(`${p}.rows.${ps}.p${i}`, r['p' + i], null, cfg.dec, ps + ' ' + pt)}</td>`).join('')}
        ${one ? '' : `<td class="m-d" data-d="${cfg.key}|${escapeHtml(ps)}|mean"></td><td class="m-d" data-d="${cfg.key}|${escapeHtml(ps)}|spread"></td>`}
        ${cfg.neighbor ? `<td class="m-d" data-d="${cfg.key}|${escapeHtml(ps)}|neighbor"></td>` : ''}
        ${cfg.extraCol ? `<td><input class="m-in txt" data-bind="${p}.rows.${ps}.${cfg.extraCol.k}" value="${escapeHtml(r[cfg.extraCol.k] || '')}" autocomplete="off" aria-label="${escapeHtml(cfg.extraCol.label)}"></td>` : ''}
        ${cfg.note ? `<td><input class="m-in txt note" data-bind="${p}.rows.${ps}.note" value="${escapeHtml(r.note || '')}" autocomplete="off" placeholder="Bemerkung" aria-label="Bemerkung ${escapeHtml(ps)}"></td>` : ''}
      </tr>`;
    }).join('');
    return `<table class="mtable"><thead><tr><th class="pos">Zyl.</th>${cfg.points.map(pt => `<th>${escapeHtml(pt)}</th>`).join('')}${one ? '' : '<th>Mittel</th><th>Streuung</th>'}${cfg.neighbor ? '<th>Δ Nachbar</th>' : ''}${cfg.extraCol ? `<th>${escapeHtml(cfg.extraCol.label)}</th>` : ''}${cfg.note ? '<th>Bemerkung</th>' : ''}</tr></thead><tbody>${body}</tbody></table>`;
  }
  // clearance
  const sides = cfg.boreOnly ? ['b'] : ['b', 's'];
  const head1 = cfg.pairs.map(pr => `<th colspan="${cfg.dirs.length * sides.length + (cfg.boreOnly ? 0 : 1)}" class="grp">${escapeHtml(pr.label)}</th>`).join('');
  const head2 = cfg.pairs.map(pr => cfg.dirs.map(dr => `<th>${escapeHtml(pr.bore)}<br><small>${escapeHtml(dr.label)}</small></th>`).join('') +
    (cfg.boreOnly ? '' : cfg.dirs.map(dr => `<th>${escapeHtml(pr.shaft)}<br><small>${escapeHtml(dr.label)}</small></th>`).join('') + '<th>Spiel</th>')).join('');
  const body = pos.map(ps => {
    const r = rows[ps] || {};
    const { cls, th } = posTh(ps);
    return `<tr class="${cls}">${th}${cfg.pairs.map(pr => {
      const nom = `${p}.spec.${pr.k}.nom`;
      return sides.map(side => cfg.dirs.map(dr => `<td>${mIn(`${p}.rows.${ps}.${pr.k}${side}_${dr.k}`, r[pr.k + side + '_' + dr.k], nom, cfg.dec || 3, ps + ' ' + pr.label)}</td>`).join('')).join('') +
        (cfg.boreOnly ? '' : `<td class="m-d" data-d="${cfg.key}|${escapeHtml(ps)}|clr_${pr.k}"></td>`);
    }).join('')}</tr>`;
  }).join('');
  return `<table class="mtable"><thead><tr><th rowspan="2" class="pos">${cfg.posKind === 'cyl' ? 'Zyl.' : 'Lager'}</th>${head1}</tr><tr>${head2}</tr></thead><tbody>${body}</tbody></table>`;
}

// Live-Auswertung: Farben der Felder, berechnete Spalten, Zusammenfassung
function refreshMeasure() {
  const order = getActiveOrder(), sheet = getActiveSheet();
  if (!order || !sheet || !showMeasure(sheet)) return;
  const body = document.getElementById('sheet-body');
  const t = getType(sheet.type);
  const setSt = (el, st) => { if (!el) return; el.classList.remove('st-ok', 'st-obs', 'st-bad'); if (st) el.classList.add('st-' + st); };
  const inp = bind => body.querySelector(`[data-bind="${CSS.escape(bind)}"]`);
  const cell = (key, pos, what) => body.querySelector(`[data-d="${CSS.escape(key + '|' + pos + '|' + what)}"]`);
  const setCell = (el, n, st, dec) => { if (!el) return; el.textContent = n == null ? '' : formatNum(n, dec); setSt(el, st); };

  t.measure.forEach(cfg0 => {
    const d = sheet.data[cfg0.key] || {};
    const cfg = effCfg(cfg0, d);
    const p = 'data.' + cfg.key;
    const pos = tablePositions(order, sheet, cfg);
    const res = computeTable(cfg, d, pos);
    const dec = cfg.dec || 3;
    res.rows.forEach(r => {
      if (cfg.kind === 'grid') {
        Object.keys(r.vals).forEach(k => setSt(inp(`${p}.rows.${r.pos}.${k}`), r.vals[k].st));
        setCell(cell(cfg.key, r.pos, 'oval'), r.oval.n, r.oval.st, dec);
        setCell(cell(cfg.key, r.pos, 'conic'), r.conic.n, r.conic.st, dec);
        if (cfg.extraCol) setSt(inp(`${p}.rows.${r.pos}.${cfg.extraCol.k}`), r.extra && r.extra.st);
      } else if (cfg.kind === 'points') {
        r.vals.forEach((v, i) => setSt(inp(`${p}.rows.${r.pos}.p${i}`), v.st));
        setCell(cell(cfg.key, r.pos, 'mean'), r.mean.n, r.mean.st, dec);
        setCell(cell(cfg.key, r.pos, 'spread'), r.spread.n, r.spread.st, dec);
        setCell(cell(cfg.key, r.pos, 'neighbor'), r.neighbor.n, r.neighbor.st, dec);
      } else {
        r.pairs.forEach(pr => {
          ['b', 's'].forEach(side => (side === 'b' ? pr.bore : pr.shaft).forEach((x, i) => setSt(inp(`${p}.rows.${r.pos}.${pr.k}${side}_${cfg.dirs[i].k}`), x.st)));
          setCell(cell(cfg.key, r.pos, 'clr_' + pr.k), pr.clr.n, pr.clr.st, dec);
        });
      }
      setSt(body.querySelector(`[data-mrow="${CSS.escape(cfg.key + '|' + r.pos)}"]`), r.st);
    });
    const sum = body.querySelector(`[data-msum="${cfg.key}"]`);
    if (sum) sum.innerHTML = `${res.measured}/${pos.length} gemessen` +
      (res.bad ? ` · <b class="txt-bad">${res.bad}× n.i.O.</b>` : '') + (res.obs ? ` · <b class="txt-obs">${res.obs}× beobachten</b>` : '') +
      (!res.bad && !res.obs && res.measured ? ' · <b class="txt-ok">alles i.O.</b>' : '');
  });
  const auto = document.getElementById('auto-rating');
  if (auto) auto.innerHTML = autoRatingText(order, sheet);
}

function saveSpecTemplate() {
  const order = getActiveOrder(), sheet = getActiveSheet();
  const e = order.engines[sheet.engine || 0];
  const k = specKey(e);
  if (!k) { showToast('Erst Fabrikat/Motortyp beim Auftrag eintragen'); return; }
  const t = getType(sheet.type);
  appData.specs[k] = appData.specs[k] || {};
  const tpl = {};
  (t.measure || []).forEach(cfg => { if (sheet.data[cfg.key] && sheet.data[cfg.key].spec) tpl[cfg.key] = JSON.parse(JSON.stringify(sheet.data[cfg.key].spec)); });
  appData.specs[k][sheet.type] = tpl;
  appData.specsUpdated = new Date().toISOString();
  saveData(true);
  showToast('Sollwerte gemerkt – neue Blätter für ' + [e.make, e.model].filter(Boolean).join(' ') + ' werden vorausgefüllt');
}

// ---------- Sichtbefund je Position ----------
function inspectCardHtml(order, sheet, cfg) {
  const d = sheet.data[cfg.key] || (sheet.data[cfg.key] = {});
  const rows = d.rows || {};
  const p = 'data.' + cfg.key;
  const pos = tablePositions(order, sheet, cfg);
  const rated = pos.filter(x => (rows[x] || {}).rating).length;
  const countHtml = cfg.posKind !== 'cyl' && !showMeasure(sheet) ? `
      <div class="count-row">
        <span>Anzahl</span>
        <input class="count-in" type="number" min="1" max="30" data-bind="${p}.count" data-rerender="1" value="${escapeHtml(d.count || pos.length)}">
      </div>` : '';
  return `
    <div class="card inspect-card">
      <div class="mc-head">
        <h3 class="card-title">${escapeHtml(cfg.title)}</h3>
        <span class="mc-sum">${rated}/${pos.length} bewertet</span>
      </div>
      ${countHtml}
      <div class="insp-list">
        ${pos.map(ps => {
          const r = rows[ps] || {};
          const key = cfg.key + '|' + ps;
          const open = expandedInspect.has(key) || r.rating === 'obs' || r.rating === 'bad';
          const tags = r.tags || [];
          return `
          <div class="insp-row rate-${r.rating || 'none'}">
            <div class="insp-head">
              <span class="pos-badge">${escapeHtml(ps)}</span>
              ${ratingSeg(`${p}.rows.${ps}.rating`, r.rating, { small: true })}
              <button type="button" class="icon-btn small insp-more ${open ? 'open' : ''}" onclick="toggleInspect('${escapeHtml(key)}')" aria-label="Details">
                <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>
            ${!open && (tags.length || r.note) ? `<div class="insp-summary">${escapeHtml(tags.concat(r.note ? [r.note] : []).join(' · '))}</div>` : ''}
            ${open ? `
            <div class="tag-chips">${cfg.items.map(it => `<button type="button" class="tag ${tags.includes(it) ? 'on' : ''}" data-tag="${p}.rows.${ps}.tags" data-val="${escapeHtml(it)}">${escapeHtml(it)}</button>`).join('')}</div>
            <input class="insp-note" data-bind="${p}.rows.${ps}.note" value="${escapeHtml(r.note || '')}" placeholder="Bemerkung zu ${escapeHtml(ps)} …" autocomplete="off">` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="btn-row insp-actions">
        <button type="button" class="btn btn-soft" onclick="inspectRestOk('${cfg.key}')">✓ Alle übrigen i.O.</button>
      </div>
    </div>`;
}

function toggleInspect(key) {
  if (expandedInspect.has(key)) expandedInspect.delete(key); else expandedInspect.add(key);
  renderSheet();
}

function inspectRestOk(key) {
  const order = getActiveOrder(), sheet = getActiveSheet();
  const cfg = getType(sheet.type).inspect.find(c => c.key === key);
  const d = sheet.data[key] = sheet.data[key] || {};
  d.rows = d.rows || {};
  let n = 0;
  tablePositions(order, sheet, cfg).forEach(ps => {
    d.rows[ps] = d.rows[ps] || {};
    if (!d.rows[ps].rating) { d.rows[ps].rating = 'ok'; n++; }
  });
  touchSheet(sheet);
  renderSheet();
  showToast(n ? n + ' Positionen auf i.O. gesetzt' : 'Alle Positionen sind schon bewertet');
}

// ---------- Befunde & Fotos (auf jedem Blatt) ----------
const PART_SUGGEST = ['Laufbuchse', 'Kolben', 'Kolbenringe', 'Pleuel', 'Pleuellager', 'Kurbelwelle', 'Grundlager', 'Nockenwelle', 'Zylinderkopf', 'Ventile', 'Einspritzdüse', 'HD-Pumpe', 'Turbolader', 'Ladeluftkühler', 'Kühlwasserpumpe', 'Seewasserpumpe', 'Schmierölpumpe', 'Kurbelgehäuse', 'Dichtungen', 'Schwingungsdämpfer'];

function findingsCardHtml(sheet, t) {
  const general = t.special === 'general';
  return `
    <div class="card findings-card">
      <div class="mc-head">
        <h3 class="card-title">${general ? 'Feststellungen' : 'Befunde & Fotos'}</h3>
        <span class="mc-sum">${sheet.findings.length || ''}</span>
      </div>
      ${sheet.findings.length ? '' : `<p class="muted small-text">${general ? 'Was ist dir bei der Durchsicht aufgefallen? Jede Feststellung mit Bewertung, Maßnahme und Fotos.' : 'Zusätzliche Feststellungen mit Fotos – optional.'}</p>`}
      <div class="finding-list">
        ${sheet.findings.map((f, i) => `
          <div class="finding rate-${f.rating || 'none'}">
            <div class="f-head">
              <span class="f-no">${i + 1}</span>
              <input class="f-part" data-bind="findings.${i}.part" value="${escapeHtml(f.part || '')}" placeholder="Bauteil / Position" list="dl-parts" autocomplete="off">
              <button type="button" class="icon-btn small danger-hover" onclick="removeFinding(${i})" aria-label="Befund löschen"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>
            </div>
            <textarea data-bind="findings.${i}.text" rows="2" placeholder="Was wurde festgestellt?">${escapeHtml(f.text || '')}</textarea>
            ${ratingSeg(`findings.${i}.rating`, f.rating)}
            <input data-bind="findings.${i}.action" value="${escapeHtml(f.action || '')}" placeholder="Maßnahme / Empfehlung (z.B. erneuern, beobachten …)" autocomplete="off">
            ${photoStripHtml(`findings.${i}.photos`, f.photos)}
          </div>`).join('')}
      </div>
      <datalist id="dl-parts">${PART_SUGGEST.map(x => `<option value="${escapeHtml(x)}">`).join('')}</datalist>
      <button type="button" class="btn btn-soft" onclick="addFinding()">＋ ${general ? 'Feststellung' : 'Befund'} hinzufügen</button>
    </div>`;
}

function addFinding() {
  const sheet = getActiveSheet();
  sheet.findings.push({ id: uid(), part: '', text: '', rating: null, action: '', photos: [] });
  touchSheet(sheet);
  renderSheet();
  const all = document.querySelectorAll('.finding .f-part');
  if (all.length) all[all.length - 1].focus();
}

async function removeFinding(i) {
  const sheet = getActiveSheet();
  const f = sheet.findings[i];
  if ((f.text || f.part || (f.photos || []).length) && !await confirmDialog('Befund löschen?', 'Löschen', true)) return;
  (f.photos || []).forEach(id => deleteFile(id).catch(() => {}));
  sheet.findings.splice(i, 1);
  touchSheet(sheet);
  renderSheet();
}

// ---------- Abschluss ----------
function autoRatingText(order, sheet) {
  const a = sheetAutoRating(order, sheet);
  return a ? `Vorschlag aus den Eintragungen: ${ratingBadge(a)}` : 'Noch keine Bewertung aus den Eintragungen.';
}

function closingCardHtml(order, sheet) {
  return `
    <div class="card">
      <h3 class="card-title">Ergebnis</h3>
      <div class="field"><span>Gesamtbewertung</span>${ratingSeg('rating', sheet.rating)}</div>
      <p class="muted small-text" id="auto-rating">${autoRatingText(order, sheet)}</p>
      ${textArea('Zusammenfassung', 'summary', sheet.summary, { rows: 2, placeholder: 'Kurz: was wurde geprüft, was ist das Ergebnis?' })}
      ${textArea('Empfehlung / Maßnahmen', 'advice', sheet.advice, { rows: 2, placeholder: 'z.B. Laufbuchse A3 erneuern, B5 beobachten …' })}
      <div class="sub-block">
        <h4>Unterschriften</h4>
        <div class="sign-grid">
          ${signBoxHtml('worker', 'Prüfer / Monteur', sheet.signWorker)}
          ${signBoxHtml('customer', 'Kunde / Abnahme (optional)', sheet.signCustomer)}
        </div>
      </div>
    </div>`;
}

function signBoxHtml(who, label, sign) {
  if (sign) return `
      <div class="sign-box signed">
        <span class="sign-label">${escapeHtml(label)}</span>
        <img src="${sign.img}" alt="Unterschrift">
        <div class="sign-meta">${escapeHtml(sign.name || '')}${sign.name ? ' · ' : ''}${escapeHtml(new Date(sign.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}</div>
        <button type="button" class="link-btn" onclick="removeSignature('${who}')">Unterschrift entfernen</button>
      </div>`;
  return `
    <button type="button" class="sign-box empty" onclick="startSignature('${who}')">
      <span class="sign-label">${escapeHtml(label)}</span>
      <svg viewBox="0 0 24 24"><path d="M3 17c3 0 4-6 7-6s1 6 4 6 3-3 5-3"/><path d="M3 21h18"/></svg>
      <span>Tippen zum Unterschreiben</span>
    </button>`;
}

// Fortschritt für die Blattkarte
function sheetProgress(order, s) {
  const t = getType(s.type);
  const parts = [];
  if (showMeasure(s)) t.measure.forEach(cfg => {
    const pos = tablePositions(order, s, cfg);
    const res = computeTable(cfg, s.data[cfg.key], pos);
    parts.push(`${res.measured}/${pos.length} gemessen`);
  });
  if (showInspect(s) && !showMeasure(s)) t.inspect.forEach(cfg => {
    const pos = tablePositions(order, s, cfg);
    parts.push(`${inspectRatings(s, cfg, pos).length}/${pos.length} bewertet`);
  });
  if (t.special && typeof specialProgress === 'function') parts.push(specialProgress(order, s));
  if (s.findings.length) parts.push(s.findings.length + (s.findings.length === 1 ? ' Befund' : ' Befunde'));
  return parts.filter(Boolean).join(' · ') || 'noch leer';
}

// ---------- Menü Blatt ----------
function openSheetMenu() {
  const order = getActiveOrder(), sheet = getActiveSheet();
  openModal(`
    <h2 class="modal-title">${escapeHtml(getType(sheet.type).label)}</h2>
    <div class="menu-list">
      <button onclick="closeModal();printSheets([getActiveSheet()])">🖨️ Drucken / als PDF speichern</button>
      <button onclick="duplicateSheet()">📄 Blatt kopieren${order.engines.length > 1 ? ' (z.B. für anderen Motor)' : ''}</button>
      ${order.engines.length > 1 ? `<button onclick="moveSheetEngine()">🔁 Anderem Motor zuordnen</button>` : ''}
      <button class="danger" onclick="deleteSheet()">🗑️ Blatt löschen</button>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Schließen</button></div>`);
}

function duplicateSheet() {
  const order = getActiveOrder(), src = getActiveSheet();
  const t = getType(src.type);
  const copy = { id: uid(), type: src.type, mode: src.mode, engine: order.engines.length > 1 ? ((src.engine || 0) + 1) % order.engines.length : src.engine, date: todayISO(), created: new Date().toISOString(), data: {}, findings: [], rating: null, summary: '', advice: '' };
  (t.measure || []).forEach(cfg => { if (src.data[cfg.key]) copy.data[cfg.key] = { spec: JSON.parse(JSON.stringify(src.data[cfg.key].spec || {})), count: src.data[cfg.key].count }; });
  ['tool', 'toolNo'].forEach(k => { if (src.data[k]) copy.data[k] = src.data[k]; });
  if (t.special && typeof specialInit === 'function') specialInit(order, copy, src);
  order.sheets.push(copy);
  touchOrder(order);
  closeModal();
  openSheet(copy.id);
  showToast('Kopie angelegt (Sollwerte übernommen, Messwerte leer)');
}

function moveSheetEngine() {
  const order = getActiveOrder();
  openModal(`
    <h2 class="modal-title">Motor zuordnen</h2>
    <div class="menu-rows">${order.engines.map((e, i) => `
      <button class="menu-row" onclick="setSheetEngine(${i})"><span><b>${escapeHtml(engineLabel(order, i))}</b><small>${escapeHtml(engineTypeText(e))}</small></span></button>`).join('')}</div>`);
}
function setSheetEngine(i) {
  const sheet = getActiveSheet();
  sheet.engine = i;
  touchSheet(sheet);
  closeModal();
  renderSheet();
}

async function deleteSheet() {
  const order = getActiveOrder(), sheet = getActiveSheet();
  if (!await confirmDialog('Blatt „' + getType(sheet.type).label + '“ wirklich löschen?', 'Löschen', true)) return;
  const ids = collectPhotoIds({ sheets: [sheet] });
  order.sheets = order.sheets.filter(s => s.id !== sheet.id);
  touchOrder(order);
  ids.forEach(id => deleteFile(id).catch(() => {}));
  showView('order');
  showToast('Blatt gelöscht');
}

// ---------- Zahlenleiste: ± (Minus) über der Tastatur ----------
// Die Zahlentastatur (inputmode="decimal") hat auf vielen Handys keine Minus-Taste.
// Solange ein Zahlenfeld aktiv ist, erscheint unten eine Leiste mit „±“ und „Weiter“.
let numBarField = null;
function isNumField(el) {
  return el && el.tagName === 'INPUT' && el.getAttribute('inputmode') === 'decimal';
}
function placeNumBar() {
  const bar = document.getElementById('num-bar');
  const vv = window.visualViewport;
  if (!bar || !vv) return;
  // Unterkante des sichtbaren Bereichs (über der Bildschirmtastatur)
  bar.style.bottom = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) + 'px';
}
function toggleSign() {
  const el = numBarField;
  if (!el) return;
  const v = el.value.trim().replace(/[−–]/g, '-');
  el.value = v.startsWith('-') ? v.slice(1) : '-' + v.replace(/^\+/, '');
  el.dataset.signed = '1';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
}
function numBarNext() {
  const el = numBarField;
  if (!el) return;
  const all = [...document.querySelectorAll('.view.active input[inputmode="decimal"]')];
  const next = all[all.indexOf(el) + 1];
  if (next) { next.focus(); next.select && next.select(); } else el.blur();
}
document.addEventListener('DOMContentLoaded', () => {
  const bar = document.getElementById('num-bar');
  // Tippen auf die Leiste soll das Feld nicht verlassen (Tastatur bleibt offen)
  bar.addEventListener('pointerdown', e => e.preventDefault());
  bar.addEventListener('mousedown', e => e.preventDefault());
  document.addEventListener('focusin', e => {
    if (!isNumField(e.target)) return;
    numBarField = e.target;
    bar.hidden = false;
    placeNumBar();
  });
  document.addEventListener('focusout', e => {
    if (!isNumField(e.target)) return;
    const el = e.target;
    // Vorzeichen per Leiste geändert → wie eine normale Eingabe abschließen (Schnelleingabe, Komma …)
    if (el.dataset.signed) { delete el.dataset.signed; el.dispatchEvent(new Event('change', { bubbles: true })); }
    setTimeout(() => { if (!isNumField(document.activeElement)) { bar.hidden = true; numBarField = null; } }, 50);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', placeNumBar);
    window.visualViewport.addEventListener('scroll', placeNumBar);
  }
});

Object.assign(window, {
  toggleSign, numBarNext,
  openSheet, getActiveSheet, saveSpecTemplate, toggleInspect, inspectRestOk, addFinding, removeFinding,
  openSheetMenu, duplicateSheet, moveSheetEngine, setSheetEngine, deleteSheet
});
