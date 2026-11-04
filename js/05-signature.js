// =====================================================================
// 05-signature: Unterschriftenfeld (Canvas mit Pointer-Events)
// who = 'customer' | 'worker' | 'own' (eigene Unterschrift in den Einstellungen)
// =====================================================================

let signWho = null;
let signHasInk = false;
let signDrawing = false;
let signLast = null;

function startSignature(who) {
  // Monteur: gespeicherte eigene Unterschrift direkt einsetzen
  if (who === 'worker' && appData.settings.ownSignature) {
    const sheet = getActiveSheet();
    sheet.signWorker = { img: appData.settings.ownSignature, name: appData.settings.name || '', at: new Date().toISOString() };
    touchSheet(sheet);
    renderEditor(true);
    showToast('Gespeicherte Unterschrift eingesetzt');
    return;
  }
  openSignaturePad(who);
}

function openSignaturePad(who) {
  signWho = who;
  const titles = { customer: 'Unterschrift Kunde', worker: 'Unterschrift Monteur', own: 'Meine Unterschrift' };
  document.getElementById('sign-title').textContent = titles[who] || 'Unterschrift';
  const nameInput = document.getElementById('sign-name');
  const sheet = who === 'own' ? null : getActiveSheet();
  document.getElementById('sign-name-wrap').hidden = who !== 'customer';
  nameInput.value = who === 'customer' && sheet && sheet.signCustomer ? sheet.signCustomer.name || '' : '';
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
  const now = new Date().toISOString();

  if (signWho === 'own') {
    appData.settings.ownSignature = img;
    saveData(true);
    closeSignaturePad();
    renderSettings();
    showToast('Unterschrift gespeichert');
    return;
  }

  const sheet = getActiveSheet();
  if (!sheet) { closeSignaturePad(); return; }
  if (signWho === 'customer') {
    const name = document.getElementById('sign-name').value.trim();
    sheet.signCustomer = { img, name, at: now };
  } else {
    sheet.signWorker = { img, name: appData.settings.name || '', at: now };
  }
  touchSheet(sheet);
  saveData(true);
  closeSignaturePad();
  renderEditor(true);
  showToast(signWho === 'customer' ? 'Zettel unterschrieben & gesperrt' : 'Unterschrift gespeichert');
}

async function removeSignature(who) {
  const sheet = getActiveSheet();
  if (!sheet) return;
  const msg = who === 'customer'
    ? 'Kunden-Unterschrift entfernen? Danach ist der Zettel wieder bearbeitbar und muss neu unterschrieben werden.'
    : 'Monteur-Unterschrift entfernen?';
  if (!(await confirmDialog(msg, 'Entfernen', true))) return;
  if (who === 'customer') sheet.signCustomer = null; else sheet.signWorker = null;
  touchSheet(sheet);
  renderEditor(true);
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

window.startSignature = startSignature;
window.openSignaturePad = openSignaturePad;
window.clearSignaturePad = clearSignaturePad;
window.closeSignaturePad = closeSignaturePad;
window.confirmSignaturePad = confirmSignaturePad;
window.removeSignature = removeSignature;
