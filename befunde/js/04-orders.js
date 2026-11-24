// =====================================================================
// 04-orders: Auftragsliste, Neuer Auftrag (auch aus Zettel-Job), Auftrag
// mit Kopfdaten + Motoren, Blätter hinzufügen (Auswahl nach Baugruppe)
// =====================================================================

let orderFilter = 'offen';

function getActiveOrder() { return appData.orders.find(o => o.id === activeOrderId) || null; }

function touchOrder(order) {
  if (order) order.updated = new Date().toISOString();
  saveData();
}

// ---------- Liste ----------
function renderOrders() {
  const body = document.getElementById('orders-body');
  const q = (document.getElementById('order-search') || {}).value || '';
  const ql = q.trim().toLowerCase();
  const all = appData.orders.slice().sort((a, b) => (b.updated || b.created || '').localeCompare(a.updated || a.created || ''));
  const list = all.filter(o => (orderFilter === 'all' || o.status === orderFilter) &&
    (!ql || [o.orderNo, o.customer, o.vessel, o.location, ...o.engines.map(e => e.model + ' ' + e.number)].join(' ').toLowerCase().includes(ql)));

  const counts = { offen: all.filter(o => o.status === 'offen').length, fertig: all.filter(o => o.status === 'fertig').length };
  const sheetsTotal = all.reduce((s, o) => s + o.sheets.length, 0);

  body.innerHTML = `
    <div class="hero">
      <div>
        <div class="hero-title">Hallo${appData.settings.name ? ' ' + escapeHtml(appData.settings.name.split(' ')[0]) : ''} 👋</div>
        <div class="hero-sub">Auftrag anlegen → Blätter hinzufügen → ausfüllen → drucken.</div>
      </div>
      <div class="hero-kpis">
        <div><b>${counts.offen}</b><span>offen</span></div>
        <div><b>${sheetsTotal}</b><span>Blätter</span></div>
      </div>
    </div>
    ${all.length ? `
    <div class="toolbar">
      <div class="search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input type="search" id="order-search" placeholder="Suchen: Auftrag, Kunde, Schiff, Motor …" value="${escapeHtml(q)}" oninput="renderOrderList()">
      </div>
      <div class="chips">
        <button class="chip ${orderFilter === 'offen' ? 'active' : ''}" onclick="setOrderFilter('offen')">Offen (${counts.offen})</button>
        <button class="chip ${orderFilter === 'fertig' ? 'active' : ''}" onclick="setOrderFilter('fertig')">Abgeschlossen (${counts.fertig})</button>
        <button class="chip ${orderFilter === 'all' ? 'active' : ''}" onclick="setOrderFilter('all')">Alle</button>
      </div>
      <button class="chip chip-action" onclick="document.getElementById('import-input').click()">📂 Auftrag laden (Datei vom Monteur)</button>
    </div>` : ''}
    <div id="order-list" class="sheet-list">${orderListHtml(list, all.length)}</div>`;
}

function renderOrderList() {
  const q = document.getElementById('order-search').value.trim().toLowerCase();
  const list = appData.orders.slice().sort((a, b) => (b.updated || b.created || '').localeCompare(a.updated || a.created || ''))
    .filter(o => (orderFilter === 'all' || o.status === orderFilter) &&
      (!q || [o.orderNo, o.customer, o.vessel, o.location, ...o.engines.map(e => e.model + ' ' + e.number)].join(' ').toLowerCase().includes(q)));
  document.getElementById('order-list').innerHTML = orderListHtml(list, appData.orders.length);
}

