// =====================================================================
// 02-helpers: Escaping, IDs, Datum, Zahlen (Komma!), Auftragsnummer,
// Motorpositionen (Zylinder A/B, Lager), Bewertungen, Pfad-Helfer
// =====================================================================

const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

// Bewertungen – überall gleich (Messwerte, Befunde, Zylinder, Gesamt)
const RATINGS = [
  { v: 'ok', label: 'i.O.', long: 'in Ordnung', sym: '✓' },
  { v: 'obs', label: 'beobachten', long: 'beobachten / Grenzwertig', sym: '◐' },
  { v: 'bad', label: 'n.i.O.', long: 'nicht in Ordnung', sym: '✗' }
];
function ratingInfo(v) { return RATINGS.find(r => r.v === v) || null; }
function ratingLabel(v) { const r = ratingInfo(v); return r ? r.label : '–'; }
function worstRating(list) {
  if (list.includes('bad')) return 'bad';
  if (list.includes('obs')) return 'obs';
  if (list.includes('ok')) return 'ok';
  return null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- Datum ----------
function toISODate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function todayISO() { return toISODate(new Date()); }
function parseISODate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function formatDate(iso) {
  const d = parseISODate(iso);
  return d ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
}

// ---------- Zahlen ----------
// "165,023" / "165.023" / " -0,05 " → Number, sonst null
function parseNum(text) {
  if (text == null) return null;
  // Minus auch als „−“ / „–“ (manche Tastaturen) akzeptieren
  const t = String(text).trim().replace(/\s/g, '').replace(/[−–]/g, '-').replace(',', '.');
  if (!t || !/^[-+]?\d*\.?\d+$/.test(t) && !/^[-+]?\d+\.?$/.test(t)) return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}
function formatNum(n, dec = 3) {
  if (n == null || isNaN(n)) return '';
  return n.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: false });
}

// Schnelleingabe: bei Durchmessern (Nennmaß ≥ 10) nur µm eintippen.
// "23" → Nennmaß + 0,023 · "-8" → Nennmaß − 0,008. Mit Komma = absoluter Wert.
function expandQuick(text, nominal, dec = 3) {
  const t = String(text || '').trim().replace(/[−–]/g, '-');
  if (!appData.settings.quickInput) return null;
  if (nominal == null || Math.abs(nominal) < 10) return null;
  if (!/^[-+]?\d{1,3}$/.test(t)) return null;
  const v = nominal + parseInt(t, 10) / 1000;
  return formatNum(v, dec);
}

// ---------- Auftragsnummer (wie Zettel-Job: SR26/000249) ----------
function formatOrderNo(input, dateIso) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let m = raw.match(/^(?:sr)?\s*(\d{2})\s*\/\s*(\d{1,6})$/i);
  if (m) return 'SR' + m[1] + '/' + m[2].padStart(6, '0');
  m = raw.match(/^sr\s*(\d{2})(\d{6})$/i);
  if (m) return 'SR' + m[1] + '/' + m[2];
  if (/^\d{1,6}$/.test(raw)) {
    const yy = (dateIso || todayISO()).slice(2, 4);
    return 'SR' + yy + '/' + raw.padStart(6, '0');
  }
  return raw;
}

// ---------- Motor & Positionen ----------
function engineCyl(e) { return Math.max(1, Math.min(24, parseInt(e && e.cylinders, 10) || 1)); }
function isV(e) { return e && e.layout === 'V' && engineCyl(e) >= 2; }

function engineLabel(order, idx) {
  const e = order.engines[idx] || {};
  if (e.name) return e.name;
  return order.engines.length > 1 ? 'Motor ' + (idx + 1) : 'Motor';
}
function engineTypeText(e) {
  const cyl = engineCyl(e);
  const cfg = e.layout === 'V' ? cyl + 'V' : 'R' + cyl;
  return [e.make, e.model].filter(Boolean).join(' ') + (e.model && /\d+V|R\d+/i.test(e.model) ? '' : ' (' + cfg + ')');
}

