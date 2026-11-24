// =====================================================================
// 10-settings: Einstellungen (Prüfer, Firma/Logo für den Kopf, eigene
// Unterschrift, Schnelleingabe), gemerkte Sollwerte, Sicherung/Import
// (inkl. Fotos), Auftrag als Datei, Beispielauftrag.
// =====================================================================

const APP_VERSION = '1.0';

function renderSettings() {
  const s = appData.settings;
  const specKeys = Object.keys(appData.specs || {});
  const body = document.getElementById('settings-body');
  body.innerHTML = `
    ${syncCardHtml()}
    <div class="card">
      <h3 class="card-title">Prüfer</h3>
      <div data-root="settings">
        ${field('Name (steht auf jedem Blatt)', 'name', s.name, { placeholder: 'Vor- und Nachname' })}
      </div>
      <div class="sub-block">
        <h4>Meine Unterschrift</h4>
        ${s.ownSignature ? `<div class="own-sign"><img src="${s.ownSignature}" alt="Unterschrift"></div>
          <div class="btn-row"><button class="btn btn-ghost" onclick="openSignaturePad('own')">Neu unterschreiben</button><button class="btn btn-ghost" onclick="removeOwnSignature()">Entfernen</button></div>`
        : `<p class="muted small-text">Einmal hinterlegen – wird beim Unterschreiben als Prüfer direkt eingesetzt.</p><button class="btn btn-soft" onclick="openSignaturePad('own')">Unterschrift hinterlegen</button>`}
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Kopf der Blätter</h3>
      <div data-root="settings">
      </div>
      <div class="logo-row">
        ${s.logo === '' ? '<span class="muted small-text">Ohne Logo</span>' : `<img class="logo-prev" src="${s.logo || DEFAULT_LOGO}" alt="Logo">`}
        <div class="btn-row">
          <button class="btn btn-soft" onclick="pickLogo()">Eigenes Logo hochladen</button>
          ${s.logo ? '<button class="btn btn-ghost" onclick="resetLogo()">SDT-Logo</button>' : ''}
          ${s.logo !== '' ? '<button class="btn btn-ghost" onclick="removeLogo()">Ohne Logo</button>' : '<button class="btn btn-ghost" onclick="resetLogo()">SDT-Logo</button>'}
        </div>
      </div>
      <p class="muted small-text">Das Logo steht mittig über dem Titel jedes Blatts.</p>
      <input type="file" id="logo-input" accept="image/*" hidden onchange="onLogoInput(event)">
    </div>

    <div class="card">
      <h3 class="card-title">Eingabe</h3>
      <label class="check"><input type="checkbox" ${s.quickInput ? 'checked' : ''} onchange="setQuickInput(this.checked)"> Schnelleingabe in µm bei Durchmessern</label>
      <p class="muted small-text">Ist ein Nennmaß eingetragen (z.B. 165,000), reicht beim Messen die Abweichung: <b>23</b> → 165,023 · <b>-8</b> → 164,992.</p>
      <div class="field"><span>Darstellung</span>
        <div class="seg">
          ${[['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => `<button type="button" class="${s.theme === v ? 'on' : ''}" onclick="setTheme('${v}')">${l}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Gemerkte Sollwerte</h3>
      ${specKeys.length ? `<div class="menu-rows">${specKeys.map(k => `
        <div class="menu-row"><span><b>${escapeHtml(k.toUpperCase())}</b><small>${escapeHtml(Object.keys(appData.specs[k]).map(t => getType(t).label).join(', '))}</small></span>
        <button class="icon-btn small danger-hover" onclick="deleteSpec('${escapeHtml(k)}')" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button></div>`).join('')}</div>`
      : `<p class="muted small-text">Im Messblatt bei „Sollwerte“ auf <b>★ merken</b> tippen – dann werden neue Blätter für denselben Motortyp automatisch vorausgefüllt.</p>`}
    </div>

    <div class="card">
      <h3 class="card-title">Daten sichern</h3>
      <p class="muted small-text">Alles wird automatisch auf diesem Gerät gespeichert. Für ein anderes Gerät oder zur Sicherheit eine Sicherung erstellen.</p>
      <div class="btn-row">
        <button class="btn btn-soft" onclick="exportBackup()">💾 Sicherung erstellen</button>
        <button class="btn btn-ghost" onclick="document.getElementById('import-input').click()">📂 Datei laden</button>
      </div>
      <p class="muted small-text">„Datei laden“ nimmt eine Sicherung oder einen einzelnen Auftrag (.json).</p>
    </div>

    ${!isStandalone() ? `<div class="card install-card"><h3 class="card-title">App installieren</h3><p class="muted small-text">Als App auf dem Startbildschirm – funktioniert dann auch offline.</p><button class="btn btn-primary" onclick="installApp()">Installieren</button></div>` : ''}

    <div class="card">
      <h3 class="card-title">Ausprobieren</h3>
      <button class="btn btn-ghost" onclick="createDemoOrder()">Beispielauftrag anlegen</button>
    </div>
    <p class="muted small-text version">Befunde ${APP_VERSION} · Service-App</p>`;
  bindForm(body, () => appData.settings, () => saveData());
  offerZettelJobLogin();
}

function setQuickInput(v) { appData.settings.quickInput = v; saveData(); }
function setTheme(v) { appData.settings.theme = v; applyTheme(); saveData(); renderSettings(); }
function removeOwnSignature() { appData.settings.ownSignature = null; saveData(true); renderSettings(); }
function pickLogo() { document.getElementById('logo-input').click(); }
async function onLogoInput(ev) {
  const f = ev.target.files[0];
  if (!f) return;
  const blob = await compressImage(f, 600, 0.9);
  appData.settings.logo = await blobToDataUrl(blob);
  appData.settings.logoUpdated = new Date().toISOString();
  saveData(true);
  renderSettings();
}
function removeLogo() { appData.settings.logo = ''; appData.settings.logoUpdated = new Date().toISOString(); saveData(true); renderSettings(); }
function resetLogo() { appData.settings.logo = null; appData.settings.logoUpdated = new Date().toISOString(); saveData(true); renderSettings(); }
async function deleteSpec(k) {
  if (!await confirmDialog('Gemerkte Sollwerte für ' + k.toUpperCase() + ' löschen?', 'Löschen', true)) return;
  delete appData.specs[k];
  appData.specsUpdated = new Date().toISOString();
  saveData(true);
  renderSettings();
}

// ---------- Export / Import ----------
function blobToDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
async function dataUrlToBlob(url) { return (await fetch(url)).blob(); }

async function filesFor(ids) {
  const files = {};
  for (const id of ids) {
    const b = await getFile(id).catch(() => null);
    if (b) files[id] = await blobToDataUrl(b);
  }
  return files;
}

function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function exportBackup() {
  flushSave();
  showToast('Sicherung wird erstellt …');
  const files = await filesFor(collectPhotoIds(appData.orders));
  downloadJson({ type: 'befunde-backup', version: 1, at: new Date().toISOString(), appData, files }, 'Befunde-Sicherung-' + todayISO() + '.json');
}

async function exportOrder() {
  const order = getActiveOrder();
  flushSave();
  const files = await filesFor(collectPhotoIds(order));
  downloadJson({ type: 'befunde-order', version: 1, at: new Date().toISOString(), order, files }, 'Befund-' + (order.orderNo || 'Auftrag').replace(/[\\/:]/g, '-') + '.json');
}

// Auswahl beim Backup laden: 'merge' (vorhandene behalten) | 'replace' | null (abbrechen)
function chooseImportMode(info) {
  return new Promise(resolve => {
    window.__importResolve = v => { closeModal(); resolve(v); };
    openModal(`
      <h2 class="modal-title">Backup laden</h2>
      <p class="modal-text muted">${escapeHtml(info)}</p>
      <div class="type-choice">
        <button class="type-btn current" onclick="__importResolve('merge')"><strong>Zusammenführen</strong>
          <span>Vorhandene Daten bleiben erhalten, aus dem Backup kommt dazu, was fehlt. Gibt es denselben Eintrag doppelt, gilt der neuere Stand.</span></button>
        <button class="type-btn" onclick="__importResolve('replace')"><strong>Ersetzen</strong>
          <span>Alle Daten auf diesem Gerät werden durch das Backup ersetzt.</span></button>
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="__importResolve(null)">Abbrechen</button></div>`);
  });
}

// Sicherung in die vorhandenen Aufträge einfügen: neue Aufträge dazu; gleicher Auftrag → Blätter
// zusammenführen (gleiche ID: neuerer Stand nach updated gewinnt), Kopf nach updated
function mergeBackupOrders(inc) {
  const stats = { added: 0, updated: 0, kept: 0 };
  const ts = x => Date.parse((x && (x.updated || x.created)) || '') || 0;
  (inc.orders || []).forEach(o => {
    const cur = appData.orders.find(x => x.id === o.id);
    if (!cur) { appData.orders.push(o); stats.added++; return; }
    const sheets = cur.sheets.slice();
    let changed = false;
    (o.sheets || []).forEach(sh => {
      const i = sheets.findIndex(x => x.id === sh.id);
      if (i < 0) { sheets.push(sh); changed = true; }
      else if (ts(sheets[i]) && ts(sh) > ts(sheets[i])) { sheets[i] = sh; changed = true; }
    });
    if (ts(cur) && ts(o) > ts(cur)) { Object.assign(cur, o, { sheets }); changed = true; } else cur.sheets = sheets;
    if (changed) stats.updated++; else stats.kept++;
  });
  // gemerkte Sollwerte: fehlende ergänzen
  Object.keys(inc.specs || {}).forEach(k => { appData.specs[k] = Object.assign({}, inc.specs[k], appData.specs[k] || {}); });
  return stats;
}

async function onImportInput(ev) {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch (e) { showToast('Datei ist keine gültige Sicherung'); return; }
  const writeFiles = async files => { for (const id of Object.keys(files || {})) await saveFile(id, await dataUrlToBlob(files[id])); };
  if (data.type === 'befunde-order' && data.order) {
    const o = normalizeOrder(data.order);
    const exists = appData.orders.find(x => x.id === o.id);
    if (exists) {
      if (!await confirmDialog('Auftrag ' + (o.orderNo || '') + ' gibt es schon. Durch die Datei ersetzen?', 'Ersetzen', true)) return;
      appData.orders = appData.orders.filter(x => x.id !== o.id);
    }
    await writeFiles(data.files);
    appData.orders.push(o);
    saveData(true);
    showToast('Auftrag ' + (o.orderNo || '') + ' geladen');
    openReportView(o.id, 'report');
    return;
  }
  if (data.type === 'befunde-backup' && data.appData) {
    const mode = await chooseImportMode('Sicherung vom ' + new Date(data.at).toLocaleString('de-DE') + ' mit ' + ((data.appData.orders || []).length) + ' Auftrag/Aufträgen. Wie soll sie geladen werden?');
    if (!mode) return;
    await writeFiles(data.files);
    let stats = null;
    if (mode === 'merge') stats = mergeBackupOrders(normalizeData(data.appData));
    else {
      appData = normalizeData(data.appData);
      await resetSyncTracking(); // mit dem Server zusammenführen statt dort zu löschen
    }
    saveData(true);
    applyTheme();
    showView('orders');
    showToast(stats ? `Zusammengeführt: ${stats.added} Aufträge neu, ${stats.updated} ergänzt/aktualisiert, ${stats.kept} unverändert` : 'Sicherung geladen (ersetzt)');
    return;
  }
  showToast('Unbekanntes Dateiformat');
}

// ---------- Beispielauftrag ----------
function createDemoOrder() {
  const order = newOrder({
    orderNo: 'SR' + todayISO().slice(2, 4) + '/000815', customer: 'Muster Reederei', vessel: 'MS Beispiel', location: 'Werft Hafen',
    reason: 'Durchsicht nach 15.000 Bh, erhöhter Ölverbrauch', demo: true,
    newbuild: 'S 1234', classification: 'DNV',
    engines: [Object.assign(newEngine(), { make: 'MTU', model: '16V 4000 M63', number: '5362001234', hours: '15120', power: '2560', rpm: '1800', layout: 'V', cylinders: 16, count: 'KS' })]
  });
  const lb = createSheet(order, 'liner', 'beides', 0);
  lb.data.tool = 'Innenmessgerät (Messuhr)';
  lb.data.temp = '20';
  lb.data.lb = { spec: { nom: '170,000', min: '170,000', max: '170,040', wear: '170,100', ovalMax: '0,030', conMax: '0,030' }, rows: {} };
  const demoVals = { A1: [12, 18, 10, 14, 8, 9], A2: [22, 35, 15, 20, 10, 12], A3: [48, 95, 30, 60, 14, 18], A4: [15, 20, 12, 14, 9, 10] };
  Object.keys(demoVals).forEach(p => {
    const v = demoVals[p];
    lb.data.lb.rows[p] = { I_L: formatNum(170 + v[0] / 1000), I_Q: formatNum(170 + v[1] / 1000), II_L: formatNum(170 + v[2] / 1000), II_Q: formatNum(170 + v[3] / 1000), III_L: formatNum(170 + v[4] / 1000), III_Q: formatNum(170 + v[5] / 1000) };
  });
  lb.data.lbi = { rows: { A1: { rating: 'ok', tags: ['Honbild i.O.'] }, A2: { rating: 'ok' }, A3: { rating: 'bad', tags: ['Polierstellen (Bore Polishing)', 'Längsriefen'], note: 'Riefen auf Druckseite' }, A4: { rating: 'ok' } } };
  const en = createSheet(order, 'endoscopy', null, 0);
  en.data.scope = 'Videoendoskop';
  en.data.access = 'Einspritzdüsenbohrung';
  en.data.cyl = { A1: { rating: 'ok', tags: ['Honbild i.O.', 'Kolbenboden i.O.'] }, A3: { rating: 'bad', tags: ['Polierstellen', 'Öl im Brennraum'], note: 'deutliche Polierstellen, Ölfilm' }, B2: { rating: 'obs', tags: ['Ablagerungen Kolben'] } };
  const gen = createSheet(order, 'general', null, 0);
  gen.findings.push({ id: uid(), part: 'Turbolader B', text: 'Ölspuren am Verdichteraustritt', rating: 'obs', action: 'beobachten, bei nächster Wartung prüfen', photos: [] });
  gen.data.check = { 0: { rating: 'ok' }, 1: { rating: 'obs', note: 'leicht ölfeucht an Ölwanne' }, 2: { rating: 'ok' } };
  createSheet(order, 'serials', null, 0);
  saveData(true);
  closeModal();
  openOrder(order.id);
  showToast('Beispielauftrag angelegt');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('import-input').addEventListener('change', onImportInput);
});

Object.assign(window, { setQuickInput, setTheme, removeOwnSignature, pickLogo, onLogoInput, removeLogo, resetLogo, deleteSpec, exportBackup, exportOrder, createDemoOrder , chooseImportMode });
