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
    await page.screenshot({ path: path.join(OUT, `${label}-07-werkstatt.png`), fullPage: true });
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
