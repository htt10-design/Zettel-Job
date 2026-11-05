// =====================================================================
// 06-print: Druckansicht (A4) – einzelner Zettel oder zusammengestellter
// Auftrag. Über den Druckdialog auch als PDF speicherbar.
// =====================================================================

function yesNoText(v) { return v === true ? 'Ja' : v === false ? 'Nein' : '–'; }

function awayText(v) {
  const o = AWAY_OPTIONS.find(x => x.value === (v || ''));
  return v && o ? o.label : '–';
}

function travelRow(label, t, date) {
  t = t || {};
  const vehicle = t.vehicle === 'Firmenwagen' && t.plate ? `Firmenwagen (${t.plate})` : (t.vehicle || '–');
  const m = parseDuration(t.duration);
  return `<tr>
    <th>${escapeHtml(label)}</th>
    <td>${escapeHtml(date ? formatDate(date, false) : '')}</td>
    <td>${escapeHtml(t.from || '–')} → ${escapeHtml(t.to || '–')}</td>
    <td class="num">${escapeHtml(t.km ? t.km + ' km' : '–')}</td>
    <td class="num">${m != null ? formatHours(m) : '–'}</td>
    <td>${escapeHtml(vehicle)}</td>
  </tr>`;
}

// Fahrten eines Zettels mit dem Datum des zugeordneten Tages
function sheetTravels(sheet) {
  if (sheet.type !== 'montage') return [];
  return TRAVEL_KEYS.filter(({ key }) => travelActive(sheet[key])).map(({ key, label }) => {
    const i = travelDayIndex(sheet, key);
    return { label, t: sheet[key], date: sheet[key].date || (sheet.days[i] ? sheet.days[i].date : '') };
  });
}

