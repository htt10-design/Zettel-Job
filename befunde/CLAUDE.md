# Bereich Befunde (`befunde/`) der Service-App

Übernommen aus dem Repo htt10-design/befunde (Stand: Abgleich über PocketBase). Dateipfade unten relativ zu `befunde/`.
Manifest und Service Worker liegen in der Wurzel (`../manifest.json`, `../sw.js`, `register('../sw.js')`);
oben rechts `#btn-home` zur Startseite. Tests: `node tools/befunde/smoke-test.js`, `node tools/befunde/sync-test.js`
(aus der Wurzel). Server-Migration: `tools/pocketbase/pb_migrations/1763200000_befunde.js`.

Offline-fähige Single-Page-PWA für Mess- und Befundblätter an Motoren (Laufbuchsen, Kurbelwelle, Nockenwelle,
Endoskopie, Düsen, Seriennummern, allgemeine Durchsicht). Design, Aufbau und Konventionen wie **Zettel-Job**
(Schwester-App, später verknüpft). Kein Build-Schritt, keine Abhängigkeiten. Daten lokal (offline zuerst), optional Abgleich über den eigenen PocketBase-Server von Zettel-Job (12-sync). UI-Sprache und Kommentare: Deutsch.

## Aufbau

| Datei | Inhalt |
|---|---|
| 01-core | `appData` (settings, orders, specs), IndexedDB `befunde` (Stores `store` + `files` für Fotos), `showView`, Theme, Modal, Toast |
| 02-helpers | `escapeHtml`, Datum, Zahlen mit Komma (`parseNum`/`formatNum`), µm-Schnelleingabe (`expandQuick`), `formatOrderNo` (wie Zettel-Job), Motorpositionen (`positions`: cyl/main/rod/cam), Bewertungen (`RATINGS` ok/obs/bad), UI-Bausteine (`field`, `ratingSeg` …) |
| 03-types | **Alle Blattarten in `SHEET_TYPES`** (Gruppen `GROUPS`: allg, zyl, lb, kw, nw, vt = Ventiltrieb mit „Kipphebelböcke“ `rocker`: Buchse ↔ Achse Ein-/Auslass je Zylinder, clearance) + Auswertung (`computeGrid/Points/Clearance`, `sheetAutoRating`) |
| 04-orders | Auftragsliste, Neuer Auftrag, Übernahme aus Zettel-Job (liest IndexedDB `zettel-job` nur lesend), Auftrag mit Motoren, Blatt hinzufügen (Modus mess/befund/beides, Pakete), `createSheet` |
| 05-editor | Blatt-Editor: `bindForm` (data-bind/data-set/data-tag, Event-Delegation), Messtabellen + `refreshMeasure`, Sichtbefund, Befunde & Fotos, Ergebnis, Blatt-Menü |
| 06-special | Endoskopie (SVG Draufsicht, KS links, A oben), **Druckprobe Einspritzdüsen** (immer als Paar `createNozzlePair`: `data.stage` 'in' Eingang / 'out' Ausgang; Düsenliste `data.nozzles` [{ k, label }] frei benennbar/Anzahl änderbar (`nozzleSetCount`, `nozzleRename`, `nozzleRemove`, Vorschlag `nozzleSuggest` Zylinder/1,2,3; ohne eigene Liste: vom Gegenstück, sonst Zylinder als Vorschlag `nozzleItems`), je Düse `rows[k] = { sn, p, result, note }`, Befund-Bausteine `nozzleChip`, `nozzleAllOk`; optional Förderbeginn `data.pump` Soll/Ist/Neu; leere Angaben/Werte kommen vom Gegenstück `nozzlePartner`/`nozzleField`/`nozzleSpec`; alte Felder p1/p2/spray/tight/chatter/action werden als Eingang gelesen; Druck „Messblatt Druckprobe – Eingang/Ausgang“ wie SDT-Vorlage), Seriennummern, Allgemeines Befundblatt, Ersatzteile/Bestellliste (`data.items[]` mit `status` order/open/ordered/none, `PART_STATUS`), Skizzen (`sketchSvg`: liner/fit/piston) |
| 07-photos | Fotos verkleinern → Store `files`, im Blatt nur IDs in `photos`-Arrays; `collectPhotoIds` |
| 08-signature | Unterschrift (aus Zettel-Job übernommen) |
| 09-print | Druck A4 im Stil der SDT-Papierblätter: `printHeadHtml` (Logo mittig, Titel unterstrichen, zweisprachige Kopftabelle Auftraggeber/Auftrags-Nr./Neubau-Nr./Klassifikation · Motorfabrikat/Motortyp/Motornr./Leistung), `printFootBlock` (Bemerkung/Empfehlung, Messwerkzeug, Seitenzahl, Datum, Unterschrift, Sonstiges), Titel über `printDocTitle` („Messblatt Überstand Laufbuchse“), Deckblatt mit Handlungsbedarf (`sheetIssues`) |
| 11-report | Zusammengefasster **Befundbericht** je Auftrag: Button am Auftrag → Dialog (Stand der Blätter, `order.reportSummary/reportAdvice/reportRating`, Optionen Fotos/Anlagen) → Druck mit Ergebnis, Kurzfassung je Blatt (`sheetDigest`), Handlungsbedarf, Empfehlung, Fotodoku, optional alle Blätter als Anlage. **Berichtsansicht** in der App (`view-report`, `renderReportView`: gleiche HTML wie Druck, Papier per `transform: scale` auf Bildschirmbreite), `shareOrder` (Auftrag + Fotos als Datei teilen), Direktlink `#bericht=<Auftragsnr.>` / `#auftrag=…` (`openFromLink`) – für Zettel-Job |
| 12-sync | Abgleich mit PocketBase (gleicher Server/Benutzer wie Zettel-Job, eigene Collections `bf_items`/`bf_files`, Einrichtung `tools/pocketbase/`): Einträge `order:<id>` (Kopf ohne Blätter + `sheetIds`), `sheet:<id>` (+ `orderId`), `team:specs`, `team:settings` (Logo); Hash-Vergleich gegen `syncMeta`, neuerer Stand gewinnt (`updated`/`created`), Löschen als `deleted`, Fotos ↔ `bf_files`; Beispielaufträge (`demo`) bleiben lokal; „Anmeldung von Zettel-Job übernehmen“ liest dessen `syncConfig` nur lesend |
| 10-settings | Prüfer, Logo für den Kopf (`settings.logo`: null = SDT-Standard `img/sdt-logo.svg`, '' = ohne, sonst Data-URL), eigene Unterschrift, gemerkte Sollwerte, Sicherung/Import (mit Fotos; Laden mit Auswahl `chooseImportMode`: Zusammenführen `mergeBackupOrders` = neue Aufträge dazu, gleicher Auftrag → Blätter ergänzen, gleiche ID nur ersetzen wenn nachweislich neuer, oder Ersetzen), Beispielauftrag |

