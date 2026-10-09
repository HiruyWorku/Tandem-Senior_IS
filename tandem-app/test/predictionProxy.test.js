const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../server');
const { requestPrediction } = require('../server/predictionProxy');
const landmarks = Array(63).fill(0.5);
const valid = { prediction: 'A', confidence: 0.92, model_version: 2 };

async function fixture(t, fetchPrediction) {
  const logs = [];
  const app = createApplication({ env: { ENABLE_ASL: 'true', REQUIRE_ROOM_TOKEN: 'false' },
    fetchPrediction, logger: event => logs.push(event) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  return { logs, post: body => fetch(`http://127.0.0.1:${app.server.address().port}/api/predict`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) };
}

test('recognition accepts only letters and probabilities and omits unrelated provider fields', async t => {
  let calls = 0;
  const f = await fixture(t, async (url, options) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:5003/predict');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    assert.deepEqual(JSON.parse(options.body), { landmarks });
    return Response.json({ ...valid, private: 'private-provider-detail' });
  });
  assert.equal((await f.post({ landmarks: Array(63).fill('invalid') })).status, 400);
  assert.equal(calls, 0);
  const response = await f.post({ landmarks });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), valid); assert.deepEqual(f.logs, []);
});

test('recognition normalizes failed, malformed and unsafe provider results without private diagnostics', async t => {
  const cases = [
    () => new Response('private-provider-detail', { status: 500 }),
    () => new Response('private-provider-detail', { headers: { 'Content-Type': 'application/json' } }),
    () => Response.json({ ...valid, prediction: 'private-provider-detail' }),
    () => Response.json({ ...valid, confidence: 2 }),
    () => Response.json({ ...valid, confidence: '0.92' }),
    () => Response.json({ ...valid, model_version: 99 }),
    () => new Response(JSON.stringify(valid), { headers: { 'Content-Type': 'text/html' } }),
    () => { throw new Error('private-provider-detail'); },
  ];
  let next = 0;
  const f = await fixture(t, async () => cases[next++]());
  for (const _ of cases) {
    const response = await f.post({ landmarks });
    assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'Recognition is unavailable. You can still type a reply.' });
  }
  assert.deepEqual(f.logs, cases.map(() => ({ event: 'recognition_provider_failed', code: 'unknown' })));
});

test('recognition cancels oversized response streams before reading the complete body', async () => {
  let canceled = false; let reads = 0;
  const body = new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(600)); },
    cancel() { canceled = true; },
  });
  await assert.rejects(requestPrediction({ landmarks, url: 'http://localhost/predict',
    fetchPrediction: async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }) }));
  assert.equal(canceled, true); assert.ok(reads <= 4);
});

test('recognition deadline also bounds stalled response bodies', { timeout: 6000 }, async t => {
  const http = require('node:http');
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  await assert.rejects(requestPrediction({ landmarks, url: `http://127.0.0.1:${server.address().port}/predict` }));
});

test('global recognition capacity rejects excess work and releases success and failure slots', async t => {
  const pending = [];
  const f = await fixture(t, () => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const a = f.post({ landmarks });
  const b = f.post({ landmarks });
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000;
    function check() {
      if (pending.length === 2) return resolve();
      if (Date.now() >= deadline) return reject(new Error('Provider work did not start.'));
      setTimeout(check, 5);
    }
    check();
  });
  t.after(() => pending.forEach(job => job.resolve(Response.json(valid))));
  const busy = await f.post({ landmarks });
  assert.equal(busy.status, 503);
  assert.equal(busy.headers.get('retry-after'), '1');
  assert.deepEqual(await busy.json(), { error: 'Recognition is busy. You can still type a reply.' });
  assert.equal(pending.length, 2);
  pending[0].resolve(Response.json(valid));
  pending[1].reject(new Error('private provider failure'));
  assert.equal((await a).status, 200);
  assert.equal((await b).status, 503);
  const next = f.post({ landmarks });
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000;
    function check() {
      if (pending.length === 3) return resolve();
      if (Date.now() >= deadline) return reject(new Error('Released slot remained unavailable.'));
      setTimeout(check, 5);
    }
    check();
  });
  pending[2].resolve(Response.json(valid));
  assert.equal((await next).status, 200);
  assert.deepEqual(f.logs, [{ event: 'recognition_provider_failed', code: 'unknown' }]);
});

test('invalid recognition concurrency fails startup', () => {
  for (const value of ['0', '21', 'NaN', '1.5']) {
    assert.throws(() => createApplication({ env: { MAX_PREDICTION_REQUESTS: value } }));
  }
});
