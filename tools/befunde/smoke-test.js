// Smoke-Test für Befunde: startet einen lokalen Server, öffnet die App in
// Chromium (Handy + Desktop), legt einen Auftrag mit ALLEN Blattarten an,
// gibt Messwerte ein, prüft die Auswertung, klickt alles durch, erzeugt die
// Druckansicht als PDF und meldet JS-Fehler. Screenshots → .smoke/
//
// Aufruf:  node tools/smoke-test.js [ausgabe-ordner]
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.smoke', 'befunde'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

let errorsGlobal = [];
function assert(cond, msg, errors) { if (!cond) errors.push('ASSERT: ' + msg); }

// Kleines Testbild (PNG, 2×2 px) für den Foto-Upload
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwnwEIGBgYGBgYGAA6DAP9Hn6r8wAAAABJRU5ErkJggg==', 'base64');

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/befunde/index.html`;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  errorsGlobal = errors;

  for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`); });
    page.on('dialog', d => d.accept());
    const shot = name => page.screenshot({ path: path.join(OUT, `${label}-${name}.png`), fullPage: true });

    await page.goto(url);
    await page.waitForFunction(() => typeof appData !== 'undefined' && appData);
    await shot('01-start');

    // Neuer Auftrag
    await page.click('.fab');
    await page.fill('#no-orderno', '249');
    await page.fill('#no-customer', 'Testkunde');
    await page.fill('#no-vessel', 'MS Test');
    await page.click('.modal-actions .btn-primary');
    await page.waitForSelector('#view-order.active');
    const orderNo = await page.evaluate(() => getActiveOrder().orderNo);
    assert(/^SR\d{2}\/000249$/.test(orderNo), 'Auftragsnummer formatiert: ' + orderNo, errors);
    await page.fill('[data-bind="engines.0.model"]', '16V 4000 M63');
    await page.locator('[data-bind="engines.0.model"]').dispatchEvent('change');
    await page.fill('[data-bind="engines.0.number"]', '5362001234');
    await page.fill('[data-bind="engines.0.hours"]', '15120');
    const cyl = await page.evaluate(() => getActiveOrder().engines[0].cylinders);
    assert(cyl === 16, 'Zylinderzahl aus Motortyp erkannt (16): ' + cyl, errors);
    await shot('02-order');

    // Alle Blattarten anlegen
    const types = await page.evaluate(() => SHEET_TYPES.map(t => t.id));
    const PAIRS = types.filter(t => t === 'nozzles' || t === 'head').length; // je ein zusätzliches Ausgangsblatt
    for (const t of types) {
      await page.click('.add-sheet-btn');
      await page.click(`.type-tile[onclick="chooseSheetType('${t}')"]`);
      if (await page.locator('.type-choice').count()) await page.click('.type-choice .type-btn >> nth=0');
      await page.waitForSelector('#view-sheet.active');
      await shot('sheet-' + t);
      await page.click('#btn-back');
      await page.waitForSelector('#view-order.active');
    }
    const n = await page.evaluate(() => getActiveOrder().sheets.length);
    // Druckprobe Einspritzdüsen legt Eingang + Ausgang an → ein Blatt mehr
    assert(n === types.length + PAIRS, `alle ${types.length} Blattarten angelegt, Düsen/Zylinderköpfe als Paar (${n})`, errors);

    // Sicherung zusammenführen: vorhandener Auftrag bleibt, neues Blatt + neuer Auftrag kommen dazu
    const bfMerge = await page.evaluate(() => {
      const order = getActiveOrder();
      const n0 = appData.orders.length, s0 = order.sheets.length;
      const inc = JSON.parse(JSON.stringify(appData));
      const o = inc.orders.find(x => x.id === order.id);
      o.customer = 'ALT'; o.updated = '2000-01-01T00:00:00Z';
      o.sheets.push({ id: 'bksheet', type: 'general', engine: 0, data: {}, findings: [], updated: '2026-01-01T00:00:00Z' });
      inc.orders.push({ id: 'bkorder', orderNo: 'SR26/000777', engines: [{}], sheets: [], updated: '2026-01-01T00:00:00Z' });
      const st = mergeBackupOrders(normalizeData(inc));
      const res = [appData.orders.length - n0, order.sheets.length - s0, order.customer, st.added, st.updated].join('|');
      order.sheets = order.sheets.filter(s => s.id !== 'bksheet');
      appData.orders = appData.orders.filter(x => x.id !== 'bkorder');
      return res;
    });
    assert(bfMerge === '1|1|Testkunde|1|1', 'Sicherung zusammenführen: ' + bfMerge, errors);

    // Zylinderköpfe: Eingang + Ausgang, Höhe/Ventilrückstand, Beschädigung
    const head = await page.evaluate(() => {
      const order = getActiveOrder();
      const [hin, hout] = order.sheets.filter(s => s.type === 'head');
      hin.data.spec = { hSoll: '120,00', hTol: '0,10', vinSoll: '0,8 – 1,2', voutSoll: '1,0' };
      const tolDir = [heightRange('120', '0,3', 'minus').join('/'), heightRange('120', '-0,3').join('/'), heightTolText({ hTol: '0,3', hTolDir: 'minus' })].join(' ');
      hin.data.tester = 'Höhenmessgerät';
      hin.data.rows = { A1: { h: '119,85', vin: '1,0', vout: '1,1' }, A2: { h: '120,05', vin: '1,5', dmg: 'ja', note: 'Riss Flammdeck' } };
      openSheet(hin.id);
      headNoDamage();
      const rows = headRows(order, hin);
      hout.data.rows = { A1: { h: '119,95', vin: '1,0' } };
      const ro = headRows(order, hout);
      hout.data.printStyle = 'std'; const pr = printSheetHtml(order, hout, 1, 1); delete hout.data.printStyle;
      const issues = sheetIssues(order, hin).map(i => i.st).join(',');
      const sdt = printSheetHtml(order, hout, 1, 1).includes('sdt-page');
      hin.data.printStyle = 'std';
      const std = !printSheetHtml(order, hout, 1, 1).includes('sdt-page') && printSheetHtml(order, hout, 1, 1).includes('Messblatt Zylinderkopf – Ausgang');
      delete hin.data.printStyle;
      return [hin.data.stage + '/' + hout.data.stage, rows[0].h.st, rows[0].vout.st, rows[1].vin.st, rows[1].st, rows[2].dmg, ro[0].h.st, ro.length, printDocTitle(hout),
        pr.includes('Ventilrückstand') && pr.includes('Höhenmessgerät') && pr.includes('Äußere Beschädigung'), issues, tolDir, sdt, std].join('|');
    });
    assert(head === 'in/out|bad||bad|bad|nein|ok|16|Messblatt Zylinderkopf – Ausgang|true|bad,obs|119.7/120 119.7/120 −0,3|true|true', 'Zylinderköpfe: ' + head, errors);
    await shot('11d-zylinderkopf');

    // Kipphebelböcke: Lagerspiel Ein-/Auslass je Zylinder
    const rocker = await page.evaluate(() => {
      const sh = getActiveOrder().sheets.find(s => s.type === 'rocker');
      const sp = { boreMin: '30,000', boreMax: '30,025', shaftMin: '29,960', shaftMax: '29,980', clrMin: '0,020', clrMax: '0,065' };
      sh.data.kh = { spec: { e: { ...sp }, a: { ...sp } }, rows: { A1: { eb_S: '30,010', eb_W: '30,012', es_S: '29,970', es_W: '29,972', ab_S: '30,060', ab_W: '30,062', as_S: '29,970', as_W: '29,970' } } };
      const res = computeClearance(getType('rocker').measure[0], sh.data.kh, ['A1']);
      const p = res.rows[0].pairs;
      openSheet(sh.id);
      return [p[0].clr.n.toFixed(3), p[0].clr.st, p[1].clr.n.toFixed(3), p[1].clr.st, res.rows[0].st, printDocTitle ? printDocTitle(sh) : ''].join('|');
    });
    assert(rocker.startsWith('0.040|ok|0.091|bad|bad|'), 'Kipphebelböcke Lagerspiel: ' + rocker, errors);
    await shot('sheet-rocker-werte');
    await page.click('#btn-back');
    await page.waitForSelector('#view-order.active');

    // Laufbuchse: Sollwerte + Messwerte (inkl. µm-Schnelleingabe)
    await page.evaluate(() => openSheet(getActiveOrder().sheets.find(s => s.type === 'liner').id));
    await page.fill('[data-bind="data.lb.spec.nom"]', '170,000');
    await page.fill('[data-bind="data.lb.spec.min"]', '170,000');
    await page.fill('[data-bind="data.lb.spec.max"]', '40');
    await page.locator('[data-bind="data.lb.spec.max"]').dispatchEvent('change');
    await page.fill('[data-bind="data.lb.spec.ovalMax"]', '0,03');
    const max = await page.inputValue('[data-bind="data.lb.spec.max"]');
    assert(max === '170,040', 'Schnelleingabe Toleranz max → 170,040: ' + max, errors);
    const vals = { 'A1.I_L': '12', 'A1.I_Q': '18', 'A2.I_L': '20', 'A2.I_Q': '75', 'A3.I_L': '170.010', 'A3.I_Q': '170,015' };
    for (const [k, v] of Object.entries(vals)) {
      const sel = `[data-bind="data.lb.rows.${k}"]`;
      await page.fill(sel, v);
      await page.locator(sel).dispatchEvent('change');
    }
    const a1 = await page.inputValue('[data-bind="data.lb.rows.A1.I_L"]');
    assert(a1 === '170,012', 'Messwert 12 → 170,012: ' + a1, errors);
    const a3 = await page.inputValue('[data-bind="data.lb.rows.A3.I_L"]');
    assert(a3 === '170,010', 'Punkt → Komma: ' + a3, errors);
    const a2bad = await page.getAttribute('[data-bind="data.lb.rows.A2.I_Q"]', 'class');
    assert(/st-bad/.test(a2bad), 'A2 quer 170,075 außer Toleranz rot', errors);
    const oval = await page.textContent('[data-d="lb|A2|oval"]');
    assert(oval.trim() === '0,055', 'Ovalität A2 = 0,055: ' + oval, errors);
    // Sichtbefund
    await page.click('[data-set="data.lbi.rows.A2.rating"][data-val="bad"]');
    await page.click('.insp-actions .btn');
    const rated = await page.evaluate(() => Object.values(getActiveSheet().data.lbi.rows).filter(r => r.rating).length);
    assert(rated === 16, 'Alle übrigen i.O. → 16 bewertet: ' + rated, errors);
    // Befund mit Foto
    await page.click('.findings-card .btn-soft');
    await page.fill('[data-bind="findings.0.part"]', 'Laufbuchse A2');
    await page.fill('[data-bind="findings.0.text"]', 'Polierstellen');
    await page.evaluate(() => addPhotos('findings.0.photos')).catch(() => {});
    await page.setInputFiles('#photo-input', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => (getActiveSheet().findings[0].photos || []).length > 0, null, { timeout: 5000 }).catch(() => errors.push('Foto nicht gespeichert'));
    const auto = await page.evaluate(() => sheetAutoRating(getActiveOrder(), getActiveSheet()));
    assert(auto === 'bad', 'Auto-Bewertung n.i.O.: ' + auto, errors);
    await page.click('[data-set="rating"][data-val="bad"]');
    await shot('10-liner-filled');

    // Endoskopie: Zylinder antippen
    await page.evaluate(() => openSheet(getActiveOrder().sheets.find(s => s.type === 'endoscopy').id));
    await page.click('[data-cyl="B3"]');
    await page.click('[data-set="data.cyl.B3.rating"][data-val="obs"]');
    await page.click('[data-tag="data.cyl.B3.tags"][data-val="Polierstellen"]');
    await page.click('.endo-card .btn-soft');
    const endo = await page.evaluate(() => getActiveSheet().data.cyl);
    assert(endo.B3.rating === 'obs' && endo.B3.tags.includes('Polierstellen') && endo.A1.rating === 'ok', 'Endoskopie B3 + Rest i.O.', errors);
    await shot('11-endo');

    // Druckprobe Einspritzdüsen: Eingang + Ausgang
    const nzIn = await page.evaluate(() => { const l = getActiveOrder().sheets.filter(s => s.type === 'nozzles'); return l.map(s => s.data.stage).join(','); });
    assert(nzIn === 'in,out', 'Düsen: Eingang + Ausgang angelegt: ' + nzIn, errors);
    await page.evaluate(() => openSheet(getActiveOrder().sheets.find(s => s.type === 'nozzles' && s.data.stage === 'in').id));
    await page.fill('[data-bind="data.spec.min"]', '300');
    await page.fill('[data-bind="data.spec.max"]', '320');
    await page.locator('[data-bind="data.spec.max"]').dispatchEvent('change');
    await page.fill('[data-bind="data.medium"]', 'Prüföl ISO 4113');
    await page.locator('[data-bind="data.medium"]').dispatchEvent('change');
    await page.fill('[data-bind="data.rows.A1.sn"]', 'D-111');
    await page.locator('[data-bind="data.rows.A1.sn"]').dispatchEvent('change');
    await page.fill('[data-bind="data.rows.A1.p"]', '280');
    await page.locator('[data-bind="data.rows.A1.p"]').dispatchEvent('change');
    await page.click('[data-set="data.rows.A1.result"][data-val="ok"]');
    const nz = await page.evaluate(() => {
      nozzleChip('A2', 'tropft nach');
      nozzleAllOk();
      const rows = nozzleRows(getActiveOrder(), getActiveSheet());
      return [rows[0].st, rows[1].result, rows[1].note, rows[2].result].join('|');
    });
    assert(nz === 'bad|bad|tropft nach|ok', 'Düsen Eingang (A1 280 bar < 300, A2 tropft nach, Rest i.O.): ' + nz, errors);
    await shot('11b-duesen-eingang');
    // Eigene Bezeichnung und Anzahl
    const nzList = await page.evaluate(async () => {
      nozzleRename('A1', 'Reserve');
      await nozzleSetCount(17);
      const sheet = getActiveSheet();
      const added = sheet.data.nozzles[16];
      const lbl = document.querySelectorAll('#sheet-body .nz-label').length + ':' + added.label;
      await nozzleRemove(added.k);
      const out = getActiveOrder().sheets.find(s => s.type === 'nozzles' && s.data.stage === 'out');
      const outRows = nozzleRows(getActiveOrder(), out);
      const pr = printSheetHtml(getActiveOrder(), sheet, 1, 1);
      return [lbl, sheet.data.nozzles.length, sheet.data.nozzles[0].label, sheet.data.rows.A1.sn, outRows.length, outRows[0].pos, pr.includes('Einspritzdüse <b>Reserve</b>')].join('|');
    });
    assert(nzList === '17:A1|16|Reserve|D-111|16|Reserve|true', 'Düsen: eigene Bezeichnung/Anzahl: ' + nzList, errors);
    await page.evaluate(() => { nozzleRename('A1', 'A1'); });
    const nzOut = await page.evaluate(() => {
      const out = getActiveOrder().sheets.find(s => s.type === 'nozzles' && s.data.stage === 'out');
      out.data.rows = { A1: { p: '310', result: 'ok', note: 'eingestellt' } };
      openSheet(out.id);
      const rows = nozzleRows(getActiveOrder(), out);
      const html = printSheetHtml(getActiveOrder(), out, 1, 1);
      // ältere Düsenblätter bleiben lesbar
      const legacy = { id: 'lg', type: 'nozzles', engine: 0, data: { spec: { min: '300', max: '320' }, rows: { A1: { p1: '305', spray: 'ok', tight: 'ok', action: 'eingestellt', p2: '312' } } } };
      const lr = nozzleRows({ engines: getActiveOrder().engines, sheets: [legacy] }, legacy)[0];
      return [rows[0].sn, rows[0].snInherited, rows[0].st, printDocTitle(out), html.includes('Prüföl ISO 4113'), html.includes('Förderbeginn Einspritzpumpe'), html.includes('Abzudrückendes Bauteil'),
        lr.pText, lr.result, lr.note, nozzleStage(legacy)].join('|');
    });
    assert(nzOut === 'D-111|true|ok|Messblatt Druckprobe – Ausgang|true|true|true|305|ok|eingestellt, neu 312 bar|in', 'Düsen Ausgang: ' + nzOut, errors);
    await shot('11c-duesen-ausgang');

    // Seriennummern
    await page.evaluate(() => openSheet(getActiveOrder().sheets.find(s => s.type === 'serials').id));
    const groups = await page.evaluate(() => getActiveSheet().data.groups.map(g => g.label + ':' + g.rows.length));
    assert(groups.some(g => g.startsWith('Pleuel:16')) && groups.some(g => g.startsWith('Zylinderköpfe:16')), 'Seriennummern-Gruppen: ' + groups.join(', '), errors);

    // Laufbuchse: Anzahl Messebenen 2/3/4 umschalten
    await page.evaluate(() => openSheet(getActiveOrder().sheets.find(s => s.type === 'liner').id));
    await page.click('[data-set="data.lb.planes"][data-val="4"]');
    const pl4 = await page.evaluate(() => document.querySelectorAll('[data-mkey="lb"] tbody tr:first-child .m-in').length);
    assert(pl4 === 8, '4 Ebenen × A/B = 8 Felder: ' + pl4, errors);
    await page.click('[data-set="data.lb.planes"][data-val="2"]');
    const pl2 = await page.evaluate(() => document.querySelectorAll('[data-mkey="lb"] tbody tr:first-child .m-in').length);
    assert(pl2 === 4, '2 Ebenen × A/B = 4 Felder: ' + pl2, errors);
    assert(await page.locator('[data-mkey="lb"] .sketch svg').count() === 1, 'Skizze Laufbuchse sichtbar', errors);
    await page.click('[data-set="data.lb.planes"][data-val="3"]');
    // Laufbuchse einpassen: nur Gehäusebohrung
    await page.evaluate(() => openSheet(getActiveOrder().sheets.find(s => s.type === 'liner_fit').id));
    const fitBoth = await page.evaluate(() => document.querySelectorAll('[data-mkey="lf"] tbody tr:first-child .m-in').length);
    assert(fitBoth === 8, 'Einpassen Gehäuse + Buchse: 8 Felder: ' + fitBoth, errors);
    assert(await page.locator('[data-mkey="lf"] .sketch svg').count() === 1, 'Skizze Laufbuchse einpassen sichtbar', errors);
    await page.click('[data-set="data.lf.sides"][data-val="bore"]');
    const fitBore = await page.evaluate(() => [document.querySelectorAll('[data-mkey="lf"] tbody tr:first-child .m-in').length, document.querySelectorAll('[data-d^="lf|"]').length]);
    assert(fitBore[0] === 4 && fitBore[1] === 0, 'Nur Gehäusebohrung: 4 Felder, kein Spiel: ' + fitBore, errors);
    await page.fill('[data-bind="data.lf.spec.o.boreMin"]', '200,000');
    await page.fill('[data-bind="data.lf.spec.o.boreMax"]', '200,030');
    await page.fill('[data-bind="data.lf.rows.A1.ob_L"]', '200,050');
    await page.locator('[data-bind="data.lf.rows.A1.ob_L"]').dispatchEvent('change');
    assert(/st-bad/.test(await page.getAttribute('[data-bind="data.lf.rows.A1.ob_L"]', 'class')), 'Gehäusebohrung außer Toleranz rot', errors);
    await shot('13-fit-bore');

    // Minuswerte: ±-Leiste bei Zahlenfeldern (Soll und Ist)
    await page.evaluate(() => openSheet(getActiveOrder().sheets.find(s => s.type === 'piston_proj').id));
    await page.click('[data-bind="data.pp.spec.min"]');
    assert(await page.isVisible('#num-bar'), 'Zahlenleiste sichtbar bei Zahlenfeld', errors);
    await page.keyboard.type('0,10');
    await page.click('.nb-sign');
    await page.click('[data-bind="data.pp.spec.max"]');
    await page.keyboard.type('0,10');
    await page.click('[data-bind="data.pp.rows.A1.p0"]');
    await page.keyboard.type('0,15');
    await page.click('.nb-sign');
    await page.click('[data-bind="data.pp.rows.A2.p0"]');
    await page.keyboard.type('−0,05');
    await page.click('#view-sheet .sheet-head .oh-title');
    const neg = await page.evaluate(() => { const d = getActiveSheet().data.pp; return [d.spec.min, d.rows.A1.p0, d.rows.A2.p0]; });
    assert(neg[0] === '-0,10' && neg[1] === '-0,15' && neg[2] === '-0,05', 'Minuswerte gespeichert: ' + neg.join(' | '), errors);
    assert(/st-bad/.test(await page.getAttribute('[data-bind="data.pp.rows.A1.p0"]', 'class')), '-0,15 < -0,10 → rot', errors);
    assert(/st-ok/.test(await page.getAttribute('[data-bind="data.pp.rows.A2.p0"]', 'class')), '-0,05 in Toleranz → grün', errors);
    await page.waitForSelector('#num-bar', { state: 'hidden', timeout: 2000 }).catch(() => errors.push('ASSERT: Zahlenleiste verschwindet außerhalb'));
    await shot('14-minus');

    // Kolbenüberstand: Anzahl Messpunkte
    await page.evaluate(() => openSheet(getActiveOrder().sheets.find(s => s.type === 'piston_proj').id));
    const pp1 = await page.evaluate(() => document.querySelectorAll('[data-mkey="pp"] tbody tr:first-child .m-in:not(.txt)').length);
    assert(pp1 === 1, 'Kolbenüberstand Standard 1 Messpunkt: ' + pp1, errors);
    await page.click('[data-set="data.pp.points"][data-val="3"]');
    const pp3 = await page.evaluate(() => document.querySelectorAll('[data-mkey="pp"] tbody tr:first-child .m-in:not(.txt)').length);
    assert(pp3 === 3, 'Kolbenüberstand 3 Messpunkte: ' + pp3, errors);
    await shot('12-piston-3pt');

    // Ersatzteile / Bestellliste
    await page.evaluate(() => openSheet(getActiveOrder().sheets.find(s => s.type === 'parts').id));
    await page.click('.parts-card .btn-primary');
    await page.fill('[data-bind="data.items.0.part"]', 'Kolbenring');
    await page.fill('[data-bind="data.items.0.pos"]', 'A3');
    await page.fill('[data-bind="data.items.0.reason"]', 'gebrochen');
    await page.evaluate(() => addPhotos('data.items.0.photos'));
    await page.setInputFiles('#photo-input', { name: 'p.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => (getActiveSheet().data.items[0].photos || []).length > 0, null, { timeout: 5000 }).catch(() => errors.push('Foto Bauteil nicht gespeichert'));
    await page.click('.parts-card .btn-primary');
    await page.fill('[data-bind="data.items.1.part"]', 'Ladeluftkühler');
    await page.click('[data-set="data.items.1.status"][data-val="open"]');
    await page.fill('[data-bind="data.items.1.note"]', 'Rücksprache Kunde');
    const parts = await page.evaluate(() => [getActiveSheet().data.items.map(i => i.status).join(','), sheetAutoRating(getActiveOrder(), getActiveSheet()), sheetIssues(getActiveOrder(), getActiveSheet()).map(x => x.text).join(' | ')]);
    assert(parts[0] === 'order,open' && parts[1] === 'bad' && /Bestellen: Kolbenring \(A3\)/.test(parts[2]) && /Klären: Ladeluftkühler/.test(parts[2]), 'Bestellliste: Status, Bewertung, Handlungsbedarf: ' + parts.join(' / '), errors);
    await shot('15-parts');

    // Kurbelwelle Zapfen: Lageranzahl V16 = 9 Grundlager, 8 Hublager
    await page.evaluate(() => openSheet(getActiveOrder().sheets.find(s => s.type === 'kw_journal').id));
    const kw = await page.evaluate(() => [document.querySelectorAll('[data-mkey="kgl"] tbody tr').length, document.querySelectorAll('[data-mkey="khl"] tbody tr').length]);
    assert(kw[0] === 9 && kw[1] === 8, 'KW 9 Grundlager / 8 Hublager: ' + kw, errors);

    // Kein Wert darf beim Blattwechsel im falschen Blatt landen
    const stray = await page.evaluate(() => getActiveOrder().sheets.filter(s => s.type !== 'parts' && s.data.items !== undefined).map(s => s.type));
    assert(!stray.length, 'keine fremden Werte in anderen Blättern: ' + stray.join(', '), errors);

    // Druck: Deckblatt + alle Blätter → PDF
    await page.click('#btn-back');
    await page.click('#btn-print');
    await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
    await page.click('.modal-actions .btn-primary');
    await page.waitForFunction(() => window.__printed, null, { timeout: 5000 }).catch(() => errors.push('Druck nicht ausgelöst'));
    const pages = await page.evaluate(() => document.querySelectorAll('#print-area .pr-page').length);
    assert(pages === types.length + PAIRS + 1, `Druck: Deckblatt + ${types.length + PAIRS} Blätter (${pages})`, errors);
    if (label === 'desktop') {
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: path.join(OUT, 'druck-alle-blaetter.pdf'), format: 'A4', printBackground: true });
      await page.emulateMedia({ media: 'screen' });
    }

    // Befundbericht (Zusammenfassung) mit Anlagen
    await page.click('.report-card');
    await page.fill('.modal-card textarea >> nth=0', 'Motor insgesamt in gutem Zustand.');
    await page.check('#rep-attach');
    await page.evaluate(() => { window.__printed = false; });
    await page.click('.modal-actions .btn-primary');
    await page.waitForFunction(() => window.__printed, null, { timeout: 5000 }).catch(() => errors.push('Bericht: Druck nicht ausgelöst'));
    const rep = await page.evaluate(() => [document.querySelectorAll('#print-area .pr-page').length, document.querySelector('.pr-report').textContent]);
    assert(rep[0] === types.length + PAIRS + 1, `Bericht + ${types.length + PAIRS} Anlagen (${rep[0]})`, errors);
    assert(/außer Toleranz: Zyl\. A2/.test(rep[1]) && /gutem Zustand/.test(rep[1]) && /Handlungsbedarf/.test(rep[1]), 'Bericht enthält Ergebnis, Fazit, Handlungsbedarf', errors);
    if (label === 'desktop') {
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: path.join(OUT, 'befundbericht.pdf'), format: 'A4', printBackground: true });
      await page.emulateMedia({ media: 'screen' });
    }

    // Berichtsansicht in der App
    await page.evaluate(() => openReportView(null, 'report'));
    await page.waitForSelector('#view-report.active #paper .pr-page');
    const rv = await page.evaluate(() => [document.querySelectorAll('#paper .pr-page').length, getComputedStyle(document.querySelector('#paper .pr-title')).textDecorationLine]);
    assert(rv[0] === 1 && /underline/.test(rv[1]), 'Berichtsansicht zeigt Papierseite im Druckstil: ' + rv, errors);
    await page.click('#view-report .chip >> nth=1');
    await page.waitForFunction(n => document.querySelectorAll('#paper .pr-page').length === n, types.length + PAIRS + 1, { timeout: 5000 }).catch(() => errors.push('Berichtsansicht + alle Blätter'));
    await shot('16-report-view');

    // Büro: Auftrag als Datei senden → anderes Gerät lädt sie → Link öffnet Bericht
    if (label === 'desktop') {
      await page.evaluate(() => { navigator.canShare = null; });
      const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => shareOrder())]);
      const file = path.join(OUT, 'auftrag-export.json');
      await dl.saveAs(file);
      const office = await browser.newContext({ viewport });
      const op = await office.newPage();
      op.on('pageerror', e => errors.push(`[büro] ${e.message}`));
      op.on('dialog', d => d.accept());
      await op.goto(url);
      await op.waitForFunction(() => typeof appData !== 'undefined' && appData);
      assert(await op.evaluate(() => appData.orders.length) === 0, 'Büro-Gerät startet leer', errors);
      await op.setInputFiles('#import-input', file);
      await op.waitForSelector('#view-report.active #paper .pr-page', { timeout: 8000 }).catch(() => errors.push('Büro: Bericht nach Import nicht angezeigt'));
      const photosOk = await op.evaluate(() => Promise.all(collectPhotoIds(getActiveOrder()).map(id => getFile(id))).then(b => b.length > 0 && b.every(Boolean)));
      assert(photosOk, 'Büro: Fotos mit übertragen', errors);
      await op.goto(url.replace('index.html', 'index.html#auftrag=x'));
      await op.goto(url + '#bericht=' + encodeURIComponent(orderNo));
      await op.waitForSelector('#view-report.active #paper .pr-page', { timeout: 8000 }).catch(() => errors.push('Büro: Direktlink öffnet Bericht nicht'));
      await op.screenshot({ path: path.join(OUT, 'buero-bericht.png'), fullPage: false });
      await office.close();
    }
    await page.click('#btn-back');

    // Einstellungen, Beispielauftrag, Dunkelmodus
    await page.click('#btn-back');
    await page.click('.nav-item[data-view="settings"]');
    await page.fill('[data-bind="name"]', 'Max Prüfer');
    await shot('20-settings');
    await page.click('#btn-theme');
    await page.evaluate(() => createDemoOrder());
    await page.waitForSelector('#view-order.active');
    await shot('21-demo-dark');
    await page.click('#btn-theme');
    await ctx.close();
  }

  await browser.close();
  server.close();
  if (errors.length) { console.log('FEHLER:\n' + errors.join('\n')); process.exit(1); }
  console.log('Smoke-Test OK – Screenshots/PDF in ' + OUT);
})().catch(e => { console.error(e); if (typeof errorsGlobal !== 'undefined' && errorsGlobal.length) console.log('Bis dahin:\n' + errorsGlobal.join('\n')); server.close(); process.exit(1); });