function orderListHtml(list, total) {
  if (!total) return `
    <div class="empty">
      <div class="empty-icon">${icon('doc')}</div>
      <h3>Noch keine Aufträge</h3>
      <p>Lege einen Auftrag an und füge die passenden Mess- und Befundblätter hinzu.</p>
      <button class="btn btn-primary" onclick="openNewOrderModal()">＋ Ersten Auftrag anlegen</button>
      <p class="muted small-text" style="margin-top:14px">Im Büro? <button class="link-btn" onclick="document.getElementById('import-input').click()">Auftrag aus Datei laden</button> · Nur mal schauen? <button class="link-btn" onclick="createDemoOrder()">Beispielauftrag anlegen</button></p>
    </div>`;
  if (!list.length) return `<div class="empty small">Keine Aufträge gefunden.</div>`;
  return list.map(o => {
    const ratings = o.sheets.map(s => sheetRating(o, s));
    const bad = ratings.filter(r => r === 'bad').length, obs = ratings.filter(r => r === 'obs').length;
    const e = o.engines[0] || {};
    return `
      <button class="sheet-card ${o.status === 'fertig' ? 'is-done' : ''}" onclick="openOrder('${o.id}')">
        <div class="sc-top">
          <span class="type-pill">${o.status === 'fertig' ? 'Abgeschlossen' : 'Offen'}${o.demo ? ' · Beispiel (nur auf diesem Gerät)' : ''}</span>
          <span class="sc-date">${escapeHtml(formatDate(o.date))}</span>
        </div>
        <div class="sc-title">${escapeHtml(o.orderNo || 'Ohne Auftragsnummer')}</div>
        <div class="sc-sub">${escapeHtml([o.customer, o.vessel].filter(Boolean).join(' · ') || '–')}</div>
        <div class="sc-sub">${escapeHtml([e.make, e.model].filter(Boolean).join(' ') + (e.number ? ' · Nr. ' + e.number : ''))}${o.engines.length > 1 ? ` <b>+${o.engines.length - 1}</b>` : ''}</div>
        <div class="sc-bottom">
          <span class="sc-hours">${o.sheets.length} ${o.sheets.length === 1 ? 'Blatt' : 'Blätter'}</span>
          <span class="sc-badges">
            ${o.sheets.length ? `<span class="sc-report" role="button" onclick="event.stopPropagation();openReportView('${o.id}','report')">📄 Bericht</span>` : ''}
            ${bad ? `<span class="badge rb-bad">${bad}× n.i.O.</span>` : ''}
            ${obs ? `<span class="badge rb-obs">${obs}× beobachten</span>` : ''}
            ${!bad && !obs && ratings.some(r => r === 'ok') ? '<span class="badge rb-ok">i.O.</span>' : ''}
          </span>
        </div>
      </button>`;
  }).join('');
}

function setOrderFilter(f) { orderFilter = f; renderOrders(); }

function openOrder(id) {
  commitFocus();
  activeOrderId = id;
  showView('order');
}

// ---------- Neuer Auftrag ----------
async function openNewOrderModal() {
  openModal(`
    <h2 class="modal-title">Neuer Auftrag</h2>
    <label class="field"><span>Auftragsnummer</span><input id="no-orderno" placeholder="z.B. 249 → SR${todayISO().slice(2, 4)}/000249" autocomplete="off" autofocus onblur="this.value=formatOrderNo(this.value)"></label>
    <div class="grid-2">
      <label class="field"><span>Kunde</span><input id="no-customer" autocomplete="off" list="dl-customers"></label>
      <label class="field"><span>Schiff / Anlage</span><input id="no-vessel" autocomplete="off" list="dl-vessels"></label>
    </div>
    ${datalists()}
    <div id="zj-import"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="createOrderFromModal()">Anlegen</button>
    </div>`);
  const jobs = await readZettelJobOrders();
  const box = document.getElementById('zj-import');
  if (box && jobs && jobs.length) {
    window.__zjJobs = jobs;
    box.innerHTML = `
      <div class="modal-sub">Aus dem Stundennachweis übernehmen</div>
      <div class="menu-rows zj-list">${jobs.slice(0, 12).map((j, i) => `
        <button class="menu-row" onclick="createOrderFromZJ(${i})">
          <span><b>${escapeHtml(j.orderNo || '–')}</b><small>${escapeHtml([j.customer, j.vessel].filter(Boolean).join(' · '))}</small></span>
          <span class="chip mini">übernehmen</span>
        </button>`).join('')}</div>`;
  }
}

function datalists() {
  const uniq = arr => [...new Set(arr.filter(Boolean))].slice(0, 40);
  return `<datalist id="dl-customers">${uniq(appData.orders.map(o => o.customer)).map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <datalist id="dl-vessels">${uniq(appData.orders.map(o => o.vessel)).map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>`;
}

