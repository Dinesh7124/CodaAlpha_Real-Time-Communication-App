'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('./db');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const router = express.Router();

const SECRET = process.env.JWT_SECRET;
const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30;

const ACCESS_COOKIE = 'rtc_at';
const REFRESH_COOKIE = 'rtc_rt';

const BCRYPT_ROUNDS = 12;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_THRESHOLD = 5;

function cookieOpts(maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeMs,
  };
}

function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

function signAccess(user) {
  return jwt.sign(
    { sub: user.id, name: user.name, role: user.role },
    SECRET,
    { expiresIn: ACCESS_TTL, algorithm: 'HS256' }
  );
}

function issueRefresh(userId) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const id = crypto.randomUUID();
  const expires = Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;
  db.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, userId, hashToken(raw), expires, Date.now());
  return raw;
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

function audit(userId, action, detail, ip) {
  try {
    const safeDetail = typeof detail === 'string' ? detail.slice(0, 500) : null;
    const safeIp = typeof ip === 'string' ? ip.slice(0, 45) : null;
    db.prepare(
      'INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userId || null, String(action).slice(0, 100), safeDetail, safeIp, Date.now());
  } catch { /* ignore */ }
}

function attachUser(req, res, next) {
  const token = req.cookies ? req.cookies[ACCESS_COOKIE] : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, SECRET, {
      algorithms: ['HS256'],
      clockTolerance: 5,
    });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (user) req.user = publicUser(user);
  } catch { /* expired */ }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function setAuthCookies(res, user) {
  res.cookie(ACCESS_COOKIE, signAccess(user), cookieOpts(15 * 60 * 1000));
  const refresh = issueRefresh(user.id);
  res.cookie(REFRESH_COOKIE, refresh, cookieOpts(REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000));
}

/* ---------------- validation ---------------- */

const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789',
  'qwerty123', 'admin123', 'letmein', 'welcome', 'admin',
  'iloveyou', 'monkey', 'dragon', 'football', 'baseball',
  'abc12345', '11111111', '00000000', 'qwertyui', 'asdfghjkl',
]);

function isStrongPassword(pw) {
  if (typeof pw !== 'string') return false;
  if (WEAK_PASSWORDS.has(pw.toLowerCase())) return false;
  let score = 0;
  if (/[a-z]/.test(pw)) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  return score >= 3;
}

const RegisterSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[\p{L}\p{N} ._-]+$/u, {
      message: 'Name may contain letters, numbers, spaces, dot, dash, underscore',
    }),
  email: z.string().trim().email().max(120).transform((e) => e.toLowerCase()),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(200)
    .refine(isStrongPassword, {
      message: 'Password must include 3 of: uppercase, lowercase, digit, symbol. No common words.',
    }),
});

const LoginSchema = z.object({
  email: z.string().trim().email().max(120).transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});

/* ---------------- routes ---------------- */

router.post('/register', async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { name, email, password } = parsed.data;

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const id = crypto.randomUUID();

  db.prepare(
    'INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, email, passwordHash, 'user', Date.now());

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  setAuthCookies(res, user);
  audit(user.id, 'register', email, req.ip);

  res.json({ user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const { email, password } = parsed.data;

  // --- Account lockout check ---
  const recentFails = db
    .prepare(
      `SELECT COUNT(*) AS c FROM audit_log
       WHERE action = 'login_failed' AND detail = ? AND created_at > ?`
    )
    .get(email, Date.now() - LOCKOUT_WINDOW_MS);

  if (recentFails.c >= LOCKOUT_THRESHOLD) {
    audit(null, 'login_locked', email, req.ip);
    return res.status(429).json({
      error: 'Too many failed attempts. Try again in 15 minutes.',
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  const hash = user ? user.password_hash : '$2a$12$' + '0'.repeat(53);
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok) {
    audit(user ? user.id : null, 'login_failed', email, req.ip);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  setAuthCookies(res, user);
  audit(user.id, 'login', null, req.ip);
  res.json({ user: publicUser(user) });
});

router.post('/refresh', (req, res) => {
  const raw = req.cookies ? req.cookies[REFRESH_COOKIE] : null;
  if (!raw) return res.status(401).json({ error: 'No refresh token' });

  const row = db
    .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?')
    .get(hashToken(raw));

  if (!row || row.expires_at < Date.now()) {
    if (row) db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(row.id);
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user) return res.status(401).json({ error: 'User no longer exists' });

  db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(row.id);
  setAuthCookies(res, user);

  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  const raw = req.cookies ? req.cookies[REFRESH_COOKIE] : null;
  if (raw) {
    db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(hashToken(raw));
  }
  res.clearCookie(ACCESS_COOKIE, cookieOpts(0));
  res.clearCookie(REFRESH_COOKIE, cookieOpts(0));
  res.json({ ok: true });
});


/* ---------------- 2FA ---------------- */

router.post('/2fa/setup', requireAuth, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `RTC (${req.user.email})`,
      issuer: 'RTC',
    });

    db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?')
      .run(secret.base32, req.user.id);

    const qr = await QRCode.toDataURL(secret.otpauth_url);

    res.json({ qr, secret: secret.base32 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/2fa/enable', requireAuth, (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Code required' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !user.totp_secret) return res.status(400).json({ error: 'Run setup first' });

  const ok = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token: String(code),
    window: 1,
  });

  if (!ok) return res.status(401).json({ error: 'Invalid code' });

  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.user.id);
  audit(req.user.id, '2fa_enabled', null, req.ip);
  res.json({ ok: true });
});

router.post('/2fa/disable', requireAuth, (req, res) => {
  const { code } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.totp_enabled) {
    const ok = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: String(code || ''),
      window: 1,
    });
    if (!ok) return res.status(401).json({ error: 'Invalid code' });
  }

  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(req.user.id);
  audit(req.user.id, '2fa_disabled', null, req.ip);
  res.json({ ok: true });
});



router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = {
  router,
  attachUser,
  requireAuth,
  audit,
  ACCESS_COOKIE,
};