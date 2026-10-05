const { createHmac, randomBytes } = require('node:crypto');
const { positiveInteger } = require('./access');

function createIceConfig(env, now = Date.now) {
  const urls = (env.TURN_URLS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (urls.some(url => !/^turns?:[^\s/?#]+(?:\?transport=(?:udp|tcp))?$/.test(url))) throw new Error('TURN_URLS must contain TURN URLs.');
  const secret = env.TURN_SHARED_SECRET;
  const staticConfigured = env.TURN_USERNAME && env.TURN_CREDENTIAL;
  if (env.NODE_ENV === 'production' && (env.TURN_USERNAME || env.TURN_CREDENTIAL)) throw new Error('Production TURN requires short-lived credentials; remove static TURN credentials.');
  if (env.NODE_ENV === 'production' && secret && Buffer.byteLength(secret) < 32) throw new Error('Production TURN_SHARED_SECRET must contain at least 32 bytes.');
  if (secret && !urls.length) throw new Error('TURN_SHARED_SECRET requires TURN_URLS.');
  if (urls.length && !secret && !staticConfigured) throw new Error('TURN_URLS requires TURN_SHARED_SECRET or development credentials.');
  const ttl = positiveInteger(env.TURN_TTL_SECONDS, 3600, 300, 86400);
  return invitation => {
    const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (urls.length && secret) {
      const expiry = Math.min(Math.floor(now() / 1000) + ttl, invitation?.exp || Infinity);
      const username = `${expiry}:${randomBytes(12).toString('hex')}`;
      servers.push({ urls, username, credential: createHmac('sha1', secret).update(username).digest('base64'), credentialType: 'password' });
    } else if (urls.length && (env.TURN_USERNAME || env.TURN_CREDENTIAL)) {
      servers.push({ urls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL, credentialType: 'password' });
    }
    return servers;
  };
}
module.exports = { createIceConfig };
