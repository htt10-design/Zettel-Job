// =====================================================================
// 07-photos: Fotos zu Befunden / Zylindern. Werden verkleinert (max.
// 1600 px, JPEG) im IndexedDB-Store "files" abgelegt; im Blatt stehen
// nur die IDs (z.B. findings.0.photos = ['id1', 'id2']).
// =====================================================================

const photoUrls = new Map(); // id → objectURL (Cache)
let pendingPhotoPath = null;

function photoStripHtml(path, ids, label) {
  ids = ids || [];
  return `
    <div class="photo-strip">
      ${ids.map((id, i) => `<button type="button" class="ph" onclick="openPhoto('${path}',${i})" aria-label="Foto ${i + 1}"><img data-photo="${escapeHtml(id)}" alt=""></button>`).join('')}
      <button type="button" class="ph-add" onclick="addPhotos('${path}')" aria-label="${escapeHtml(label || 'Foto hinzufügen')}">
        <svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
        <span>Foto</span>
      </button>
    </div>`;
}

async function photoUrl(id) {
  if (photoUrls.has(id)) return photoUrls.get(id);
  const blob = await getFile(id).catch(() => null);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  photoUrls.set(id, url);
  return url;
}

function hydratePhotos(root) {
  root.querySelectorAll('img[data-photo]').forEach(async img => {
    const url = await photoUrl(img.dataset.photo);
    if (url) img.src = url; else img.closest('.ph') && img.closest('.ph').classList.add('missing');
  });
}

function addPhotos(path) {
  pendingPhotoPath = path;
  const input = document.getElementById('photo-input');
  input.value = '';
  input.click();
}

async function onPhotoInput(ev) {
  const files = [...ev.target.files];
  const sheet = getActiveSheet();
  if (!files.length || !sheet || !pendingPhotoPath) return;
  showToast(files.length > 1 ? files.length + ' Fotos werden gespeichert …' : 'Foto wird gespeichert …');
  const arr = Array.isArray(getPath(sheet, pendingPhotoPath)) ? getPath(sheet, pendingPhotoPath) : [];
  for (const f of files) {
    try {
      const blob = await compressImage(f);
      const id = 'ph_' + uid();
      await saveFile(id, blob);
      arr.push(id);
    } catch (e) { console.error(e); showToast('Foto konnte nicht gelesen werden'); }
  }
  setPath(sheet, pendingPhotoPath, arr);
  pendingPhotoPath = null;
  touchSheet(sheet);
  saveData(true);
  renderSheet();
}

async function compressImage(file, max = 1600, quality = 0.8) {
  let src;
  if (window.createImageBitmap) {
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = null; }
  }
  if (!src) {
    src = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h = src.height;
  const k = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob')), 'image/jpeg', quality));
}

async function openPhoto(path, idx) {
  const sheet = getActiveSheet();
  const ids = getPath(sheet, path) || [];
  const id = ids[idx];
  if (!id) return;
  const url = await photoUrl(id);
  openModal(`
    <div class="photo-view"><img src="${url}" alt="Foto"></div>
    <div class="modal-actions">
      <button class="btn btn-danger-ghost" onclick="deletePhoto('${path}',${idx})">Foto löschen</button>
      <button class="btn btn-primary" onclick="closeModal()">Schließen</button>
    </div>`, { wide: true });
}

async function deletePhoto(path, idx) {
  const sheet = getActiveSheet();
  const ids = getPath(sheet, path) || [];
  const id = ids[idx];
  ids.splice(idx, 1);
  touchSheet(sheet);
  closeModal();
  renderSheet();
  if (id) {
    // Rückgängig möglich: Datei erst nach Ablauf löschen
    showToast('Foto gelöscht', { label: 'Rückgängig', fn: () => { ids.splice(idx, 0, id); touchSheet(sheet); renderSheet(); } });
    setTimeout(() => { if (!collectPhotoIds({ sheets: getActiveOrder() ? getActiveOrder().sheets : [] }).includes(id)) deleteFile(id).catch(() => {}); }, 7000);
  }
}

// Alle Foto-IDs in einem Auftrag (sucht jedes "photos"-Feld)
function collectPhotoIds(obj) {
  const out = [];
  const walk = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    Object.keys(o).forEach(k => {
      if (k === 'photos' && Array.isArray(o[k])) o[k].forEach(id => typeof id === 'string' && out.push(id));
      else walk(o[k]);
    });
  };
  walk(obj);
  return out;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('photo-input').addEventListener('change', onPhotoInput);
});

Object.assign(window, { addPhotos, openPhoto, deletePhoto });
