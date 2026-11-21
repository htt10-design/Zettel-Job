# Service-App

Offline-fähige Web-App (PWA) für Servicetechniker – eine Startseite, mehrere Bereiche:

- **Zettel-Job** (`zettel/`): Montage- und Werkstattzettel, Stunden, Aufträge, Einsatzplan, Übergabe
- **Befunde** (`befunde/`): Mess- und Befundblätter, Ersatzteile, Befundbericht
- in Planung: Ersatzteile (Teilenummern / Liste scannen), Werkstatthandbücher

## Zettel-Job

- Montagezettel: Auftragsnummer, Kunde, Schiff/Anlage, Zeiten (z.B. `0630`–`0700` RZ), Abwesenheit (≥ 8,25 h / 24 h), Hotel & Frühstück, An-/Rückfahrt, Material, Montage beendet, Unterschrift Kunde & Monteur, Druck/PDF
- Werkstattzettel: nur Zeiten und ausgeführte Arbeiten
- Persönliche Stundenübersicht und Überstundenkonto (Mo–Do 8 h, Fr 5 h), freie Tage, Urlaub, Krank, Feiertage, Korrekturen
- Hell/Dunkel, Backup als JSON

Starten: Ordner über einen beliebigen Webserver ausliefern (z.B. GitHub Pages) und im Handy-Browser „Zum Startbildschirm hinzufügen“.
