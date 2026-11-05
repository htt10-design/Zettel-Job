# Zettel-Job

Offline-fähige Single-Page-PWA für Montage- und Werkstattzettel eines Monteurs:
Zeiten erfassen (Zeitarten wie AZ/RZ/FZ/LZ, erweiterbar), Auftrag/Kunde/Schiff,
Abwesenheit (≥ 8,25 h weg von SDT / 24 h weg) für die Auslöse, Hotel inkl. Frühstück,
An-/Rückfahrt, Material, Montage beendet, elektronische Unterschrift (Kunde + Monteur),
Druck/PDF – plus persönliche Stundenübersicht und Überstundenkonto mit freien Tagen.
Kein Server, kein Build-Schritt, keine Abhängigkeiten. UI-Sprache und Kommentare: Deutsch.
Farben: Hellblau & Weiß, Hell/Dunkel-Umschaltung.

## Aufbau

```
index.html        gesamtes Markup (Ansichten, Navigation, Modal, Unterschrift-Overlay, Druckbereich)
style.css         gesamtes Styling inkl. Dunkelmodus ([data-theme="dark"]) und @media print
js/NN-*.js        App-Logik, klassische <script>-Dateien (KEINE ES-Module)
sw.js             Service Worker (App-Shell-Cache, network-first)
manifest.json, icons/  PWA-Manifest und Icons (icons/icon.svg ist die Vorlage)
tools/smoke-test.js    Browser-Smoke-Test (Playwright)
```

| Datei | Inhalt |
|---|---|
| 01-core | `appData`-State, IndexedDB-Persistenz (`saveData`), `initApp`, `showView`, Theme, Modal, Toast |
| 02-helpers | `escapeHtml`, Zeit-/Datumsfunktionen (`parseTime` "0630"→390), Stundenrechnung (`dayInfo`, `overtimeBalance`) |
| 03-sheets | Zettel-Liste, Filter/Suche, Neuer Zettel (Montage/Werkstatt), „Nächster Tag“ (`nextDaySheet`), Löschen |
| 04-editor | Zettel-Editor (data-bind-Pfade + Event-Delegation), Tage, Zeitzeilen, Anfahrt, Abschluss |
| 05-signature | Unterschriften-Canvas; Kundenunterschrift sperrt den Zettel |
| 06-print | Druckansicht A4 (`buildPrintHtml`, `printActiveSheet`) |
| 07-hours | Stundenübersicht (Monat/KW/Jahr), Überstundenkonto, freie Tage / Urlaub / Krank / Feiertag / Korrektur |
| 08-settings | Name, Standort, Kennzeichen, Sollzeiten, Startsaldo, Zeitarten, eigene Unterschrift, Backup |
| 09-orders | „Auftrag zusammenstellen“ (nur auf Befehl): alle Montagezettel einer Auftragsnummer → Übersicht, Auslöse-Summen, gemeinsamer Druck, Unterschriften in `appData.orders` |

## Zettel-Modell

- Ein Zettel = ein Tag (`days` hat einen Eintrag; ältere Mehrtages-Zettel werden weiter angezeigt).
- An-/Rückfahrt pro Zettel ein-/ausschaltbar (`travelOut.on` / `travelBack.on`; ohne `on` aktiv, wenn Fahrzeit gesetzt).
- Zusammenstellung verändert keine Einzelzettel; sie wird bei jedem Öffnen neu berechnet.

## Stundenregeln

- Soll je Wochentag in `settings.targets` (Index 0 = So): Standard Mo–Do 8 h, Fr 5 h, Sa/So 0.
- Überstunden je Tag = gearbeitet − Soll; Tage ohne Einträge und ohne Abwesenheit zählen nicht.
- Freier Tag (`abbau`): Soll bleibt → Minus. Urlaub/Krank/Feiertag: Soll = 0. Korrektur: fester ± Wert.
- Zentrale Tagesrechnung `daySplit(sheet, di)`: Anfahrt-Fahrzeit (FZ) am Tagesanfang, Zeilen nach Startzeit,
  Rückfahrt-Fahrzeit am Tagesende; bis zum Soll = Normalstunden, ab der ersten Minute darüber = Überstunden.
  Fahrt ohne Datum → Anfahrt erster, Rückfahrt letzter Tag. Zettel zeigt links nur Normalstunden, daneben Überstunden,
  unten Normal/Über/Gesamt (`sheetTotals`).
- Zeitarten mit `counts: false` (z.B. Pause) zählen nicht als Arbeitszeit.

## Konventionen

- Alle Dateien teilen sich den globalen Scope; aus `onclick=""` aufgerufene Funktionen sind global (+ `window.x = x`).
- Top-Level-Code nur Konstanten/Variablen; Logik ab `DOMContentLoaded`. Kein Name in zwei Dateien deklarieren.
- Neue Datei in `js/`? → in `index.html` als `<script>` UND in `sw.js` `APP_SHELL_FILES` eintragen.
- Daten ändern: `appData` mutieren, `saveData()`, dann passende `render*()`.
- Benutzertext in `innerHTML` immer mit `escapeHtml()`.
- Datenmodell abwärtskompatibel halten (`normalizeData` ergänzt fehlende Felder), Backups müssen importierbar bleiben.
- **Bei jeder Änderung an index.html / js / style.css `CACHE_VERSION` in `sw.js` hochzählen.**

## Prüfen

```
for f in js/*.js; do node --check "$f"; done
node tools/smoke-test.js        # legt Zettel an, prüft Rechnungen, klickt alles durch, meldet JS-Fehler
```
Screenshots landen in `.smoke/` (ignoriert).
