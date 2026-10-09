// Synthetic real Node -> Gunicorn -> sklearn contract. Never log bearer links.
const assert = require('node:assert/strict');
const { createApplication } = require('/app/server.js');

(async () => {
  const app = createApplication({ env: {
    NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://tandem.example.com',
    ROOM_SIGNING_SECRET: 'synthetic-runtime-secret-only-at-least-32-bytes',
    ENABLE_ASL: 'true', ENABLE_SPEECH: 'false', ENABLE_AVATAR: 'false',
    ENABLE_SPEECH_OUTPUT: 'false', ASL_API_URL: process.env.ASL_TEST_URL,
  }, logger: () => {} });
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const post = (path, body, token) => fetch(base + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    const body = { landmarks: Array(63).fill(0) };
    assert.equal((await post('/api/predict', body)).status, 403);
    assert.equal((await post('/api/predict', body, 'invalid')).status, 403);
    const invitationResponse = await post('/api/rooms', {});
    assert.equal(invitationResponse.status, 201);
    const invitation = await invitationResponse.json();
    assert.equal((await post('/api/predict', { landmarks: [] }, invitation.token)).status, 400);
    const response = await post('/api/predict', body, invitation.token);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { prediction: 'A', confidence: 1, model_version: 2 });
  } finally {
    await app.close();
  }
})().catch(() => { console.error('Authenticated inference integration failed.'); process.exitCode = 1; });
