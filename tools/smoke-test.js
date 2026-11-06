// Smoke-Test für Zettel-Job: startet einen lokalen Server, öffnet die App in
// Chromium (Handy + Desktop), legt Zettel an, prüft die Stundenrechnung,
// klickt alle Ansichten durch und meldet JS-Fehler. Screenshots → .smoke/
//
// Aufruf:  node tools/smoke-test.js [screenshot-ordner]
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.smoke'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

function assert(cond, msg, errors) { if (!cond) errors.push('ASSERT: ' + msg); }

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/index.html`;
  fs.mkdirSync(OUT, { recursive: true });
  const launchOpts = fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
  const browser = await chromium.launch(launchOpts);
  const errors = [];

  for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`); });
    page.on('requestfailed', r => errors.push(`[${label}] request failed: ${r.url()}`));
    page.on('dialog', d => d.accept());

    await page.goto(url);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${label}-01-leer.png`) });

    // Neuer Montagezettel über die Oberfläche
    await page.click('.fab');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${label}-02-typwahl.png`) });
    await page.click('.type-btn:first-child');
    await page.waitForTimeout(300);
    await page.fill('[data-bind="orderNo"]', '24-1187');
    await page.fill('[data-bind="customer"]', 'Reederei Nord GmbH');
    await page.fill('[data-bind="vessel"]', 'MS Hanna');

    // Zeiten eintippen: Montag 2026-11-02
    await page.evaluate(() => { getActiveSheet().days[0].date = '2026-11-02'; renderEditor(); });
    const rows = [['630', '700', 'RZ', 'Werkzeug vorbereitet'], ['700', '1200', 'AZ', 'Pumpe demontiert'], ['1200', '1230', 'P', ''], ['1230', '1645', 'AZ', 'Dichtungen getauscht']];
    for (const [i, [f, t, c, d]] of rows.entries()) {
      await page.click('.day-card[data-day="0"] .entry-add .btn');
      const row = page.locator('.day-card[data-day="0"] .entry').nth(i);
      await row.locator('.t-in').nth(0).fill(f);
      await row.locator('.t-in').nth(0).dispatchEvent('change');
      await row.locator('.t-in').nth(1).fill(t);
      await row.locator('.t-in').nth(1).dispatchEvent('change');
      await row.locator('.code-sel').selectOption(c);
      if (d) await page.locator('.day-card[data-day="0"] .entry').nth(i).locator('.entry-desc').fill(d);
    }
    await page.selectOption('[data-bind="days.0.away"]', '24h');
    await page.check('[data-bind="days.0.hotel"]');
    await page.waitForTimeout(200);

    // Rechnung: 0,5 + 5 + 4,25 = 9,75 h (Pause zählt nicht), Montag Soll 8 → +1,75
    const info = await page.evaluate(() => dayInfo('2026-11-02'));
    assert(info.worked === 585, `Montag gearbeitet erwartet 585 min, ist ${info.worked}`, errors);
    assert(info.delta === 105, `Montag Überstunden erwartet 105 min, ist ${info.delta}`, errors);

    // Anfahrt über die Oberfläche einschalten: 1:00 h am Montag
    await page.click('button.travel-add >> nth=0');
    await page.fill('[data-bind="travelOut.duration"]', '1:00');
    await page.locator('[data-bind="travelOut.duration"]').dispatchEvent('change');
    const mondayId = await page.evaluate(() => activeSheetId);
    // Montag: 1h Anfahrt + 9,75h = 10,75h → 8 normal, 2,75 Überstunden (alle in der letzten AZ-Zeile)
    const mon = await page.evaluate(() => { const r = daySplit(getActiveSheet(), 0); return { n: r.normal, o: r.ot, by: r.byEntry.map(l => l.ot) }; });
    assert(mon.n === 480 && mon.o === 165 && JSON.stringify(mon.by) === '[0,0,0,165]', `Montag-Split ${JSON.stringify(mon)}`, errors);
    await page.click('[data-set="material"][data-val="true"]');
    await page.screenshot({ path: path.join(OUT, `${label}-03-editor.png`), fullPage: true });

    // „Nächster Tag“ → eigener Zettel, Kopf übernommen; Datum auf Freitag setzen
    await page.click('.editor-footer .btn-soft');
    await page.waitForTimeout(200);
    const head = await page.evaluate(() => { const s = getActiveSheet(); return [s.orderNo, s.vessel, s.days.length, s.days[0].date, s.days[0].hotel].join('|'); });
    assert(head === '24-1187|MS Hanna|1|2026-11-03|true', `Nächster Tag übernimmt Kopf: ${head}`, errors);
    await page.evaluate(() => {
      const s = getActiveSheet();
      s.days[0].date = '2026-11-06';
      s.days[0].away = '8h'; s.days[0].hotel = false;
      s.days[0].entries.push({ id: uid(), from: '07:00', to: '14:00', code: 'AZ', desc: 'Probelauf' });
      renderEditor();
    });
    // Rückfahrt einschalten → wird aus der Anfahrt (umgekehrt) vorbelegt, dann 2:00 h
    await page.click('button.travel-add >> nth=1');
    const prefill = await page.evaluate(() => getActiveSheet().travelBack.duration);
    assert(prefill === '1:00', `Rückfahrt vorbelegt mit Anfahrt-Zeit, ist ${prefill}`, errors);
    await page.fill('[data-bind="travelBack.duration"]', '2:00');
    await page.locator('[data-bind="travelBack.duration"]').dispatchEvent('change');
    await page.click('[data-set="finished"][data-val="false"]');
    // Freitag: 5h Soll, 7h + 2h Rückfahrt → 5 normal, 4 Überstunden
    const fri = await page.evaluate(() => sheetTotals(getActiveSheet()));
    assert(fri.worked === 540 && fri.normal === 300 && fri.ot === 240, `Freitag-Summen ${JSON.stringify(fri)}`, errors);
    const nSheets = await page.evaluate(() => appData.sheets.length);
    assert(nSheets === 2, `zwei einzelne Zettel erwartet, sind ${nSheets}`, errors);

    // Freier Tag Dienstag → −8h; Saldo = +2,75 − 8 + 4 = −1,25 h
    await page.evaluate(() => { appData.daysOff.push({ id: uid(), date: '2026-11-03', type: 'abbau', note: '' }); });
    const bal = await page.evaluate(() => overtimeBalance());
    assert(bal === -75, `Saldo erwartet -75 min, ist ${bal}`, errors);

    // Auftrag zusammenstellen (nur auf Befehl)
    await page.evaluate(() => { closeEditor(); });
    await page.click('.chip-action');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${label}-14-zusammenstellen-auswahl.png`) });
    await page.click('#modal .menu-row >> nth=0');
    await page.waitForTimeout(300);
    const ord = await page.evaluate(() => { const o = orderData(activeOrderNo); return { n: o.items.length, t: o.totals, a: o.allowance }; });
    assert(ord.n === 2 && ord.t.worked === 1185 && ord.t.normal === 780 && ord.t.ot === 405, `Auftragssummen ${JSON.stringify(ord)}`, errors);
    assert(ord.a.away24 === 1 && ord.a.away8 === 1 && ord.a.hotel === 1, `Auslöse ${JSON.stringify(ord.a)}`, errors);
    await page.screenshot({ path: path.join(OUT, `${label}-15-auftrag.png`), fullPage: true });
    await page.evaluate(() => { document.getElementById('print-area').innerHTML = buildOrderPrintHtml(activeOrderNo); });
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({ path: path.join(OUT, `${label}-16-auftrag-druck.png`), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    // In Ordner ablegen → Zettel verschwinden aus der Liste, Ordner erscheint
    await page.click('.folder-actions .btn-primary');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, `${label}-17-ordner.png`), fullPage: true });
    await page.evaluate(() => showView('sheets'));
    await page.waitForTimeout(200);
    const listInfo = await page.evaluate(() => ({ folders: document.querySelectorAll('.folder-card').length, cards: document.querySelectorAll('.sheet-card:not(.folder-card)').length }));
    assert(listInfo.folders === 1 && listInfo.cards === 0, `Liste mit Ordner ${JSON.stringify(listInfo)}`, errors);
    await page.screenshot({ path: path.join(OUT, `${label}-18-liste-ordner.png`), fullPage: true });
    // Neuer Zettel im Ordner → landet automatisch darin, zurück in den Ordner
    await page.click('.folder-card');
    await page.waitForTimeout(200);
    await page.click('.folder-actions .btn-soft');
    await page.waitForTimeout(200);
    const inFolder = await page.evaluate(() => { const s = getActiveSheet(); const r = [s.orderNo, s.days[0].date, editorReturn].join('|'); return r; });
    assert(inFolder === '24-1187|2026-11-07|order', `Neuer Zettel im Ordner ${inFolder}`, errors);
    const back2 = await page.evaluate(() => { const id = activeSheetId; closeEditor(); appData.sheets = appData.sheets.filter(x => x.id !== id); renderOrder(); return currentView; });
    assert(back2 === 'order', `Nach neuem Ordner-Zettel zurück im Ordner, ist ${back2}`, errors);

    // Aus der Zusammenstellung einen Tag öffnen und zurück
    await page.click('.o-day >> nth=0');
    await page.waitForTimeout(200);
    const backTo = await page.evaluate(() => { closeEditor(); return currentView; });
    assert(backTo === 'order', `Zurück aus Editor in Zusammenstellung, ist ${backTo}`, errors);
    await page.evaluate((id) => openEditor(id), mondayId);
    await page.waitForTimeout(200);
    const t = await page.evaluate(() => parseTime('0630') === 390 && parseTime('6:30') === 390 && parseTime('2500') === null && entryMinutes({ from: '22:00', to: '02:00' }) === 240);
    assert(t, 'parseTime/entryMinutes', errors);

    // Unterschrift Kunde
    await page.click('.sign-box.empty >> nth=1');
    await page.waitForTimeout(300);
    await page.fill('#sign-name', 'K. Kunde');
    const box = await page.locator('#sign-canvas').boundingBox();
    await page.mouse.move(box.x + 40, box.y + box.height * 0.6);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 40 + i * 12, box.y + box.height * 0.6 + Math.sin(i) * 20);
    await page.mouse.up();
    await page.screenshot({ path: path.join(OUT, `${label}-04-unterschrift.png`) });
    await page.click('.sign-actions .btn-primary');
    await page.waitForTimeout(300);
    const locked = await page.evaluate(() => !!document.querySelector('fieldset.editor-form[disabled]'));
    assert(locked, 'Zettel nach Kundenunterschrift gesperrt', errors);
    await page.screenshot({ path: path.join(OUT, `${label}-05-unterschrieben.png`), fullPage: true });

    // Druckansicht
    await page.evaluate(() => { document.getElementById('print-area').innerHTML = buildPrintHtml(getActiveSheet()); });
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({ path: path.join(OUT, `${label}-06-druck.png`), fullPage: true });
    await page.emulateMedia({ media: 'screen' });

    // Werkstattzettel
    await page.evaluate(() => { closeEditor(); createSheet('werkstatt'); });
    await page.waitForTimeout(200);
    // Werkstatt: Kostenstellen statt Zeitarten, P = Pause zählt nicht
    await page.evaluate(() => { getActiveSheet().days[0].date = '2026-11-04'; renderEditor(); });
    for (const [i, [f, t, c]] of [['700', '1000', 'sr26/244'], ['1000', '1015', 'p'], ['1015', '1600', '120']].entries()) {
      await page.click('.day-card[data-day="0"] .entry-add .btn');
      const row = page.locator('.day-card[data-day="0"] .entry').nth(i);
      await row.locator('.t-in').nth(0).fill(f); await row.locator('.t-in').nth(0).dispatchEvent('change');
      await row.locator('.t-in').nth(1).fill(t); await row.locator('.t-in').nth(1).dispatchEvent('change');
      await row.locator('.cost-in').fill(c); await row.locator('.cost-in').dispatchEvent('change');
    }
    const ws = await page.evaluate(() => { const s = getActiveSheet(); return { costs: s.days[0].entries.map(e => e.cost), t: sheetTotals(s), by: sheetMinutesByCode(s) }; });
    assert(JSON.stringify(ws.costs) === '["SR26/000244","P","120"]', `Kostenstellen ${JSON.stringify(ws.costs)}`, errors);
    assert(ws.t.worked === 525 && ws.t.normal === 480 && ws.t.ot === 45, `Werkstatt-Summen ${JSON.stringify(ws.t)}`, errors);
    assert(ws.by['SR26/000244'] === 180 && ws.by['120'] === 345, `Summen je Kostenstelle ${JSON.stringify(ws.by)}`, errors);
    const cc = await page.evaluate(() => [appData.settings.costCenters.length, (getCostCenter('17b') || {}).no, (getCostCenter('120') || {}).label].join('|'));
    assert(cc === '31|17B|Verwaltung', `Standard-Kostenstellen ${cc}`, errors);
    // Daten der Vorversion (leere Liste, fehlerhafte Markierung) → Standardliste wird nachgetragen
    const seeded = await page.evaluate(() => [
      normalizeData({ settings: { costCenters: [] }, sheets: [] }).settings.costCenters.length,
      normalizeData({ settings: { costCenters: [], costCentersSeeded: true }, sheets: [] }).settings.costCenters.length,
      normalizeData({ settings: { costCenters: [{ no: '1', label: 'x' }] }, sheets: [] }).settings.costCenters.length,
      normalizeData({ settings: { costCenters: [], costCentersVersion: 1 }, sheets: [] }).settings.costCenters.length
    ].join(','));
    assert(seeded === '31,31,1,0', `Kostenstellen nachtragen ${seeded}`, errors);
    const fmt = await page.evaluate(() => [formatOrderNo('249', '2026-11-04'), formatOrderNo('26/249'), formatOrderNo('SR26000249'), formatOrderNo('120', null, false), formatOrderNo('24-1187')].join(' '));
    assert(fmt === 'SR26/000249 SR26/000249 SR26/000249 120 24-1187', `Auftragsnummer-Format ${fmt}`, errors);
    await page.screenshot({ path: path.join(OUT, `${label}-07-werkstatt.png`), fullPage: true });
    await page.evaluate(() => { document.getElementById('print-area').innerHTML = buildPrintHtml(getActiveSheet()); });
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({ path: path.join(OUT, `${label}-07b-werkstatt-druck.png`), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => closeEditor());
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${label}-08-liste.png`), fullPage: true });

    await page.evaluate(() => { showView('hours'); hoursMonth = '2026-11'; renderHours(); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${label}-09-stunden.png`), fullPage: true });
    await page.evaluate(() => openDayOffModal());
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${label}-10-freier-tag.png`) });
    await page.evaluate(() => closeModal());

    await page.evaluate(() => showView('settings'));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${label}-11-einstellungen.png`), fullPage: true });

    // Dunkelmodus
    await page.evaluate(() => toggleTheme());
    await page.evaluate(() => showView('hours'));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${label}-12-dunkel-stunden.png`), fullPage: true });
    await page.evaluate(() => openEditor(appData.sheets[0].id));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${label}-13-dunkel-editor.png`), fullPage: true });

    // Zeile dazwischen einfügen: 0630-0730 RZ, 0730-1200 AZ → FZ 0730-0830 einfügen, AZ rutscht auf 0830-1300
    await page.evaluate(() => {
      createSheet('montage');
      const s = getActiveSheet();
      s.days[0].date = '2026-11-09';
      s.days[0].entries = [{ id: uid(), from: '06:30', to: '07:30', code: 'RZ', desc: '' }, { id: uid(), from: '07:30', to: '12:00', code: 'AZ', desc: 'Montage' }];
      s.engines = [{ make: 'MTU', model: '12V 4000 M73', number: '5370012345', hours: '12450' }];
      renderEditor();
    });
    await page.click('.insert-btn');
    await page.waitForTimeout(200);
    await page.fill('#ins-to', '0830');
    await page.selectOption('#ins-code', 'FZ');
    await page.fill('#ins-desc', 'Fahrt zum Schiff');
    await page.screenshot({ path: path.join(OUT, `${label}-19-einfuegen.png`) });
    await page.click('#modal .btn-primary');
    await page.waitForTimeout(200);
    const ins = await page.evaluate(() => getActiveSheet().days[0].entries.map(e => `${e.from}-${e.to} ${e.code}`).join(', '));
    assert(ins === '06:30-07:30 RZ, 07:30-08:30 FZ, 08:30-13:00 AZ', `Einfügen & Verschieben: ${ins}`, errors);
    await page.screenshot({ path: path.join(OUT, `${label}-20-motor-editor.png`), fullPage: true });
    const prEng = await page.evaluate(() => { const h = buildPrintHtml(getActiveSheet()); return ['Motornummer', '5370012345', 'Betriebsstunden', '12V 4000 M73'].every(t => h.includes(t)); });
    assert(prEng, 'Motordaten im Ausdruck', errors);
    // Zweiter Motor: übernimmt Fabrikat/Bezeichnung, Benennung BB/SB
    await page.click('.engine-title-row ~ .link-btn, button.link-btn:has-text("2. Motor")');
    await page.fill('[data-bind="engines.1.number"]', '5370012346');
    await page.fill('[data-bind="engines.1.hours"]', '12398');
    await page.locator('[data-bind="engines.1.hours"]').dispatchEvent('change');
    const two = await page.evaluate(() => { const s = getActiveSheet(); return [s.engines.length, s.engines[1].make, engineLabel(s, 0), engineLabel(s, 1)].join('|'); });
    assert(two === '2|MTU|Motor 1|Motor 2', `Zweiter Motor ohne Bezeichnung ${two}`, errors);
    // Bezeichnung optional selbst eintragen
    await page.fill('[data-bind="engines.0.name"]', 'Motor BB');
    await page.fill('[data-bind="engines.1.name"]', 'Motor SB');
    await page.locator('[data-bind="engines.1.name"]').dispatchEvent('change');
    await page.screenshot({ path: path.join(OUT, `${label}-21-zwei-motoren.png`), fullPage: true });
    const pr2 = await page.evaluate(() => { const h = buildPrintHtml(getActiveSheet()); return h.includes('Motor BB') && h.includes('Motor SB') && h.includes('5370012346') && h.includes('12398'); });
    assert(pr2, 'Zwei Motoren im Ausdruck', errors);
    const nextEng = await page.evaluate(() => { const first = activeSheetId; nextDaySheet(first); const s = getActiveSheet(); s.engines[0].hours = '12460'; s.engines[1].hours = '12408'; return s.engines.map(e => [e.make, e.number, e.hours].join('|')).join(' / ') + ' ' + s.engines.map(e => e.name).join(','); });
    assert(nextEng === 'MTU|5370012345|12460 / MTU|5370012346|12408 Motor BB,Motor SB', `Nächster Tag übernimmt Motoren: ${nextEng}`, errors);
    const oe = await page.evaluate(() => { const sh = appData.sheets.filter(x => x.days.some(d => d.date === '2026-11-09' || d.date === '2026-11-10')); sh.forEach(x => x.orderNo = 'SR26/000999'); return orderEngines(orderSheets('SR26/000999')).map(e => e.label + ':' + e.hours).join(' '); });
    assert(oe === 'Motor BB:12450 → 12460 Motor SB:12398 → 12408', `Zusammenstellung Motoren ${oe}`, errors);
    const legacy = await page.evaluate(() => { const s = normalizeSheet({ days: [], engine: { make: 'MAN', hours: '100' } }); return s.engines.length + '|' + s.engines[0].make + '|' + ('engine' in s); });
    assert(legacy === '1|MAN|false', `Alte Motordaten übernommen ${legacy}`, errors);
    await page.evaluate(() => { appData.sheets = appData.sheets.filter(x => !x.days.some(d => d.date === '2026-11-09' || d.date === '2026-11-10')); closeEditor(); });

    // Persistenz: neu laden, Daten müssen noch da sein
    await page.evaluate(() => saveData(true));
    await page.reload();
    await page.waitForTimeout(800);
    const n = await page.evaluate(() => appData.sheets.length);
    assert(n === 3, `nach Reload 3 Zettel erwartet, sind ${n}`, errors);

    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(`Screenshots: ${OUT}`);
  if (errors.length) { console.log('FEHLER:\n' + errors.join('\n')); process.exit(1); }
  console.log('OK - keine JS-Fehler, Rechnungen stimmen.');
})().catch(e => { console.error(e); server.close(); process.exit(1); });
