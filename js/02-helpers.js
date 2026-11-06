// =====================================================================
// 02-helpers: Escaping, IDs, Zeit- und Datumsfunktionen, Stundenrechnung
// =====================================================================

const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const AWAY_OPTIONS = [
  { value: '', label: 'Keine Abwesenheit' },
  { value: '8h', label: '≥ 8,25 h weg von SDT' },
  { value: '24h', label: '24 h weg' }
];

const VEHICLE_OPTIONS = ['Firmenwagen', 'Privat-PKW', 'Mitfahrer', 'Bahn', 'Flugzeug', 'Fähre', 'Sonstiges'];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- Uhrzeiten ----------
// Akzeptiert "0630", "630", "6:30", "06.30", "6", "18" → Minuten seit 0 Uhr
function parseTime(text) {
  if (text == null) return null;
  let t = String(text).trim().replace(/[.,h]/g, ':');
  if (!t) return null;
  let h, m;
  if (t.includes(':')) {
    const [a, b] = t.split(':');
    h = parseInt(a, 10); m = parseInt(b || '0', 10);
  } else if (/^\d{1,2}$/.test(t)) {
    h = parseInt(t, 10); m = 0;
  } else if (/^\d{3,4}$/.test(t)) {
    h = parseInt(t.slice(0, -2), 10); m = parseInt(t.slice(-2), 10);
  } else return null;
  if (isNaN(h) || isNaN(m) || m > 59 || h > 24 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

function formatClock(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Dauer eines Eintrags in Minuten (über Mitternacht wird korrekt gerechnet)
function entryMinutes(entry) {
  const a = parseTime(entry.from), b = parseTime(entry.to);
  if (a == null || b == null) return 0;
  return b >= a ? b - a : b + 1440 - a;
}

// Minuten → "8,25 h" (Dezimalstunden, wie auf Montagezetteln üblich)
function formatHours(min, withSign) {
  const h = (min || 0) / 60;
  const txt = h.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (withSign && h > 0 ? '+' : '') + txt + ' h';
}

// Dauer-Eingabe für Fahrzeit "2:30" oder "2,5" → Minuten
function parseDuration(text) {
  if (text == null || String(text).trim() === '') return null;
  const t = String(text).trim();
  if (t.includes(':')) {
    const [a, b] = t.split(':');
    const h = parseInt(a || '0', 10), m = parseInt(b || '0', 10);
    return isNaN(h) || isNaN(m) ? null : h * 60 + m;
  }
  const n = parseFloat(t.replace(',', '.'));
  return isNaN(n) ? null : Math.round(n * 60);
}

// ---------- Datum ----------
function toISODate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function todayISO() { return toISODate(new Date()); }

function parseISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function addDaysISO(iso, n) {
  const d = parseISODate(iso) || new Date();
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function formatDate(iso, withWeekday = true) {
  const d = parseISODate(iso);
  if (!d) return '–';
  const txt = String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
  return withWeekday ? WEEKDAYS_SHORT[d.getDay()] + ', ' + txt : txt;
}

function formatDateShort(iso) {
  const d = parseISODate(iso);
  if (!d) return '–';
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.';
}

// ISO-Kalenderwoche
function isoWeek(iso) {
  const d = parseISODate(iso);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

// ---------- Auftragsnummern (Format SR26/000249) ----------
// "249" → "SR26/000249" (Jahr aus dem Datum), "26/249" / "sr26/249" / "SR26000249" → "SR26/000249".
// allowDigitsOnly=false: reine Zahlen bleiben stehen (z.B. dreistellige Kostenstellen).
function formatOrderNo(input, dateIso, allowDigitsOnly = true) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let m = raw.match(/^(?:sr)?\s*(\d{2})\s*\/\s*(\d{1,6})$/i);
  if (m) return 'SR' + m[1] + '/' + m[2].padStart(6, '0');
  m = raw.match(/^sr\s*(\d{2})(\d{6})$/i);
  if (m) return 'SR' + m[1] + '/' + m[2];
  if (allowDigitsOnly && /^\d{1,6}$/.test(raw)) {
    const yy = (dateIso || todayISO()).slice(2, 4);
    return 'SR' + yy + '/' + raw.padStart(6, '0');
  }
  return raw;
}

// Kostenstelle „P“ / „Pause“ zählt nicht als Arbeitszeit
function isPauseCost(cost) {
  return /^(p|pause)$/i.test(String(cost || '').trim());
}

function getCostCenter(no) {
  const n = String(no || '').trim().toLowerCase();
  return (appData.settings.costCenters || []).find(c => String(c.no).trim().toLowerCase() === n) || null;
}

// ---------- Motoren ----------
// Ein Zettel hat 1–4 Motoren (sheet.engines). Jeder Motor kann optional eine
// eigene Bezeichnung haben (engine.name, z.B. „BB“, „Steuerbord“, „Hauptmotor“).
// Ohne Bezeichnung heißen sie „Motor 1“, „Motor 2“ …
// Ältere Zettel mit Benennungs-Umschalter (sheet.engineNaming) werden weiter so angezeigt.
const MAX_ENGINES = 4;
const LEGACY_ENGINE_NAMES = { bbsb: ['BB', 'SB'], ab: ['A', 'B', 'C', 'D'], num: ['1', '2', '3', '4'] };

// Anzeigename eines Motors; bei nur einem Motor ohne eigene Bezeichnung leer
function engineLabel(sheet, i) {
  const engines = sheet.engines || [];
  const e = engines[i] || {};
  const name = String(e.name || '').trim();
  if (name) return name;
  if (engines.length < 2) return '';
  const legacy = LEGACY_ENGINE_NAMES[sheet.engineNaming];
  if (legacy && legacy[i]) return 'Motor ' + legacy[i];
  return 'Motor ' + (i + 1);
}

// Titel für Überschriften/Rückfragen (nie leer)
function engineTitle(sheet, i) {
  return engineLabel(sheet, i) || 'Motor';
}

function engineHasData(e) {
  return !!(e && (e.name || e.make || e.model || e.number || e.hours));
}

// ---------- Zeitarten ----------
function getCode(code) {
  return appData.settings.codes.find(c => c.code === code) || null;
}

function codeCounts(code) {
  const c = getCode(code);
  return c ? c.counts !== false : true; // unbekannte Codes zählen sicherheitshalber mit
}

// ---------- Stundenrechnung ----------
// Zentrale Rechnung je Tag eines Zettels (daySplit):
//  - Anfahrt-Zeit zählt als Fahrzeit (FZ) am Anfang ihres Tages,
//    Rückfahrt-Zeit am Ende ihres Tages
//  - Zeilen werden nach Startzeit durchgezählt; bis zum Soll = Normalstunden,
//    ab der ersten Minute darüber = Überstunden
//  - Zeitarten mit counts:false (Pause) zählen nicht

const TRAVEL_KEYS = [
  { key: 'travelOut', label: 'Anfahrt' },
  { key: 'travelBack', label: 'Rückfahrt' }
];

// Ist An-/Rückfahrt auf diesem Zettel eingeschaltet?
// Ältere Daten ohne "on"-Feld: aktiv, sobald eine Fahrzeit eingetragen ist
function travelActive(t) {
  if (!t) return false;
  if (t.on === true) return true;
  if (t.on === false) return false;
  return !!parseDuration(t.duration);
}

function travelMinutes(t) {
  if (!t) return 0;
  const m = parseDuration(t.duration);
  return m && m > 0 ? m : 0;
}

// Index des Tages, dem An-/Rückfahrt zugeordnet wird:
// Datum der Fahrt, sonst erster bzw. letzter Tag des Zettels
function travelDayIndex(sheet, key) {
  if (!sheet.days.length) return -1;
  const t = sheet[key] || {};
  if (t.date) {
    const i = sheet.days.findIndex(d => d.date === t.date);
    if (i >= 0) return i;
  }
  let best = 0;
  sheet.days.forEach((d, i) => {
    const a = d.date || '', b = sheet.days[best].date || '';
    if (key === 'travelOut' ? a < b : a > b) best = i;
  });
  return best;
}

function daySplit(sheet, di) {
  const day = sheet.days[di];
  const target = dayTargetMinutes(day.date);
  const lines = [];
  const travel = {};
  TRAVEL_KEYS.forEach(({ key, label }) => {
    if (sheet.type !== 'montage') return;
    const m = travelActive(sheet[key]) ? travelMinutes(sheet[key]) : 0;
    if (m && travelDayIndex(sheet, key) === di) {
      travel[key] = { kind: 'travel', key, label, minutes: m, counts: true, code: 'FZ' };
    }
  });
  if (travel.travelOut) lines.push(travel.travelOut);
  const order = day.entries.map((e, i) => i).sort((a, b) => {
    const ta = parseTime(day.entries[a].from), tb = parseTime(day.entries[b].from);
    if (ta == null && tb == null) return a - b;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb || a - b;
  });
  const byEntry = day.entries.map(() => null);
  order.forEach(i => {
    const e = day.entries[i];
    const isCost = sheet.type === 'werkstatt' && e.cost !== undefined;
    const line = {
      kind: 'entry', index: i, entry: e, minutes: entryMinutes(e),
      counts: isCost ? !isPauseCost(e.cost) : codeCounts(e.code),
      code: isCost ? (String(e.cost || '').trim() || '–') : e.code
    };
    byEntry[i] = line;
    lines.push(line);
  });
  if (travel.travelBack) lines.push(travel.travelBack);

  let used = 0;
  lines.forEach(l => {
    if (!l.counts) { l.normal = 0; l.ot = 0; return; }
    l.normal = Math.max(0, Math.min(l.minutes, target - used));
    l.ot = l.minutes - l.normal;
    used += l.minutes;
  });
  const normal = lines.reduce((a, l) => a + l.normal, 0);
  const ot = lines.reduce((a, l) => a + l.ot, 0);
  return { lines, byEntry, travel, target, worked: normal + ot, normal, ot };
}

// Gearbeitete Minuten eines Tages eines Zettels (inkl. Fahrzeit)
function dayWorkedMinutes(sheet, di) {
  return daySplit(sheet, di).worked;
}

// Summen eines Zettels: { worked, normal, ot }
function sheetTotals(sheet) {
  return sheet.days.reduce((acc, d, di) => {
    const s = daySplit(sheet, di);
    acc.worked += s.worked; acc.normal += s.normal; acc.ot += s.ot;
    return acc;
  }, { worked: 0, normal: 0, ot: 0 });
}

function sheetWorkedMinutes(sheet) {
  return sheetTotals(sheet).worked;
}

// Minuten je Zeitart eines Zettels, z.B. { AZ: 900, FZ: 120 } (Fahrten als FZ)
function sheetMinutesByCode(sheet) {
  const res = {};
  sheet.days.forEach((d, di) => daySplit(sheet, di).lines.forEach(l => {
    if (!l.minutes) return;
    const k = l.code || '?';
    res[k] = (res[k] || 0) + l.minutes;
  }));
  return res;
}

function sheetDateRange(sheet) {
  const dates = sheet.days.map(d => d.date).filter(Boolean).sort();
  if (!dates.length) return '';
  if (dates[0] === dates[dates.length - 1]) return formatDate(dates[0]);
  return formatDateShort(dates[0]) + ' – ' + formatDate(dates[dates.length - 1], false);
}

function sheetFirstDate(sheet) {
  const dates = sheet.days.map(d => d.date).filter(Boolean).sort();
  return dates[0] || '';
}

// Sollminuten für ein Datum laut Einstellungen (ohne Abwesenheiten)
function baseTargetMinutes(iso) {
  const d = parseISODate(iso);
  if (!d) return 0;
  return Math.round((Number(appData.settings.targets[d.getDay()]) || 0) * 60);
}

function daysOffFor(iso) {
  return appData.daysOff.filter(o => o.date === iso);
}

// Übersicht eines Datums: gearbeitet, Soll, Differenz, Quellen
// Regeln:
//  - Tage ohne Einträge und ohne Abwesenheit zählen nicht (kein Minus)
//  - Freier Tag (Überstundenabbau): Soll bleibt → Minus in Höhe der Sollzeit
//  - Urlaub / Krank / Feiertag: Soll = 0 → gearbeitete Zeit wären komplett Überstunden
//  - Korrektur: fester Plus/Minus-Wert (z.B. ausgezahlte Überstunden)
function dayInfo(iso) {
  const sources = [];
  let worked = 0;
  appData.sheets.forEach(sh => sh.days.forEach((d, di) => {
    if (d.date !== iso || !isOwnSheet(sh)) return;
    const m = dayWorkedMinutes(sh, di);
    if (m || d.entries.length) sources.push({ sheet: sh, minutes: m });
    worked += m;
  }));
  const offs = daysOffFor(iso);
  let target = baseTargetMinutes(iso);
  let correction = 0;
  let counted = worked > 0;
  offs.forEach(o => {
    if (o.type === 'abbau') counted = true;
    else if (o.type === 'korrektur') correction += Math.round((Number(o.hours) || 0) * 60);
    else target = 0; // Urlaub, Krank, Feiertag
  });
  const delta = (counted ? worked - target : 0) + correction;
  return { date: iso, worked, target: counted ? target : 0, delta, sources, offs, counted };
}

// Gehört der Zettel dem angemeldeten Techniker? (Zettel ohne Namen zählen immer)
function isOwnSheet(sh) {
  const me = String(appData.settings.name || '').trim().toLowerCase();
  return !sh.worker || !me || String(sh.worker).trim().toLowerCase() === me;
}

// Alle Daten, an denen irgendetwas erfasst ist
function allRelevantDates() {
  const set = new Set();
  appData.sheets.forEach(sh => sh.days.forEach(d => { if (d.date) set.add(d.date); }));
  appData.daysOff.forEach(o => { if (o.date) set.add(o.date); });
  return Array.from(set).sort();
}

// Gesamtes Überstundenkonto in Minuten
function overtimeBalance(untilIso) {
  let total = Math.round((Number(appData.settings.startBalance) || 0) * 60);
  allRelevantDates().forEach(iso => {
    if (untilIso && iso > untilIso) return;
    total += dayInfo(iso).delta;
  });
  return total;
}

// Datei herunterladen (Backup)
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// Soll eines Tages für die Überstunden auf dem Zettel:
// Urlaub/Krank/Feiertag → 0, sonst Soll laut Wochentag
function dayTargetMinutes(iso) {
  if (daysOffFor(iso).some(o => o.type === 'urlaub' || o.type === 'krank' || o.type === 'feiertag')) return 0;
  return baseTargetMinutes(iso);
}