function newOrder(fields) {
  const order = normalizeOrder(Object.assign({
    id: uid(), orderNo: '', customer: '', vessel: '', newbuild: '', classification: '', location: '', reason: '', date: todayISO(),
    status: 'offen', created: new Date().toISOString(), updated: new Date().toISOString(), engines: [newEngine()], sheets: []
  }, fields));
  // Bekannter Kunde/Schiff → Motordaten vom letzten Auftrag übernehmen
  if (!fields.engines && order.vessel) {
    const prev = appData.orders.find(o => o.vessel && o.vessel.toLowerCase() === order.vessel.toLowerCase());
    if (prev) order.engines = prev.engines.map(e => ({ ...e, hours: '' }));
  }
  appData.orders.push(order);
  saveData(true);
  return order;
}

function createOrderFromModal() {
  const order = newOrder({
    orderNo: formatOrderNo(document.getElementById('no-orderno').value),
    customer: document.getElementById('no-customer').value.trim(),
    vessel: document.getElementById('no-vessel').value.trim()
  });
  closeModal();
  openOrder(order.id);
}

function createOrderFromZJ(i) {
  const j = window.__zjJobs[i];
  const existing = appData.orders.find(o => o.orderNo && o.orderNo === j.orderNo);
  if (existing) { closeModal(); openOrder(existing.id); showToast('Auftrag gibt es schon – geöffnet'); return; }
  const engines = (j.engines || []).filter(e => e && (e.make || e.model || e.number)).map(e => Object.assign(newEngine(), {
    name: e.name || '', make: e.make || '', model: e.model || '', number: e.number || '', hours: e.hours || '',
    ...guessLayout(e.model)
  }));
  const order = newOrder({
    orderNo: j.orderNo || '', customer: j.customer || '', vessel: j.vessel || '', reason: j.description || '',
    zjJobId: j.id || null, ...(engines.length ? { engines } : {})
  });
  closeModal();
  openOrder(order.id);
  showToast('Aus dem Stundennachweis übernommen');
}

// "16V 4000 M63" → V, 16 Zyl. · "12V2000" → V, 12 · "R6"/"6R" → Reihe
function guessLayout(model) {
  const m = String(model || '');
  let r = /(\d{1,2})\s*V/i.exec(m);
  if (r) return { layout: 'V', cylinders: parseInt(r[1], 10) };
  r = /(?:R\s*(\d{1,2})|(\d{1,2})\s*R\b|(\d{1,2})\s*L\b)/i.exec(m);
  if (r) return { layout: 'R', cylinders: parseInt(r[1] || r[2] || r[3], 10) };
  return {};
}

