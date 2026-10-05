const { randomBytes, createHmac, timingSafeEqual } = require('node:crypto');
const ROOM_RE = /^[A-Z0-9]{4,12}$/;

function positiveInteger(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Expected an integer between ${min} and ${max}.`);
  return number;
}

function createAccess(env, now = Date.now) {
  const production = env.NODE_ENV === 'production';
  const required = production || env.REQUIRE_ROOM_TOKEN !== 'false';
  if (production && env.REQUIRE_ROOM_TOKEN === 'false') throw new Error('Production requires private room invitations.');
  if (env.ROOM_SIGNING_SECRET && Buffer.byteLength(env.ROOM_SIGNING_SECRET) < 32) throw new Error('ROOM_SIGNING_SECRET must contain at least 32 bytes.');
  if (production && !env.ROOM_SIGNING_SECRET) throw new Error('Production requires ROOM_SIGNING_SECRET.');
  const secret = env.ROOM_SIGNING_SECRET || randomBytes(32).toString('hex');
  const ttl = positiveInteger(env.ROOM_TTL_SECONDS, 28800, 300, 86400);
  const origins = new Set((env.ALLOWED_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean));
  for (const value of origins) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) throw new Error('ALLOWED_ORIGIN must list exact HTTP(S) origins.');
    if (production && url.protocol !== 'https:') throw new Error('Production ALLOWED_ORIGIN requires HTTPS.');
  }
  if (production && !origins.size) throw new Error('Production requires ALLOWED_ORIGIN.');
  const sign = body => createHmac('sha256', secret).update(body).digest();
  function mint() {
    const room = randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = Math.floor(now() / 1000) + ttl;
    const body = Buffer.from(JSON.stringify({ v: 1, room, exp: expiresAt, nonce: randomBytes(16).toString('hex') })).toString('base64url');
    return { room, token: `${body}.${sign(body).toString('base64url')}`, expiresAt };
  }
  function verify(token, room) {
    if (typeof token !== 'string' || token.length > 512) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
    const signature = Buffer.from(parts[1], 'base64url');
    const expected = sign(parts[0]);
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
    try {
      const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      if (value.v !== 1 || !ROOM_RE.test(value.room) || !Number.isInteger(value.exp) ||
        value.exp <= Math.floor(now() / 1000) || (room && value.room !== room)) return null;
      return value;
    } catch { return null; }
  }
  function originAllowed(request) {
    const origin = request.headers.origin;
    // Non-browser clients must still present a valid invitation for admission.
    if (!origin) return true;
    if (origins.size) return origins.has(origin);
    try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && url.host === request.headers.host; }
    catch { return false; }
  }
  const bearer = request => {
    const header = request.headers.authorization;
    return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
  };
  return { required, production, mint, verify, originAllowed, bearer };
}

// Bounded, lazy-expiring rate windows; client-supplied forwarding headers are never trusted.
function createRateLimit({ limit, interval, capacity = 10000, now = Date.now }) {
  const entries = new Map();
  return key => {
    const time = now();
    let entry = entries.get(key);
    if (!entry || time >= entry.until) {
      if (entries.size >= capacity) {
        for (const [id, value] of entries) if (time >= value.until) entries.delete(id);
        if (!entries.has(key) && entries.size >= capacity) return false;
      }
      entry = { count: 0, until: time + interval };
      entries.set(key, entry);
    }
    return ++entry.count <= limit;
  };
}
module.exports = { createAccess, createRateLimit, positiveInteger };
