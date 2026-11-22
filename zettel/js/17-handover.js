// ---------- Übergabe: Auftrag mittendrin an einen anderen Monteur übergeben ----------
// appData.handovers = [{ id, orderNo, date, reason, done, stats, withBefunde, befunde, open: [{ text, done, fromBefunde }],
//   (from/to nur noch Altbestand, werden nicht mehr angezeigt)
//   notes, contact, location, signFrom, signTo, createdAt, updatedAt }]
// stats und befunde sind ein Stand zum Zeitpunkt der Erstellung (per Knopf aktualisierbar).

let activeHandoverId = null;
let handoverReturn = null; // 'order' | 'job' – wohin „Zurück“ führt

const BF_RATINGS = { ok: 'i.O.', obs: 'beobachten', bad: 'n.i.O.' };
const BF_SHEET_LABELS = {
  general: 'Allgemeines Befundblatt', serials: 'Seriennummern Bauteile', parts: 'Ersatzteile / Bestellliste',
  endoscopy: 'Endoskopie', piston_proj: 'Kolbenüberstand', liner: 'Laufbuchse', liner_fit: 'Laufbuchse einpassen',
  liner_proj: 'Laufbuchse Überstand', kw_bore: 'Kurbelwelle Lagergasse', kw_journal: 'Kurbelwelle Zapfen', cam: 'Nockenwellenlager'
};
const BF_PART_STATUS = { order: 'Bestellen', open: 'Klären', ordered: 'Bestellt', none: 'Nicht nötig' };

