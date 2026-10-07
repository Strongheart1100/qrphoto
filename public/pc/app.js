const socket = io();

const chooseBtn = document.getElementById('chooseBtn');
const qrPanel = document.getElementById('qrPanel');
const qrImage = document.getElementById('qrImage');
const status = document.getElementById('status');
const cancelBtn = document.getElementById('cancelBtn');
const previewPanel = document.getElementById('previewPanel');
const preview = document.getElementById('preview');
const photoName = document.getElementById('photoName');
const newBtn = document.getElementById('newBtn');
let currentToken = null;

async function readResponse(response) {
  const text = await response.text();
  let data = {};
  if (text.trim()) {
    try { data = JSON.parse(text); }
    catch { throw new Error(`Server returned invalid data (HTTP ${response.status}). Make sure you started Node.js with npm start, not Live Server.`); }
  }
  if (!response.ok) {
    throw new Error(data.error || `Server error (HTTP ${response.status}).`);
  }
  return data;
}

async function createSession() {
  previewPanel.classList.add('hidden');
  qrPanel.classList.remove('hidden');
  qrImage.removeAttribute('src');
  status.textContent = 'Generating QR code...';
  chooseBtn.disabled = true;

  try {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Accept': 'application/json' }
    });
    const data = await readResponse(response);

    currentToken = data.token;
    qrImage.src = data.qrDataUrl;
    status.textContent = 'Scan the QR code with your phone.';
    socket.emit('register-pc', currentToken);
  } catch (error) {
    status.textContent = error.message;
    console.error(error);
  } finally {
    chooseBtn.disabled = false;
  }
}

socket.on('connect', () => {
  if (currentToken) socket.emit('register-pc', currentToken);
});

socket.on('photo-uploaded', (photo) => {
  if (!currentToken) return;
  qrPanel.classList.add('hidden');
  previewPanel.classList.remove('hidden');
  preview.src = `${photo.url}?t=${Date.now()}`;
  photoName.textContent = `${photo.name} • ${(photo.size / 1024 / 1024).toFixed(2)} MB`;
});

chooseBtn.addEventListener('click', createSession);
newBtn.addEventListener('click', createSession);
cancelBtn.addEventListener('click', () => {
  currentToken = null;
  qrPanel.classList.add('hidden');
  qrImage.removeAttribute('src');
  status.textContent = '';
});
