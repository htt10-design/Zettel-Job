// Sync-Test: getrennte Browser („Handy“ = Monteur, „Büro“ = PC) gleichen über einen
// nachgebauten PocketBase-Server ab (nur die Endpunkte, die die App nutzt).
// Prüft: Auftrag + Blätter + Fotos, gleichzeitiges Arbeiten an verschiedenen Blättern,
// Konflikt (neuerer gewinnt), Löschen, Beispielauftrag bleibt lokal, Anmeldung von
// Zettel-Job übernehmen, Offline-Erkennung.
// Aufruf:  node tools/sync-test.js
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, '.smoke', 'befunde');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// ---------- Mini-PocketBase (bf_items / bf_files) ----------
const items = new Map();
const files = new Map();
let clock = Date.parse('2026-11-15T10:00:00Z');
const stamp = () => new Date(clock += 7).toISOString().replace('T', ' ');
const TOKEN = 'tok-123';

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise(r => { const c = []; req.on('data', x => c.push(x)); req.on('end', () => r(Buffer.concat(c))); });
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
  if (p === '/api/collections/bf_items/records' && req.method === 'GET') {
    const since = ((url.searchParams.get('filter') || '').match(/updated >= "([^"]+)"/) || [])[1] || '';
    const list = [...items.values()].filter(r => !since || r.updated >= since).sort((a, b) => a.updated.localeCompare(b.updated));
    const per = +url.searchParams.get('perPage') || 30, page = +url.searchParams.get('page') || 1;
    return send(res, 200, { items: list.slice((page - 1) * per, page * per) });
  }
  if ((m = p.match(/^\/api\/collections\/bf_items\/records\/([a-z0-9]{15})$/)) && req.method === 'PATCH') {
    const rec = items.get(m[1]);
    if (!rec) return send(res, 404, { message: 'not found' });
    Object.assign(rec, JSON.parse((await readBody(req)).toString()), { updated: stamp() });
    return send(res, 200, rec);
  }
  if (p === '/api/collections/bf_items/records' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString());
    if (!/^[a-z0-9]{15}$/.test(b.id || '')) return send(res, 400, { message: 'bad id' });
    if ([...items.values()].some(r => r.key === b.key)) return send(res, 400, { message: 'key exists' });
    items.set(b.id, Object.assign({}, b, { created: stamp(), updated: stamp() }));
    return send(res, 200, items.get(b.id));
  }
  if (p === '/api/collections/bf_files/records' && req.method === 'POST') {
    const raw = await readBody(req);
    const txt = raw.toString('latin1');
    const fileId = (txt.match(/name="fileId"\r\n\r\n([^\r]+)/) || [])[1];
    if ([...files.values()].some(f => f.fileId === fileId)) return send(res, 400, { message: 'exists' });
    const head = txt.indexOf('name="file"; filename=');
    const start = txt.indexOf('\r\n\r\n', head) + 4;
    const end = txt.indexOf('\r\n--', start);
    const id = 'f' + String(files.size).padStart(14, '0');
    files.set(id, { id, fileId, file: 'foto.jpg', data: raw.subarray(start, end), updated: stamp() });
    return send(res, 200, { id, fileId, file: 'foto.jpg' });
  }
  if (p === '/api/collections/bf_files/records' && req.method === 'GET') {
    const fid = ((url.searchParams.get('filter') || '').match(/fileId = "([^"]+)"/) || [])[1];
    return send(res, 200, { items: [...files.values()].filter(f => f.fileId === fid).map(({ data, ...r }) => r) });
  }
  if ((m = p.match(/^\/api\/files\/bf_files\/([^/]+)\//))) {
    const f = files.get(m[1]);
    return f ? send(res, 200, f.data, 'image/jpeg') : send(res, 404, { message: 'nf' });
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
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];

  async function newDevice(label) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
    page.on('dialog', d => d.accept());
    await page.goto(base + '/befunde/index.html');
    await page.waitForFunction(() => typeof appData !== 'undefined' && appData);
    return page;
  }
  async function login(page) {
    await page.evaluate(() => showView('settings'));
    await page.fill('#sync-url', base);
    await page.fill('#sync-email', 'test@example.com');
    await page.fill('#sync-pass', 'geheim');
    await page.click('.sync-card .btn-primary');
    await page.waitForFunction(() => syncState === 'idle' || syncState === 'error' || syncState === 'offline', null, { timeout: 8000 });
  }
  const sync = page => page.evaluate(() => runSync(false));

  // Handy (Monteur): Auftrag mit Laufbuchsen-Blatt + Foto, Beispielauftrag
  const handy = await newDevice('Handy');
  await handy.evaluate(async () => {
    const o = newOrder({ orderNo: 'SR26/000111', customer: 'Kunde A', vessel: 'MS A',
      engines: [Object.assign(newEngine(), { model: '16V 4000 M63', number: '123', cylinders: 16 })] });
    activeOrderId = o.id;
    const s = createSheet(o, 'liner', 'beides', 0);
    s.data.lb = { spec: { min: '170,000', max: '170,040' }, rows: { A1: { I_L: '170,012', I_Q: '170,018' } } };
    await saveFile('ph_test1', new Blob(['JPEGDATA-123'], { type: 'image/jpeg' }));
    s.findings.push({ id: 'f1', part: 'Laufbuchse A1', text: 'Riefen', rating: 'obs', action: '', photos: ['ph_test1'] });
    window.__orderId = o.id; window.__sheetA = s.id;
    createDemoOrder();
    activeOrderId = o.id;
    await saveData(true);
  });
  await login(handy);
  const keys = [...items.values()].map(r => r.key);
  assert(keys.some(k => k.startsWith('order:')) && keys.some(k => k.startsWith('sheet:')), 'Auftrag und Blatt liegen auf dem Server: ' + keys.join(', '), errors);
  assert(keys.filter(k => k.startsWith('order:')).length === 1, 'Beispielauftrag bleibt lokal', errors);
  assert(keys.includes('team:specs') && keys.includes('team:settings'), 'Team-Einstellungen auf dem Server', errors);
  assert([...files.values()].some(f => f.fileId === 'ph_test1'), 'Foto liegt auf dem Server', errors);
  const orderRec = [...items.values()].find(r => r.key.startsWith('order:'));
  assert(orderRec && !('sheets' in orderRec.data) && Array.isArray(orderRec.data.sheetIds), 'Auftragskopf ohne Blätter, mit Reihenfolge', errors);

  // Büro meldet sich an → hat Auftrag, Blatt, Foto; Bericht lässt sich ansehen
  const buero = await newDevice('Büro');
  await login(buero);
  let t = await buero.evaluate(async () => {
    const o = appData.orders.find(x => x.orderNo === 'SR26/000111');
    const b = await getFile('ph_test1');
    return [!!o, o && o.sheets.length, o && o.sheets[0].data.lb.rows.A1.I_L, b ? await b.text() : 'fehlt', appData.orders.length].join('|');
  });
  assert(t === 'true|1|170,012|JPEGDATA-123|1', `Büro hat Auftrag, Blatt, Messwert, Foto (ohne Beispiel): ${t}`, errors);
  await buero.evaluate(() => openReportView(appData.orders[0].id, 'report'));
  await buero.waitForSelector('#view-report.active #paper .pr-page', { timeout: 8000 }).catch(() => errors.push('Büro: Bericht nicht sichtbar'));

  // Gleichzeitig: Handy ändert Blatt A, Büro legt Blatt B an → beide haben beides
  await handy.evaluate(async () => { const s = getActiveOrder().sheets[0]; s.data.lb.rows.A2 = { I_L: '170,020' }; s.updated = new Date().toISOString(); await saveData(true); });
  await buero.evaluate(async () => { const o = appData.orders[0]; activeOrderId = o.id; const s = createSheet(o, 'endoscopy', null, 0); s.data.cyl = { A1: { rating: 'ok' } }; window.__sheetB = s.id; await saveData(true); });
  await sync(handy); await sync(buero); await sync(handy);
  t = await Promise.all([handy, buero].map(p => p.evaluate(() => { const o = appData.orders.find(x => x.orderNo === 'SR26/000111'); return [o.sheets.length, (o.sheets.find(s => s.type === 'liner').data.lb.rows.A2 || {}).I_L, o.sheets.map(s => s.type).join('+')].join('|'); })));
  assert(t[0] === '2|170,020|liner+endoscopy' && t[1] === t[0], `Gleichzeitiges Arbeiten an zwei Blättern: ${t.join(' / ')}`, errors);

  // Konflikt am selben Blatt: neuerer Stand gewinnt
  await buero.evaluate(async () => { const s = appData.orders[0].sheets.find(x => x.type === 'liner'); s.summary = 'Büro (älter)'; s.updated = new Date(Date.now() - 60000).toISOString(); await saveData(true); });
  await handy.evaluate(async () => { const s = getActiveOrder().sheets.find(x => x.type === 'liner'); s.summary = 'Handy (neuer)'; s.updated = new Date().toISOString(); await saveData(true); });
  await sync(handy); await sync(buero); await sync(handy);
  t = await Promise.all([handy, buero].map(p => p.evaluate(() => appData.orders.find(x => x.orderNo === 'SR26/000111').sheets.find(x => x.type === 'liner').summary)));
  assert(t[0] === 'Handy (neuer)' && t[1] === 'Handy (neuer)', `Konflikt: neuerer Stand gewinnt (${t.join(' / ')})`, errors);

  // Fazit im Büro schreiben → Handy bekommt es
  await buero.evaluate(async () => { const o = appData.orders[0]; o.reportSummary = 'Motor gut'; o.updated = new Date().toISOString(); await saveData(true); });
  await sync(buero); await sync(handy);
  t = await handy.evaluate(() => getActiveOrder().reportSummary);
  assert(t === 'Motor gut', `Fazit vom Büro beim Monteur: ${t}`, errors);

  // Blatt löschen wird übertragen
  await handy.evaluate(async () => { const o = getActiveOrder(); o.sheets = o.sheets.filter(s => s.type !== 'endoscopy'); await saveData(true); });
  await sync(handy); await sync(buero);
  t = await buero.evaluate(() => appData.orders[0].sheets.map(s => s.type).join('+'));
  assert(t === 'liner', `Löschen übertragen: ${t}`, errors);

  // Drittes Gerät: Zettel-Job ist dort schon angemeldet → Anmeldung übernehmen
  const tablet = await newDevice('Tablet');
  await tablet.evaluate(b => new Promise((res, rej) => {
    const r = indexedDB.open('zettel-job', 2);
    r.onupgradeneeded = () => { r.result.createObjectStore('store'); r.result.createObjectStore('files'); };
    r.onsuccess = () => { const tx = r.result.transaction('store', 'readwrite'); tx.objectStore('store').put({ url: b, email: 'test@example.com', token: 'tok-123', userId: 'user1' }, 'syncConfig'); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
    r.onerror = () => rej(r.error);
  }), base);
  await tablet.evaluate(() => showView('settings'));
  await tablet.waitForSelector('.zj-login', { timeout: 5000 }).catch(() => errors.push('Tablet: Angebot „Anmeldung von Zettel-Job übernehmen“ fehlt'));
  await tablet.screenshot({ path: path.join(OUT, 'sync-zj-angebot.png'), fullPage: false });
  await tablet.click('.zj-login').catch(() => {});
  await tablet.waitForFunction(() => appData.orders.some(o => o.orderNo === 'SR26/000111'), null, { timeout: 8000 }).catch(() => errors.push('Tablet: nach Übernahme keine Daten'));

  // Server weg → App läuft weiter, Status „offline“
  t = await handy.evaluate(async () => { const u = syncCfg.url; syncCfg.url = 'http://localhost:1'; const ok = await runSync(false); const st = syncState; syncCfg.url = u; return [ok, st].join('|'); });
  assert(t === 'false|offline', `Offline sauber erkannt: ${t}`, errors);
  await handy.evaluate(() => runSync(false));

  await handy.evaluate(() => showView('settings'));
  await handy.screenshot({ path: path.join(OUT, 'sync-einstellungen.png'), fullPage: false });

  await browser.close();
  server.close();
  if (errors.length) { console.log('FEHLER:\n' + errors.join('\n')); process.exit(1); }
  console.log(`OK – Sync zwischen Geräten funktioniert (${items.size} Einträge, ${files.size} Foto(s) auf dem Testserver).`);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
