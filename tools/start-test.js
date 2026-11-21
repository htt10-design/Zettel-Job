// Test der Service-App-Startseite: Kacheln, Überblick aus Zettel-Job/Befunde, keine Fehler,
// keine Datenbank anlegen. Aufruf: node tools/start-test.js  → Screenshots in .smoke/start/
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.smoke', 'start');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const errors = [];
  const browser = await chromium.launch();
  for (const [label, opts] of [['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1200, height: 900 } }]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });

    // 1) Erststart: nichts gespeichert → Kacheln, keine Datenbank angelegt
    await page.goto(base + '/');
    await page.waitForTimeout(500);
    const first = await page.evaluate(async () => [
      document.querySelectorAll('a.tile').length,
      document.getElementById('stats-zettel').textContent.trim(),
      document.getElementById('todo-card').hidden,
      (await indexedDB.databases()).map(d => d.name).join(',')
    ].join('|'));
    if (first !== '2|Noch nicht benutzt|true|') errors.push(`${label}: Erststart ${first}`);

    // 1b) Wer arbeitet? → Monteur per Name auswählen (vor dem ersten Öffnen des Stundennachweises)
    await page.click('#who');
    await page.fill('#who-input', 'Henrik Test');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${label}-wer-arbeitet.png`) });
    await page.click('text=Als Monteur anmelden');
    await page.waitForTimeout(300);
    const who1 = await page.evaluate(() => document.getElementById('who-name').textContent + '|' + document.getElementById('hello-title').textContent.split(', ')[1]);
    if (who1 !== 'Henrik Test|Henrik!') errors.push(`${label}: Auswahl ${who1}`);

    // 2) Zettel-Job benutzen: heute 8 h, Montage ohne Kundenunterschrift, Auftrag zugeteilt
    await page.goto(base + '/zettel/index.html');
    await page.waitForTimeout(700);
    const applied = await page.evaluate(() => [appData.role, appData.settings.name, document.getElementById('modal').classList.contains('open'), document.querySelector('#topbar-title .brand-text').textContent].join('|'));
    if (applied !== 'tech|Henrik Test|false|Stundennachweis') errors.push(`${label}: Auswahl im Stundennachweis ${applied}`);
    await page.evaluate(() => {
      const t = todayISO();
      appData.sheets.push(normalizeSheet({ id: 'st1', type: 'montage', worker: 'Henrik Test', orderNo: 'SR26/000111', days: [{ date: t, entries: [{ from: '07:00', to: '15:00', code: 'AZ', desc: 'Test' }] }] }));
      appData.jobs.push(normalizeData({ jobs: [{ id: 'jt', orderNo: 'SR26/000222', vessel: 'MS Start', assigned: ['henrik test'] }] }).jobs[0]);
      saveData(true);
    });
    const home = await page.getAttribute('#btn-home', 'href');
    if (home !== '../') errors.push(`${label}: Startseiten-Link ${home}`);
    await page.waitForTimeout(300);
    // Befunde-Daten wie von der Befunde-App
    await page.evaluate(() => new Promise(res => { const r = indexedDB.open('befunde', 1); r.onupgradeneeded = () => r.result.createObjectStore('store'); r.onsuccess = () => { const tx = r.result.transaction('store', 'readwrite'); tx.objectStore('store').put({ orders: [{ orderNo: 'SR26/000111', status: 'offen', sheets: [{ type: 'parts', data: { items: [{ part: 'Dichtung', status: 'order' }] } }, {}] }, { orderNo: 'X', status: 'fertig', sheets: [] }] }, 'appData'); tx.oncomplete = () => { r.result.close(); res(); }; }; }));
    await page.click('#btn-home');
    await page.waitForURL(base + '/');
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => [
      document.getElementById('hello-title').textContent,
      document.getElementById('stats-zettel').textContent.replace(/\s+/g, ' ').trim(),
      document.getElementById('stats-befunde').textContent.replace(/\s+/g, ' ').trim(),
      Array.from(document.querySelectorAll('.todo b')).map(b => b.textContent).join(' / '),
      Math.max(...Array.from(document.querySelectorAll('main *')).map(e => e.getBoundingClientRect().right)) <= window.innerWidth
    ].join('|'));
    const expWeek = 'Woche 8,00 h';
    if (!after.startsWith('Moin, Henrik!|') && !after.startsWith('Hallo, Henrik!|') && !after.startsWith('Guten Abend, Henrik!|')) errors.push(`${label}: Begrüßung ${after}`);
    if (!after.includes(expWeek)) errors.push(`${label}: Wochenstunden ${after}`);
    if (!after.includes('Urlaub 30 frei')) errors.push(`${label}: Urlaubstage ${after}`);
    if (!after.includes('1 offen2 Blätter') && !after.includes('1 offen 2 Blätter')) errors.push(`${label}: Befunde-Zahlen ${after}`);
    if (!after.includes('1 Zettel ohne Kundenunterschrift') || !after.includes('1 Auftrag dir zugeteilt') || !after.includes('1 Ersatzteil zu bestellen')) errors.push(`${label}: Zu erledigen ${after}`);
    if (!after.endsWith('|true')) errors.push(`${label}: Seite zu breit`);
    await page.screenshot({ path: path.join(OUT, `${label}-start.png`), fullPage: true });

    // 3) Wechsel auf Büro und zurück zum Monteur aus der Liste
    await page.click('#who');
    await page.click('#who-seg [data-role="office"]');
    await page.fill('#who-input', 'Bea Büro');
    await page.click('text=Als Büro anmelden');
    await page.waitForTimeout(300);
    const office = await page.evaluate(() => [document.getElementById('who-role').textContent, document.getElementById('who-name').textContent, document.getElementById('stats-zettel').textContent.includes('offene Aufträge')].join('|'));
    if (office !== 'Büro / Sachbearbeiter|Bea Büro|true') errors.push(`${label}: Büro-Auswahl ${office}`);
    await page.goto(base + '/zettel/index.html'); await page.waitForTimeout(700);
    const zOffice = await page.evaluate(() => [appData.role, appData.settings.officeName, appData.settings.name].join('|'));
    if (zOffice !== 'office|Bea Büro|Henrik Test') errors.push(`${label}: Büro im Stundennachweis ${zOffice}`);
    await page.click('#btn-home'); await page.waitForURL(base + '/'); await page.waitForTimeout(400);
    await page.click('#who');
    await page.click('#who-seg [data-role="tech"]');
    const listed = await page.evaluate(() => Array.from(document.querySelectorAll('.pick-btn b')).map(b => b.textContent).join(','));
    if (listed !== 'Henrik Test') errors.push(`${label}: Monteurliste ${listed}`);
    await page.click('.pick-btn');
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => document.getElementById('who-name').textContent + '|' + document.getElementById('stats-zettel').textContent.includes('Woche 8,00 h'));
    if (back !== 'Henrik Test|true') errors.push(`${label}: zurück zum Monteur ${back}`);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload(); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${label}-start-dunkel.png`), fullPage: true });
    // Kachel öffnet den Bereich
    await page.click('#tile-befunde');
    await page.waitForURL(/\/befunde\/$/);
    await page.waitForTimeout(500);
    if (!(await page.$('#btn-home'))) errors.push(`${label}: Befunde ohne Startseiten-Knopf`);
    const pruefer = await page.evaluate(() => appData.settings.name);
    if (pruefer !== 'Henrik Test') errors.push(`${label}: Prüfer in Befunde ${pruefer}`);
    await ctx.close();
  }
  await browser.close();
  server.close();
  if (errors.length) { console.log('FEHLER:\n' + errors.join('\n')); process.exit(1); }
  console.log('OK – Startseite, Überblick und Wechsel funktionieren. Screenshots: ' + OUT);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
