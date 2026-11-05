// =====================================================================
// 06-print: Druckansicht eines Zettels (A4) – über den Druckdialog auch
// als PDF speicherbar
// =====================================================================

function yesNoText(v) { return v === true ? 'Ja' : v === false ? 'Nein' : '–'; }

function awayText(v) {
  const o = AWAY_OPTIONS.find(x => x.value === (v || ''));
  return v ? o.label : '–';
}

function travelRow(label, t) {
  t = t || {};
  const vehicle = t.vehicle === 'Firmenwagen' && t.plate ? `Firmenwagen (${t.plate})` : (t.vehicle || '–');
  return `<tr>
    <th>${label}</th>
    <td>${escapeHtml(formatDate(t.date, false) === '–' ? '' : formatDate(t.date, false))}</td>
    <td>${escapeHtml(t.from || '–')} → ${escapeHtml(t.to || '–')}</td>
    <td class="num">${escapeHtml(t.km ? t.km + ' km' : '–')}</td>
    <td class="num">${(() => { const m = parseDuration(t.duration); return m != null ? formatHours(m) : '–'; })()}</td>
    <td>${escapeHtml(vehicle)}</td>
  </tr>`;
}

function buildPrintHtml(sheet) {
  const isMontage = sheet.type === 'montage';
  const s = appData.settings;
  const byCode = sheetMinutesByCode(sheet);
  const totals = sheetTotals(sheet);
  const num = m => m ? formatHours(m).replace(' h', '') : '';
  // Tage chronologisch, Index für daySplit merken
  const days = sheet.days.map((d, di) => ({ d, di })).sort((a, b) => (a.d.date || '').localeCompare(b.d.date || ''));

  const dayRows = days.map(({ d, di }) => {
    const split = daySplit(sheet, di);
    const lines = split.lines;
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
    if (isMontage && (d.away || d.hotel)) {
      const parts = [];
      if (d.away) parts.push('Abwesenheit: ' + awayText(d.away));
      if (d.hotel) parts.push('Hotel: ' + (d.hotelName || 'ja') + ' · Frühstück: ' + yesNoText(d.breakfast));
      extra = `<tr class="day-extra"><td></td><td colspan="6">${escapeHtml(parts.join('   |   '))}</td></tr>`;
    }
    return rows + extra + `<tr class="day-total"><td colspan="4">Summe ${escapeHtml(formatDateShort(d.date))}${split.worked ? ' · gesamt ' + formatHours(split.worked) : ''}</td><td class="num">${num(split.normal) || '0,00'}</td><td class="num ot">${num(split.ot)}</td><td></td></tr>`;
  }).join('');

  const legend = appData.settings.codes.map(c => `${escapeHtml(c.code)} = ${escapeHtml(c.label)}`).join(' · ');
  const codeTotals = Object.keys(byCode).map(k => `<span><b>${escapeHtml(k)}</b> ${formatHours(byCode[k])}</span>`).join('');

  const sigImg = sig => sig && sig.img ? `<img src="${sig.img}" alt="">` : '';
  const sigMeta = sig => sig ? escapeHtml([sig.name, sig.at ? new Date(sig.at).toLocaleDateString('de-DE') : ''].filter(Boolean).join(', ')) : '';

  return `
    <div class="pr-page">
      <div class="pr-head">
        <div>
          <div class="pr-title">${isMontage ? 'Montagezettel' : 'Werkstattzettel'}</div>
          <div class="pr-sub">${escapeHtml(sheetDateRange(sheet))}</div>
        </div>
        <div class="pr-worker">
          <span>Monteur</span>
          <strong>${escapeHtml(s.name || '______________________')}</strong>
        </div>
      </div>

      ${isMontage ? `
      <table class="pr-info">
        <tr><th>Auftragsnummer</th><td>${escapeHtml(sheet.orderNo || '–')}</td>
            <th>Auftraggeber / Kunde</th><td>${escapeHtml(sheet.customer || '–')}</td></tr>
        <tr><th>Schiff / Anlage</th><td colspan="3">${escapeHtml(sheet.vessel || '–')}</td></tr>
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

      ${isMontage ? `
      <table class="pr-travel">
        <thead><tr><th></th><th>Datum</th><th>Strecke</th><th>Km</th><th>Zeit</th><th>Verkehrsmittel</th></tr></thead>
        <tbody>${travelRow('Anfahrt', sheet.travelOut)}${travelRow('Rückfahrt', sheet.travelBack)}</tbody>
      </table>

      <table class="pr-info">
        <tr><th>Material verwendet</th><td>${yesNoText(sheet.material)}</td>
            <th>Montage beendet</th><td>${yesNoText(sheet.finished)}</td></tr>
        ${sheet.material === true && sheet.materialNote ? `<tr><th>Material</th><td colspan="3" class="pre">${escapeHtml(sheet.materialNote)}</td></tr>` : ''}
        ${sheet.note ? `<tr><th>Bemerkung</th><td colspan="3" class="pre">${escapeHtml(sheet.note)}</td></tr>` : ''}
      </table>

      <div class="pr-signs">
        <div class="pr-sign"><div class="pr-sign-img">${sigImg(sheet.signWorker)}</div><div class="pr-sign-line">Unterschrift Monteur ${sigMeta(sheet.signWorker) ? '· ' + sigMeta(sheet.signWorker) : ''}</div></div>
        <div class="pr-sign"><div class="pr-sign-img">${sigImg(sheet.signCustomer)}</div><div class="pr-sign-line">Unterschrift Kunde ${sigMeta(sheet.signCustomer) ? '· ' + sigMeta(sheet.signCustomer) : ''}</div></div>
      </div>` : (sheet.note ? `<table class="pr-info"><tr><th>Bemerkung</th><td class="pre">${escapeHtml(sheet.note)}</td></tr></table>` : '')}

      <div class="pr-foot">Erstellt mit Zettel-Job · ${escapeHtml(new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}</div>
    </div>`;
}

function printActiveSheet() {
  const sheet = getActiveSheet();
  if (!sheet) return;
  flushSave();
  document.getElementById('print-area').innerHTML = buildPrintHtml(sheet);
  const oldTitle = document.title;
  // Dateiname-Vorschlag für "Als PDF speichern"
  document.title = [sheet.type === 'montage' ? 'Montagezettel' : 'Werkstattzettel', sheet.orderNo, sheet.vessel || sheet.customer, sheetFirstDate(sheet)]
    .filter(Boolean).join('_').replace(/[\\/:*?"<>|]+/g, '-');
  setTimeout(() => {
    window.print();
    document.title = oldTitle;
  }, 50);
}

window.printActiveSheet = printActiveSheet;