// Positionslisten je nach Motor:
//  cyl  = Zylinder (V: A1…An, B1…Bn · Reihe: 1…n)
//  main = Grundlager · rod = Hublagerzapfen · cam = Nockenwellenlager
function defaultCount(e, kind) {
  const n = engineCyl(e);
  const v = isV(e);
  if (kind === 'cyl') return n;
  if (kind === 'main') return (v ? Math.ceil(n / 2) : n) + 1;
  if (kind === 'rod') return v ? Math.ceil(n / 2) : n;
  if (kind === 'cam') return (v ? Math.ceil(n / 2) : n) + 1;
  return n;
}

function positions(e, kind, count) {
  if (kind === 'cyl') {
    const n = engineCyl(e);
    if (isV(e)) {
      const half = Math.ceil(n / 2);
      const a = [], b = [];
      for (let i = 1; i <= half; i++) a.push('A' + i);
      for (let i = 1; i <= n - half; i++) b.push('B' + i);
      return a.concat(b);
    }
    return Array.from({ length: n }, (_, i) => String(i + 1));
  }
  const c = count || defaultCount(e, kind);
  return Array.from({ length: c }, (_, i) => String(i + 1));
}

// Zylinderbank eines Labels ("A3" → "A")
function bankOf(label) { const m = /^([AB])\d+$/.exec(label); return m ? m[1] : ''; }

// ---------- Pfad-Helfer (data-bind="data.rows.3.v") ----------
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(k) ? {} : {};
    return o[k];
  }, obj);
  target[last] = value;
}

// ---------- Kleine UI-Bausteine ----------
function field(label, bind, value, opts = {}) {
  const type = opts.type || 'text';
  const attrs = [
    `type="${type}"`,
    `data-bind="${bind}"`,
    `value="${escapeHtml(value ?? '')}"`,
    opts.placeholder ? `placeholder="${escapeHtml(opts.placeholder)}"` : '',
    opts.inputmode ? `inputmode="${opts.inputmode}"` : '',
    opts.list ? `list="${opts.list}"` : '',
    opts.rerender ? 'data-rerender="1"' : '',
    opts.orderno ? 'data-orderno="1"' : '',
    opts.num ? 'data-num="1"' : '',
    'autocomplete="off"'
  ].filter(Boolean).join(' ');
  return `<label class="field ${opts.cls || ''}"><span>${escapeHtml(label)}</span><input ${attrs}></label>`;
}

function selectField(label, bind, value, options, opts = {}) {
  const opt = options.map(o => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option value="${escapeHtml(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${escapeHtml(l)}</option>`;
  }).join('');
  return `<label class="field ${opts.cls || ''}"><span>${escapeHtml(label)}</span><select data-bind="${bind}" ${opts.rerender ? 'data-rerender="1"' : ''}>${opt}</select></label>`;
}

function textArea(label, bind, value, opts = {}) {
  return `<label class="field ${opts.cls || ''}"><span>${escapeHtml(label)}</span><textarea data-bind="${bind}" rows="${opts.rows || 3}" placeholder="${escapeHtml(opts.placeholder || '')}">${escapeHtml(value || '')}</textarea></label>`;
}

// Bewertungs-Schalter i.O. / beobachten / n.i.O. (nochmal tippen = zurücknehmen)
function ratingSeg(bind, value, opts = {}) {
  return `<div class="rate-seg ${opts.small ? 'small' : ''}">${RATINGS.map(r =>
    `<button type="button" class="r-${r.v} ${value === r.v ? 'on' : ''}" data-set="${bind}" data-val="${r.v}">${opts.small ? r.sym + ' ' + escapeHtml(r.v === 'obs' ? 'beob.' : r.label) : escapeHtml(r.label)}</button>`).join('')}</div>`;
}

function ratingBadge(v, text) {
  if (!v) return `<span class="badge">${escapeHtml(text || 'offen')}</span>`;
  return `<span class="badge rb-${v}">${escapeHtml(text || ratingLabel(v))}</span>`;
}

Object.assign(window, { formatOrderNo });
