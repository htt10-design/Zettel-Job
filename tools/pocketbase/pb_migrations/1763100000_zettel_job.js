/// <reference path="../pb_data/types.d.ts" />
// Zettel-Job: Collections für den Abgleich (PocketBase ab v0.23, JS-Migration).
// zj_items: ein Datensatz je Zettel/Auftrag/Monteur/Abwesenheit/… (data = JSON)
// zj_files: Dateianhänge der Aufträge (PDF/Fotos)
// Zugriff: nur angemeldete Benutzer der Collection „users“.
migrate((app) => {
  const auth = "@request.auth.id != ''";

  const items = new Collection({
    type: "base",
    name: "zj_items",
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
      "CREATE UNIQUE INDEX idx_zj_items_key ON zj_items (key)",
      "CREATE INDEX idx_zj_items_updated ON zj_items (updated)",
    ],
  });
  app.save(items);

  const files = new Collection({
    type: "base",
    name: "zj_files",
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
      "CREATE UNIQUE INDEX idx_zj_files_fileid ON zj_files (fileId)",
    ],
  });
  app.save(files);
}, (app) => {
  for (const name of ["zj_files", "zj_items"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (e) { /* schon weg */ }
  }
});
