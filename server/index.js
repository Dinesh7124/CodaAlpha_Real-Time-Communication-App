'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const cookie = require('cookie');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { z } = require('zod');
const { Server } = require('socket.io');

const db = require('./db');
const auth = require('./auth');
const store = require('./store');
const sanitize = require('./sanitize');

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('\n[FATAL] JWT_SECRET missing or too short (min 32 chars). Edit .env first.\n');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const MAX_UPLOAD = 100 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();

/* ---------- HTTPS / HTTP ---------- */

const certDir = path.join(ROOT, 'certs');
const hasCerts =
  fs.existsSync(path.join(certDir, 'key.pem')) &&
  fs.existsSync(path.join(certDir, 'cert.pem'));

let server;
if (hasCerts) {
  server = https.createServer(
    {
      key: fs.readFileSync(path.join(certDir, 'key.pem')),
      cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
      minVersion: 'TLSv1.2',
      ciphers: [
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384',
      ].join(':'),
      honorCipherOrder: true,
    },
    app
  );
  console.log('  [HTTPS] Secure mode enabled');
} else {
  server = http.createServer(app);
  console.log('  [HTTP]  Dev mode — no certs found');
}

const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  pingTimeout: 30000,
  pingInterval: 25000,
  cors: { origin: false },  // same-origin only
});

app.disable('x-powered-by');
app.set('trust proxy', 1);

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:', 'https://api.qrserver.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
        workerSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
  })
);

app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()'
  );
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
});

app.use(compression());
app.use(express.json({ limit: '512kb' }));
app.use(cookieParser());
app.use(auth.attachUser);

/* ---------- Rate limiters ---------- */

function userAwareKey(req) {
  return (req.user ? req.user.id : req.ip) + ':' + (req.path || '');
}

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: userAwareKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down — too many requests' },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => (req.user ? req.user.id : req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload limit reached. Try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

app.use('/api/', globalLimiter);
app.use('/api/upload', uploadLimiter);
app.use('/api/rooms', (req, res, next) => {
  if (req.method === 'POST') return strictLimiter(req, res, next);
  next();
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

/* ------------------------------------------------------------------ */
/* Static + auth routes                                                */
/* ------------------------------------------------------------------ */

app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: '1h' }));
app.use('/api/auth', auth.router);

/* ------------------------------------------------------------------ */
/* REST API                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/rooms', auth.requireAuth, (req, res) => {
  res.json({ rooms: store.listRooms() });
});

const CreateRoomSchema = z.object({
  name: z.string().max(60).optional(),
  password: z.string().min(4).max(100).optional().or(z.literal('')),
});

app.post('/api/rooms', auth.requireAuth, async (req, res) => {
  const parsed = CreateRoomSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const room = await store.createRoom(req.user, parsed.data.name, parsed.data.password || null);
  auth.audit(req.user.id, 'room_created', room.id, req.ip);
  res.json({ room });
});

app.get('/api/rooms/:id', auth.requireAuth, (req, res) => {
  const roomId = sanitize.cleanRoomId(req.params.id);
  const room = store.getRoom(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ room: store.publicRoom(room) });
});

app.post('/api/rooms/:id/verify', auth.requireAuth, async (req, res) => {
  const roomId = sanitize.cleanRoomId(req.params.id);
  const room = store.getRoom(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const password = (req.body && req.body.password) || '';
  const ok = await store.checkRoomPassword(room, password);
  if (!ok) {
    auth.audit(req.user.id, 'room_password_fail', roomId, req.ip);
    return res.status(403).json({ error: 'Wrong room password' });
  }
  res.json({ ok: true });
});

app.get('/api/ice', auth.requireAuth, (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const { TURN_URL, TURN_SECRET } = process.env;
  if (TURN_URL && TURN_SECRET) {
    const ttl = 3600;
    const username = `${Math.floor(Date.now() / 1000) + ttl}:${req.user.id}`;
    const credential = crypto
      .createHmac('sha1', TURN_SECRET)
      .update(username)
      .digest('base64');
    iceServers.push({ urls: TURN_URL, username, credential });
  }
  res.json({ iceServers });
});

/* ---------------- files ---------------- */

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: {
    fileSize: MAX_UPLOAD,
    files: 1,
    fields: 5,
    parts: 10,
  },
  fileFilter: (req, file, cb) => {
    if (!sanitize.isAllowedMime(file.mimetype)) {
      return cb(new Error('File type not allowed'));
    }
    cb(null, true);
  },
});

