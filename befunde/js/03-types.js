// =====================================================================
// 03-types: Alle Blattarten (Mess- und Befundblätter) an EINER Stelle.
// Neues Blatt ergänzen = hier einen Eintrag in SHEET_TYPES anlegen.
//
// Bausteine je Blatt:
//   measure: Messtabellen  – kind 'grid' (Ebenen × Richtungen, Ovalität/Konizität)
//                           – kind 'points' (Messpunkte je Position, Mittelwert/Streuung)
//                           – kind 'clearance' (Bohrung − Welle = Spiel)
//   inspect: Sichtbefund je Position (Bewertung + typische Befunde zum Antippen)
//   special: eigene Blätter (endoscopy, nozzles, serials, general) → 06-special
//   extra:   zusätzliche Angaben im Kopf des Blatts
// Allgemein gilt: Jedes Blatt hat „Befunde & Fotos“, Gesamtbewertung, Unterschriften.
// =====================================================================

const ICONS = {
  doc: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  cart: '<path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.2"/><circle cx="9.5" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.6"/><path d="M11 13l3 3M13 11l3 3"/>',
  scope: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/><circle cx="11" cy="11" r="2"/>',
  cyl: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M7 7h10M7 17h10"/>',
  liner: '<path d="M6 4h12M6 4v16h12V4"/><path d="M9 4v16M15 4v16"/><path d="M4 4h16"/>',
  fit: '<path d="M4 6h16M4 18h16"/><path d="M8 6v12M16 6v12"/><path d="M12 9v6M10 11l2-2 2 2M10 13l2 2 2-2"/>',
  proj: '<path d="M3 15h18"/><path d="M7 15V8h10v7"/><path d="M12 4v4M10 6l2-2 2 2"/>',
  piston: '<path d="M6 5h12v6a6 6 0 0 1-12 0z"/><path d="M6 8h12"/><path d="M10 17l-1 4h6l-1-4"/>',
  crank: '<path d="M3 12h4M17 12h4"/><rect x="7" y="8" width="4" height="8" rx="1"/><rect x="13" y="8" width="4" height="8" rx="1"/><path d="M11 10h2M11 14h2"/>',
  bore: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4"/>',
  cam: '<path d="M3 12h4M17 12h4"/><path d="M7 12a4 3 0 1 0 5-3l3-1"/><circle cx="15" cy="12" r="2"/>',
  nozzle: '<path d="M10 3h4v8l2 3v2H8v-2l2-3z"/><path d="M12 16v2M9 21l3-3 3 3"/>',
  rocker: '<path d="M3 13l9-4 9 2"/><circle cx="12" cy="9.5" r="2.2"/><path d="M12 12v8M8 20h8"/><path d="M3 13v3M21 11v3"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24">${ICONS[name] || ICONS.doc}</svg>`; }

const GROUPS = [
  { id: 'allg', label: 'Allgemein' },
  { id: 'zyl', label: 'Zylinder & Brennraum' },
  { id: 'lb', label: 'Laufbuchse' },
  { id: 'kw', label: 'Kurbelwelle' },
  { id: 'nw', label: 'Nockenwelle' },
  { id: 'vt', label: 'Ventiltrieb' },
  { id: 'esp', label: 'Einspritzung' }
];

// Typische Befunde zum Antippen (Sichtprüfung)
const INSPECT_ITEMS = {
  liner: ['Honbild i.O.', 'Honbild teilw. abgetragen', 'Polierstellen (Bore Polishing)', 'Längsriefen', 'Fresser', 'Ölkohle / Verkokung', 'Korrosion', 'Kavitation (außen)', 'Risse', 'Stufe im OT-Bereich'],
  kwMain: ['Laufbild i.O.', 'Leichte Riefen', 'Tiefe Riefen', 'Anschmelzungen / Fresser', 'Verfärbung (Überhitzung)', 'Risse', 'Korrosion', 'Lagerschalen verschlissen', 'Lagerschale Materialabtrag', 'Lagerschale verdreht'],
  kwRod: ['Laufbild i.O.', 'Leichte Riefen', 'Tiefe Riefen', 'Anschmelzungen / Fresser', 'Verfärbung (Überhitzung)', 'Risse', 'Korrosion', 'Lagerschalen verschlissen', 'Lagerschale Materialabtrag'],
  cam: ['Laufbild i.O.', 'Riefen', 'Lagerbuchse verschlissen', 'Lagerbuchse verdreht', 'Pittings Nocken', 'Verschleiß Nockenspitze', 'Fresser', 'Verfärbung'],
  rocker: ['Laufbild i.O.', 'Buchse verschlissen', 'Buchse verdreht / gewandert', 'Riefen Kipphebelachse', 'Fresser', 'Verfärbung (Überhitzung)', 'Druckstück / Kugelpfanne verschlissen', 'Einstellschraube beschädigt', 'Gleitfläche / Rolle verschlissen', 'Ölbohrung zugesetzt', 'Risse', 'Bock-Auflage beschädigt'],
  liner_fit: ['Sitzfläche i.O.', 'Passungsrost', 'Korrosion Bundauflage', 'Kavitation Gehäuse', 'Dichtring-Nut beschädigt', 'Ablagerungen Kühlraum']
};

// Messmittel-Vorschläge
const TOOL_LIST = ['Innenmessschraube', 'Innenmessgerät (Messuhr)', 'Bügelmessschraube', 'Messuhr mit Halter', 'Tiefenmaß', 'Fühlerlehre', 'Messschieber', 'Düsenprüfgerät', 'Endoskop'];

// Messebenen Laufbuchse je nach Anzahl (Schlüssel bleiben gleich → alte Daten passen)
const PLANE_SETS = {
  2: [{ k: 'I', label: 'Ebene I (oben)' }, { k: 'II', label: 'Ebene II (unten)' }],
  3: [{ k: 'I', label: 'Ebene I (oben)' }, { k: 'II', label: 'Ebene II (Mitte)' }, { k: 'III', label: 'Ebene III (unten)' }],
  4: [{ k: 'I', label: 'Ebene I (oben)' }, { k: 'II', label: 'Ebene II' }, { k: 'III', label: 'Ebene III' }, { k: 'IV', label: 'Ebene IV (unten)' }]
};

const SHEET_TYPES = [
  {
    id: 'general', group: 'allg', icon: 'doc', label: 'Allgemeines Befundblatt',
    desc: 'Durchsicht / Inspektion – Feststellungen mit Fotos und Empfehlung',
    special: 'general'
  },
  {
    id: 'serials', group: 'allg', icon: 'tag', label: 'Seriennummern Bauteile',
    desc: 'HD-Pumpen, Turbolader, Pleuel, Zylinderköpfe … alt / neu',
    special: 'serials'
  },
  {
    id: 'parts', group: 'allg', icon: 'cart', label: 'Ersatzteile / Bestellliste',
    desc: 'Defekte Bauteile: bestellen, noch klären, bestellt – mit Fotos',
    special: 'parts'
  },
  {
    id: 'endoscopy', group: 'zyl', icon: 'scope', label: 'Endoskopie',
    desc: 'Brennraum je Zylinder – Bild mit A-/B-Reihe und Zählweise',
    special: 'endoscopy'
  },
  {
    id: 'piston_proj', group: 'zyl', icon: 'piston', label: 'Kolbenüberstand', printLabel: 'Überstand Kolben',
    desc: 'Überstand im OT je Zylinder',
    measure: [{
      kind: 'points', key: 'pp', title: 'Kolbenüberstand', posKind: 'cyl', dec: 2, unit: 'mm',
      points: ['Istmaß OT'], pointOptions: [1, 2, 3, 4], pointDefault: 1, sketch: 'piston',
      pointLabels: n => n === 1 ? ['Istmaß OT'] : Array.from({ length: n }, (_, i) => 'Pkt. ' + (i + 1)),
      pointHint: 'Kolben im OT – Überstand über Dichtfläche Kurbelgehäuse (negativ = Rückstand). Lage der Messpunkte siehe Skizze.',
      neighbor: false, note: true
    }]
  },
  {
    id: 'liner', group: 'lb', icon: 'liner', label: 'Laufbuchse',
    desc: 'Innendurchmesser in 3 Ebenen, Ovalität, Konizität + Sichtbefund',
    measure: [{
      kind: 'grid', key: 'lb', title: 'Innendurchmesser Laufbuchse', posKind: 'cyl', dec: 3, unit: 'mm',
      planes: PLANE_SETS[3], planeOptions: [2, 3, 4], planeDefault: 3, sketch: 'liner',
      dirs: [{ k: 'Q', label: 'A quer' }, { k: 'L', label: 'B längs' }],
      dirHint: 'A = quer (90° zur Kurbelwelle), B = längs (parallel zur Kurbelwelle) – siehe Skizze'
    }],
    inspect: [{ key: 'lbi', title: 'Sichtbefund Laufbuchse', posKind: 'cyl', items: INSPECT_ITEMS.liner }]
  },
  {
    id: 'liner_fit', group: 'lb', icon: 'fit', label: 'Laufbuchse einpassen',
    desc: 'Gehäusebohrung ↔ Buchsen-Außen-Ø oben/unten, Spiel bzw. Übermaß',
    measure: [{
      kind: 'clearance', key: 'lf', title: 'Einpassmaße Laufbuchse', posKind: 'cyl', dec: 3, unit: 'mm',
      pairs: [
        { k: 'o', label: 'Sitz oben (Bund)', bore: 'Gehäuse', shaft: 'Buchse' },
        { k: 'u', label: 'Sitz unten (Führung)', bore: 'Gehäuse', shaft: 'Buchse' }
      ],
      dirs: [{ k: 'Q', label: 'A quer' }, { k: 'L', label: 'B längs' }], sketch: 'fit',
      clrHint: 'A = quer (90° zur Kurbelwelle), B = längs (parallel zur Kurbelwelle) – siehe Skizze. Spiel = Gehäuse − Buchse (negativ = Übermaß / Pressung)', sideOption: true
    }],
    inspect: [{ key: 'lfi', title: 'Sichtbefund Sitzflächen', posKind: 'cyl', items: INSPECT_ITEMS.liner_fit }]
  },
  {
    id: 'liner_proj', group: 'lb', icon: 'proj', label: 'Laufbuchse Überstand', printLabel: 'Überstand Laufbuchse',
    desc: 'Bundüberstand über Gehäuse, 4 Messpunkte, Nachbarvergleich',
    measure: [{
      kind: 'points', key: 'lp', title: 'Buchsenüberstand', posKind: 'cyl', dec: 3, unit: 'mm',
      points: ['0°', '90°', '180°', '270°'], pointHint: '0° = Richtung KS, im Uhrzeigersinn',
      neighbor: true, note: true
    }],
    extra: [{ k: 'torque', label: 'Anzugsmoment / Spannvorrichtung' }]
  },
  {
    id: 'kw_bore', group: 'kw', icon: 'bore', label: 'Kurbelwelle Lagergasse',
    desc: 'Grundlagerbohrung im Gehäuse, Ovalität, Konizität, Fluchtung',
    measure: [{
      kind: 'grid', key: 'kb', title: 'Grundlagerbohrung (Lagergasse)', posKind: 'main', dec: 3, unit: 'mm',
      planes: [{ k: 'V', label: 'vorne (KS)' }, { k: 'H', label: 'hinten (KGS)' }],
      dirs: [{ k: 'S', label: 'senkrecht' }, { k: 'W', label: 'waagerecht' }],
      extraCol: { k: 'flu', label: 'Fluchtung', limit: true }
    }],
    extra: [
      { k: 'shells', label: 'Gemessen', options: ['ohne Lagerschalen', 'mit Lagerschalen'] },
      { k: 'torque', label: 'Lagerdeckel Anzugsmoment' }
    ]
  },
  {
    id: 'kw_journal', group: 'kw', icon: 'crank', label: 'Kurbelwelle Zapfen',
    desc: 'Grundlager- und Hublagerzapfen, Ovalität, Konizität + Befund',
    measure: [
      {
        kind: 'grid', key: 'kgl', title: 'Grundlagerzapfen', posKind: 'main', dec: 3, unit: 'mm',
        planes: [{ k: 'V', label: 'vorne' }, { k: 'H', label: 'hinten' }],
        dirs: [{ k: 'A', label: '0°' }, { k: 'B', label: '90°' }]
      },
      {
        kind: 'grid', key: 'khl', title: 'Hublagerzapfen', posKind: 'rod', dec: 3, unit: 'mm',
        planes: [{ k: 'V', label: 'vorne' }, { k: 'H', label: 'hinten' }],
        dirs: [{ k: 'A', label: '0°' }, { k: 'B', label: '90°' }]
      }
    ],
    inspect: [
      { key: 'kgli', title: 'Sichtbefund Grundlager', posKind: 'main', items: INSPECT_ITEMS.kwMain },
      { key: 'khli', title: 'Sichtbefund Hublager', posKind: 'rod', items: INSPECT_ITEMS.kwRod }
    ],
    extra: [
      { k: 'stepMain', label: 'Schleifstufe Grundlager', options: ['Standard', '−0,10', '−0,25', '−0,50', '−0,75', '−1,00'] },
      { k: 'stepRod', label: 'Schleifstufe Hublager', options: ['Standard', '−0,10', '−0,25', '−0,50', '−0,75', '−1,00'] },
      { k: 'axial', label: 'Axialspiel (mm)' },
      { k: 'runout', label: 'Rundlauf / Schlag (mm)' },
      { k: 'crack', label: 'Rissprüfung', options: ['nicht durchgeführt', 'Magnetpulver – rissfrei', 'Farbeindring – rissfrei', 'Risse festgestellt'] }
    ]
  },
  {
    id: 'cam', group: 'nw', icon: 'cam', label: 'Nockenwellenlager',
    desc: 'Lagerbohrung ↔ Lagerzapfen, Lagerspiel + Sichtbefund',
    measure: [{
      kind: 'clearance', key: 'nw', title: 'Nockenwellenlager', posKind: 'cam', dec: 3, unit: 'mm',
      pairs: [{ k: 'l', label: 'Lager', bore: 'Bohrung', shaft: 'Zapfen' }],
      dirs: [{ k: 'S', label: 'senkr.' }, { k: 'W', label: 'waager.' }],
      clrHint: 'Lagerspiel = Bohrung − Zapfen'
    }],
    inspect: [{ key: 'nwi', title: 'Sichtbefund Nockenwelle', posKind: 'cam', items: INSPECT_ITEMS.cam }],
    extra: [
      { k: 'shaft', label: 'Nockenwelle', options: ['—', 'A-Seite', 'B-Seite', 'Einlass', 'Auslass'] },
      { k: 'axial', label: 'Axialspiel (mm)' }
    ]
  },
  {
    id: 'rocker', group: 'vt', icon: 'rocker', label: 'Kipphebelböcke', printLabel: 'Kipphebelböcke',
    desc: 'Kipphebelbuchse ↔ Kipphebelachse Ein-/Auslass, Lagerspiel + Sichtbefund',
    measure: [{
      kind: 'clearance', key: 'kh', title: 'Kipphebelbuchse / Kipphebelachse', posKind: 'cyl', dec: 3, unit: 'mm',
      pairs: [
        { k: 'e', label: 'Einlass-Kipphebel', bore: 'Buchse', shaft: 'Achse' },
        { k: 'a', label: 'Auslass-Kipphebel', bore: 'Buchse', shaft: 'Achse' }
      ],
      dirs: [{ k: 'S', label: 'senkr.' }, { k: 'W', label: 'waager.' }],
      clrHint: 'Lagerspiel = Buchsenbohrung − Achsdurchmesser, je Kipphebel in zwei Richtungen'
    }],
    inspect: [{ key: 'khi', title: 'Sichtbefund Kipphebel / Böcke', posKind: 'cyl', items: INSPECT_ITEMS.rocker }],
    extra: [
      { k: 'valveIn', label: 'Ventilspiel Einlass (mm)' },
      { k: 'valveOut', label: 'Ventilspiel Auslass (mm)' },
      { k: 'torque', label: 'Anzugsmoment Kipphebelbock' }
    ]
  },
  {
    id: 'nozzles', group: 'esp', icon: 'nozzle', label: 'Düsen abdrücken',
    desc: 'Einspritzdüsen: Öffnungsdruck, Strahlbild, Dichtheit je Zylinder',
    special: 'nozzles'
  }
];

function getType(id) { return SHEET_TYPES.find(t => t.id === id) || SHEET_TYPES[0]; }
function typeHasMeasure(t) { return !!(t.measure && t.measure.length); }
function typeHasInspect(t) { return !!(t.inspect && t.inspect.length); }
function typeModes(t) { return typeHasMeasure(t) && typeHasInspect(t); }

// Welche Teile zeigt ein Blatt je nach Modus?
function showMeasure(sheet) { const t = getType(sheet.type); return typeHasMeasure(t) && sheet.mode !== 'befund'; }
function showInspect(sheet) { const t = getType(sheet.type); return typeHasInspect(t) && sheet.mode !== 'mess'; }

function sheetTitle(sheet) {
  const t = getType(sheet.type);
  if (t.special || !typeModes(t)) return (t.measure && !t.inspect ? 'Messprotokoll ' : '') + t.label;
  if (sheet.mode === 'mess') return 'Messprotokoll ' + t.label;
  if (sheet.mode === 'befund') return 'Befundblatt ' + t.label;
  return 'Mess- und Befundblatt ' + t.label;
}
function sheetKindText(sheet) {
  const t = getType(sheet.type);
  if (t.special === 'general') return 'Befundblatt';
  if (t.special === 'serials') return 'Bauteilliste';
  if (t.special === 'parts') return 'Bestellliste';
  if (t.special === 'endoscopy') return 'Befundblatt';
  if (t.special === 'nozzles') return 'Prüfprotokoll';
  if (!typeModes(t)) return 'Messblatt';
  return { mess: 'Messblatt', befund: 'Befundblatt' }[sheet.mode] || 'Mess- + Befundblatt';
}

// ---------- Positionen eines Messblocks ----------
function tablePositions(order, sheet, cfg) {
  const e = order.engines[sheet.engine || 0] || newEngine();
  const d = sheet.data[cfg.key] || {};
  return positions(e, cfg.posKind, cfg.posKind === 'cyl' ? null : (parseInt(d.count, 10) || null));
}

// =====================================================================
// Auswertung (rein rechnerisch, für Editor und Druck gleich)
// Status: 'ok' | 'obs' | 'bad' | null (nicht bewertbar)
// =====================================================================
const EPS = 1e-9;

// Wert gegen Toleranz min/max; optional Verschleißgrenze (wear) → 'obs'
function evalRange(v, min, max, wear) {
  if (v == null) return null;
  if (min == null && max == null) return null;
  const inTol = (min == null || v >= min - EPS) && (max == null || v <= max + EPS);
  if (inTol) return 'ok';
  if (wear != null) {
    const lo = Math.min(min ?? max, max ?? min, wear), hi = Math.max(min ?? max, max ?? min, wear);
    if (v >= lo - EPS && v <= hi + EPS) return 'obs';
  }
  return 'bad';
}
function evalMax(v, limit) {
  if (v == null || limit == null) return null;
  return v <= limit + EPS ? 'ok' : 'bad';
}
function specNums(spec) {
  const s = spec || {};
  const o = {};
  Object.keys(s).forEach(k => { o[k] = parseNum(s[k]); });
  return o;
}

// Ebenen × Richtungen → Ovalität je Ebene, Konizität je Richtung
function computeGrid(cfg, data, posList) {
  const sp = specNums(data.spec);
  const rows = data.rows || {};
  let bad = 0, obs = 0, measured = 0;
  const out = posList.map(pos => {
    const r = rows[pos] || {};
    const vals = {};
    const sts = [];
    cfg.planes.forEach(p => cfg.dirs.forEach(d => {
      const key = p.k + '_' + d.k;
      const n = parseNum(r[key]);
      const st = evalRange(n, sp.min, sp.max, sp.wear);
      vals[key] = { n, st };
      if (n != null) sts.push(st);
    }));
    // Ovalität: je Ebene max − min über die Richtungen
    let oval = null;
    cfg.planes.forEach(p => {
      const ns = cfg.dirs.map(d => vals[p.k + '_' + d.k].n).filter(n => n != null);
      if (ns.length >= 2) oval = Math.max(oval ?? 0, Math.max(...ns) - Math.min(...ns));
    });
    // Konizität: je Richtung max − min über die Ebenen
    let conic = null;
    if (cfg.planes.length > 1) cfg.dirs.forEach(d => {
      const ns = cfg.planes.map(p => vals[p.k + '_' + d.k].n).filter(n => n != null);
      if (ns.length >= 2) conic = Math.max(conic ?? 0, Math.max(...ns) - Math.min(...ns));
    });
    const ovalSt = evalMax(oval, sp.ovalMax);
    const conicSt = evalMax(conic, sp.conMax);
    let extra = null;
    if (cfg.extraCol) {
      const n = parseNum(r[cfg.extraCol.k]);
      extra = { n, st: cfg.extraCol.limit ? evalMax(n == null ? null : Math.abs(n), sp.extraMax) : null };
      if (extra.st) sts.push(extra.st);
    }
    if (ovalSt) sts.push(ovalSt);
    if (conicSt) sts.push(conicSt);
    const all = Object.values(vals).map(x => x.n).filter(n => n != null);
    if (all.length) measured++;
    const st = worstRating(sts);
    if (st === 'bad') bad++; else if (st === 'obs') obs++;
    return { pos, vals, oval: { n: oval, st: ovalSt }, conic: { n: conic, st: conicSt }, extra, st,
      min: all.length ? Math.min(...all) : null, max: all.length ? Math.max(...all) : null };
  });
  return { rows: out, bad, obs, measured };
}

// Messpunkte je Position → Mittelwert, Streuung (max − min), Nachbarvergleich
function computePoints(cfg, data, posList) {
  const sp = specNums(data.spec);
  const rows = data.rows || {};
  let bad = 0, obs = 0, measured = 0;
  const out = posList.map(pos => {
    const r = rows[pos] || {};
    const vals = cfg.points.map((_, i) => {
      const n = parseNum(r['p' + i]);
      return { n, st: evalRange(n, sp.min, sp.max) };
    });
    const ns = vals.map(v => v.n).filter(n => n != null);
    const mean = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
    const spread = ns.length >= 2 ? Math.max(...ns) - Math.min(...ns) : null;
    return { pos, vals, mean: { n: mean, st: evalRange(mean, sp.min, sp.max) }, spread: { n: spread, st: evalMax(spread, sp.spreadMax) }, extraText: cfg.extraCol ? (r[cfg.extraCol.k] || '') : '' };
  });
  // Nachbar: Differenz der Mittelwerte zum Vorgänger/Nachfolger derselben Bank
  out.forEach((row, i) => {
    let diff = null;
    [i - 1, i + 1].forEach(j => {
      const o = out[j];
      if (!o || bankOf(o.pos) !== bankOf(row.pos) || row.mean.n == null || o.mean.n == null) return;
      diff = Math.max(diff ?? 0, Math.abs(row.mean.n - o.mean.n));
    });
    row.neighbor = { n: cfg.neighbor ? diff : null, st: cfg.neighbor ? evalMax(diff, sp.neighborMax) : null };
    const sts = row.vals.map(v => v.st).concat([row.mean.st, row.spread.st, row.neighbor.st]).filter(Boolean);
    row.st = worstRating(sts);
    if (row.vals.some(v => v.n != null)) measured++;
    if (row.st === 'bad') bad++; else if (row.st === 'obs') obs++;
  });
  return { rows: out, bad, obs, measured };
}

// Bohrung − Welle = Spiel (je Paar, Mittelwert der Richtungen)
function computeClearance(cfg, data, posList) {
  const sp = data.spec || {};
  const rows = data.rows || {};
  let bad = 0, obs = 0, measured = 0;
  const out = posList.map(pos => {
    const r = rows[pos] || {};
    const sts = [];
    const pairs = cfg.pairs.map(pr => {
      const s = specNums(sp[pr.k]);
      const get = side => cfg.dirs.map(d => {
        const n = parseNum(r[pr.k + side + '_' + d.k]);
        return { n, st: evalRange(n, side === 'b' ? s.boreMin : s.shaftMin, side === 'b' ? s.boreMax : s.shaftMax) };
      });
      const bore = get('b'), shaft = cfg.boreOnly ? [] : get('s');
      const avg = list => { const ns = list.map(x => x.n).filter(n => n != null); return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null; };
      const bm = avg(bore), sm = avg(shaft);
      const clr = bm != null && sm != null ? bm - sm : null;
      const clrSt = evalRange(clr, s.clrMin, s.clrMax);
      bore.concat(shaft).forEach(x => x.st && sts.push(x.st));
      if (clrSt) sts.push(clrSt);
      return { k: pr.k, bore, shaft, clr: { n: clr, st: clrSt } };
    });
    if (pairs.some(p => p.bore.concat(p.shaft).some(x => x.n != null))) measured++;
    const st = worstRating(sts);
    if (st === 'bad') bad++; else if (st === 'obs') obs++;
    return { pos, pairs, st };
  });
  return { rows: out, bad, obs, measured };
}

// Messblock mit den im Blatt gewählten Ebenen / Messpunkten
function effCfg(cfg, data) {
  data = data || {};
  if (cfg.planeOptions) {
    const n = cfg.planeOptions.includes(parseInt(data.planes, 10)) ? parseInt(data.planes, 10) : cfg.planeDefault;
    cfg = { ...cfg, planes: PLANE_SETS[n], nPlanes: n };
  }
  if (cfg.pointOptions) {
    const n = cfg.pointOptions.includes(parseInt(data.points, 10)) ? parseInt(data.points, 10) : cfg.pointDefault;
    cfg = { ...cfg, points: cfg.pointLabels(n), nPoints: n };
  }
  // Einpassen: nur Gehäusebohrung messen (z.B. wenn die Buchsen sowieso neu kommen)
  if (cfg.sideOption) cfg = { ...cfg, boreOnly: data.sides === 'bore' };
  return cfg;
}

function computeTable(cfg, data, posList) {
  data = data || {};
  cfg = effCfg(cfg, data);
  if (cfg.kind === 'grid') return computeGrid(cfg, data, posList);
  if (cfg.kind === 'points') return computePoints(cfg, data, posList);
  return computeClearance(cfg, data, posList);
}

// Bewertungen aller Sichtbefunde eines Blatts
function inspectRatings(sheet, cfg, posList) {
  const d = sheet.data[cfg.key] || {};
  const rows = d.rows || {};
  return posList.map(p => (rows[p] || {}).rating).filter(Boolean);
}

// Automatischer Vorschlag für die Gesamtbewertung
function sheetAutoRating(order, sheet) {
  const t = getType(sheet.type);
  const list = [];
  if (showMeasure(sheet)) t.measure.forEach(cfg => {
    const res = computeTable(cfg, sheet.data[cfg.key], tablePositions(order, sheet, cfg));
    if (res.bad) list.push('bad'); else if (res.obs) list.push('obs'); else if (res.measured) list.push('ok');
  });
  if (showInspect(sheet)) t.inspect.forEach(cfg => list.push(...inspectRatings(sheet, cfg, tablePositions(order, sheet, cfg))));
  if (t.special && typeof specialAutoRating === 'function') list.push(...specialAutoRating(order, sheet));
  sheet.findings.forEach(f => f.rating && list.push(f.rating));
  return worstRating(list);
}

function sheetRating(order, sheet) {
  return sheet.rating || sheetAutoRating(order, sheet);
}
