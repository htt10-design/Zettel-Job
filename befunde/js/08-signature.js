// =====================================================================
// 08-signature: Unterschriftenfeld (Canvas mit Pointer-Events), wie in
// Zettel-Job. who = 'worker' | 'customer' (aktuelles Blatt) | 'own'
// (eigene Unterschrift in den Einstellungen)
// =====================================================================

let signWho = null;
let signHasInk = false;
let signDrawing = false;
let signLast = null;

function signTarget(who) {
  const sheet = getActiveSheet();
  if (!sheet) return null;
  return { obj: sheet, field: who === 'customer' ? 'signCustomer' : 'signWorker' };
}

function afterSignChange() {
  touchSheet(getActiveSheet());
  renderSheet();
}

function startSignature(who) {
  // Prüfer: gespeicherte eigene Unterschrift direkt einsetzen
  if (who === 'worker' && appData.settings.ownSignature) {
    const target = signTarget(who);
    if (!target) return;
    target.obj[target.field] = { img: appData.settings.ownSignature, name: appData.settings.name || '', at: new Date().toISOString() };
    afterSignChange();
    showToast('Gespeicherte Unterschrift eingesetzt');
    return;
  }
  openSignaturePad(who);
}

function openSignaturePad(who) {
  signWho = who;
  const titles = { customer: 'Unterschrift Kunde', worker: 'Unterschrift Prüfer', own: 'Meine Unterschrift' };
  document.getElementById('sign-title').textContent = titles[who] || 'Unterschrift';
  const isCustomer = who === 'customer';
  const target = who === 'own' ? null : signTarget(who);
  const prev = target && target.obj[target.field];
  document.getElementById('sign-name-wrap').hidden = !isCustomer;
  document.getElementById('sign-name').value = isCustomer && prev ? prev.name || '' : '';
  document.getElementById('sign-overlay').classList.add('open');
  document.body.classList.add('no-scroll');
  requestAnimationFrame(setupSignCanvas);
}

function setupSignCanvas() {
  const canvas = document.getElementById('sign-canvas');
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0b2a4a';
  ctx.lineWidth = 2.4;
  signHasInk = false;
}

function signPoint(ev) {
  const r = ev.target.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

function onSignDown(ev) {
  ev.preventDefault();
  signDrawing = true;
  signLast = signPoint(ev);
  ev.target.setPointerCapture && ev.target.setPointerCapture(ev.pointerId);
  const ctx = ev.target.getContext('2d');
  ctx.beginPath();
  ctx.arc(signLast.x, signLast.y, 1.1, 0, Math.PI * 2);
  ctx.fillStyle = '#0b2a4a';
  ctx.fill();
  signHasInk = true;
}

function onSignMove(ev) {
  if (!signDrawing) return;
  ev.preventDefault();
  const p = signPoint(ev);
  const ctx = ev.target.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(signLast.x, signLast.y);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  signLast = p;
  signHasInk = true;
}

function onSignUp() { signDrawing = false; }

function clearSignaturePad() { setupSignCanvas(); }

function closeSignaturePad() {
  document.getElementById('sign-overlay').classList.remove('open');
  document.body.classList.remove('no-scroll');
  signWho = null;
}

// Unterschrift auf den benutzten Bereich zuschneiden → kleineres Bild
function trimmedSignature(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 12;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const w = maxX - minX + 1, h = maxY - minY + 1;
  // auf max. 600 px Breite verkleinern
  const scale = Math.min(1, 600 / w);
  const out = document.createElement('canvas');
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  out.getContext('2d').drawImage(canvas, minX, minY, w, h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function confirmSignaturePad() {
  const canvas = document.getElementById('sign-canvas');
  if (!signHasInk) { showToast('Bitte zuerst unterschreiben'); return; }
  const img = trimmedSignature(canvas);
  if (!img) { showToast('Bitte zuerst unterschreiben'); return; }
  if (signWho === 'own') {
    appData.settings.ownSignature = img;
    saveData(true);
    closeSignaturePad();
    renderSettings();
    showToast('Unterschrift gespeichert');
    return;
  }
  const who = signWho;
  const target = signTarget(who);
  if (!target) { closeSignaturePad(); return; }
  target.obj[target.field] = {
    img,
    name: who === 'customer' ? document.getElementById('sign-name').value.trim() : (appData.settings.name || ''),
    at: new Date().toISOString()
  };
  closeSignaturePad();
  afterSignChange();
  saveData(true);
  showToast('Unterschrift gespeichert');
}

async function removeSignature(who) {
  const target = signTarget(who);
  if (!target) return;
  if (!(await confirmDialog('Unterschrift entfernen?', 'Entfernen', true))) return;
  target.obj[target.field] = null;
  afterSignChange();
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('sign-canvas');
  canvas.addEventListener('pointerdown', onSignDown);
  canvas.addEventListener('pointermove', onSignMove);
  canvas.addEventListener('pointerup', onSignUp);
  canvas.addEventListener('pointercancel', onSignUp);
  canvas.addEventListener('pointerleave', onSignUp);
  window.addEventListener('resize', () => {
    if (document.getElementById('sign-overlay').classList.contains('open') && !signHasInk) setupSignCanvas();
  });
});

Object.assign(window, { startSignature, openSignaturePad, clearSignaturePad, closeSignaturePad, confirmSignaturePad, removeSignature });