function getHandover(id) { return (appData.handovers || []).find(h => h.id === id) || null; }
function getActiveHandover() { return getHandover(activeHandoverId); }
function handoversFor(orderNo) {
  const no = normOrderNo(orderNo);
  if (!no) return [];
  return (appData.handovers || []).filter(h => sameOrder(h.orderNo, no)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}
function handoverSigned(h) { return !!((h.signFrom && h.signFrom.img) || (h.signTo && h.signTo.img)); }
function handoverEditable(h) { return !!h && !isOffice() && !handoverSigned(h); }

// ---------- Daten aus Zettel-Job ----------
function handoverStats(no) {
  const o = orderData(no);
  const uniq = list => list.map(v => String(v || '').trim()).filter((v, i, a) => v && a.indexOf(v) === i);
  return {
    customer: o.customer, vessel: o.vessel, engines: o.engines,
    days: o.items.length, worked: o.totals.worked,
    material: uniq(o.sheets.filter(s => s.material === true).map(s => s.materialNote)),
    notes: uniq(o.sheets.map(s => s.note)), finished: o.finished
  };
}

// Befunde einbezogen? (ältere Übergaben ohne Schalter: wenn ein Befunde-Stand gespeichert ist)
function hoWithBefunde(h) {
  return h.withBefunde === undefined ? !!h.befunde : !!h.withBefunde;
}

// Erledigte Arbeiten: Zeilen-Beschreibungen aller Zettel des Auftrags, jede nur einmal (ohne Datum/Namen)
function handoverDoneText(no) {
  const descs = [];
  orderData(no).items.forEach(i => i.split.lines.forEach(l => {
    const t = l.kind === 'entry' ? String(l.entry.desc || '').trim() : '';
    if (t && !descs.some(d => d.toLowerCase() === t.toLowerCase())) descs.push(t);
  }));
  return descs.join('\n');
}

// ---------- Daten aus Befunde (nur lesen) ----------
function handoverBefundeSnapshot(no, data) {
  const orders = data ? data.orders.filter(o => sameOrder(o.orderNo, no)) : [];
  if (!orders.length) return null;
  const snap = { at: new Date().toISOString(), status: '', sheets: [], parts: [], summary: '', advice: '' };
  orders.forEach(o => {
    if (o.status === 'fertig') snap.status = 'fertig';
    if (o.reportSummary) snap.summary = [snap.summary, o.reportSummary].filter(Boolean).join('\n');
    if (o.reportAdvice) snap.advice = [snap.advice, o.reportAdvice].filter(Boolean).join('\n');
    const engines = Array.isArray(o.engines) ? o.engines : [];
    (o.sheets || []).forEach(s => {
      const eng = engines.length > 1 ? engines[s.engine || 0] : null;
      const engName = eng ? (eng.name || eng.label || ('Motor ' + ((s.engine || 0) + 1))) : '';
      snap.sheets.push({
        label: BF_SHEET_LABELS[s.type] || s.type || 'Blatt',
        sub: [engName, s.subtitle].filter(Boolean).join(' · '),
        date: s.date || '', rating: s.rating || '',
        summary: s.summary || '', advice: s.advice || ''
      });
      const items = s.data && Array.isArray(s.data.items) ? s.data.items : [];
      items.filter(it => it && (it.part || it.reason)).forEach(it => snap.parts.push({ part: it.part || '', reason: it.reason || '', status: it.status || '' }));
    });
  });
  return snap;
}

// Vorschläge für offene Arbeiten aus Befunde
function handoverOpenFromBefunde(snap) {
  if (!snap) return [];
  const out = [];
  snap.parts.forEach(p => {
    const txt = [p.part, p.reason].filter(Boolean).join(' – ');
    if (p.status === 'order') out.push('Ersatzteil bestellen: ' + txt);
    else if (p.status === 'open') out.push('Ersatzteil klären: ' + txt);
    else if (p.status === 'ordered') out.push('Bestelltes Teil abwarten/einbauen: ' + txt);
  });
  snap.sheets.filter(s => s.rating === 'bad' || s.rating === 'obs').forEach(s => {
    const what = s.advice || s.summary;
    out.push((s.rating === 'bad' ? 'n.i.O. ' : 'Beobachten ') + s.label + (s.sub ? ' (' + s.sub + ')' : '') + (what ? ': ' + what : ''));
  });
  return out;
}

// ---------- Anlegen / Öffnen ----------
async function createHandover(orderNo, ret) {
  const no = normOrderNo(orderNo);
  if (!no) { showToast('Keine Auftragsnummer'); return; }
  const now = new Date().toISOString();
  const ho = {
    id: uid(), orderNo: no, date: todayISO(), from: '', to: '', reason: '',
    done: handoverDoneText(no), stats: handoverStats(no), withBefunde: false, befunde: null, open: [],
    notes: '', contact: '', location: '', signFrom: null, signTo: null,
    createdAt: now, updatedAt: now
  };
  appData.handovers.push(ho);
  saveData(true);
  openHandover(ho.id, ret);
  showToast('Übergabe angelegt – bitte ergänzen');
}

function openHandover(id, ret) {
  activeHandoverId = id;
  if (ret) handoverReturn = ret;
  showView('handover');
}

function closeHandover() {
  const ho = getActiveHandover();
  flushSave();
  if (handoverReturn === 'order' && ho) { openOrder(ho.orderNo); return; }
  if (handoverReturn === 'job') { showView('job'); return; }
  showView('sheets');
}

async function deleteHandover() {
  const ho = getActiveHandover();
  if (!ho) return;
  if (!(await confirmDialog('Übergabe für Auftrag ' + ho.orderNo + ' löschen? Zettel und Befunde bleiben unverändert.', 'Löschen', true))) return;
  appData.handovers = appData.handovers.filter(h => h.id !== ho.id);
  saveData(true);
  closeHandover();
  showToast('Übergabe gelöscht');
}

// Stand aus Zetteln und Befunden neu holen
async function refreshHandover() {
  const ho = getActiveHandover();
  if (!handoverEditable(ho)) return;
  ho.stats = handoverStats(ho.orderNo);
  const newDone = handoverDoneText(ho.orderNo);
  if (!ho.done.trim()) ho.done = newDone;
  else newDone.split('\n').forEach(line => { if (line && !ho.done.includes(line)) ho.done += '\n' + line; });
  if (hoWithBefunde(ho)) await loadHandoverBefunde(ho);
  touchHandover(ho);
  renderHandover();
  showToast(hoWithBefunde(ho) ? 'Aus Zetteln und Befunden aktualisiert' : 'Aus den Zetteln aktualisiert');
}

// Schalter „Bisherige Stunden und Tage anzeigen“ (Ansicht und Ausdruck)
function toggleHandoverHours() {
  const ho = getActiveHandover();
  if (!handoverEditable(ho)) return;
  ho.withHours = !ho.withHours;
  touchHandover(ho);
  renderHandover();
}

// Befunde-Stand holen und Vorschläge als offene Arbeiten ergänzen
async function loadHandoverBefunde(ho) {
  ho.befunde = handoverBefundeSnapshot(ho.orderNo, await loadBefundeData(true));
  handoverOpenFromBefunde(ho.befunde).forEach(text => { if (!ho.open.some(t => t.text === text)) ho.open.push({ text, done: false, fromBefunde: true }); });
}

// Schalter „Befunde einbeziehen“ – aus: Befunde-Vorschläge, die noch nicht abgehakt sind, wieder entfernen
async function toggleHandoverBefunde() {
  const ho = getActiveHandover();
  if (!handoverEditable(ho)) return;
  if (hoWithBefunde(ho)) {
    ho.withBefunde = false;
    ho.befunde = null;
    ho.open = ho.open.filter(t => !t.fromBefunde || t.done);
  } else {
    ho.withBefunde = true;
    await loadHandoverBefunde(ho);
    if (!ho.befunde) showToast('Zu diesem Auftrag gibt es auf diesem Gerät keine Befunde');
  }
  touchHandover(ho);
  renderHandover();
}

function touchHandover(ho) {
  ho.updatedAt = new Date().toISOString();
  saveData();
}

// ---------- Offene Arbeiten ----------
function addHandoverTask() {
  const ho = getActiveHandover();
  if (!handoverEditable(ho)) return;
  ho.open.push({ text: '', done: false });
  touchHandover(ho);
  renderHandover();
  const inputs = document.querySelectorAll('#handover-body .ho-task input[type=text]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeHandoverTask(i) {
  const ho = getActiveHandover();
  if (!handoverEditable(ho)) return;
  ho.open.splice(i, 1);
  touchHandover(ho);
  renderHandover();
}

// Abhaken geht auch nach der Unterschrift (Fortschritt des Nachfolgers)
function toggleHandoverTask(i) {
  const ho = getActiveHandover();
  if (!ho || isOffice() || !ho.open[i]) return;
  ho.open[i].done = !ho.open[i].done;
  touchHandover(ho);
  renderHandover();
}

function handleHandoverInput(ev) {
  const el = ev.target;
  const ho = getActiveHandover();
  if (!handoverEditable(ho)) return;
  if (el.dataset.hb) ho[el.dataset.hb] = el.value;
  else if (el.dataset.hbTask !== undefined) {
    const t = ho.open[Number(el.dataset.hbTask)];
    if (t) t.text = el.value;
  } else return;
  touchHandover(ho);
}

// ---------- Ansicht ----------
function renderHandover() {
  const body = document.getElementById('handover-body');
  const ho = getActiveHandover();
  if (!ho) { showView('sheets'); return; }
  setTopbarTitle('Übergabe ' + ho.orderNo);
  const edit = handoverEditable(ho);
  const ro = edit ? '' : ' readonly';
  const st = ho.stats || {};
  const withBf = hoWithBefunde(ho);
  const bf = withBf ? ho.befunde : null;
  const engines = (st.engines || []).filter(engineHasData);
  const doneCount = ho.open.filter(t => t.done).length;

  const taskRows = ho.open.map((t, i) => `
    <div class="ho-task ${t.done ? 'done' : ''}">
      <input type="checkbox" ${t.done ? 'checked' : ''} ${isOffice() ? 'disabled' : ''} onchange="toggleHandoverTask(${i})" aria-label="Erledigt">
      ${edit ? `<input type="text" data-hb-task="${i}" value="${escapeHtml(t.text)}" placeholder="Was ist noch zu tun?" autocomplete="off">
        <button type="button" class="icon-btn" onclick="removeHandoverTask(${i})" aria-label="Entfernen">×</button>`
        : `<span>${escapeHtml(t.text || '–')}</span>`}
    </div>`).join('');

  const bfHtml = bf ? `
      <div class="ho-bf-list">
        ${bf.sheets.length ? bf.sheets.map(s => `
          <div class="ho-bf">
            <span class="ho-rate r-${escapeHtml(s.rating || 'none')}">${escapeHtml(BF_RATINGS[s.rating] || '–')}</span>
            <span class="ho-bf-text"><b>${escapeHtml(s.label)}</b>${s.sub ? ` <small>${escapeHtml(s.sub)}</small>` : ''}
              ${s.summary || s.advice ? `<small class="ho-bf-note">${escapeHtml([s.summary, s.advice ? 'Empfehlung: ' + s.advice : ''].filter(Boolean).join(' · '))}</small>` : ''}</span>
          </div>`).join('') : '<p class="muted small-text">Keine Blätter angelegt.</p>'}
      </div>
      ${bf.parts.length ? `<h4 class="sub-title">Ersatzteile</h4><div class="ho-parts">${bf.parts.map(p => `
        <div class="ho-part"><span class="code-chip">${escapeHtml(BF_PART_STATUS[p.status] || 'ohne Status')}</span>
          <span>${escapeHtml(p.part || '–')}${p.reason ? ` <small class="muted">${escapeHtml(p.reason)}</small>` : ''}</span></div>`).join('')}</div>` : ''}
      ${bf.summary || bf.advice ? `<p class="small-text">${escapeHtml([bf.summary, bf.advice ? 'Empfehlung: ' + bf.advice : ''].filter(Boolean).join('\n'))}</p>` : ''}
      <p class="muted small-text">Stand Befunde: ${escapeHtml(new Date(bf.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}${bf.status === 'fertig' ? ' · Befundung fertig' : ''}</p>`
    : '<p class="muted small-text">Keine Befunde zu diesem Auftrag auf diesem Gerät gefunden.</p>';

  body.innerHTML = `
    <div class="card order-head">
      <div class="oh-top">
        <div>
          <div class="type-pill"><svg viewBox="0 0 24 24"><path d="M4 12h12M12 6l6 6-6 6"/><path d="M20 4v16"/></svg> Übergabe</div>
          <div class="oh-title">Auftrag ${escapeHtml(ho.orderNo)}</div>
          <div class="muted">${escapeHtml([st.vessel, st.customer].filter(Boolean).join(' · ') || 'ohne Kunde')}</div>
        </div>
        ${ho.withHours ? `<div class="oh-range"><b>${formatHours(st.worked || 0)}</b><small>${escapeHtml(st.days ? 'bisher · ' + st.days + ' Tag' + (st.days > 1 ? 'e' : '') : 'noch keine Zettel')}</small></div>` : ''}
      </div>
      ${engines.length ? `<div class="engine-facts">${engines.map((e, i) => `
        <div class="engine-fact"><b>${escapeHtml(e.label || (engines.length > 1 ? 'Motor ' + (i + 1) : 'Motor'))}</b>
          <span>${escapeHtml([e.make, e.model].filter(Boolean).join(' ') || '–')}</span>
          <span>Nr. ${escapeHtml(e.number || '–')} · Betriebsstd. ${escapeHtml(e.hours || '–')}</span></div>`).join('')}</div>` : ''}
      ${handoverSigned(ho) ? '<p class="muted small-text">Unterschrieben – Inhalt gesperrt. Offene Arbeiten können weiter abgehakt werden.</p>' : ''}
    </div>

    <div class="card">
      <h3 class="card-title">Übergabe</h3>
      <div class="grid-2">
        <label class="field"><span>Datum</span><input type="date" data-hb="date" value="${escapeHtml(ho.date)}"${ro}></label>
        <label class="field"><span>Grund (optional)</span><input type="text" data-hb="reason" value="${escapeHtml(ho.reason)}" placeholder="z.B. Urlaub, anderer Einsatz" autocomplete="off"${ro}></label>
      </div>
      ${edit ? `<label class="switch-row ho-switch"><input type="checkbox" class="switch" ${ho.withHours ? 'checked' : ''} onchange="toggleHandoverHours()"><span>Bisherige Stunden und Tage anzeigen${ho.withHours ? ` <small class="muted">(${formatHours(st.worked || 0)} · ${st.days || 0} Tag${st.days === 1 ? '' : 'e'})</small>` : ''}</span></label>` : ''}
    </div>

    <div class="card">
      <h3 class="card-title">Erledigt</h3>
      <label class="field"><textarea data-hb="done" rows="7" placeholder="Was wurde bisher gemacht?"${ro}>${escapeHtml(ho.done)}</textarea></label>
      ${(st.material || []).length ? `<p class="small-text"><b>Material:</b> ${escapeHtml(st.material.join(' · '))}</p>` : ''}
      ${(st.notes || []).length ? `<p class="small-text"><b>Bemerkungen:</b> ${escapeHtml(st.notes.join(' · '))}</p>` : ''}
      <p class="muted small-text">Aus den Stundenzetteln dieses Auftrags übernommen – frei änderbar.</p>
    </div>

    <div class="card">
      <div class="job-status-row">
        <h3 class="card-title">${BEFUNDE_ICON.replace('<svg', '<svg class="ho-title-icon"')} Befunde</h3>
        ${edit ? `<label class="switch-row"><span class="muted small-text">einbeziehen</span><input type="checkbox" class="switch" ${withBf ? 'checked' : ''} onchange="toggleHandoverBefunde()"></label>` : ''}
      </div>
      ${withBf ? bfHtml : '<p class="muted small-text">Optional: Mess- und Befundblätter sowie Ersatzteile zu diesem Auftrag mit in die Übergabe nehmen.</p>'}
    </div>

    <div class="card">
      <div class="job-status-row">
        <h3 class="card-title">Offene Arbeiten</h3>
        ${ho.open.length ? `<span class="badge ${doneCount === ho.open.length ? 'badge-ok' : 'badge-open'}">${doneCount}/${ho.open.length} erledigt</span>` : ''}
      </div>
      <div class="ho-tasks">${taskRows || '<p class="muted small-text">Noch keine offenen Arbeiten eingetragen.</p>'}</div>
      ${edit ? '<button type="button" class="btn btn-soft" onclick="addHandoverTask()"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Offene Arbeit</button>' : ''}
    </div>

    <div class="card">
      <h3 class="card-title">Hinweise für den Nachfolger</h3>
      <label class="field"><span>Stand &amp; Besonderheiten</span><textarea data-hb="notes" rows="4" placeholder="Wo stehen wir? Worauf muss man achten?"${ro}>${escapeHtml(ho.notes)}</textarea></label>
      <label class="field"><span>Ansprechpartner vor Ort</span><input type="text" data-hb="contact" value="${escapeHtml(ho.contact)}" placeholder="Name, Telefon" autocomplete="off"${ro}></label>
      <label class="field"><span>Werkzeug &amp; Teile liegen</span><input type="text" data-hb="location" value="${escapeHtml(ho.location)}" placeholder="z.B. Maschinenraum BB, Werkzeugkiste im Bus" autocomplete="off"${ro}></label>
    </div>

    <div class="card">
      <h3 class="card-title">Unterschriften</h3>
      <div class="sign-grid">
        ${signatureBox('Übergeben', ho.signFrom, 'hoFrom')}
        ${signatureBox('Übernommen', ho.signTo, 'hoTo')}
      </div>
    </div>

    <div class="editor-footer">
      ${!isOffice() ? '<button type="button" class="btn btn-danger-ghost" onclick="deleteHandover()">Löschen</button>' : ''}
      ${edit ? '<button type="button" class="btn btn-ghost" onclick="refreshHandover()">Aktualisieren</button>' : ''}
      <button type="button" class="btn btn-primary" onclick="printHandover()">
        <svg viewBox="0 0 24 24"><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg> Drucken / PDF</button>
    </div>`;
}

// Karte „Übergabe“ im Auftrag / in der Zusammenstellung
function handoverCardHtml(orderNo, ret) {
  const no = normOrderNo(orderNo);
  if (!no) return '';
  const list = handoversFor(no);
  return `
    <div class="card">
      <h3 class="card-title">Übergabe</h3>
      ${list.length ? `<div class="menu-rows">${list.map(h => {
        const open = (h.open || []).filter(t => !t.done).length;
        return `<button class="menu-row" onclick="openHandover('${h.id}','${ret}')">
          <span><b>Übergabe vom ${escapeHtml(formatDateShort(h.date))}</b><small>${h.reason ? escapeHtml(h.reason) + ' · ' : ''}${handoverSigned(h) ? 'unterschrieben' : 'Entwurf'}</small></span>
          <span class="mr-right"><b>${open ? open + ' offen' : (h.open || []).length ? 'alles erledigt' : ''}</b></span></button>`;
      }).join('')}</div>` : '<p class="muted small-text">Muss der Auftrag mittendrin abgegeben werden? Die Übergabe fasst zusammen, was gemacht wurde und was noch offen ist – Befunde auf Wunsch.</p>'}
      <button type="button" class="btn btn-soft tech-only" onclick="createHandover(${escapeHtml(JSON.stringify(no))},'${ret}')">
        <svg viewBox="0 0 24 24"><path d="M4 12h12M12 6l6 6-6 6"/><path d="M20 4v16"/></svg> Übergabe erstellen</button>
    </div>`;
}

// ---------- Druck ----------
function buildHandoverPrintHtml(ho) {
  const st = ho.stats || {};
  const bf = hoWithBefunde(ho) ? ho.befunde : null;
  const sig = s => s && s.img ? `<img src="${s.img}" alt="">` : '';
  const meta = s => s ? escapeHtml([s.name, s.at ? new Date(s.at).toLocaleDateString('de-DE') : ''].filter(Boolean).join(', ')) : '';
  const pre = (label, text) => text && String(text).trim() ? `<tr><th>${label}</th><td class="pre">${escapeHtml(text)}</td></tr>` : '';
  return `
    <div class="pr-page">
      <div class="pr-head">
        <div><div class="pr-title">Übergabe</div><div class="pr-sub">Auftrag ${escapeHtml(ho.orderNo)} · ${escapeHtml(formatDate(ho.date))}</div></div>
        ${ho.withHours ? `<div class="pr-worker"><span>Bisher</span><strong>${formatHours(st.worked || 0)}${st.days ? ' · ' + st.days + ' Tag' + (st.days > 1 ? 'e' : '') : ''}</strong></div>` : ''}
      </div>
      <table class="pr-info">
        <tr><th>Auftragsnummer</th><td>${escapeHtml(ho.orderNo)}</td><th>Auftraggeber / Kunde</th><td>${escapeHtml(st.customer || '–')}</td></tr>
        <tr><th>Schiff / Anlage</th><td colspan="3">${escapeHtml(st.vessel || '–')}</td></tr>
        ${engineRows(st.engines)}
        ${ho.reason ? `<tr><th>Grund</th><td colspan="3">${escapeHtml(ho.reason)}</td></tr>` : ''}
      </table>

      <div class="pr-section">Erledigt</div>
      <table class="pr-info">
        ${pre('Arbeiten', ho.done) || '<tr><th>Arbeiten</th><td>–</td></tr>'}
        ${pre('Material', (st.material || []).join('\n'))}
        ${pre('Bemerkungen', (st.notes || []).join('\n'))}
      </table>

      ${bf ? `<div class="pr-section">Befunde${bf.status === 'fertig' ? ' (fertig)' : ''}</div>
      ${bf.sheets.length ? `<table class="pr-bf"><thead><tr><th>Blatt</th><th>Bewertung</th><th>Befund / Empfehlung</th></tr></thead><tbody>
        ${bf.sheets.map(s => `<tr><td>${escapeHtml(s.label)}${s.sub ? '<br><small>' + escapeHtml(s.sub) + '</small>' : ''}</td><td>${escapeHtml(BF_RATINGS[s.rating] || '–')}</td>
          <td class="pre">${escapeHtml([s.summary, s.advice ? 'Empfehlung: ' + s.advice : ''].filter(Boolean).join('\n'))}</td></tr>`).join('')}</tbody></table>` : ''}
      ${bf.parts.length ? `<table class="pr-bf"><thead><tr><th>Ersatzteil</th><th>Status</th><th>Grund</th></tr></thead><tbody>
        ${bf.parts.map(p => `<tr><td>${escapeHtml(p.part || '–')}</td><td>${escapeHtml(BF_PART_STATUS[p.status] || '–')}</td><td>${escapeHtml(p.reason || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${bf.summary || bf.advice ? `<table class="pr-info">${pre('Zusammenfassung', bf.summary)}${pre('Empfehlung', bf.advice)}</table>` : ''}` : ''}

      <div class="pr-section">Offene Arbeiten</div>
      <div class="pr-checks">${ho.open.length ? ho.open.map(t => `<div>${t.done ? '☑' : '☐'} ${escapeHtml(t.text || '')}</div>`).join('') : '<div>–</div>'}</div>

      <div class="pr-section">Hinweise für den Nachfolger</div>
      <table class="pr-info">
        ${pre('Stand / Besonderheiten', ho.notes) || '<tr><th>Stand / Besonderheiten</th><td>–</td></tr>'}
        <tr><th>Ansprechpartner vor Ort</th><td>${escapeHtml(ho.contact || '–')}</td></tr>
        <tr><th>Werkzeug &amp; Teile</th><td>${escapeHtml(ho.location || '–')}</td></tr>
      </table>

      ${[['Übergeben', ho.signFrom], ['Übernommen', ho.signTo]].some(x => x[1] && x[1].img) ? `<div class="pr-signs">
        ${[['Übergeben', ho.signFrom], ['Übernommen', ho.signTo]].filter(x => x[1] && x[1].img).map(([label, s]) => `
        <div class="pr-sign"><div class="pr-sign-img">${sig(s)}</div><div class="pr-sign-line">${label} ${meta(s) ? '· ' + meta(s) : ''}</div></div>`).join('')}
      </div>` : ''}
    </div>`;
}

function printHandover() {
  const ho = getActiveHandover();
  if (!ho) return;
  printHtml(buildHandoverPrintHtml(ho), ['Übergabe', ho.orderNo, ho.stats && (ho.stats.vessel || ho.stats.customer), ho.date].filter(Boolean).join('_'));
}

document.addEventListener('DOMContentLoaded', () => {
  const body = document.getElementById('handover-body');
  if (!body) return;
  body.addEventListener('input', handleHandoverInput);
  body.addEventListener('change', handleHandoverInput);
});

window.createHandover = createHandover;
window.openHandover = openHandover;
window.closeHandover = closeHandover;
window.deleteHandover = deleteHandover;
window.refreshHandover = refreshHandover;
window.addHandoverTask = addHandoverTask;
window.removeHandoverTask = removeHandoverTask;
window.toggleHandoverTask = toggleHandoverTask;
window.printHandover = printHandover;
window.renderHandover = renderHandover;
window.toggleHandoverBefunde = toggleHandoverBefunde;
window.toggleHandoverHours = toggleHandoverHours;