app.post('/api/upload', auth.requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });

  const roomId = sanitize.cleanRoomId((req.body && req.body.roomId) || '');
  const room = store.getRoom(roomId);

  if (!room) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Room not found' });
  }
  if (!store.isUserInRoom(roomId, req.user.id)) {
    fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: 'You are not in this room' });
  }

  // Double-check magic bytes
  try {
    const fd = fs.openSync(req.file.path, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    const sniffed = sanitize.sniffMime(buf);
    if (sniffed && sniffed !== req.file.mimetype) {
      auth.audit(req.user.id, 'upload_mime_mismatch', `${req.file.mimetype} vs ${sniffed}`, req.ip);
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'File content does not match its type' });
    }
  } catch { /* ignore read errors */ }

  const meta = {
    id: path.basename(req.file.filename),
    storedName: path.basename(req.file.filename),
    name: sanitize.cleanFileName(req.file.originalname || 'file'),
    size: req.file.size,
    type: req.file.mimetype,
    roomId,
    ownerId: req.user.id,
  };
  store.registerFile(meta);

  const entry = {
    id: meta.id,
    name: meta.name,
    size: meta.size,
    type: meta.type,
    by: req.user.name,
    at: Date.now(),
  };
  store.addFileEntry(roomId, entry);
  io.to(roomId).emit('file:shared', entry);

  auth.audit(req.user.id, 'file_uploaded', `${meta.name} (${meta.size} bytes)`, req.ip);
  res.json({ file: entry });
});

app.get('/api/files/:id', auth.requireAuth, (req, res) => {
  const rec = store.getFile(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (!store.isUserInRoom(rec.roomId, req.user.id)) {
    return res.status(403).json({ error: 'Not in this room' });
  }
  const filePath = path.join(UPLOAD_DIR, rec.storedName);
  if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'File gone' });

  const ascii = rec.name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', rec.size);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(rec.name)}`
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  fs.createReadStream(filePath).pipe(res);
});

/* ------------------------------------------------------------------ */
/* Socket.io — signalling + collaboration                              */
/* ------------------------------------------------------------------ */

const socketMsgLimiter = new Map();

function checkSocketRate(socketId, maxPerMinute = 180) {
  const now = Date.now();
  let entry = socketMsgLimiter.get(socketId);
  if (!entry || now > entry.reset) {
    entry = { count: 0, reset: now + 60000 };
    socketMsgLimiter.set(socketId, entry);
  }
  entry.count++;
  return entry.count <= maxPerMinute;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of socketMsgLimiter) {
    if (now > v.reset) socketMsgLimiter.delete(k);
  }
}, 5 * 60 * 1000).unref();

io.use((socket, next) => {
  try {
    const parsed = cookie.parse(socket.handshake.headers.cookie || '');
    const token = parsed[auth.ACCESS_COOKIE];
    if (!token) throw new Error('no token');

    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      clockTolerance: 5,
    });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user) throw new Error('no user');

    // Origin check
    const origin = socket.handshake.headers.origin;
    if (origin && process.env.NODE_ENV === 'production') {
      const allowed = [
        process.env.CLIENT_ORIGIN,
        `https://localhost:${PORT}`,
      ].filter(Boolean);
      if (!allowed.some((o) => origin === o)) {
        throw new Error('origin not allowed');
      }
    }

    socket.user = { id: user.id, name: user.name, role: user.role };
    socket.data.connectedAt = Date.now();
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

