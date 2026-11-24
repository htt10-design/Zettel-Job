# Service-App

Eine installierbare, offline-fähige PWA für Servicetechniker (Schiffsmotoren) mit Startseite und
eigenständigen Bereichen. Kein Server, kein Build-Schritt, keine Abhängigkeiten. UI-Sprache und Kommentare: Deutsch.
Live: https://htt10-design.github.io/Zettel-Job/ (Repo heißt weiter Zettel-Job; Manifest-`id` bleibt
`./?app=zettel-job`, damit installierte Zettel-Job-Apps zur Service-App werden).

```
index.html, start.css, start.js   Startseite: Kacheln je Bereich, „Zu erledigen“, „In Planung“ (Ersatzteile, Handbücher)
manifest.json, icons/             EIN Manifest/Icon für alles (Shortcuts zu den Bereichen)
404.html                          GitHub Pages: unbekannte/alte Adressen (z.B. vor dem Umbau, Kleinschreibung zettel-job) → passende Stelle der App
sw.js                             EIN Service Worker für alles (Scope = Wurzel); löscht nur eigene Caches
zettel/                           Bereich Zettel-Job (Doku unten)
befunde/                          Bereich Befunde (Doku: befunde/CLAUDE.md) – übernommen aus dem Repo htt10-design/befunde
tools/                            Tests (start-test, smoke-test, sync-test; tools/befunde/ für Befunde), pocketbase/ (Server-Migrationen beider Bereiche)
```

- Bereiche sind getrennte Seiten mit eigenem globalem Scope (gleiche Funktionsnamen erlaubt) und eigener IndexedDB
  (`zettel-job`, `befunde`). Sie verlinken per relativem Pfad (`../`, `../befunde/`) und lesen die Daten des anderen
  Bereichs nur lesend (gleiche Herkunft). Jeder Bereich hat oben den Knopf `#btn-home` (→ `../`) zur Startseite.
- Startseite: lädt `zettel/js/02-helpers.js` (nur Funktionen) mit eigener globaler `appData` = Zettel-Job-Daten (nur lesend)
  für Wochenstunden/Konto/To-dos; liest `befunde` nur lesend; legt nie eine Datenbank an. Theme folgt Zettel-Job.
- Sichtbarer Name des Bereichs `zettel/` ist **„Stundennachweis“** (Code, Ordner, DB-Name `zettel-job` bleiben).
- **Wer arbeitet?** (Startseite, `openWho`/`pickWho`): `localStorage['serviceApp.identity'] = { role: 'tech'|'office', name, at }`.
  Bereiche übernehmen sie beim Start, wenn `at` neuer ist als ihr Stempel `serviceApp.applied.<bereich>`:
  Stundennachweis `applySharedIdentity` (10-jobs, wie `loginAs` inkl. `switchTechnician`/Profilwechsel; `loginAs` meldet per
  `publishIdentity` zurück), Befunde setzt bei Monteur `settings.name` (Prüfer). Die Startseite rechnet bis dahin mit
  `applyIdentityInMemory` (nur im Speicher). Monteurliste = angelegte Monteure + Namen aus Zetteln/Aufträgen.
- Neuer Bereich = neuer Ordner + Kachel in index.html + Dateien in `sw.js` `APP_SHELL_FILES` + `register('../sw.js')` + `#btn-home`.
- Druck: `@page { margin: 0 }` (so druckt Chrome keine Kopf-/Fußzeilen mit Adresse/Datum); Ränder über `printFrame(html)`
  (Tabelle mit thead/tfoot-Abstand, wiederholt sich je Seite) in zettel/06-print `printHtml` und befunde `printSheets`/`printReport`.
