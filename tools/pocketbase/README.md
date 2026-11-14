# Zettel-Job · Server-Einrichtung (PocketBase)

Die App gleicht über einen eigenen PocketBase-Server ab (z.B. Heimserver über Tailscale).
Benötigt werden zwei Collections: `zj_items` und `zj_files`.

## 1. Collections anlegen (einmalig)

Migration auf den Server kopieren – im Ordner, in dem die `docker-compose.yml` von PocketBase liegt
(z.B. `~/server/pocketbase`):

```bash
cd ~/server/pocketbase
mkdir -p pb_migrations
curl -fsSL -o pb_migrations/1763100000_zettel_job.js \
  https://raw.githubusercontent.com/htt10-design/Zettel-Job/main/tools/pocketbase/pb_migrations/1763100000_zettel_job.js
```

Der Ordner `pb_migrations` muss im Container unter `/pb/pb_migrations` (bzw. neben `pb_data`) eingebunden sein.
In der `docker-compose.yml` z.B.:

```yaml
    volumes:
      - ./pb_data:/pb/pb_data
      - ./pb_migrations:/pb/pb_migrations
```

Danach neu starten – PocketBase führt die Migration beim Start automatisch aus:

```bash
docker compose up -d --force-recreate
docker compose logs --tail=50
```

Im Admin (`https://heimserver.<tailnet>.ts.net/_/`) sollten jetzt `zj_items` und `zj_files` erscheinen.

### Falls die Migration nicht greift: von Hand im Admin anlegen

**zj_items** (Typ *Base*): Felder `key` (Text, Pflicht), `kind` (Text), `data` (JSON, max. Größe z.B. 10 MB),
`ts` (Number), `deleted` (Bool), `device` (Text), dazu `created`/`updated` (Autodate).
Index: eindeutig auf `key`. API-Regeln List/View/Create/Update: `@request.auth.id != ''`, Delete: leer lassen (gesperrt).

**zj_files** (Typ *Base*): `fileId` (Text, Pflicht, eindeutiger Index), `name` (Text), `file` (Datei, 1 Datei, max. 25 MB),
`created`/`updated` (Autodate). Gleiche API-Regeln wie oben.

## 2. Benutzer anlegen

Im Admin unter **Collections → users → New record**: E-Mail + Passwort (bei Bedarf „Verified“ anhaken).
Für jede Person bzw. jedes Gerät kann derselbe oder ein eigener Benutzer genutzt werden – alle angemeldeten
Benutzer sehen denselben Datenstand (ein Team).

## 3. In der App anmelden

Zettel-Job → **Einstellungen → Synchronisation**: Server-Adresse (`https://heimserver.<tailnet>.ts.net`),
E-Mail, Passwort → **Anmelden & abgleichen**. Das Gerät braucht die Tailscale-App und muss im Tailnet sein.

## Gut zu wissen

- Pro Gerät bleiben: Rolle (Büro/Monteur), angemeldeter Name, Hell/Dunkel.
- „Alle Daten löschen“ löscht nur auf dem Gerät – beim nächsten Abgleich kommt alles vom Server zurück.
- Gelöschte Einträge werden auf dem Server als `deleted` markiert (nicht entfernt).
- Backup des Servers: Ordner `pb_data` sichern (z.B. nachts per Cron).