// Druckdokument aus beliebig vielen Tagen (auch aus mehreren Zetteln)
// doc: { title, subtitle, isMontage, orderNo, customer, vessel, items: [{sheet, di}],
//        travels, material, materialNotes, finished, notes, signWorker, signCustomer, summary }
function buildPrintDoc(doc) {
  const s = appData.settings;
  const num = m => m ? formatHours(m).replace(' h', '') : '';
  const totals = { worked: 0, normal: 0, ot: 0 };
  const byCode = {};

  const items = doc.items.slice().sort((a, b) => (a.sheet.days[a.di].date || '').localeCompare(b.sheet.days[b.di].date || ''));
  const dayRows = items.map(({ sheet, di }) => {
    const d = sheet.days[di];
    const split = daySplit(sheet, di);
    totals.worked += split.worked; totals.normal += split.normal; totals.ot += split.ot;
    const lines = split.lines;
    lines.forEach(l => { if (l.minutes) byCode[l.code || '?'] = (byCode[l.code || '?'] || 0) + l.minutes; });
    const rows = lines.length ? lines.map((l, i) => {
      let from = '', to = '', desc = '';
      if (l.kind === 'entry') {
        from = l.entry.from || ''; to = l.entry.to || ''; desc = l.entry.desc || '';
      } else {
        const t = sheet[l.key] || {};
        const route = [t.from, t.to].filter(Boolean).join(' → ');
        desc = l.label + (route ? ': ' + route : '') + (t.km ? ` (${t.km} km)` : '');
      }
      const normalCell = l.counts ? num(l.normal) : `<s>${num(l.minutes)}</s>`;
      return `
      <tr class="${l.kind === 'travel' ? 'travel' : ''}">
        ${i === 0 ? `<td rowspan="${lines.length}" class="date-cell">${escapeHtml(formatDate(d.date))}</td>` : ''}
        <td class="num">${escapeHtml(from)}</td>
        <td class="num">${escapeHtml(to)}</td>
        <td class="code">${escapeHtml(l.code || '')}</td>
        <td class="num">${normalCell}</td>
        <td class="num ot">${num(l.ot)}</td>
        <td>${escapeHtml(desc)}</td>
      </tr>`;
    }).join('') : `<tr><td class="date-cell">${escapeHtml(formatDate(d.date))}</td><td colspan="6" class="muted">keine Einträge</td></tr>`;
    let extra = '';
    if (doc.isMontage && (d.away || d.hotel)) {
      const parts = [];
      if (d.away) parts.push('Abwesenheit: ' + awayText(d.away));
      if (d.hotel) parts.push('Hotel: ' + (d.hotelName || 'ja') + ' · Frühstück: ' + yesNoText(d.breakfast));
      extra = `<tr class="day-extra"><td></td><td colspan="6">${escapeHtml(parts.join('   |   '))}</td></tr>`;
    }
    return rows + extra + `<tr class="day-total"><td colspan="4">Summe ${escapeHtml(formatDateShort(d.date))}${split.worked ? ' · gesamt ' + formatHours(split.worked) : ''}</td><td class="num">${num(split.normal) || '0,00'}</td><td class="num ot">${num(split.ot)}</td><td></td></tr>`;
  }).join('');

  const legend = s.codes.map(c => `${escapeHtml(c.code)} = ${escapeHtml(c.label)}`).join(' · ');
  const codeTotals = Object.keys(byCode).map(k => `<span><b>${escapeHtml(k)}</b> ${formatHours(byCode[k])}</span>`).join('');
  const sigImg = sig => sig && sig.img ? `<img src="${sig.img}" alt="">` : '';
  const sigMeta = sig => sig ? escapeHtml([sig.name, sig.at ? new Date(sig.at).toLocaleDateString('de-DE') : ''].filter(Boolean).join(', ')) : '';
  const notes = (doc.notes || []).filter(Boolean);
  const matNotes = (doc.materialNotes || []).filter(Boolean);

  return `
    <div class="pr-page">
      <div class="pr-head">
        <div>
          <div class="pr-title">${escapeHtml(doc.title)}</div>
          <div class="pr-sub">${escapeHtml(doc.subtitle || '')}</div>
        </div>
        <div class="pr-worker">
          <span>Monteur</span>
          <strong>${escapeHtml(s.name || '______________________')}</strong>
        </div>
      </div>

      ${doc.isMontage ? `
      <table class="pr-info">
        <tr><th>Auftragsnummer</th><td>${escapeHtml(doc.orderNo || '–')}</td>
            <th>Auftraggeber / Kunde</th><td>${escapeHtml(doc.customer || '–')}</td></tr>
        <tr><th>Schiff / Anlage</th><td colspan="3">${escapeHtml(doc.vessel || '–')}</td></tr>
      </table>` : ''}

      <table class="pr-times">
        <thead><tr><th>Datum</th><th>Von</th><th>Bis</th><th>Art</th><th>Normal</th><th>Überst.</th><th>Ausgeführte Arbeiten</th></tr></thead>
        <tbody>${dayRows}</tbody>
        <tfoot>
          <tr><td colspan="4">Normalstunden / Überstunden</td><td class="num">${formatHours(totals.normal).replace(' h', '')}</td><td class="num ot">${formatHours(totals.ot).replace(' h', '')}</td><td></td></tr>
          <tr class="grand"><td colspan="4">Gesamtstunden</td><td colspan="2" class="num">${formatHours(totals.worked)}</td><td class="pr-codes">${codeTotals}</td></tr>
        </tfoot>
      </table>
      <div class="pr-legend">${legend}</div>

      ${doc.summary || ''}

      ${doc.isMontage ? `
      ${doc.travels.length ? `
      <table class="pr-travel">
        <thead><tr><th></th><th>Datum</th><th>Strecke</th><th>Km</th><th>Zeit</th><th>Verkehrsmittel</th></tr></thead>
        <tbody>${doc.travels.map(x => travelRow(x.label, x.t, x.date)).join('')}</tbody>
      </table>` : ''}

      <table class="pr-info">
        <tr><th>Material verwendet</th><td>${yesNoText(doc.material)}</td>
            <th>Montage beendet</th><td>${yesNoText(doc.finished)}</td></tr>
        ${doc.material === true && matNotes.length ? `<tr><th>Material</th><td colspan="3" class="pre">${escapeHtml(matNotes.join('\n'))}</td></tr>` : ''}
        ${notes.length ? `<tr><th>Bemerkung</th><td colspan="3" class="pre">${escapeHtml(notes.join('\n'))}</td></tr>` : ''}
      </table>

      <div class="pr-signs">
        <div class="pr-sign"><div class="pr-sign-img">${sigImg(doc.signWorker)}</div><div class="pr-sign-line">Unterschrift Monteur ${sigMeta(doc.signWorker) ? '· ' + sigMeta(doc.signWorker) : ''}</div></div>
        <div class="pr-sign"><div class="pr-sign-img">${sigImg(doc.signCustomer)}</div><div class="pr-sign-line">Unterschrift Kunde ${sigMeta(doc.signCustomer) ? '· ' + sigMeta(doc.signCustomer) : ''}</div></div>
      </div>` : (notes.length ? `<table class="pr-info"><tr><th>Bemerkung</th><td class="pre">${escapeHtml(notes.join('\n'))}</td></tr></table>` : '')}

      <div class="pr-foot">Erstellt mit Zettel-Job · ${escapeHtml(new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}</div>
    </div>`;
}

function buildPrintHtml(sheet) {
  const isMontage = sheet.type === 'montage';
  return buildPrintDoc({
    title: isMontage ? 'Montagezettel' : 'Werkstattzettel',
    subtitle: sheetDateRange(sheet),
    isMontage,
    orderNo: sheet.orderNo, customer: sheet.customer, vessel: sheet.vessel,
    items: sheet.days.map((d, di) => ({ sheet, di })),
    travels: sheetTravels(sheet),
    material: sheet.material,
    materialNotes: [sheet.materialNote],
    finished: sheet.finished,
    notes: [sheet.note],
    signWorker: sheet.signWorker,
    signCustomer: sheet.signCustomer
  });
}

// HTML in den Druckbereich setzen und Druckdialog öffnen
function printHtml(html, fileTitle) {
  flushSave();
  document.getElementById('print-area').innerHTML = html;
  const oldTitle = document.title;
  // Dateiname-Vorschlag für "Als PDF speichern"
  document.title = fileTitle.replace(/[\\/:*?"<>|]+/g, '-');
  setTimeout(() => {
    window.print();
    document.title = oldTitle;
  }, 50);
}

function printActiveSheet() {
  const sheet = getActiveSheet();
  if (!sheet) return;
  printHtml(buildPrintHtml(sheet),
    [sheet.type === 'montage' ? 'Montagezettel' : 'Werkstattzettel', sheet.orderNo, sheet.vessel || sheet.customer, sheetFirstDate(sheet)].filter(Boolean).join('_'));
}

window.printActiveSheet = printActiveSheet;