// Zettel-Job liegt (z.B. auf GitHub Pages) unter derselben Adresse → Aufträge direkt lesen.
// Nur lesen, nie schreiben; existiert die Datenbank nicht, wird nichts angelegt.
async function readZettelJobOrders() {
  try {
    if (!indexedDB.databases) return null;
    const dbs = await indexedDB.databases();
    if (!dbs.some(d => d.name === 'zettel-job')) return null;
    const db = await new Promise((res, rej) => { const r = indexedDB.open('zettel-job'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    if (!db.objectStoreNames.contains('store')) { db.close(); return null; }
    const data = await new Promise((res, rej) => {
      const r = db.transaction('store', 'readonly').objectStore('store').get('appData');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    db.close();
    return zettelJobList(data);
  } catch (e) { console.warn('Zettel-Job nicht lesbar', e); return null; }
}

// Aufträge + Auftragsnummern aus Zetteln (neueste zuerst)
function zettelJobList(data) {
  if (!data) return [];
  const map = new Map();
  (data.jobs || []).forEach(j => { if (j.orderNo) map.set(j.orderNo, { id: j.id, orderNo: j.orderNo, customer: j.customer, vessel: j.vessel, engines: j.engines, description: j.description, at: j.updated || j.created || '' }); });
  (data.sheets || []).filter(s => s.orderNo && s.type === 'montage').forEach(s => {
    const at = (s.days && s.days[0] && s.days[0].date) || '';
    const cur = map.get(s.orderNo);
    if (!cur) map.set(s.orderNo, { orderNo: s.orderNo, customer: s.customer, vessel: s.vessel, engines: s.engines, at });
    else if (!cur.engines || !cur.engines.some(e => e && e.number)) cur.engines = s.engines;
  });
  return [...map.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// ---------- Auftrag (Detail) ----------
function renderOrder() {
  const order = getActiveOrder();
  const body = document.getElementById('order-body');
  if (!order) { showView('orders'); return; }
  setTopbarTitle(order.orderNo || 'Auftrag');

  const groups = GROUPS.map(g => {
    const sheets = order.sheets.filter(s => getType(s.type).group === g.id);
    if (!sheets.length) return '';
    return `<div class="group-head">${escapeHtml(g.label)}</div>${sheets.map(s => sheetCardHtml(order, s)).join('')}`;
  }).join('');

  const ratings = order.sheets.map(s => sheetRating(order, s));
  body.innerHTML = `
    <div class="order-top card">
      <div class="ot-row">
        <div>
          <div class="type-pill">Auftrag</div>
          <div class="oh-title">${escapeHtml(order.orderNo || 'Ohne Auftragsnummer')}</div>
          <div class="muted">${escapeHtml([order.customer, order.vessel].filter(Boolean).join(' · ') || 'Kunde / Schiff eintragen')}</div>
        </div>
        <button class="chip ${order.status === 'fertig' ? 'active' : ''}" onclick="toggleOrderStatus()">${order.status === 'fertig' ? '✓ Abgeschlossen' : 'Offen'}</button>
      </div>
      <div class="ot-stats">
        <div><b>${order.sheets.length}</b><span>Blätter</span></div>
        <div class="st-ok"><b>${ratings.filter(r => r === 'ok').length}</b><span>i.O.</span></div>
        <div class="st-obs"><b>${ratings.filter(r => r === 'obs').length}</b><span>beobachten</span></div>
        <div class="st-bad"><b>${ratings.filter(r => r === 'bad').length}</b><span>n.i.O.</span></div>
      </div>
    </div>

    <div class="section-head"><h3>Blätter</h3>${order.sheets.length ? `<button class="link-btn" onclick="openPrintChooser()">Alle drucken</button>` : ''}</div>
    <div class="sheet-list">
      ${groups || `<div class="empty small"><p>Noch keine Blätter. Wähle unten, was du erfassen möchtest.</p></div>`}
    </div>
    <button class="btn btn-soft block add-sheet-btn" onclick="openAddSheet()">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Blatt hinzufügen
    </button>
    ${order.sheets.length ? `
    <button class="report-card" onclick="openReportDialog()">
      <span class="rc-icon">${icon('doc')}</span>
      <span class="rc-text"><b>Befundbericht erstellen</b><small>Alle Blätter zusammengefasst: Ergebnis, Handlungsbedarf, Empfehlung, Fotos – drucken oder als PDF</small></span>
      <svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>
    </button>
    <div class="order-actions">
      <button class="btn btn-soft" onclick="openReportView()">👁 Bericht ansehen</button>
      <button class="btn btn-soft" onclick="shareOrder()">📤 An Büro senden</button>
    </div>` : ''}

    <details class="card collapse" ${order.sheets.length ? '' : 'open'}>
      <summary class="card-title">Auftragsdaten</summary>
      <div class="order-form" data-root="order">
        <div class="grid-2">
          ${field('Auftragsnummer', 'orderNo', order.orderNo, { orderno: true })}
          ${field('Datum', 'date', order.date, { type: 'date' })}
          ${field('Kunde', 'customer', order.customer, { list: 'dl-customers' })}
          ${field('Schiff / Anlage', 'vessel', order.vessel, { list: 'dl-vessels' })}
          ${field('Neubau-Nr.', 'newbuild', order.newbuild)}
          ${field('Klassifikation', 'classification', order.classification, { list: 'dl-class' })}
          ${field('Ort / Werft', 'location', order.location)}
          ${field('Ansprechpartner', 'contact', order.contact)}
        </div>
        ${textArea('Anlass / Auftrag', 'reason', order.reason, { placeholder: 'z.B. Durchsicht nach 12.000 Bh, Ölverbrauch erhöht …', rows: 2 })}
        ${datalists()}
        <datalist id="dl-class"><option value="DNV"><option value="BV"><option value="LR"><option value="ABS"><option value="RINA"><option value="ohne Klasse"></datalist>
      </div>
    </details>

    <details class="card collapse" ${order.sheets.length ? '' : 'open'}>
      <summary class="card-title">Motor${order.engines.length > 1 ? 'en' : ''} <span class="muted small-text">${escapeHtml(order.engines.map(e => engineTypeText(e)).join(' · '))}</span></summary>
      <div data-root="order">
        ${order.engines.map((e, i) => engineFormHtml(order, e, i)).join('')}
      </div>
      ${order.engines.length < 4 ? `<button class="btn btn-soft" onclick="addEngine()">＋ weiteren Motor</button>` : ''}
    </details>`;
  bindForm(body, () => getActiveOrder(), onOrderChange);
}

function sheetCardHtml(order, s) {
  const t = getType(s.type);
  const r = sheetRating(order, s);
  const filled = sheetProgress(order, s);
  return `
    <button class="sheet-card sc-sheet rate-${r || 'none'}" onclick="openSheet('${s.id}')">
      <span class="sc-icon">${icon(t.icon)}</span>
      <span class="sc-main">
        <span class="sc-top"><span class="type-pill">${escapeHtml(sheetKindText(s))}</span><span class="sc-date">${escapeHtml(formatDate(s.date))}</span></span>
        <span class="sc-title">${escapeHtml(t.label)}${s.subtitle ? ' – ' + escapeHtml(s.subtitle) : ''}</span>
        <span class="sc-sub">${order.engines.length > 1 ? escapeHtml(engineLabel(order, s.engine || 0)) + ' · ' : ''}${escapeHtml(filled)}</span>
      </span>
      ${ratingBadge(r, r ? null : 'offen')}
    </button>`;
}

function engineFormHtml(order, e, i) {
  const p = 'engines.' + i + '.';
  const cylOpts = (e.layout === 'V' ? [6, 8, 10, 12, 16, 20, 24] : [1, 2, 3, 4, 5, 6, 8, 9, 10, 12]).map(n => [n, n + (e.layout === 'V' ? ' (' + n + 'V)' : ' Zyl.')]);
  if (!cylOpts.some(o => o[0] === engineCyl(e))) cylOpts.push([engineCyl(e), engineCyl(e) + '']);
  return `
    <div class="engine-block">
      ${order.engines.length > 1 ? `<div class="engine-head"><b>${escapeHtml(engineLabel(order, i))}</b><button class="icon-btn small danger-hover" onclick="removeEngine(${i})" aria-label="Motor entfernen"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button></div>` : ''}
      <div class="grid-2">
        ${order.engines.length > 1 ? field('Bezeichnung (optional)', p + 'name', e.name, { placeholder: 'z.B. HM BB / HM SB / DG 1', cls: 'span-2' }) : ''}
        ${field('Fabrikat', p + 'make', e.make, { list: 'dl-makes' })}
        ${field('Motortyp', p + 'model', e.model, { placeholder: 'z.B. 16V 4000 M63', rerender: true })}
        ${field('Motornummer', p + 'number', e.number)}
        ${field('Betriebsstunden', p + 'hours', e.hours, { inputmode: 'numeric' })}
        ${field('Leistung (kW)', p + 'power', e.power, { inputmode: 'numeric' })}
        ${field('Drehzahl (1/min)', p + 'rpm', e.rpm, { inputmode: 'numeric' })}
      </div>
      <div class="grid-2 engine-cfg">
        <div class="field"><span>Bauform</span>
          <div class="seg"><button type="button" class="${e.layout === 'V' ? 'on' : ''}" data-set="${p}layout" data-val="V" data-keep="1">V-Motor</button><button type="button" class="${e.layout !== 'V' ? 'on' : ''}" data-set="${p}layout" data-val="R" data-keep="1">Reihe</button></div>
        </div>
        ${selectField('Zylinder', p + 'cylinders', engineCyl(e), cylOpts, { rerender: true })}
        ${e.layout === 'V' ? `<div class="field span-2"><span>Zählweise Zylinder 1</span>
          <div class="seg"><button type="button" class="${e.count !== 'KGS' ? 'on' : ''}" data-set="${p}count" data-val="KS" data-keep="1">ab KS (MTU)</button><button type="button" class="${e.count === 'KGS' ? 'on' : ''}" data-set="${p}count" data-val="KGS" data-keep="1">ab KGS</button></div>
        </div>` : ''}
      </div>
      <div class="engine-preview">${engineMiniSvg(e)}<span class="muted small-text">${escapeHtml(positions(e, 'cyl').join(' · '))}</span></div>
      <datalist id="dl-makes"><option value="MTU"><option value="MAN"><option value="Caterpillar"><option value="Deutz"><option value="Wärtsilä"><option value="Volvo Penta"><option value="Scania"><option value="Mitsubishi"><option value="Cummins"></datalist>
    </div>`;
}

function onOrderChange(order, el, ev) {
  const bind = el.dataset.bind || el.dataset.set || '';
  if (/engines\.\d+\.model$/.test(bind) && ev.type === 'change') {
    const i = parseInt(bind.split('.')[1], 10);
    const g = guessLayout(order.engines[i].model);
    if (g.layout) Object.assign(order.engines[i], g);
  }
  if (/engines\.\d+\.layout$/.test(bind)) {
    const e = order.engines[parseInt(bind.split('.')[1], 10)];
    if (e.layout === 'V' && engineCyl(e) % 2) e.cylinders = engineCyl(e) + 1;
  }
  touchOrder(order);
  if (ev.type === 'change' || ev.type === 'click') {
    if (el.dataset.rerender || el.dataset.set) renderOrder();
    else if (bind === 'orderNo') setTopbarTitle(order.orderNo || 'Auftrag');
  }
}

function addEngine() {
  const order = getActiveOrder();
  const last = order.engines[order.engines.length - 1];
  order.engines.push({ ...newEngine(), make: last.make, model: last.model, layout: last.layout, cylinders: last.cylinders, count: last.count });
  touchOrder(order);
  renderOrder();
}

async function removeEngine(i) {
  const order = getActiveOrder();
  if (order.sheets.some(s => (s.engine || 0) === i)) { showToast('Motor hat noch Blätter – erst Blätter löschen/umhängen'); return; }
  if (!await confirmDialog('Motor entfernen?', 'Entfernen', true)) return;
  order.engines.splice(i, 1);
  order.sheets.forEach(s => { if ((s.engine || 0) > i) s.engine--; });
  touchOrder(order);
  renderOrder();
}

function toggleOrderStatus() {
  const order = getActiveOrder();
  order.status = order.status === 'fertig' ? 'offen' : 'fertig';
  touchOrder(order);
  renderOrder();
}

// Kleines Motorbild (Draufsicht) für die Motordaten
function engineMiniSvg(e) {
  const v = isV(e);
  const pos = positions(e, 'cyl');
  const per = v ? Math.ceil(pos.length / 2) : pos.length;
  const w = 26 + per * 16, h = v ? 44 : 28;
  const flip = e.count === 'KGS';
  let s = `<svg class="engine-mini" viewBox="0 0 ${w + 30} ${h}" style="width:${w + 30}px;height:${h}px">`;
  s += `<rect x="${flip ? w + 4 : 2}" y="${h / 2 - 9}" width="22" height="18" rx="4" class="em-ks"/><text x="${flip ? w + 15 : 13}" y="${h / 2 + 3.5}" class="em-t">KS</text>`;
  const x0 = flip ? 4 : 28;
  const rows = v ? [pos.slice(0, per), pos.slice(per)] : [pos];
  rows.forEach((r, ri) => r.forEach((p, i) => {
    const idx = flip ? per - 1 - i : i;
    s += `<rect x="${x0 + idx * 16}" y="${v ? (ri ? 24 : 4) : 6}" width="14" height="16" rx="3" class="em-c"/><text x="${x0 + idx * 16 + 7}" y="${(v ? (ri ? 24 : 4) : 6) + 11.5}" class="em-t">${escapeHtml(p)}</text>`;
  }));
  return s + '</svg>';
}

// ---------- Blatt hinzufügen ----------
const SHEET_PACKS = [
  { id: 'pack-lb', label: 'Paket Laufbuchsen', desc: 'Laufbuchse, Einpassen, Überstand, Kolbenüberstand', types: ['liner', 'liner_fit', 'liner_proj', 'piston_proj'] },
  { id: 'pack-kw', label: 'Paket Kurbelwelle', desc: 'Lagergasse + Grund-/Hublagerzapfen', types: ['kw_bore', 'kw_journal'] }
];

function openAddSheet() {
  const order = getActiveOrder();
  openModal(`
    <h2 class="modal-title">Welches Blatt?</h2>
    ${GROUPS.map(g => `
      <div class="modal-sub">${escapeHtml(g.label)}</div>
      <div class="type-grid">${SHEET_TYPES.filter(t => t.group === g.id).map(t => `
        <button class="type-tile" onclick="chooseSheetType('${t.id}')">
          ${icon(t.icon)}<strong>${escapeHtml(t.label)}</strong><span>${escapeHtml(t.desc)}</span>
          ${order.sheets.some(s => s.type === t.id) ? '<em class="tt-has">vorhanden</em>' : ''}
        </button>`).join('')}</div>`).join('')}
    <div class="modal-sub">Pakete</div>
    <div class="type-grid">${SHEET_PACKS.map(p => `
      <button class="type-tile pack" onclick="addPack('${p.id}')">${icon('doc')}<strong>${escapeHtml(p.label)}</strong><span>${escapeHtml(p.desc)}</span></button>`).join('')}</div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button></div>`, { wide: true });
}

// Schritt 2: Messblatt / Befundblatt / beides – Schritt 3: Motor
function chooseSheetType(typeId, mode, engine) {
  const order = getActiveOrder();
  const t = getType(typeId);
  if (typeModes(t) && !mode) {
    openModal(`
      <h2 class="modal-title">${escapeHtml(t.label)}</h2>
      <p class="muted">Was möchtest du erfassen?</p>
      <div class="type-choice">
        <button class="type-btn" onclick="chooseSheetType('${typeId}','beides')">${icon('doc')}<strong>Mess- + Befundblatt</strong><span>Messwerte und Sichtbefund auf einem Blatt</span></button>
        <button class="type-btn" onclick="chooseSheetType('${typeId}','mess')">${icon('bore')}<strong>Nur Messblatt</strong><span>Messwerte mit automatischer Auswertung</span></button>
        <button class="type-btn" onclick="chooseSheetType('${typeId}','befund')">${icon('scope')}<strong>Nur Befundblatt</strong><span>Sichtbefund je Position zum Antippen</span></button>
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="openAddSheet()">Zurück</button></div>`);
    return;
  }
  if (order.engines.length > 1 && engine == null) {
    openModal(`
      <h2 class="modal-title">Für welchen Motor?</h2>
      <div class="menu-rows">${order.engines.map((e, i) => `
        <button class="menu-row" onclick="chooseSheetType('${typeId}','${mode || ''}',${i})">
          <span><b>${escapeHtml(engineLabel(order, i))}</b><small>${escapeHtml(engineTypeText(e))}${e.number ? ' · Nr. ' + escapeHtml(e.number) : ''}</small></span>
        </button>`).join('')}</div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button></div>`);
    return;
  }
  // Druckprobe Einspritzdüsen: immer Eingangs- UND Ausgangsprotokoll
  const sheet = t.special === 'nozzles' ? createNozzlePair(order, engine || 0) : createSheet(order, typeId, mode || null, engine || 0);
  closeModal();
  openSheet(sheet.id);
  if (t.special === 'nozzles') showToast('Eingangs- und Ausgangsprotokoll angelegt');
}

function addPack(id, engine) {
  const order = getActiveOrder();
  const p = SHEET_PACKS.find(x => x.id === id);
  if (order.engines.length > 1 && engine == null) {
    openModal(`
      <h2 class="modal-title">${escapeHtml(p.label)} – für welchen Motor?</h2>
      <div class="menu-rows">${order.engines.map((e, i) => `
        <button class="menu-row" onclick="addPack('${id}',${i})"><span><b>${escapeHtml(engineLabel(order, i))}</b><small>${escapeHtml(engineTypeText(e))}</small></span></button>`).join('')}</div>`);
    return;
  }
  p.types.forEach(t => createSheet(order, t, typeModes(getType(t)) ? 'beides' : null, engine || 0));
  closeModal();
  renderOrder();
  showToast(p.types.length + ' Blätter angelegt');
}

function createSheet(order, typeId, mode, engine) {
  const t = getType(typeId);
  const sheet = {
    id: uid(), type: typeId, mode: typeModes(t) ? (mode || 'beides') : null, engine: engine || 0,
    date: todayISO(), created: new Date().toISOString(), updated: new Date().toISOString(), data: {}, findings: [], rating: null, summary: '', advice: ''
  };
  // Gemerkte Sollwerte für diesen Motortyp übernehmen
  const e = order.engines[sheet.engine] || {};
  const spec = specTemplate(e, typeId);
  if (spec) Object.keys(spec).forEach(k => { sheet.data[k] = Object.assign({}, sheet.data[k], { spec: JSON.parse(JSON.stringify(spec[k])) }); });
  if (t.special && typeof specialInit === 'function') specialInit(order, sheet);
  order.sheets.push(sheet);
  touchOrder(order);
  return sheet;
}

function specKey(e) { return String((e.make || '') + ' ' + (e.model || '')).trim().toLowerCase(); }
function specTemplate(e, typeId) {
  const k = specKey(e);
  return k && appData.specs[k] ? appData.specs[k][typeId] || null : null;
}

// ---------- Menü Auftrag ----------
function openOrderMenu() {
  const order = getActiveOrder();
  openModal(`
    <h2 class="modal-title">${escapeHtml(order.orderNo || 'Auftrag')}</h2>
    <div class="menu-list">
      <button onclick="closeModal();openReportDialog()">📄 Befundbericht (Zusammenfassung)</button>
      <button onclick="closeModal();openPrintChooser()">🖨️ Einzelne Blätter drucken / PDF</button>
      <button onclick="closeModal();exportOrder()">💾 Auftrag als Datei speichern (mit Fotos)</button>
      <button onclick="closeModal();duplicateOrder()">📄 Als Vorlage kopieren (neuer Auftrag, leere Messwerte)</button>
      <button class="danger" onclick="deleteOrder()">🗑️ Auftrag löschen</button>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Schließen</button></div>`);
}

async function deleteOrder() {
  const order = getActiveOrder();
  if (!await confirmDialog(`Auftrag ${order.orderNo || ''} mit ${order.sheets.length} Blättern wirklich löschen?`, 'Löschen', true)) return;
  const photoIds = collectPhotoIds(order);
  appData.orders = appData.orders.filter(o => o.id !== order.id);
  saveData(true);
  photoIds.forEach(id => deleteFile(id).catch(() => {}));
  showView('orders');
  showToast('Auftrag gelöscht');
}

function duplicateOrder() {
  const src = getActiveOrder();
  const copy = newOrder({
    orderNo: '', customer: src.customer, vessel: src.vessel, newbuild: src.newbuild, classification: src.classification, location: src.location,
    engines: src.engines.map(e => ({ ...e, hours: '' }))
  });
  copy.sheets = src.sheets.map(s => {
    const t = getType(s.type);
    const ns = { id: uid(), type: s.type, mode: s.mode, engine: s.engine, date: todayISO(), created: new Date().toISOString(), data: {}, findings: [], rating: null, summary: '', advice: '' };
    (t.measure || []).forEach(cfg => { if (s.data[cfg.key]) ns.data[cfg.key] = { spec: JSON.parse(JSON.stringify(s.data[cfg.key].spec || {})), count: s.data[cfg.key].count }; });
    if (t.special && typeof specialInit === 'function') specialInit(copy, ns, s);
    return ns;
  });
  saveData(true);
  openOrder(copy.id);
  showToast('Kopie angelegt – Auftragsnummer eintragen');
}

Object.assign(window, {
  renderOrderList, setOrderFilter, openOrder, openNewOrderModal, createOrderFromModal, createOrderFromZJ,
  addEngine, removeEngine, toggleOrderStatus, openAddSheet, chooseSheetType, addPack, openOrderMenu, deleteOrder, duplicateOrder
});
