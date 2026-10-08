/** Only the experimental letter contract may cross the Python/provider boundary. */
async function requestPrediction({ landmarks, url, fetchPrediction = fetch }) {
  const upstream = await fetchPrediction(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ landmarks }), signal: AbortSignal.timeout(3000),
    redirect: 'error',
  });
  let reader;
  try {
    if (upstream.status !== 200 || !upstream.body ||
      !/^application\/json(?:\s*;|$)/i.test(upstream.headers.get('content-type') || '')) {
      throw new Error('Invalid prediction response.');
    }
    reader = upstream.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) throw new Error('Prediction response is too large.');
      chunks.push(Buffer.from(value));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data.prediction !== 'string' || !/^[A-Z]$/.test(data.prediction) ||
      typeof data.confidence !== 'number' || !Number.isFinite(data.confidence) ||
      data.confidence < 0 || data.confidence > 1 || ![1, 2].includes(data.model_version)) {
      throw new Error('Invalid prediction result.');
    }
    return { prediction: data.prediction, confidence: data.confidence, model_version: data.model_version };
  } finally {
    if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
    else { try { await upstream.body?.cancel(); } catch {} }
  }
}
module.exports = { requestPrediction };
