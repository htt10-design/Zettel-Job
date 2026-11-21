// =====================================================================
// 13-demo: Demo-Modus mit Beispieldaten zum Vorführen
// - Echte Daten werden vorher unter einem eigenen Schlüssel in IndexedDB
//   gesichert und beim Beenden unverändert zurückgeholt.
// - Beispieldaten liegen immer relativ zu „heute“ (aktuelle und
//   benachbarte Wochen), damit Startseite und Plan sofort gefüllt sind.
// =====================================================================

const ZJ_DEMO_BACKUP_KEY = 'appDataBeforeDemo';

function isDemo() { return !!(appData && appData.demo); }

async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ZJ_DB_STORE, 'readwrite');
    tx.objectStore(ZJ_DB_STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ZJ_DB_STORE, 'readonly');
    const req = tx.objectStore(ZJ_DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ZJ_DB_STORE, 'readwrite');
    tx.objectStore(ZJ_DB_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Beispieldaten ----------
function buildDemoData() {
  const d = createDefaultData();
  const today = todayISO();
  const mon = weekStartISO(today);
  const day = (weekOffset, wd) => addDaysISO(mon, weekOffset * 7 + wd); // wd: 0 = Mo … 6 = So
  const past = iso => iso < today;
  let n = 0;
  const id = () => 'demo' + (++n);

  d.demo = true;
  d.role = 'tech';
  Object.assign(d.settings, {
    name: 'Jan Becker', officeName: 'Sabine Kraft', home: 'Hamburg', plate: 'HH-SR 412', startBalance: 6.5
  });
  d.technicians = [
    { id: id(), name: 'Jan Becker', phone: '0151 2345678' },
    { id: id(), name: 'Lena Hoffmann', phone: '0160 9876543' },
    { id: id(), name: 'Tom Schröder', phone: '0172 5551234' },
    { id: id(), name: 'Ali Yilmaz', phone: '0157 4433221' }
  ];

  const mtu = [
    { name: 'BB', make: 'MTU', model: '16V 4000 M63', number: '5362004417', hours: '18240' },
    { name: 'SB', make: 'MTU', model: '16V 4000 M63', number: '5362004418', hours: '18195' }
  ];
  const job = (o) => Object.assign({ id: id(), createdAt: new Date().toISOString(), createdBy: 'Sabine Kraft', files: [], status: 'offen', assigned: [], slots: [], engines: [{}], planFrom: '', planTo: '' }, o);
  const slot = (name, from, to) => ({ id: id(), name, from, to: to || from });

  const jNord = job({
    kind: 'montage', orderNo: 'SR26/000412', customer: 'Reederei Nordlicht GmbH', vessel: 'MS Nordlicht',
    engines: JSON.parse(JSON.stringify(mtu)),
    description: 'Inspektion W5 an beiden Hauptmotoren.\nEinspritzventile tauschen, Ventilspiel prüfen, Probelauf mit Kunde.\nLiegeplatz: Kiel, Schwedenkai 1. Ansprechpartner: Kapitän Behrens.',
    assigned: ['Jan Becker', 'Tom Schröder'],
    slots: [slot('Jan Becker', day(0, 0), day(0, 3)), slot('Tom Schröder', day(0, 0), day(0, 2))]
  });
  const jKiel = job({
    kind: 'werkstatt', orderNo: 'SR26/000418', customer: 'Hafenbetriebe Kiel',
    engines: [{ make: 'MAN', model: 'D2862 LE', number: 'MAN-77120', hours: '9410' }],
    description: 'Zylinderköpfe überholen, Ventilsitze nacharbeiten.',
    assigned: ['Lena Hoffmann', 'Jan Becker'],
    slots: [slot('Lena Hoffmann', day(0, 0), day(0, 4)), slot('Jan Becker', day(0, 4))]
  });
  const jSee = job({
    kind: 'mix', orderNo: 'SR26/000425', customer: 'Helgoland Line', vessel: 'MS Seestern',
    engines: [{ make: 'Caterpillar', model: '3512C', number: 'CAT-3512-0098', hours: '22110' }],
    description: 'Turbolader-Tausch vor Ort, Altteil anschließend in der Werkstatt befunden.',
    assigned: ['Jan Becker', 'Ali Yilmaz'],
    slots: [slot('Jan Becker', day(1, 0), day(1, 1)), slot('Ali Yilmaz', day(1, 0), day(1, 2))]
  });
  const jBaltic = job({
    kind: 'montage', orderNo: 'SR26/000431', customer: 'Werft Rostock', vessel: 'Tanker Baltic Star',
    description: 'Generator-Motor startet nicht zuverlässig – Fehlersuche.'
  });
  const jOld = job({
    kind: 'montage', orderNo: 'SR26/000398', customer: 'Fischerei Albers', vessel: 'FK Möwe', status: 'erledigt',
    engines: [{ make: 'Deutz', model: 'TBD 620', number: 'DZ-620-1187', hours: '31020' }],
    assigned: ['Jan Becker'], slots: [slot('Jan Becker', day(-1, 0), day(-1, 3))]
  });
  d.jobs = [jNord, jKiel, jSee, jBaltic, jOld];

  // ---- Zettel ----
  const e = (from, to, code, desc, cost) => ({ id: id(), from, to, code, desc: desc || '', ...(cost !== undefined ? { cost } : {}) });
  const montage = (worker, date, j, entries, extra) => Object.assign({
    id: id(), type: 'montage', createdAt: date + 'T18:00:00.000Z', updatedAt: date + 'T18:00:00.000Z', worker,
    orderNo: j.orderNo, customer: j.customer, vessel: j.vessel, engines: JSON.parse(JSON.stringify(j.engines)),
    days: [{ id: id(), date, entries, away: '24h', hotel: true, hotelName: 'Hotel Kieler Förde', breakfast: true }],
    travelOut: { on: false }, travelBack: { on: false }, material: null, materialNote: '', finished: null, note: '',
    signCustomer: null, signWorker: null
  }, extra || {});
  const werkstatt = (worker, date, entries) => ({
    id: id(), type: 'werkstatt', createdAt: date + 'T16:00:00.000Z', updatedAt: date + 'T16:00:00.000Z', worker,
    orderNo: '', customer: '', vessel: '', engines: [{}],
    days: [{ id: id(), date, entries, away: '', hotel: false, hotelName: '', breakfast: null }],
    travelOut: {}, travelBack: {}, material: null, materialNote: '', finished: null, note: '', signCustomer: null, signWorker: null
  });
  const sig = (name, date) => ({ img: DEMO_SIGNATURE, name, at: date + 'T16:30:00.000Z' });
  const travel = (from, to, km, dur) => ({ on: true, from, to, km, duration: dur, vehicle: 'Firmenwagen', plate: 'HH-SR 412' });
  const sheets = [];

  // Jan, letzte Woche: FK Möwe (erledigt)
  sheets.push(montage('Jan Becker', day(-1, 0), jOld, [
    e('08:30', '12:00', 'AZ', 'Motor geöffnet, Befund Kurbeltrieb'), e('12:00', '12:30', 'P'), e('12:30', '17:00', 'AZ', 'Pleuellager vermessen')
  ], { travelOut: travel('Hamburg', 'Cuxhaven', '118', '1:45'), signCustomer: sig('H. Albers', day(-1, 0)), signWorker: sig('Jan Becker', day(-1, 0)), material: true, materialNote: '2x Pleuellagerschale' }));
  sheets.push(montage('Jan Becker', day(-1, 1), jOld, [
    e('07:00', '12:00', 'AZ', 'Lager getauscht'), e('12:00', '12:30', 'P'), e('12:30', '16:30', 'AZ', 'Zusammenbau')
  ], { signCustomer: sig('H. Albers', day(-1, 1)) }));
  sheets.push(montage('Jan Becker', day(-1, 2), jOld, [
    e('07:00', '11:30', 'AZ', 'Probelauf, Einstellarbeiten'), e('11:30', '12:00', 'P'), e('12:00', '14:00', 'AZ', 'Übergabe an Kunde')
  ], { travelBack: travel('Cuxhaven', 'Hamburg', '118', '1:45'), finished: true, signCustomer: sig('H. Albers', day(-1, 2)) }));
  sheets.push(werkstatt('Jan Becker', day(-1, 3), [
    e('07:00', '09:00', 'AZ', 'Werkzeug geprüft', '14'), e('09:00', '09:15', 'AZ', '', 'P'), e('09:15', '15:00', 'AZ', 'Bericht FK Möwe', '208')
  ]));
  sheets.push(werkstatt('Jan Becker', day(-1, 4), [e('07:00', '12:00', 'AZ', 'Lager aufgeräumt', '16')]));

  // Jan, diese Woche: MS Nordlicht (bis gestern), Lücke am Mittwoch wenn schon vorbei
  [0, 1, 3].forEach((wd, i) => {
    const date = day(0, wd);
    if (!past(date)) return;
    const s = montage('Jan Becker', date, jNord, wd === 0 ? [
      e('09:00', '12:00', 'AZ', 'Motor BB: Ventildeckel ab, Ventilspiel'), e('12:00', '12:30', 'P'), e('12:30', '17:30', 'AZ', 'Einspritzventile BB getauscht')
    ] : [
      e('07:00', '12:00', 'AZ', 'Motor SB: Einspritzventile getauscht'), e('12:00', '12:30', 'P'), e('12:30', '16:00', 'AZ', 'Ventilspiel SB')
    ], i === 0 ? { travelOut: travel('Hamburg', 'Kiel', '96', '1:30') } : {});
    s.engines[0].hours = String(18240 + i * 6);
    s.engines[1].hours = String(18195 + i * 6);
    if (i === 0) s.signCustomer = sig('Kapitän Behrens', date);
    sheets.push(s);
  });

  // Kollegen (für die Büro-Ansicht)
  [0, 1, 2].forEach(wd => {
    const date = day(0, wd);
    if (!past(date)) return;
    sheets.push(montage('Tom Schröder', date, jNord, [e('07:00', '12:00', 'AZ', 'Unterstützung Motor BB'), e('12:00', '12:30', 'P'), e('12:30', '16:00', 'AZ', 'Filter gewechselt')]));
  });
  [0, 1, 2, 3, 4].forEach(wd => {
    const date = day(0, wd);
    if (!past(date)) return;
    sheets.push(werkstatt('Lena Hoffmann', date, [e('07:00', '12:00', 'AZ', 'Zylinderköpfe', 'SR26/000418'), e('12:00', '12:30', 'AZ', '', 'P'), e('12:30', '15:30', 'AZ', 'Ventilsitze', 'SR26/000418')]));
  });
  d.sheets = sheets;

  // Abwesenheiten
  d.daysOff = [
    { id: id(), date: day(0, 2), type: 'krank', note: '', worker: 'Ali Yilmaz' },
    { id: id(), date: day(1, 3), type: 'urlaub', note: '', worker: 'Ali Yilmaz' },
    { id: id(), date: day(1, 4), type: 'urlaub', note: '', worker: 'Ali Yilmaz' },
    { id: id(), date: day(1, 4), type: 'abbau', note: 'Brückentag', worker: 'Jan Becker' }
  ];
  return normalizeData(d);
}

// Kleine Beispiel-Unterschrift (SVG als Data-URL)
const DEMO_SIGNATURE = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60"><path d="M8 42c18-26 28-30 32-18s-8 22 4 14 16-30 26-18-4 20 8 14 14-18 24-10 6 12 18 6 16-10 26-6 10 8 22 2 20-10 30-8" fill="none" stroke="#0b2a4a" stroke-width="2.4" stroke-linecap="round"/></svg>');

// ---------- Starten / Beenden ----------
async function startDemo() {
  const ok = await confirmDialog('Demo mit Beispieldaten starten? Deine echten Daten werden sicher zur Seite gelegt und beim Beenden der Demo unverändert wiederhergestellt.', 'Demo starten');
  if (!ok) return;
  flushSave();
  if (!isDemo()) await idbPut(ZJ_DEMO_BACKUP_KEY, JSON.parse(JSON.stringify(appData)));
  appData = buildDemoData();
  await saveData(true);
  afterDataSwap();
  showView('sheets');
  showToast('Demo gestartet – angemeldet als Monteur Jan Becker');
}

async function endDemo() {
  const ok = await confirmDialog('Demo beenden? Die Beispieldaten werden verworfen und deine echten Daten wiederhergestellt.', 'Demo beenden');
  if (!ok) return;
  const backup = await idbGet(ZJ_DEMO_BACKUP_KEY).catch(() => null);
  appData = backup ? normalizeData(backup) : createDefaultData();
  await saveData(true);
  await idbDelete(ZJ_DEMO_BACKUP_KEY).catch(() => {});
  afterDataSwap();
  showView(appData.role === 'office' ? 'jobs' : 'sheets');
  if (!appData.role) openRoleChooser();
  showToast('Demo beendet – deine Daten sind wieder da');
}

function afterDataSwap() {
  if (typeof homeSelected !== 'undefined') { homeSelected = null; homeWeekStart = null; homeShowList = false; }
  if (typeof planWeekStart !== 'undefined') planWeekStart = null;
  applyTheme();
  applyRole();
  closeModal();
  renderDemoBanner();
}

function renderDemoBanner() {
  const el = document.getElementById('demo-banner');
  if (!el) return;
  el.hidden = !isDemo();
  document.body.classList.toggle('is-demo', isDemo());
}

window.startDemo = startDemo;
window.endDemo = endDemo;
window.renderDemoBanner = renderDemoBanner;