function makeLimiter(capacity, refillPerSecond) {
  let tokens = capacity;
  let last = Date.now();
  return function allow() {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

function sanitizeStroke(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'clear') return { type: 'clear' };

  const W = store.LOGICAL_W;
  const H = store.LOGICAL_H;
  const num = (v, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  };

  const x0 = num(s.x0, 0, W), y0 = num(s.y0, 0, H);
  const x1 = num(s.x1, 0, W), y1 = num(s.y1, 0, H);
  if ([x0, y0, x1, y1].some((v) => v === null)) return null;

  const color = sanitize.cleanColor(s.color, '#ffffff');
  const width = num(s.width, 1, 40) || 4;

  return { x0, y0, x1, y1, color, width, erase: Boolean(s.erase) };
}

io.on('connection', (socket) => {
  // Per-socket rate limiting on every event
  const _originalOnEvent = socket.onevent.bind(socket);
  socket.onevent = function (packet) {
    if (!checkSocketRate(socket.id, 180)) {
      socket.emit('rate:limited', { message: 'Slow down' });
      return;
    }
    _originalOnEvent(packet);
  };

  // Concurrent socket limit per user
  const userSocketCount = [...io.sockets.sockets.values()]
    .filter((s) => s.user && s.user.id === socket.user.id).length;
  if (userSocketCount > 5) {
    socket.emit('error', 'Too many concurrent connections');
    socket.disconnect(true);
    return;
  }

  const limitSignal = makeLimiter(600, 300);
  const limitStroke = makeLimiter(600, 400);
  const limitChat = makeLimiter(30, 2);

  /* ---- join ---- */
  socket.on('room:join', async (payload, ack) => {
    if (typeof ack !== 'function') return;

    if (typeof payload !== 'object' || payload === null) {
      return ack({ error: 'Invalid payload' });
    }

    const roomId = sanitize.cleanRoomId(payload.roomId);
    const password = typeof payload.password === 'string'
      ? payload.password.slice(0, 100)
      : '';

    if (!roomId || roomId.length < 4) {
      return ack({ error: 'Invalid room code' });
    }

    try {
      const room = store.getRoom(roomId);
      if (!room) return ack({ error: 'Room not found' });

      if (room.locked && room.ownerId !== socket.user.id) {
        const alreadyIn = [...room.members.values()].some((m) => m.id === socket.user.id);
        if (!alreadyIn) return ack({ error: 'Room is locked by the host' });
      }

      const ok = await store.checkRoomPassword(room, password);
      if (!ok) return ack({ error: 'Wrong room password' });

      const previous = socket.data.roomId;
      if (previous && previous !== roomId) {
        store.leave(previous, socket.id);
        socket.to(previous).emit('peer:left', { peerId: socket.id });
        socket.leave(previous);
      }

      const existing = store.participants(roomId).map((p) => ({
        socketId: p.socketId,
        name: p.name,
        audio: p.audio,
        video: p.video,
        screen: p.screen,
        hand: p.hand,
        isOwner: p.isOwner,
      }));

      store.join(roomId, socket.id, socket.user);
      socket.data.roomId = roomId;
      socket.join(roomId);

      ack({
        selfId: socket.id,
        name: socket.user.name,
        isOwner: socket.user.id === room.ownerId,
        peers: existing,
        strokes: room.strokes,
        files: room.files,
        messages: room.messages.slice(-100),
        notes: room.notes,
        polls: room.polls,
        locked: room.locked,
      });

      socket.to(roomId).emit('peer:joined', {
        peerId: socket.id,
        name: socket.user.name,
      });

      auth.audit(socket.user.id, 'room_join', roomId, socket.handshake.address);
    } catch (err) {
      ack({ error: 'Join failed: ' + err.message });
    }
  });

  /* ---- WebRTC signalling ---- */
  socket.on('signal', (payload) => {
    if (!limitSignal()) return;
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const to = payload && payload.to;
    const data = payload && payload.data;
    if (typeof to !== 'string' || !data) return;

    const room = store.getRoom(roomId);
    if (!room || !room.members.has(to)) return;

    io.to(to).emit('signal', { from: socket.id, data });
  });

  /* ---- media state ---- */
  socket.on('media:state', (state) => {
    const roomId = socket.data.roomId;
    if (!roomId || !state || typeof state !== 'object') return;

    const room = store.getRoom(roomId);
    const m = room && room.members.get(socket.id);
    if (!m) return;

    if (typeof state.audio === 'boolean') m.audio = state.audio;
    if (typeof state.video === 'boolean') m.video = state.video;
    if (typeof state.screen === 'boolean') m.screen = state.screen;

    socket.to(roomId).emit('peer:media', {
      peerId: socket.id,
      audio: m.audio,
      video: m.video,
      screen: m.screen,
    });
  });

  /* ---- hand raise ---- */
  socket.on('hand:raise', (raised) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = store.getRoom(roomId);
    const m = room && room.members.get(socket.id);
    if (!m) return;
    m.hand = Boolean(raised);
    socket.to(roomId).emit('peer:hand', { peerId: socket.id, hand: m.hand });
  });

  /* ---- captions (SINGLE handler, not duplicated) ---- */
  socket.on('caption', (text) => {
    const roomId = socket.data.roomId;
    if (!roomId || typeof text !== 'string') return;
    const clean = sanitize.cleanText(text, 300);
    if (!clean) return;
    socket.to(roomId).emit('caption', { name: socket.user.name, text: clean });
  });

  /* ---- reactions ---- */
  socket.on('reaction', (emoji) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const allowed = ['👍', '❤️', '😂', '🎉', '👏', '🤔', '😮', '🔥'];
    if (!allowed.includes(emoji)) return;
    io.to(roomId).emit('reaction', {
      peerId: socket.id,
      name: socket.user.name,
      emoji,
    });
  });

  /* ---- chat ---- */
  socket.on('chat:send', (payload) => {
    const roomId = socket.data.roomId;
    if (!roomId || !limitChat()) return;
    const raw = payload && payload.text;
    if (typeof raw !== 'string') return;
    const text = sanitize.cleanMultiline(raw, 2000).trim();
    if (!text) return;
    const msg = { from: socket.user.name, text, at: Date.now() };
    store.addMessage(roomId, msg);
    io.to(roomId).emit('chat:message', msg);
  });

  /* ---- notes ---- */
  socket.on('notes:update', (text) => {
    const roomId = socket.data.roomId;
    if (!roomId || typeof text !== 'string') return;
    store.setNotes(roomId, sanitize.cleanMultiline(text, 20000));
    socket.to(roomId).emit('notes:update', text);
  });

  /* ---- whiteboard ---- */
  socket.on('wb:stroke', (stroke) => {
    const roomId = socket.data.roomId;
    if (!roomId || !limitStroke()) return;
    const clean = sanitizeStroke(stroke);
    if (!clean) return;
    store.addStroke(roomId, clean);
    socket.to(roomId).emit('wb:stroke', clean);
  });

  socket.on('wb:clear', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    store.clearBoard(roomId);
    io.to(roomId).emit('wb:clear', { by: socket.user.name });
  });

  /* ---- polls ---- */
  socket.on('poll:create', (payload) => {
    const roomId = socket.data.roomId;
    if (!roomId || !payload) return;
    const question = sanitize.cleanText(payload.question, 200);
    const options = Array.isArray(payload.options)
      ? payload.options
          .map((o) => sanitize.cleanText(o, 80))
          .filter(Boolean)
          .slice(0, 6)
      : [];
    if (!question || options.length < 2) return;

    const poll = {
      id: crypto.randomBytes(4).toString('hex'),
      question,
      options,
      votes: {},
      createdBy: socket.user.name,
      at: Date.now(),
    };
    store.createPoll(roomId, poll);
    io.to(roomId).emit('poll:created', poll);
  });

  socket.on('poll:vote', (payload) => {
    const roomId = socket.data.roomId;
    if (!roomId || !payload) return;
    const poll = store.votePoll(roomId, payload.pollId, socket.user.id, payload.choice);
    if (poll) io.to(roomId).emit('poll:updated', poll);
  });

  /* ---- host controls ---- */
  socket.on('host:mute-all', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = store.getRoom(roomId);
    if (!room || room.ownerId !== socket.user.id) return;
    io.to(roomId).emit('host:force-mute');
  });

  socket.on('host:kick', ({ peerId } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId || typeof peerId !== 'string') return;
    const room = store.getRoom(roomId);
    if (!room || room.ownerId !== socket.user.id) return;
    if (!room.members.has(peerId)) return;

    io.to(peerId).emit('host:kicked');
    const target = io.sockets.sockets.get(peerId);
    if (target) {
      target.leave(roomId);
      target.data.roomId = null;
    }
    store.leave(roomId, peerId);
    io.to(roomId).emit('peer:left', { peerId });
    auth.audit(socket.user.id, 'host_kick', peerId, socket.handshake.address);
  });

  socket.on('host:lock', (locked) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = store.getRoom(roomId);
    if (!room || room.ownerId !== socket.user.id) return;
    room.locked = Boolean(locked);
    io.to(roomId).emit('host:locked', { locked: room.locked });
    auth.audit(
      socket.user.id,
      room.locked ? 'room_lock' : 'room_unlock',
      roomId,
      socket.handshake.address
    );
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    store.leave(roomId, socket.id);
    socket.to(roomId).emit('peer:left', { peerId: socket.id });
  });
});

/* ------------------------------------------------------------------ */
/* Error handler                                                       */
/* ------------------------------------------------------------------ */

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 100 MB)' });
  }
  if (err && err.message === 'File type not allowed') {
    return res.status(400).json({ error: 'File type not allowed' });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔════════════════════════════════════════════════════╗');
  console.log('  ║   Real-Time Communication App  v2.1 (Secured)       ║');
  console.log('  ╚════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  →  ${hasCerts ? 'https' : 'http'}://localhost:${PORT}`);
  console.log('');
});