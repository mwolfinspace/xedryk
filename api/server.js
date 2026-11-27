'use strict';
/*
 * BotanicaLab share API — dependency-free Node.js service.
 * POST /api/share with JSON { action, ... }
 *
 * Actions: ping | create | read | update | renew | delete
 * Payloads are encrypted at rest with AES-256-GCM. PINs are scrypt-hashed.
 * Codes are 8 chars from an unambiguous alphabet; TTL defaults to 3 days.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 4317);
const HOST_LIST = (process.env.HOST || '127.0.0.1').split(',').map(h => h.trim()).filter(Boolean);
const HOST = HOST_LIST[0];
const DATA_DIR = process.env.BOTANICALAB_SHARE_DATA || path.join(os.tmpdir(), 'botanicalab-share');
const STATIC_DIR = process.env.STATIC_DIR || __dirname;
const SERVE_STATIC = process.env.SERVE_STATIC === '1';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://about.xedryk.top';
const TTL_MS = Number(process.env.SHARE_TTL_SECONDS || 3 * 24 * 60 * 60) * 1000;
const MAX_BODY_BYTES = Number(process.env.SHARE_MAX_BYTES || 2 * 1024 * 1024);
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const PIN_FAIL_LIMIT = 5;
const PIN_LOCK_MS = 15 * 60_000;
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const KEY = loadKey();

function loadKey() {
  const file = path.join(DATA_DIR, '.key');
  if (fs.existsSync(file)) {
    const key = fs.readFileSync(file);
    if (key.length !== 32) throw new Error('Invalid share encryption key');
    return key;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

function send(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    ...headers,
  });
  res.end(body);
}

function fail(res, status, message, extra = {}) {
  send(res, status, { ok: false, error: message, ...extra });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON body'), { code: 'BAD_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetch/curl; browser normally sends Origin on POST
  return origin === ALLOWED_ORIGIN
    || origin === 'http://127.0.0.1:4226'
    || origin === 'http://localhost:4226'
    || origin === 'http://127.0.0.1:4320'
    || origin === 'http://localhost:4320';
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

const rateBuckets = new Map();
function rateAllowed(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { start: now, count: 0 };
  if (now - bucket.start > RATE_WINDOW_MS) { bucket.start = now; bucket.count = 0; }
  bucket.count++;
  rateBuckets.set(ip, bucket);
  return bucket.count <= RATE_LIMIT;
}

const pinFailures = new Map();
function lockState(code) {
  const s = pinFailures.get(code);
  if (!s) return { locked: false, retryAfterMs: 0 };
  if (s.until && Date.now() < s.until) return { locked: true, retryAfterMs: s.until - Date.now() };
  if (s.until && Date.now() >= s.until) pinFailures.delete(code);
  return { locked: false, retryAfterMs: 0 };
}
function notePinFailure(code) {
  const s = pinFailures.get(code) || { count: 0, until: 0 };
  s.count++;
  if (s.count >= PIN_FAIL_LIMIT) s.until = Date.now() + PIN_LOCK_MS;
  pinFailures.set(code, s);
  return s;
}
function clearPinFailures(code) { pinFailures.delete(code); }

function normalizeCode(value) {
  const code = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[2-9A-HJ-NP-Z]{8}$/.test(code) ? code : '';
}
function generateCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 8; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!fs.existsSync(codePath(code))) return code;
  }
  throw new Error('Could not allocate share code');
}
function codePath(code) {
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  return path.join(DATA_DIR, `${hash}.json`);
}

function writeRecord(code, record) {
  const target = codePath(code);
  const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
  fs.renameSync(tmp, target);
  try { fs.chmodSync(target, 0o600); } catch (e) {}
}
function readRecord(code) {
  const file = codePath(code);
  if (!fs.existsSync(file)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    return record && typeof record === 'object' ? record : null;
  } catch (e) { return null; }
}
function deleteRecord(code) {
  try { fs.unlinkSync(codePath(code)); } catch (e) {}
  clearPinFailures(code);
}

function cleanupExpired() {
  try {
    const now = Date.now();
    for (const file of fs.readdirSync(DATA_DIR)) {
      if (!file.endsWith('.json')) continue;
      const full = path.join(DATA_DIR, file);
      try {
        const rec = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (!rec || typeof rec.expiresAt !== 'number' || rec.expiresAt <= now) fs.unlinkSync(full);
      } catch (e) {
        fs.unlinkSync(full);
      }
    }
  } catch (e) {}
}

function encryptPayload(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return {
    enc: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
}
function decryptPayload(record) {
  if (!record.enc) return record.payload || null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(record.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8'));
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('base64');
}
function verifyPin(record, pin) {
  if (!record.pinSalt || !record.pinHash) return true;
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return false;
  const salt = Buffer.from(record.pinSalt, 'base64');
  const supplied = Buffer.from(hashPin(pin, salt), 'base64');
  const expected = Buffer.from(record.pinHash, 'base64');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function validPayload(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload);
}
function meta(record, code) {
  return {
    ok: true,
    code,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    hasPin: !!(record.pinSalt && record.pinHash),
  };
}
function requireUnlock(res, record, code, pin) {
  if (!verifyPin(record, pin)) {
    const s = notePinFailure(code);
    const retry = s.until ? Math.max(0, s.until - Date.now()) : 0;
    fail(res, 401, retry ? 'Mã bị khóa tạm do nhập sai PIN quá nhiều' : 'Sai PIN', { retryAfterMs: retry });
    return false;
  }
  clearPinFailures(code);
  return true;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};
function serveStatic(req, res, pathname) {
  if (!SERVE_STATIC) return fail(res, 404, 'Not found');
  let rel = decodeURIComponent(pathname || '/');
  if (rel === '/' || rel === '/index.html') rel = '/herbal_brew_inventory_tracker.html';
  const full = path.resolve(STATIC_DIR, `.${rel}`);
  if (!full.startsWith(path.resolve(STATIC_DIR))) return fail(res, 403, 'Forbidden');
  fs.readFile(full, (err, data) => {
    if (err) return fail(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.pathname !== '/api/share') return serveStatic(req, res, url.pathname);
    const origin = req.headers.origin;
    const allowed = originAllowed(req);
    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method !== 'POST') return fail(res, 405, 'POST only', { allow: 'POST' });
    if (!allowed) return fail(res, 403, 'Origin not allowed');
    if (!rateAllowed(clientIp(req))) return fail(res, 429, 'Too many requests');

    const body = await readBody(req);
    cleanupExpired();
    const action = String(body.action || '');

    if (action === 'ping') {
      return send(res, 200, {
        ok: true,
        service: 'botanicalab-share',
        version: 1,
        ttlDays: Math.round(TTL_MS / 86400000),
        encrypted: true,
        pinLength: 4,
        now: Date.now(),
      });
    }

    if (action === 'create') {
      if (!validPayload(body.payload)) return fail(res, 400, 'Missing payload');
      const code = generateCode();
      // Blank or invalid PIN means "generate one"; every code gets a 4-digit PIN.
      const pin = (typeof body.pin === 'string' && /^\d{4}$/.test(body.pin))
        ? body.pin
        : String(crypto.randomInt(1000, 10000));
      const salt = crypto.randomBytes(16);
      const now = Date.now();
      const record = {
        version: 1,
        ...encryptPayload(body.payload),
        pinSalt: pin ? salt.toString('base64') : '',
        pinHash: pin ? hashPin(pin, salt) : '',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + TTL_MS,
      };
      writeRecord(code, record);
      clearPinFailures(code);
      const out = meta(record, code);
      out.pin = pin;
      return send(res, 201, out);
    }

    const code = normalizeCode(body.code);
    if (!code) return fail(res, 400, 'Invalid code');
    const locked = lockState(code);
    if (locked.locked) return fail(res, 429, 'Mã bị khóa tạm do nhập sai PIN quá nhiều', { retryAfterMs: locked.retryAfterMs });
    const record = readRecord(code);
    if (!record) return fail(res, 404, 'Mã không tồn tại hoặc đã hết hạn');
    if (record.expiresAt <= Date.now()) {
      deleteRecord(code);
      return fail(res, 404, 'Mã đã hết hạn');
    }

    if (action === 'read') {
      if (!requireUnlock(res, record, code, body.pin)) return;
      const payload = decryptPayload(record);
      const out = meta(record, code);
      out.payload = payload;
      return send(res, 200, out);
    }

    if (action === 'update') {
      if (!validPayload(body.payload)) return fail(res, 400, 'Missing payload');
      if (!requireUnlock(res, record, code, body.pin)) return;
      record.updatedAt = Date.now();
      record.expiresAt = record.updatedAt + TTL_MS;
      Object.assign(record, encryptPayload(body.payload));
      writeRecord(code, record);
      return send(res, 200, meta(record, code));
    }

    if (action === 'renew') {
      if (!requireUnlock(res, record, code, body.pin)) return;
      record.updatedAt = Date.now();
      record.expiresAt = record.updatedAt + TTL_MS;
      writeRecord(code, record);
      return send(res, 200, meta(record, code));
    }

    if (action === 'delete') {
      if (!requireUnlock(res, record, code, body.pin)) return;
      deleteRecord(code);
      return send(res, 200, { ok: true, code, deleted: true });
    }

    return fail(res, 400, 'Unknown action');
  } catch (err) {
    const status = err && err.code === 'TOO_LARGE' ? 413 : (err && err.code === 'BAD_JSON' ? 400 : 500);
    fail(res, status, status === 500 ? 'Server error' : String(err.message || 'Request error'));
  }
});

cleanupExpired();
const cleanupTimer = setInterval(cleanupExpired, 60_000);
cleanupTimer.unref();
let listeningCount = 0;
HOST_LIST.forEach(host => server.listen(PORT, host, () => {
  listeningCount++;
  if (listeningCount === HOST_LIST.length) {
    console.log(`BotanicaLab share API listening on ${HOST_LIST.map(h => `http://${h}:${PORT}`).join(', ')} (data: ${DATA_DIR}, ttl: ${TTL_MS / 86400000}d)`);
  }
}));
