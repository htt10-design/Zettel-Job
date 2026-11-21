/// <reference path="../pb_data/types.d.ts" />
// Befunde: Collections für den Abgleich (PocketBase ab v0.23, JS-Migration).
// Läuft neben den Zettel-Job-Collections (zj_items/zj_files) auf demselben Server
// und nutzt dieselben Benutzer („users“).
// bf_items: ein Datensatz je Auftrag (Kopf), Blatt und Team-Einstellung (data = JSON)
// bf_files: Fotos
// Zugriff: nur angemeldete Benutzer.
migrate((app) => {
  const auth = "@request.auth.id != ''";

  const items = new Collection({
    type: "base",
    name: "bf_items",
    listRule: auth,
    viewRule: auth,
    createRule: auth,
    updateRule: auth,
    deleteRule: null,
    fields: [
      { name: "key", type: "text", required: true, max: 200 },
      { name: "kind", type: "text", max: 40 },
      { name: "data", type: "json", maxSize: 10485760 },
      { name: "ts", type: "number" },
      { name: "deleted", type: "bool" },
      { name: "device", type: "text", max: 100 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_bf_items_key ON bf_items (key)",
      "CREATE INDEX idx_bf_items_updated ON bf_items (updated)",
    ],
  });
  app.save(items);

  const files = new Collection({
    type: "base",
    name: "bf_files",
    listRule: auth,
    viewRule: auth,
    createRule: auth,
    updateRule: auth,
    deleteRule: null,
    fields: [
      { name: "fileId", type: "text", required: true, max: 100 },
      { name: "name", type: "text", max: 300 },
      { name: "file", type: "file", maxSelect: 1, maxSize: 26214400 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_bf_files_fileid ON bf_files (fileId)",
    ],
  });
  app.save(files);
}, (app) => {
  for (const name of ["bf_files", "bf_items"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (e) { /* schon weg */ }
  }
});
