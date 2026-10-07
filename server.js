const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const localtunnel = require('localtunnel');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 4000;
const HOST = '0.0.0.0';
let publicBaseUrl = null;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// Short-lived upload sessions. In production, store these in a database/Redis.
const sessions = new Map();
const SESSION_TTL = 10 * 60 * 1000;

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) sessions.delete(token);
  }
}
setInterval(cleanupSessions, 60 * 1000).unref();

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return (a === 10) ||
         (a === 172 && b >= 16 && b <= 31) ||
         (a === 192 && b === 168);
}

function getLanAddress() {
  // Optional override for machines with multiple adapters (VPN, VirtualBox, etc.).
  if (process.env.LAN_IP && isPrivateIPv4(process.env.LAN_IP)) {
    return process.env.LAN_IP;
  }

  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, names] of Object.entries(interfaces)) {
    for (const net of names || []) {
      if (net.family === 'IPv4' && !net.internal && isPrivateIPv4(net.address)) {
        candidates.push({ address: net.address, name });
      }
    }
  }

  // Prefer normal Wi-Fi/Ethernet adapters over virtual/VPN adapters.
  const preferred = candidates.find(x =>
    !/virtual|vmware|vbox|hyper-v|wsl|vpn|tunnel|tailscale|zerotier/i.test(x.name)
  );

  return (preferred || candidates[0])?.address || 'localhost';
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (allowedTypes.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, JPEG, PNG and WEBP images are allowed.'));
  }
});

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'pc', 'index.html')));
app.get('/mobile', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'mobile', 'index.html')));

// PC creates a private upload session and receives a QR code for the phone.
app.post('/api/session', async (_req, res, next) => {
  try {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { createdAt: Date.now(), socketId: null, uploaded: false });

    const lanAddress = getLanAddress();
    const base = publicBaseUrl || process.env.PUBLIC_BASE_URL || `http://${lanAddress}:${PORT}`;
    const mobileUrl = `${base}/mobile?token=${encodeURIComponent(token)}`;
    const qrDataUrl = await QRCode.toDataURL(mobileUrl, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M'
    });

    res.json({ token, mobileUrl, qrDataUrl, expiresInSeconds: SESSION_TTL / 1000 });
  } catch (err) {
    next(err);
  }
});

app.post('/api/upload/:token', (req, res, next) => {
  const token = req.params.token;
  const session = sessions.get(token);
  if (!session || Date.now() - session.createdAt > SESSION_TTL) {
    return res.status(410).json({ error: 'This upload QR code has expired. Please create a new one.' });
  }

  upload.single('photo')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Photo must be 5 MB or smaller.'
        : err.message || 'Upload failed.';
      return res.status(400).json({ error: message });
    }

    if (!req.file) return res.status(400).json({ error: 'Please select a photo.' });

    session.uploaded = true;
    const payload = {
      url: `/uploads/${req.file.filename}`,
      name: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype
    };

    // Send the uploaded image to the exact PC browser that created this session.
    if (session.socketId) io.to(session.socketId).emit('photo-uploaded', payload);

    res.json({ ok: true, ...payload });
  });
});

io.on('connection', (socket) => {
  socket.on('register-pc', (token) => {
    const session = sessions.get(token);
    if (!session) return;
    session.socketId = socket.id;
    socket.join(`pc:${token}`);
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

async function start() {
  server.listen(PORT, HOST, async () => {
    console.log(`\nPC page: http://localhost:${PORT}`);
    console.log(`LAN page: http://${getLanAddress()}:${PORT}`);
    console.log('Starting secure public tunnel for phone QR...');
    try {
      const tunnel = await localtunnel({ port: PORT });
      publicBaseUrl = tunnel.url;
      console.log(`\nPHONE QR URL: ${publicBaseUrl}/mobile`);
      console.log('Phone and PC do NOT need to be on the same Wi-Fi when using this QR URL.');
      tunnel.on('close', () => {
        publicBaseUrl = null;
        console.log('Tunnel closed. Restart npm start to create a new tunnel.');
      });
      tunnel.on('error', (err) => console.error('Tunnel error:', err.message));
    } catch (err) {
      console.error('Could not start public tunnel:', err.message);
      console.log(`\nFallback phone URL (same Wi-Fi only): http://${getLanAddress()}:${PORT}/mobile`);
      console.log('If the fallback does not open on your phone, check Windows Firewall/router isolation.');
    }
  });
}

start();
