const fs = require('node:fs');
const path = require('node:path');
const { createAccess } = require('../../server/access');
const { createIceConfig } = require('../../server/iceConfig');
const { createObservability } = require('../../server/observability');

function parse(file) {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || Object.hasOwn(values, match[1])) throw new Error('Invalid or duplicate environment entry.');
    values[match[1]] = match[2];
  }
  return values;
}
function validate(settings, runtime) {
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(settings.APP_HOST || '') || !settings.APP_HOST.includes('.')) throw new Error('APP_HOST must be a DNS hostname.');
  if (!['true', 'false'].includes(settings.ENABLE_SPEECH || 'false')) throw new Error('ENABLE_SPEECH must be true or false.');
  for (const key of ['ROOM_SIGNING_SECRET', 'METRICS_TOKEN', 'TURN_SHARED_SECRET']) {
    if (!runtime[key] || /REPLACE|EXAMPLE/i.test(runtime[key]) || Buffer.byteLength(runtime[key]) < 32 || /[\s$#'"\\]/.test(runtime[key])) throw new Error(`Provide a non-placeholder ${key} with at least 32 bytes and no environment interpolation characters.`);
  }
  if (new Set(['ROOM_SIGNING_SECRET', 'METRICS_TOKEN', 'TURN_SHARED_SECRET'].map(key => runtime[key])).size !== 3) throw new Error('Room, metrics, and TURN secrets must be independent.');
  if (!runtime.TURN_URLS || runtime.TURN_USERNAME || runtime.TURN_CREDENTIAL || runtime.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Staging requires shared-secret TURN and attached-identity Google authentication.');
  const env = { ...runtime, NODE_ENV: 'production', ALLOWED_ORIGIN: `https://${settings.APP_HOST}` };
  createAccess(env); createIceConfig(env); createObservability({ env });
  return true;
}
if (require.main === module) {
  try {
    const directory = path.resolve(process.argv[2] || __dirname);
    const file = path.join(directory, 'runtime.env');
    if (fs.statSync(file).mode & 0o077) throw new Error('runtime.env must be readable only by its owner (chmod 600).');
    validate(parse(path.join(directory, '.env')), parse(file));
    console.log('Staging configuration valid. No cloud resources were changed.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validate };
