const express = require('express');
const router = express.Router();
const { Readable } = require('stream');
const { Readable: WebReadable } = require('stream/web');

// GET /pose?text=Hello&spoken=en&signed=ase
router.get('/pose', async (req, res) => {
  const { text, spoken = 'en', signed = 'ase' } = req.query;
  if (!text || !String(text).trim()) {
    return res.status(400).send('Missing text');
  }

  try {
    const base = 'https://us-central1-sign-mt.cloudfunctions.net/spoken_text_to_signed_pose';
    const url = `${base}?text=${encodeURIComponent(text)}&spoken=${encodeURIComponent(spoken)}&signed=${encodeURIComponent(signed)}`;

    const upstream = await fetch(url, {
      method: 'GET',
      headers: {
        Referer: 'https://sign.mt/',
        Origin: 'https://sign.mt',
        'User-Agent': 'Mozilla/5.0',
        Accept: '*/*',
      },
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!['transfer-encoding', 'content-encoding'].includes(key)) {
        res.setHeader(key, value);
      }
    });
    res.setHeader('Cache-Control', 'no-store');

    if (!upstream.body) return res.end();

    if (!upstream.ok) {
      const bodyTxt = await upstream.text().catch(() => '');
      console.error('Upstream error', upstream.status, bodyTxt.slice(0, 500));
      return res.end(bodyTxt);
    }

    try {
      const nodeReadable = Readable.fromWeb ? Readable.fromWeb(upstream.body) : WebReadable.toWeb(upstream.body);
      return nodeReadable.pipe(res);
    } catch {
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.end(buf);
    }
  } catch (e) {
    console.error('Proxy error:', e && e.stack ? e.stack : e);
    res.status(500).send('Proxy error');
  }
});

module.exports = router;
