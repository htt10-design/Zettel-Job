// =====================================================================
// 08-settings: Persönliche Daten, Sollzeiten, Zeitarten (erweiterbar),
// eigene Unterschrift, Darstellung, Backup Export/Import
// =====================================================================

let costListOpen = false; // Kostenstellen-Liste aufgeklappt?
let codesListOpen = false; // Zeitarten-Liste aufgeklappt?

function renderSettings() {
  const s = appData.settings;
  const theme = s.theme || 'auto';
  const wdOrder = [1, 2, 3, 4, 5, 6, 0];

  const office = isOffice();
  const staffRec = !office ? currentStaffRecord() : null;
  const managed = !!(staffRec && (Array.isArray(staffRec.targets) || (staffRec.startBalance !== undefined && staffRec.startBalance !== '') || staffRec.startDate));
  document.getElementById('settings-body').innerHTML = `
    <div class="card login-card">
      <div>
        <span class="muted small-text">Angemeldet als</span>
        <b>${office ? 'Sachbearbeiter' : 'Servicetechniker'}${currentUserName() ? ' – ' + escapeHtml(currentUserName()) : ''}</b>
      </div>
      <button class="btn btn-soft" onclick="openRoleChooser()">Rolle wechseln</button>
    </div>

    ${isStandalone() ? '' : `<div class="card install-card">
      <div><b>Als App installieren</b><span class="muted small-text">Eigenes Symbol, ohne Browserleiste, offline nutzbar</span></div>
      <button class="btn btn-primary" onclick="installApp()">${installPromptEvent ? 'Jetzt installieren' : 'So geht’s'}</button>
    </div>`}

    ${office ? `<div class="card">
      <h3 class="card-title">Meine Daten</h3>
      <label class="field"><span>Name (Sachbearbeiter)</span><input type="text" value="${escapeHtml(s.officeName || '')}" onchange="setSetting('officeName', this.value); applyRole()" placeholder="Vor- und Nachname"></label>
    </div>
    ${techniciansHtml()}` : ''}

    <div class="card tech-only">
      <h3 class="card-title">Meine Daten</h3>
      <div class="grid-2">
        <label class="field"><span>Name (Monteur)</span><input type="text" value="${escapeHtml(s.name)}" onchange="setSetting('name', this.value)" placeholder="Vor- und Nachname"></label>
        <label class="field"><span>Standort (SDT)</span><input type="text" value="${escapeHtml(s.home)}" onchange="setSetting('home', this.value)" placeholder="Ort für Anfahrt"></label>
        <label class="field span-2"><span>Kennzeichen Firmenwagen</span><input type="text" value="${escapeHtml(s.plate)}" onchange="setSetting('plate', this.value)" placeholder="wird bei neuen Zetteln vorgeschlagen"></label>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Darstellung</h3>
      <div class="seg wide">
        <button class="${theme === 'light' ? 'on' : ''}" onclick="setTheme('light')">Hell</button>
        <button class="${theme === 'dark' ? 'on' : ''}" onclick="setTheme('dark')">Dunkel</button>
        <button class="${theme === 'auto' ? 'on' : ''}" onclick="setTheme('auto')">Automatisch</button>
      </div>
    </div>

    <div class="card tech-only">
      <h3 class="card-title">Arbeitszeit &amp; Überstunden</h3>
      <p class="muted small-text">Sollstunden je Wochentag. Alles darüber zählt als Überstunden.</p>
      ${managed ? `<p class="managed-note">Vom Büro festgelegt${staffRec.startDate ? ' · Eintritt ' + formatDate(staffRec.startDate, false) : ''}.</p>` : ''}
      <div class="target-grid">
        ${wdOrder.map(i => `
          <label class="field"><span>${WEEKDAYS_SHORT[i]}</span>
            <input type="text" inputmode="decimal" value="${String(s.targets[i]).replace('.', ',')}" onchange="setTarget(${i}, this.value)" ${managed ? 'disabled' : ''}>
          </label>`).join('')}
      </div>
      <div class="pause-setting">
        <label class="check"><input type="checkbox" ${(s.workshopPause || {}).on ? 'checked' : ''} onchange="setWorkshopPause('on', this.checked)"><span>Werkstattzettel mit Pause vorbelegen</span></label>
        <div class="pause-times">
          <input type="text" inputmode="numeric" value="${escapeHtml((s.workshopPause || {}).from || '')}" onchange="setWorkshopPause('from', this.value)" aria-label="Pause von" ${(s.workshopPause || {}).on ? '' : 'disabled'}>
          <span>–</span>
          <input type="text" inputmode="numeric" value="${escapeHtml((s.workshopPause || {}).to || '')}" onchange="setWorkshopPause('to', this.value)" aria-label="Pause bis" ${(s.workshopPause || {}).on ? '' : 'disabled'}>
        </div>
      </div>
      <label class="field"><span>Übertrag Überstunden (Startsaldo in Std.)</span>
        <input type="text" inputmode="decimal" value="${String(s.startBalance || 0).replace('.', ',')}" onchange="setStartBalance(this.value)" ${managed ? 'disabled' : ''}>
      </label>
    </div>

    <div class="card">
      <h3 class="card-title">Zeitarten</h3>
      <p class="muted small-text">Kürzel für die Zeiteinträge. „Zählt“ = wird als Arbeitszeit gerechnet.</p>
      <details class="cost-details" ${codesListOpen ? 'open' : ''} ontoggle="codesListOpen = this.open">
      <summary>${s.codes.length} Zeitarten anzeigen / bearbeiten</summary>
      <div class="codes-list">
        ${s.codes.map((c, i) => `
          <div class="code-row">
            <input class="code-k" type="text" value="${escapeHtml(c.code)}" onchange="updateCode(${i}, 'code', this.value)" maxlength="4" aria-label="Kürzel">
            <input class="code-l" type="text" value="${escapeHtml(c.label)}" onchange="updateCode(${i}, 'label', this.value)" aria-label="Bezeichnung">
            <label class="check small"><input type="checkbox" ${c.counts !== false ? 'checked' : ''} onchange="updateCode(${i}, 'counts', this.checked)"><span>zählt</span></label>
            <button class="icon-btn small danger-hover" onclick="removeCode(${i})" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>`).join('')}
      </div>
      <button class="btn btn-soft" onclick="addCode()"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Zeitart hinzufügen</button>
      </details>
    </div>

    <div class="card">
      <h3 class="card-title">Kostenstellen (Werkstatt)</h3>
      <p class="muted small-text">Werden bei Werkstattzetteln je Zeile vorgeschlagen. Auftragsnummern wie SR26/000244 kannst du auch direkt eintippen. Pause = P.</p>
      <details class="cost-details" ${costListOpen ? 'open' : ''} ontoggle="costListOpen = this.open">
      <summary>${(s.costCenters || []).length} Kostenstellen anzeigen / bearbeiten</summary>
      <div class="codes-list">
        ${(s.costCenters || []).map((c, i) => `
          <div class="code-row">
            <input class="cost-k" type="text" value="${escapeHtml(c.no)}" onchange="updateCostCenter(${i}, 'no', this.value)" aria-label="Nummer" placeholder="Nr.">
            <input class="code-l" type="text" value="${escapeHtml(c.label)}" onchange="updateCostCenter(${i}, 'label', this.value)" aria-label="Bezeichnung" placeholder="Bezeichnung">
            <button class="icon-btn small danger-hover" onclick="removeCostCenter(${i})" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>`).join('') || '<p class="muted small-text">Noch keine Kostenstellen angelegt.</p>'}
      </div>
      </details>
      <div class="btn-row">
        <button class="btn btn-soft" onclick="addCostCenter()"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Kostenstelle hinzufügen</button>
        <button class="btn btn-ghost" onclick="restoreCostCenters()">Standardliste ergänzen</button>
      </div>
    </div>

    <div class="card tech-only">
      <h3 class="card-title">Meine Unterschrift</h3>
      <p class="muted small-text">Wird bei „Unterschrift Monteur“ mit einem Tipp eingesetzt.</p>
      ${s.ownSignature
        ? `<div class="own-sign"><img src="${s.ownSignature}" alt="Unterschrift"></div>
           <div class="btn-row"><button class="btn btn-soft" onclick="openSignaturePad('own')">Neu unterschreiben</button>
           <button class="btn btn-ghost" onclick="removeOwnSignature()">Entfernen</button></div>`
        : `<button class="btn btn-soft" onclick="openSignaturePad('own')">Unterschrift hinterlegen</button>`}
    </div>

    <div class="card demo-card">
      <div>
        <b>${isDemo() ? 'Demo läuft' : 'Demo-Modus'}</b>
        <span class="muted small-text">${isDemo() ? 'Beispieldaten – deine echten Daten sind sicher zur Seite gelegt.' : 'Mit Beispieldaten vorführen (Monteure, Aufträge, Plan, Zettel). Deine Daten bleiben unberührt.'}</span>
      </div>
      <button class="btn ${isDemo() ? 'btn-primary' : 'btn-soft'}" onclick="${isDemo() ? 'endDemo()' : 'startDemo()'}">${isDemo() ? 'Demo beenden' : 'Demo starten'}</button>
    </div>

    <div class="card">
      <h3 class="card-title">Datensicherung</h3>
      <p class="muted small-text">Alle Daten liegen nur auf diesem Gerät. Bitte regelmäßig ein Backup speichern.</p>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="exportBackup()">Backup speichern</button>
        <button class="btn btn-soft" onclick="document.getElementById('import-file').click()">Backup laden</button>
        <input type="file" id="import-file" accept=".json,application/json" hidden onchange="importBackup(this)">
      </div>
      <p class="muted small-text">${appData.sheets.length} Zettel · ${appData.daysOff.length} Abwesenheiten</p>
    </div>

    <div class="card danger-zone">
      <button class="btn btn-danger-ghost" onclick="resetAll()">Alle Daten löschen</button>
    </div>

    <p class="version muted small-text">Zettel-Job · offline-fähig</p>`;
}

