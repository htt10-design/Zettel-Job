// Sync-Test: zwei getrennte Browser („Handy“ und „Tablet“) gleichen über einen
// nachgebauten PocketBase-Server ab (nur die Endpunkte, die die App nutzt).
// Aufruf:  node tools/sync-test.js
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// ---------- Mini-PocketBase ----------
const items = new Map();   // id → record
const files = new Map();   // id → { id, fileId, name, file, data(Buffer), updated }
let clock = Date.parse('2026-11-14T10:00:00Z');
const stamp = () => new Date(clock += 7).toISOString().replace('T', ' ');
const TOKEN = 'tok-123';

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise(r => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => r(Buffer.concat(chunks))); });
}

async function api(req, res, url) {
  const p = url.pathname;
  if (p === '/api/collections/users/auth-with-password' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString());
    if (b.identity === 'test@example.com' && b.password === 'geheim') return send(res, 200, { token: TOKEN, record: { id: 'user1' } });
    return send(res, 400, { message: 'Failed to authenticate.' });
  }
  if (req.headers.authorization !== TOKEN) return send(res, 401, { message: 'unauthorized' });

  let m;
  if (p === '/api/collections/zj_items/records' && req.method === 'GET') {
    const f = url.searchParams.get('filter') || '';
    const since = (f.match(/updated >= "([^"]+)"/) || [])[1] || '';
    const list = [...items.values()].filter(r => !since || r.updated >= since).sort((a, b) => a.updated.localeCompare(b.updated));
    const per = +url.searchParams.get('perPage') || 30, page = +url.searchParams.get('page') || 1;
    return send(res, 200, { items: list.slice((page - 1) * per, page * per) });
  }
  if ((m = p.match(/^\/api\/collections\/zj_items\/records\/([a-z0-9]{15})$/)) && req.method === 'PATCH') {
    const rec = items.get(m[1]);
    if (!rec) return send(res, 404, { message: 'not found' });
    Object.assign(rec, JSON.parse((await readBody(req)).toString()), { updated: stamp() });
    return send(res, 200, rec);
  }
  if (p === '/api/collections/zj_items/records' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString());
    if (!/^[a-z0-9]{15}$/.test(b.id || '')) return send(res, 400, { message: 'bad id' });
    if ([...items.values()].some(r => r.key === b.key)) return send(res, 400, { message: 'key exists' });
    const rec = Object.assign({}, b, { created: stamp(), updated: stamp() });
    items.set(b.id, rec);
    return send(res, 200, rec);
  }
  if (p === '/api/collections/zj_files/records' && req.method === 'POST') {
    const raw = await readBody(req);
    const txt = raw.toString('latin1');
    const fileId = (txt.match(/name="fileId"\r\n\r\n([^\r]+)/) || [])[1];
    if ([...files.values()].some(f => f.fileId === fileId)) return send(res, 400, { message: 'exists' });
    const head = txt.indexOf('name="file"; filename=');
    const start = txt.indexOf('\r\n\r\n', head) + 4;
    const end = txt.indexOf('\r\n--', start);
    const id = 'f' + String(files.size).padStart(14, '0');
    files.set(id, { id, fileId, file: 'doc.pdf', data: raw.subarray(start, end), updated: stamp() });
    return send(res, 200, { id, fileId, file: 'doc.pdf' });
  }
  if (p === '/api/collections/zj_files/records' && req.method === 'GET') {
    const fid = ((url.searchParams.get('filter') || '').match(/fileId = "([^"]+)"/) || [])[1];
    return send(res, 200, { items: [...files.values()].filter(f => f.fileId === fid).map(({ data, ...r }) => r) });
  }
  if ((m = p.match(/^\/api\/files\/zj_files\/([^/]+)\//))) {
    const f = files.get(m[1]);
    return f ? send(res, 200, f.data, 'application/pdf') : send(res, 404, { message: 'nf' });
  }
  send(res, 404, { message: 'unknown ' + req.method + ' ' + p });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return api(req, res, url).catch(e => send(res, 500, { message: String(e) }));
  const file = path.join(ROOT, decodeURIComponent(url.pathname).replace(/\/$/, '/index.html'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

function assert(cond, msg, errors) { if (!cond) errors.push('ASSERT: ' + msg); }

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const launchOpts = fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
  const browser = await chromium.launch(launchOpts);
  const errors = [];

  async function device(label, role, name) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
    await page.goto(base + '/index.html');
    await page.waitForTimeout(600);
    await page.evaluate(([r, n]) => loginAs(r, n), [role, name]);
    // Anmeldung am Server über das Formular in den Einstellungen
    await page.evaluate(() => showView('settings'));
    await page.fill('#sync-url', base);
    await page.fill('#sync-email', 'test@example.com');
    await page.fill('#sync-pass', 'geheim');
    await page.click('.sync-card .btn-primary');
    await page.waitForTimeout(800);
    return page;
  }
  const sync = page => page.evaluate(() => runSync(false));

  // Handy (Monteur) legt einen Zettel an
  const handy = await device('Handy', 'tech', 'Max Monteur');
  await handy.evaluate(async () => {
    appData.sheets.push({ id: 'sheetA', type: 'montage', worker: 'Max Monteur', orderNo: 'SR26/000111', customer: 'Kunde A', vessel: 'MS A', updatedAt: new Date().toISOString(),
      engines: [{}], travelOut: { on: false }, travelBack: { on: false },
      days: [{ id: 'd1', date: '2026-11-16', entries: [{ id: 'e1', from: '07:00', to: '15:00', code: 'AZ', desc: 'Montage' }], away: '', hotel: false }] });
    await saveData(true);
  });
  await sync(handy);
  assert([...items.values()].some(r => r.key === 'sheet:sheetA'), 'Zettel liegt auf dem Server', errors);
  const team = [...items.values()].find(r => r.key === 'team:settings');
  assert(team && !('role' in team.data) && !('name' in team.data) && !('theme' in team.data) && Array.isArray(team.data.costCenters),
    'nur Team-Einstellungen auf dem Server (keine Rolle/Name/Theme)', errors);

  // Tablet (Büro) meldet sich an → hat den Zettel, Rolle bleibt Büro
  const tablet = await device('Tablet', 'office', 'Petra Büro');
  let t = await tablet.evaluate(() => [appData.sheets.some(s => s.id === 'sheetA'), appData.role, appData.settings.name].join('|'));
  assert(t === 'true|office|Max Monteur' || t.startsWith('true|office'), `Tablet hat den Zettel, Rolle Büro: ${t}`, errors);

  // Tablet legt Auftrag mit PDF an → Handy bekommt beides
  await tablet.evaluate(async () => {
    await saveFile('file1', new Blob(['%PDF-1.4 Testinhalt'], { type: 'application/pdf' }));
    appData.jobs.push({ id: 'jobA', kind: 'montage', orderNo: 'SR26/000111', customer: 'Kunde A', vessel: 'MS A', engines: [{}], description: 'Bitte prüfen',
      files: [{ id: 'file1', name: 'Auftrag.pdf', type: 'application/pdf', size: 20 }], status: 'offen', assigned: ['Max Monteur'], slots: [], updatedAt: new Date().toISOString() });
    await saveData(true);
  });
  await sync(tablet);
  await sync(handy);
  t = await handy.evaluate(async () => { const b = await getFile('file1'); return [appData.jobs.some(j => j.id === 'jobA'), b ? await b.text() : 'fehlt'].join('|'); });
  assert(t === 'true|%PDF-1.4 Testinhalt', `Handy hat Auftrag + PDF: ${t}`, errors);

  // Handy ändert den Zettel → Tablet sieht die Änderung
  await handy.evaluate(async () => { const s = appData.sheets.find(x => x.id === 'sheetA'); s.days[0].entries[0].desc = 'Montage fertig'; s.updatedAt = new Date().toISOString(); await saveData(true); });
  await sync(handy);
  await sync(tablet);
  t = await tablet.evaluate(() => appData.sheets.find(s => s.id === 'sheetA').days[0].entries[0].desc);
  assert(t === 'Montage fertig', `Änderung angekommen: ${t}`, errors);

  // Konflikt: beide ändern denselben Auftrag, der neuere gewinnt
  await tablet.evaluate(async () => { const j = appData.jobs.find(x => x.id === 'jobA'); j.description = 'Tablet-Version'; j.updatedAt = new Date(Date.now() - 60000).toISOString(); await saveData(true); });
  await handy.evaluate(async () => { const j = appData.jobs.find(x => x.id === 'jobA'); j.description = 'Handy-Version (neuer)'; j.updatedAt = new Date().toISOString(); await saveData(true); });
  await sync(handy);
  await sync(tablet);
  await sync(handy);
  t = await Promise.all([handy, tablet].map(p => p.evaluate(() => appData.jobs.find(x => x.id === 'jobA').description)));
  assert(t[0] === 'Handy-Version (neuer)' && t[1] === 'Handy-Version (neuer)', `Konflikt: neuerer Stand gewinnt (${t.join(' / ')})`, errors);

  // Löschen wird übertragen
  await handy.evaluate(async () => { appData.sheets = appData.sheets.filter(s => s.id !== 'sheetA'); await saveData(true); });
  await sync(handy);
  await sync(tablet);
  t = await tablet.evaluate(() => appData.sheets.some(s => s.id === 'sheetA'));
  assert(t === false, 'Löschen übertragen', errors);

  // „Alle Daten löschen“ auf dem Tablet → nächster Abgleich holt alles zurück, auf dem Server bleibt alles
  t = await tablet.evaluate(async () => {
    await resetSyncTracking();
    const role = appData.role; appData = createDefaultData(); appData.role = role; await saveData(true);
    await runSync(false);
    return [appData.jobs.some(j => j.id === 'jobA'), appData.role].join('|');
  });
  assert(t === 'true|office', `Nach Zurücksetzen wieder da: ${t}`, errors);
  assert([...items.values()].some(r => r.key === 'job:jobA' && !r.deleted), 'Server-Daten nicht gelöscht', errors);

  // Server weg → App läuft weiter, Status „offline“
  const before = server.listening;
  t = await handy.evaluate(async () => { syncCfg.url = 'http://localhost:1'; const ok = await runSync(false); const st = syncState; syncCfg.url = location.origin; return [ok, st].join('|'); });
  assert(t === 'false|offline', `Offline sauber erkannt: ${t}`, errors);
  void before;

  await handy.evaluate(() => showView('settings'));
  await handy.screenshot({ path: path.join(ROOT, '.smoke', 'sync-einstellungen.png'), fullPage: true });

  await browser.close();
  server.close();
  if (errors.length) { console.log('FEHLER:\n' + errors.join('\n')); process.exit(1); }
  console.log(`OK – Sync zwischen zwei Geräten funktioniert (${items.size} Einträge, ${files.size} Datei auf dem Testserver).`);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
