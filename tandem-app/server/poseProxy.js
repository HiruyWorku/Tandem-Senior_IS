const express = require('express');
const { Readable } = require('node:stream');

function createPoseProxy({ fetchPose = fetch, telemetry = { failure() {} } } = {}) {
  const router = express.Router();
  router.get('/pose', (_req, res) => res.set('Allow', 'POST').set('Cache-Control', 'no-store')
    .status(405).json({ error: 'Signing requests require POST.' }));
  router.post('/pose', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { text, spoken = 'en', signed = 'ase' } = req.body || {};
    if (typeof text !== 'string' || !text.trim() || text.length > 1000 ||
      typeof spoken !== 'string' || !/^[a-z]{2,3}$/.test(spoken) ||
      typeof signed !== 'string' || !/^[a-z]{2,3}$/.test(signed)) {
      return res.status(400).json({ error: 'Invalid signing request.' });
    }
    try {
      const url = new URL('https://us-central1-sign-mt.cloudfunctions.net/spoken_text_to_signed_pose');
      url.search = new URLSearchParams({ text, spoken, signed }).toString();
      const upstream = await fetchPose(url, { signal: AbortSignal.timeout(10000), headers: {
        Referer: 'https://sign.mt/', Origin: 'https://sign.mt', Accept: '*/*',
      } });
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel();
        telemetry.failure('avatar_provider_failed', upstream.status);
        return res.status(503).json({ error: 'Signing is unavailable. You can still type replies.' });
      }
      res.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
      const stream = Readable.fromWeb(upstream.body);
      stream.on('error', () => {
        telemetry.failure('avatar_provider_failed');
        if (!res.headersSent) res.status(503).json({ error: 'Signing is unavailable. You can still type replies.' });
        else res.destroy();
      });
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch {
      telemetry.failure('avatar_provider_failed');
      if (!res.headersSent) res.status(503).json({ error: 'Signing is unavailable. You can still type replies.' });
      else res.destroy();
    }
  });
  return router;
}
module.exports = createPoseProxy();
module.exports.createPoseProxy = createPoseProxy;