function setSetting(key, value) {
  appData.settings[key] = String(value).trim();
  saveData();
}

function setTheme(t) {
  appData.settings.theme = t;
  applyTheme();
  saveData();
  renderSettings();
}

function parseNum(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function setTarget(i, value) {
  appData.settings.targets[i] = Math.max(0, Math.min(24, parseNum(value)));
  saveData();
  renderSettings();
}

function setWorkshopPause(key, value) {
  const p = appData.settings.workshopPause || (appData.settings.workshopPause = { on: true, from: '11:30', to: '12:00' });
  if (key === 'on') p.on = !!value;
  else {
    const m = parseTime(value);
    if (m == null) { showToast('Bitte Uhrzeit wie 1130 eingeben'); renderSettings(); return; }
    p[key] = formatClock(m);
  }
  saveData();
  renderSettings();
}

function setStartBalance(value) {
  appData.settings.startBalance = parseNum(value);
  saveData();
  renderSettings();
}

function updateCode(i, key, value) {
  const c = appData.settings.codes[i];
  if (!c) return;
  if (key === 'code') {
    const v = String(value).trim().toUpperCase();
    if (!v) { showToast('Kürzel darf nicht leer sein'); renderSettings(); return; }
    if (appData.settings.codes.some((x, j) => j !== i && x.code === v)) { showToast('Kürzel gibt es schon'); renderSettings(); return; }
    // vorhandene Einträge mit umbenennen
    const old = c.code;
    appData.sheets.forEach(sh => sh.days.forEach(d => d.entries.forEach(e => { if (e.code === old) e.code = v; })));
    c.code = v;
  } else if (key === 'label') c.label = String(value).trim();
  else c.counts = !!value;
  saveData();
  renderSettings();
}

function addCode() {
  codesListOpen = true;
  let n = 1;
  while (appData.settings.codes.some(c => c.code === 'X' + n)) n++;
  appData.settings.codes.push({ code: 'X' + n, label: 'Neue Zeitart', counts: true });
  saveData();
  renderSettings();
  const inputs = document.querySelectorAll('.code-row .code-k');
  if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
}

async function removeCode(i) {
  const c = appData.settings.codes[i];
  const used = appData.sheets.some(sh => sh.days.some(d => d.entries.some(e => e.code === c.code)));
  const msg = used
    ? `Zeitart „${c.code}“ wird in Zetteln verwendet. Trotzdem löschen? (Einträge bleiben erhalten und zählen weiter mit.)`
    : `Zeitart „${c.code}“ löschen?`;
  if (!(await confirmDialog(msg, 'Löschen', true))) return;
  appData.settings.codes.splice(i, 1);
  saveData();
  renderSettings();
}

// ---------- Kostenstellen ----------
function addCostCenter() {
  costListOpen = true;
  appData.settings.costCenters.push({ no: '', label: '' });
  saveData();
  renderSettings();
  const inputs = document.querySelectorAll('.code-row .cost-k');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function updateCostCenter(i, key, value) {
  const c = appData.settings.costCenters[i];
  if (!c) return;
  c[key] = key === 'no' ? formatOrderNo(value, null, false) : String(value).trim();
  saveData();
  renderSettings();
}

// Fehlende Kostenstellen aus der Standardliste wieder hinzufügen (vorhandene bleiben)
function restoreCostCenters() {
  let added = 0;
  defaultCostCenters().forEach(c => {
    if (!getCostCenter(c.no)) { appData.settings.costCenters.push(c); added++; }
  });
  saveData();
  renderSettings();
  showToast(added ? `${added} Kostenstelle(n) ergänzt` : 'Alle Standard-Kostenstellen sind vorhanden');
}

async function removeCostCenter(i) {
  const c = appData.settings.costCenters[i];
  if (c && c.no && !(await confirmDialog(`Kostenstelle „${c.no}“ löschen? Bereits eingetragene Zeiten bleiben erhalten.`, 'Löschen', true))) return;
  appData.settings.costCenters.splice(i, 1);
  saveData();
  renderSettings();
}

async function removeOwnSignature() {
  if (!(await confirmDialog('Gespeicherte Unterschrift entfernen?', 'Entfernen', true))) return;
  appData.settings.ownSignature = null;
  saveData();
  renderSettings();
}

// ---------- Backup ----------
async function exportBackup() {
  const name = 'zettel-job-backup-' + todayISO() + '.json';
  // Dateianhänge der Aufträge als Data-URL mitsichern
  const files = {};
  for (const j of appData.jobs) {
    for (const f of j.files) {
      try {
        const blob = await getFile(f.id);
        if (blob) files[f.id] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      } catch (e) { console.warn('Datei nicht gesichert', f.name, e); }
    }
  }
  downloadFile(name, JSON.stringify(Object.assign({}, appData, { files }), null, 2), 'application/json');
  showToast('Backup gespeichert');
}

function importBackup(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch { showToast('Datei ist kein gültiges Backup'); return; }
    if (!data || !Array.isArray(data.sheets)) { showToast('Datei ist kein Zettel-Job-Backup'); return; }
    const ok = await confirmDialog(`Backup mit ${data.sheets.length} Zettel(n) laden? Die aktuellen Daten auf diesem Gerät werden ersetzt.`, 'Laden', true);
    if (!ok) return;
    const files = data.files || {};
    delete data.files;
    appData = normalizeData(data);
    // Dateianhänge zurückschreiben
    for (const id of Object.keys(files)) {
      try { await saveFile(id, await (await fetch(files[id])).blob()); } catch (e) { console.warn('Datei nicht wiederhergestellt', id, e); }
    }
    await saveData(true);
    applyTheme();
    applyRole();
    renderSettings();
    showToast('Backup geladen');
  };
  reader.readAsText(file);
}

async function resetAll() {
  if (!(await confirmDialog('Wirklich ALLE Zettel, Stunden und Einstellungen löschen? Vorher am besten ein Backup speichern.', 'Alles löschen', true))) return;
  const role = appData.role;
  appData = createDefaultData();
  appData.role = role;
  await saveData(true);
  applyTheme();
  renderSettings();
  showToast('Alle Daten gelöscht');
}

window.renderSettings = renderSettings;
window.setSetting = setSetting;
window.setTheme = setTheme;
window.setTarget = setTarget;
window.setStartBalance = setStartBalance;
window.setWorkshopPause = setWorkshopPause;
window.updateCode = updateCode;
window.addCode = addCode;
window.removeCode = removeCode;
window.removeOwnSignature = removeOwnSignature;
window.addCostCenter = addCostCenter;
window.updateCostCenter = updateCostCenter;
window.removeCostCenter = removeCostCenter;
window.restoreCostCenters = restoreCostCenters;
window.exportBackup = exportBackup;
window.importBackup = importBackup;
window.resetAll = resetAll;