- **Bei jeder Änderung an index.html / start.* / zettel/* / befunde/* `CACHE_VERSION` in `sw.js` (Wurzel) hochzählen**
  und neue Dateien in `APP_SHELL_FILES` eintragen. Die Bereiche haben keinen eigenen sw.js mehr.

## Prüfen

```
for f in start.js zettel/js/*.js befunde/js/*.js; do node --check "$f"; done
node tools/start-test.js          # Startseite: Kacheln, Überblick, Wechsel, keine DB anlegen
node tools/smoke-test.js          # Zettel-Job
node tools/sync-test.js           # Zettel-Job-Abgleich (nachgebauter PocketBase)
node tools/befunde/smoke-test.js  # Befunde (→ .smoke/befunde/)
node tools/befunde/sync-test.js   # Befunde-Abgleich
```
Screenshots landen in `.smoke/` (ignoriert).

---

# Bereich Zettel-Job (`zettel/`)

Offline-fähige Single-Page-PWA für Montage- und Werkstattzettel eines Monteurs:
Zeiten erfassen (Zeitarten wie AZ/RZ/FZ/LZ, erweiterbar), Auftrag/Kunde/Schiff,
Abwesenheit (≥ 8,25 h weg von SDT / 24 h weg) für die Auslöse, Hotel inkl. Frühstück,
An-/Rückfahrt, Material, Montage beendet, elektronische Unterschrift (Kunde + Monteur),
Druck/PDF – plus persönliche Stundenübersicht und Überstundenkonto mit freien Tagen.
Kein Server, kein Build-Schritt, keine Abhängigkeiten. UI-Sprache und Kommentare: Deutsch.
Farben: Hellblau & Weiß, Hell/Dunkel-Umschaltung.

## Aufbau

```
zettel/index.html   gesamtes Markup (Ansichten, Navigation, Modal, Unterschrift-Overlay, Druckbereich)
zettel/style.css    gesamtes Styling inkl. Dunkelmodus ([data-theme="dark"]) und @media print
zettel/js/NN-*.js   App-Logik, klassische <script>-Dateien (KEINE ES-Module)
zettel/icons/       Icon des Bereichs (Favicon/Kachel); Manifest + Service Worker liegen in der Wurzel
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
| 09-orders | „Auftrag zusammenstellen“ (nur auf Befehl): alle Montagezettel einer Auftragsnummer → Übersicht, Auslöse-Summen, gemeinsamer Druck, Unterschriften in `appData.orders`; Ordner je Auftragsnummer |
| 10-jobs | Rollen (Anmeldung Servicetechniker / Sachbearbeiter, `appData.role`), Aufträge vom Büro (`appData.jobs`: Auftragsnr., Kunde, Schiff, Motoren, Beschreibung, Dateien), Zettel aus Auftrag, Büro-Ansicht aller Zettel |
| 11-home | Startseite Techniker: Wochenleiste (Stunden/Status je Tag, blättern), gewählter Tag mit Zetteln und „Neuer Zettel“, „Zu erledigen“ (fehlende Tage, fehlende Unterschriften, zugeteilte Aufträge), Wochenfortschritt; alte Liste aufklappbar |
| 12-plan | Einsatzplanung: Wochentafel Monteure × Tage (Büro: einplanen/entfernen, Konflikte, „Noch nicht eingeplant“, Druck), Monteur: „Meine nächsten Einsätze“ + Team-Tafel |
| 13-demo | Demo-Modus: echte Daten unter `appDataBeforeDemo` sichern, Beispieldaten relativ zu heute (`buildDemoData`), Beenden stellt alles wieder her; gelbes Demo-Banner |
| 14-apps | Verknüpfung zum Bereich **Befunde** (`../befunde/`, `openBefunde`); liest deren IndexedDB `befunde` nur lesend (`loadBefundeData`) und zeigt im Auftrag/Zettel die Befunde-Box mit Direktlinks `#auftrag=` / `#bericht=` |
| 15-staff | Monteur-Akte (Büro): Eintritt, Telefon, Übertrag, Sollstunden je Monteur (`appData.technicians`), Überstundenkonto ab Eintritt (`staffBalance`), Tag ändern/Überstunden streichen/Tag streichen und Buchungen als `daysOff`-Korrektur `{ by:'office', kind }` |
| 16-sync | Abgleich mit eigenem PocketBase (Collections `zj_items`/`zj_files`, Einrichtung `tools/pocketbase/`): je Eintrag ein Datensatz (`key` = `sheet:<id>`, `job:`, `handover:`, `leave:`, `tech:`, `off:`, `order:`, `profile:`, `team:settings`), Hash-Vergleich gegen `syncMeta`, neuerer Stand gewinnt, Löschen als `deleted`; pro Gerät bleiben Rolle/Name/Theme |
| 17-handover | Übergabe eines Auftrags mittendrin (`appData.handovers`): Übersicht ohne Namen/Daten – Stand aus Zetteln (`handoverStats`, erledigte Arbeiten = Zeilen-Beschreibungen, jede einmal, `handoverDoneText`), Stunden/Tage nur optional (`withHours`, `toggleHandoverHours`), Druck zeigt nur benutzte Unterschriften und keine „Erstellt mit“-Zeile, Befunde nur optional per Schalter (`withBefunde`, `hoWithBefunde`, `toggleHandoverBefunde`; Schnappschuss `handoverBefundeSnapshot`, nur lesend; Vorschläge als offene Arbeiten mit `fromBefunde`), offene Arbeiten (abhakbar auch nach Unterschrift); `from`/`to` nur Altbestand, Hinweise für den Nachfolger, Unterschriften `hoFrom`/`hoTo` (sperren den Inhalt), Druck; Karte `handoverCardHtml` in Auftrag und Zusammenstellung; Sync-Schlüssel `handover:<id>` |
| 18-leave | Urlaub: Anträge `appData.leaveRequests` ({ worker, from, to, days, note, status pending/approved/rejected/cancelled, decidedAt/By, answer }); Monteur: Karte in „Stunden“ (`vacationCardHtml`, Antrag `openLeaveRequest`, zurückziehen), Urlaub nicht mehr direkt über „Abwesenheit“; Büro: Posteingang oben im Plan (`leaveInboxHtml`, Zähler `#plan-badge`), genehmigen → je Urlaubstag `daysOff` { type:'urlaub', requestId, by:'office' }, ablehnen mit Begründung, stornieren entfernt die Tage; Akte: Anspruch `technicians[].vacationDays` (Standard 30; im Eintrittsjahr laut `startDate` automatisch anteilig: 1/12 je vollem Monat, ≥ 0,5 aufrunden, `vacationMonths`) + `vacationCarry[Jahr]`, Urlaub direkt eintragen. Rechnung in 02-helpers (`vacationSummary`, `leaveDayList`: Tage mit Soll ohne Feiertage; 24.12./31.12. zählen halb `leaveDayWeight`, Summen `leaveDaysSum`, Anzeige `formatDays`), auch für die Startseite; Plan zeigt offene Anträge als „Urlaub?“ (`absencesFor`); Sync-Schlüssel `leave:<id>`; Direktlink `zettel/#urlaub` |

## Zettel-Modell

- Ein Zettel = ein Tag (`days` hat einen Eintrag; ältere Mehrtages-Zettel werden weiter angezeigt).
- An-/Rückfahrt pro Zettel ein-/ausschaltbar (`travelOut.on` / `travelBack.on`; ohne `on` aktiv, wenn Fahrzeit gesetzt).
- Zusammenstellung verändert keine Einzelzettel; sie wird bei jedem Öffnen neu berechnet.
- Zusammenstellung/Ordner umfassen Montagezettel mit der Auftragsnummer UND Werkstattzettel mit Zeilen, deren Kostenstelle
  die Auftragsnummer ist (`orderAllSheets`, `orderDaySplit` zählt/druckt nur diese Zeilen, im Druck als „WS“). Ein
  Werkstattzettel verschwindet nur dann aus der Liste, wenn alle seine Kostenstellen Ordner-Aufträge sind (`workshopSheetInFolders`).
- Ordner: `appData.orders[nr].folder` gesetzt → alle Montagezettel dieser Auftragsnummer (auch neue) erscheinen
  nicht mehr einzeln in der Liste, sondern als Ordner-Karte (`folderList`, `folderCardHtml`). Auflösen löscht nichts.
- `sheet.worker` (Name des Monteurs) wird beim Anlegen gesetzt – Vorbereitung für mehrere Benutzer.
- Werkstattzettel: Zeilen haben `cost` (Kostenstelle) statt Zeitart; `P`/`Pause` zählt nicht. Neue Werkstattzettel enthalten die Pause
  aus `settings.workshopPause` (Standard 11:30–12:00, Zeile mit `auto: true`); die erste echte Zeile wird davor eingefügt. Kostenstellen-Liste in
  `settings.costCenters` ({ no, label }); Standardliste `DEFAULT_COST_CENTERS` (01-core) wird einmalig eingetragen
  (`costCentersVersion`; vor dem Merge mit den Defaults auslesen!). Ältere Werkstatt-Zeilen ohne `cost` rechnen weiter über `code`.
- Motoren je Montagezettel in `sheet.engines` (1–4 × { make, model, number, hours }; altes `sheet.engine` wird in
  `normalizeSheet` übernommen). Optionale eigene Bezeichnung je Motor
  (`engine.name`), sonst „Motor 1/2…“ (`engineLabel`); `sheet.engineNaming` nur noch Altbestand.
  „Nächster Tag“ übernimmt alle Motordaten inkl. Betriebsstunden (`copyEngines`); neue Zettel mit bekannter
  Auftragsnummer füllen leeren Kunde/Schiff/Motoren vom letzten Zettel des Auftrags (`fillFromOrder`); Zusammenstellung (`orderEngines`) je Motor mit Verlauf „erster → letzter“.
- „＋ einfügen“ zwischen zwei Zeilen (`openInsertEntry`): neue Zeile ab Ende der oberen, alle folgenden Zeilen werden um
  die Dauer verschoben.
- Auftragsnummern-Format `SR26/000249`: `formatOrderNo()` ergänzt beim Verlassen des Feldes
  ("249" → SR{Jahr des Zettels}/000249, "26/249" → SR26/000249). Reine Zahlen bei Kostenstellen bleiben stehen.

## Rollen & Aufträge

- Beim ersten Start Anmeldung: Servicetechniker (`settings.name`) oder Sachbearbeiter (`settings.officeName`); wechselbar.
  Monteur wählt sich aus der Liste (`knownTechnicians`: angelegte `appData.technicians` + bekannte Namen) – noch ohne Passwort.
  Wechsel des Monteurs (`switchTechnician`): Zettel/Abwesenheiten ohne Namen bekommen den bisherigen Namen, persönliche
  Einstellungen (Kennzeichen, Standort, Übertrag, Sollzeiten, Unterschrift) liegen je Monteur in `appData.profiles`.
- Büro verwaltet Monteure in den Einstellungen (anlegen, umbenennen = überall umbenennen, entfernen); Tipp öffnet die Akte
  (15-staff). Vom Büro gesetzte Werte (startDate, startBalance, targets) gelten auch in der Monteur-App (`applyStaffToSettings`,
  `currentStaffRecord`; Tage vor Eintritt zählen nicht in `overtimeBalance`), dort sind die Felder dann gesperrt.
  CSS-Klassen `tech-only` / `office-only` blenden je Rolle aus (body.role-tech / body.role-office).
- Daten lokal (offline zuerst); optional Abgleich über eigenen PocketBase-Server (16-sync). Ohne Anmeldung bleibt alles auf dem Gerät.
- Büro: Aufträge anlegen/bearbeiten, alle Zettel nur ansehen (Editor gesperrt), Filter nach Techniker (`sheet.worker`).
- Techniker: sieht nur eigene Zettel (`isOwnSheet`, Zettel ohne Namen zählen mit); Stunden nur aus eigenen Zetteln;
  „Zettel für diesen Auftrag anlegen“ füllt Auftragsnr., Kunde, Schiff, Motoren; Auftragsinfo (Beschreibung/PDF) im Zettel.
- Zuteilung: `job.assigned` (Liste von Monteur-Namen; altes `assignedTo` wird übernommen), optional `planFrom`/`planTo`.
  Monteur sieht auf der Startseite „Dir zugeteilt“ (`renderMyJobs`, Namensvergleich ohne Groß/Klein) mit „Zettel schreiben“.
- Auftragsart `job.kind`: montage | werkstatt | mix. Werkstatt → „Zettel schreiben“ legt im eigenen Werkstattzettel von
  heute eine Zeile mit der Auftragsnummer als Kostenstelle an (`addWorkshopEntryForJob`); mix → Auswahl Montage/Werkstatt;
  auch „Nächster Tag“ fragt bei gemischten Aufträgen (`nextDayFor`, `sheetMixJob`), auch aus Werkstattzetteln heraus.
  Stunden je Auftrag: Montagezettel ganz + Werkstattzeilen mit passender Kostenstelle (`jobAllSheets`, `jobSheetHours`).
- Nachträglich zuordnen: im Auftrag „Vorhandene Zettel zuordnen“ (`openAssignSheets`, Montagezettel, füllt leere Felder per
  `fillSheetFromJob`), im Zettel-Menü „Einem Auftrag zuordnen“ (`openAssignToJob`; Werkstatt: Zeilen wählen → Kostenstelle).
  Vom Kunden unterschriebene Zettel werden nicht verändert.
- Kalender: Startseite Techniker umschaltbar Woche/Monat (`homeCalMode`, im Browser gemerkt; `calCellHtml`), Büro-„Zettel“ mit
  Monatskalender (`officeCalendarHtml`, Tag antippen → `officeDay` filtert die Liste).
- Startseite Techniker = `renderTechHome` (11-home); die Liste (`#sheet-browser`) ist nur aufgeklappt sichtbar
  (`homeShowList`). Büro sieht weiter die Liste. In der Liste: nur aktuelle Woche (`sheetRange`) oder alle.
- Neue Zettel für einen gewählten Tag: `newSheetDate` setzen → `createSheet`/`nextDaySheet`/`addWorkshopEntryForJob`
  holen es mit `takeNewSheetDate()` ab (sonst heute).
- Einsatzplanung: `job.slots` [{ id, name, from, to }] je Monteur; Fallback `assigned` + `planFrom/planTo` (Altbestand).
  `jobPlannedOn`, `plannedJobsFor`; Abwesenheiten tragen `daysOff[].worker` (ohne Namen = Techniker dieses Geräts).
- Dateianhänge im IndexedDB-Store `files` (DB-Version 2), `job.files` nur Metadaten; Backup enthält sie als Data-URL.

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
- `02-helpers.js` wird auch von der Startseite (`../start.js`) geladen: dort nur Konstanten und Funktionen, kein Code beim Laden,
  und keine Funktionen aus anderen Dateien in `dayInfo`/`overtimeBalance`-Pfaden ohne `typeof`-Prüfung.
- Neue Datei in `zettel/js/`? → in `zettel/index.html` als `<script>` UND in `sw.js` (Wurzel) `APP_SHELL_FILES` eintragen.
- Daten ändern: `appData` mutieren, `saveData()`, dann passende `render*()`.
- Benutzertext in `innerHTML` immer mit `escapeHtml()`.
- Datenmodell abwärtskompatibel halten (`normalizeData` ergänzt fehlende Felder), Backups müssen importierbar bleiben.
- **Bei jeder Änderung `CACHE_VERSION` in `sw.js` (Wurzel) hochzählen.**
