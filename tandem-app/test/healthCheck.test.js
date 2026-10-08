const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { httpCheck, certificateCheck, check } = require('../deploy/staging/health-check.cjs');

test('health checks refuse bad status, malformed readiness and oversized bodies without retaining private content', async () => {
  const expected = { status: 200, body: body => JSON.parse(body).ready === true };
  const run = body => httpCheck('https://example.com', '/ready', expected, { fetchImpl: async () => new Response(body) });
  assert.deepEqual(await run('{"ready":true}'), { healthy: true });
  assert.equal((await run('{"ready":false}')).healthy, false);
  assert.equal((await run('PRIVATE_BODY')).healthy, false);
  assert.equal((await run('x'.repeat(1025))).reason, 'response_size');
  assert.equal((await httpCheck('https://example.com', '/ready', expected, {
    fetchImpl: async () => new Response('PRIVATE_BODY', { status: 503 }),
  })).reason, 'http_status');
});

test('HTTP health probes forbid redirects and carry a deadline while omitting raw fetch failures', async () => {
  const result = await httpCheck('https://example.com', '/health', { status: 200 }, {
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
      assert.ok(options.signal instanceof AbortSignal); throw Error('PRIVATE_EXCEPTION');
    },
  });
  assert.deepEqual(result, { healthy: false, reason: 'http_unavailable' });
});

test('TLS health checks require trusted certificates, detect near expiry, and terminate hung connections', async () => {
  const probe = (authorized, days) => certificateCheck('relay.example.com', {
    now: () => 0, connect: options => {
      assert.equal(options.rejectUnauthorized, true); assert.equal(options.servername, 'relay.example.com');
      const socket = new EventEmitter(); socket.authorized = authorized; socket.destroy = () => {};
      socket.getPeerCertificate = () => ({ valid_to: new Date(days * 86400000).toUTCString() });
      queueMicrotask(() => socket.emit('secureConnect')); return socket;
    },
  });
  assert.equal((await probe(true, 30)).healthy, true);
  assert.equal((await probe(true, 6)).reason, 'certificate_expiring');
  assert.equal((await probe(false, 30)).reason, 'tls_untrusted');
  let destroyed = false;
  const hung = await certificateCheck('relay.example.com', { timeoutMs: 5, connect: () => {
    const socket = new EventEmitter(); socket.destroy = () => { destroyed = true; }; return socket;
  } });
  assert.equal(hung.reason, 'tls_unavailable'); assert.equal(destroyed, true);
});

test('monitor output uses fixed check names and no raw server errors, URLs, invitations or body text', async () => {
  const result = await check('https://example.com', 'relay.example.com', {
    fetchImpl: async () => { throw Error('PRIVATE_INVITATION'); },
    connect: () => { throw Error('PRIVATE_TLS_EXCEPTION'); },
  });
  assert.equal(result.healthy, false); assert.equal(result.checks.length, 6);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result).includes('example.com'), false);
  await assert.rejects(check('https://example.com/#invite=PRIVATE', 'relay.example.com'));
});