## Papier-Styles

Alle `.pr-*`-Regeln stehen außerhalb von `@media print` und gelten in `.paper-doc` (Druckbereich `#print-area` und Bildschirm `.paper-screen`). In `@media print` nur Seitenformat, Ausblenden der App, Seitenumbrüche.

## Datenmodell

- `order`: { id, orderNo, customer, vessel, newbuild, classification, location, contact, reason, date, status 'offen'|'fertig', engines[], sheets[], reportSummary, reportAdvice, reportRating, reportPhotos, reportAttach }
- `engine`: { name, make, model, number, hours, power, rpm, layout 'V'|'R', cylinders, count 'KS'|'KGS' } – Motortyp „16V…“ setzt V/16.
- `sheet`: { id, type, mode 'beides'|'mess'|'befund'|null, engine (Index), date, subtitle, data{}, findings[], rating, summary, advice, signWorker, signCustomer }
- Messwerte: `sheet.data[cfg.key] = { spec, rows: { [Position]: { 'I_L': '170,012', … } }, count }` – Werte als Text mit Komma.
- Gemerkte Sollwerte: `appData.specs["mtu 16v 4000 m63"][typeId] = { [cfg.key]: spec }`.
- V-Motor: Zylinder A1…An/2, B1…; Grundlager n/2+1, Hublager n/2, NW-Lager n/2+1 (änderbar je Blatt).

## Neues Blatt ergänzen

Eintrag in `SHEET_TYPES` (03-types): `measure` (grid/points/clearance; points mit nur 1 Punkt = Einzelwert ohne Mittel/Streuung, `note: true` = Bemerkung je Zeile), `inspect` (Positionen + Befund-Chips),
`extra` (Zusatzangaben im Kopf), `printLabel` (Name im Drucktitel) – Editor, Auswertung und Druck kommen automatisch. Nur für ganz eigene Blätter
`special` + Funktionen in 06-special und `specialPrintHtml` (09-print).

## Konventionen

- Klassische `<script>`-Dateien, globaler Scope; aus `onclick` aufgerufene Funktionen über `Object.assign(window, …)`.
- Vor jedem Wechsel von Blatt/Auftrag/Ansicht `commitFocus()` (steckt in `showView`, `openSheet`, `openOrder`) – sonst landet ein spätes „change“ im neuen Blatt.
- Beim bloßen Anzeigen keine Daten anlegen/ändern (sonst hält der Abgleich es für eine Änderung); Änderungen setzen `sheet.updated`/`order.updated` (`touchSheet`/`touchOrder`).
- Benutzertext in `innerHTML` immer mit `escapeHtml()`. Datenmodell abwärtskompatibel halten (`normalizeData`).
- Neue Datei in `js/` → in `befunde/index.html` UND in `../sw.js` (Wurzel) `APP_SHELL_FILES`.
- **Bei jeder Änderung `CACHE_VERSION` in `../sw.js` (Wurzel) hochzählen.**

## Prüfen

```
for f in js/*.js; do node --check "$f"; done
node tools/befunde/smoke-test.js   # legt alle Blätter an, prüft Auswertung, Druck (PDF) → .smoke/
node tools/befunde/sync-test.js    # Handy, Büro und Tablet gleichen über einen nachgebauten PocketBase-Server ab
```
