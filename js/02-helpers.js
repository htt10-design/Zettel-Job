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

// ---------- Zeitarten ----------
function getCode(code) {
  return appData.settings.codes.find(c => c.code === code) || null;
}

function codeCounts(code) {
  const c = getCode(code);
  return c ? c.counts !== false : true; // unbekannte Codes zählen sicherheitshalber mit
}

// ---------- Stundenrechnung ----------
// Gearbeitete Minuten eines Tages eines Zettels (nur zählende Zeitarten)
function dayWorkedMinutes(day) {
  return day.entries.reduce((sum, e) => sum + (codeCounts(e.code) ? entryMinutes(e) : 0), 0);
}

function sheetWorkedMinutes(sheet) {
  return sheet.days.reduce((sum, d) => sum + dayWorkedMinutes(d), 0);
}

// Minuten je Zeitart eines Zettels, z.B. { AZ: 900, FZ: 120 }
function sheetMinutesByCode(sheet) {
  const res = {};
  sheet.days.forEach(d => d.entries.forEach(e => {
    const m = entryMinutes(e);
    if (!m) return;
    const k = e.code || '?';
    res[k] = (res[k] || 0) + m;
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
  appData.sheets.forEach(sh => sh.days.forEach(d => {
    if (d.date !== iso) return;
    const m = dayWorkedMinutes(d);
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

// Überstunden je Zeile eines Tages: Zeilen werden nach Startzeit
// durchgezählt, ab der ersten Minute über dem Soll zählt alles als
// Überstunde. Rückgabe: Array (gleiche Reihenfolge wie day.entries)
function dayOvertimeSplit(day) {
  const target = dayTargetMinutes(day.date);
  const order = day.entries.map((e, i) => i).sort((a, b) => {
    const ta = parseTime(day.entries[a].from), tb = parseTime(day.entries[b].from);
    if (ta == null && tb == null) return a - b;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb || a - b;
  });
  const result = day.entries.map(() => 0);
  let used = 0;
  order.forEach(i => {
    const e = day.entries[i];
    if (!codeCounts(e.code)) return;
    const m = entryMinutes(e);
    const normal = Math.max(0, Math.min(m, target - used));
    result[i] = m - normal;
    used += m;
  });
  return result;
}

function dayOvertimeMinutes(day) {
  return dayOvertimeSplit(day).reduce((a, b) => a + b, 0);
}

function sheetOvertimeMinutes(sheet) {
  return sheet.days.reduce((sum, d) => sum + dayOvertimeMinutes(d), 0);
}
