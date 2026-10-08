const tls = require('node:tls');

async function httpCheck(origin, path, expected, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  try {
    const response = await fetchImpl(origin + path, { redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== expected.status) {
      await response.body?.cancel(); return { healthy: false, reason: 'http_status' };
    }
    if (!expected.body) { await response.body?.cancel(); return { healthy: true }; }
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024) return { healthy: false, reason: 'response_size' };
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    return expected.body(Buffer.concat(chunks).toString('utf8')) ? { healthy: true } :
      { healthy: false, reason: 'response_invalid' };
  } catch { return { healthy: false, reason: 'http_unavailable' }; }
}

function certificateCheck(host, { connect = tls.connect, now = Date.now, timeoutMs = 10000 } = {}) {
  return new Promise(resolve => {
    let socket; let completed = false;
    const finish = result => {
      if (completed) return;
      completed = true; clearTimeout(timer); socket?.destroy(); resolve(result);
    };
    const timer = setTimeout(() => finish({ healthy: false, reason: 'tls_unavailable' }), timeoutMs);
    try {
      socket = connect({ host, port: 443, servername: host, rejectUnauthorized: true });
      socket.once('error', () => finish({ healthy: false, reason: 'tls_unavailable' }));
      socket.once('secureConnect', () => {
        try {
          if (!socket.authorized) return finish({ healthy: false, reason: 'tls_untrusted' });
          const expiresAt = Date.parse(socket.getPeerCertificate().valid_to);
          if (!Number.isFinite(expiresAt)) return finish({ healthy: false, reason: 'certificate_invalid' });
          const daysRemaining = Math.floor((expiresAt - now()) / 86400000);
          finish({ healthy: daysRemaining >= 7, daysRemaining,
            ...(daysRemaining < 7 ? { reason: 'certificate_expiring' } : {}) });
        } catch { finish({ healthy: false, reason: 'certificate_invalid' }); }
      });
    } catch { finish({ healthy: false, reason: 'tls_unavailable' }); }
  });
}

async function check(origin, relayHost, dependencies = {}) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin + '/' !== url.href || url.username || url.password ||
      typeof relayHost !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(relayHost)) throw new Error('Invalid monitoring configuration');
  const requests = [
    ['app_health', httpCheck(url.origin, '/health', { status: 200, body: body => body === 'OK' }, dependencies)],
    ['app_readiness', httpCheck(url.origin, '/ready', { status: 200, body: body => JSON.parse(body).ready === true }, dependencies)],
    ['metrics_access', httpCheck(url.origin, '/metrics', { status: 404 }, dependencies)],
    ['ice_access', httpCheck(url.origin, '/ice-config', { status: 403 }, dependencies)],
    ['app_certificate', certificateCheck(url.hostname, dependencies)],
    ['relay_certificate', certificateCheck(relayHost, dependencies)],
  ];
  const checks = await Promise.all(requests.map(async ([name, result]) => ({ name, ...await result })));
  return { event: 'staging_health', healthy: checks.every(result => result.healthy), checks };
}

module.exports = { httpCheck, certificateCheck, check };
if (require.main === module) check(process.argv[2], process.argv[3]).then(result => {
  console.log(JSON.stringify(result));
  if (!result.healthy) process.exitCode = 1;
}).catch(() => { console.error('Staging health check configuration failed.'); process.exitCode = 1; });
