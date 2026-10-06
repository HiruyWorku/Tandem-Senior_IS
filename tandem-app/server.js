const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { Server } = require('socket.io');
const { registerCallProtocol } = require('./server/callProtocol');
const { createAccess, createRateLimit, positiveInteger } = require('./server/access');
const { createIceConfig } = require('./server/iceConfig');
const { createObservability } = require('./server/observability');
const { createConnectionAdmission, closeUnadmittedTransports } = require('./server/connectionAdmission');

/** Build an isolated application; imports never open a port or call an AI provider. */
function createApplication({ env = process.env, speech, interpretLetters, synthesize, logger } = {}) {
  const telemetry = createObservability({ env, logger });
  let draining = false;
  const access = createAccess(env);
  const iceConfig = createIceConfig(env);
  const speechEnabled = env.ENABLE_SPEECH === 'true' ||
    (env.ENABLE_SPEECH !== 'false' && Boolean(env.GOOGLE_APPLICATION_CREDENTIALS));
  const capabilities = {
    captions: speechEnabled,
    speechOutput: speechEnabled && env.ENABLE_SPEECH_OUTPUT !== 'false',
    recognition: env.ENABLE_ASL === 'true',
    suggestions: env.ENABLE_ASL === 'true' && Boolean(env.ANTHROPIC_API_KEY),
    avatar: env.ENABLE_AVATAR === 'true',
    privateRooms: access.required,
  };
  const app = express();
  app.set('trust proxy', positiveInteger(env.TRUST_PROXY_HOPS, 0, 0, 5));
  const server = http.createServer(app);
  const maxConnections = positiveInteger(env.MAX_CONNECTIONS, 100, 2, 10000);
  const unjoinedTimeoutMs = positiveInteger(env.UNJOINED_TIMEOUT_SECONDS, 30, 5, 300) * 1000;
  const connectionRate = createRateLimit({ limit: 60, interval: 60000 });
  const io = new Server(server, {
    serveClient: true, pingTimeout: 20000, pingInterval: 10000,
    maxHttpBufferSize: 128 * 1024,
    allowRequest: (request, callback) => {
      const allowed = !draining && io.engine.clientsCount < maxConnections &&
        access.originAllowed(request) && connectionRate(request.socket.remoteAddress);
      if (!allowed) telemetry.record('connection_rejected');
      callback(null, allowed);
    },
    // Enforce our transport deadline before Socket.IO begins a graceful polling close.
    connectTimeout: unjoinedTimeoutMs + 1000,
    transports: ['websocket', 'polling'],
  });
  io.use(createConnectionAdmission({ maxConnections, unjoinedTimeoutMs, isDraining: () => draining, telemetry }));
  closeUnadmittedTransports(io, { unjoinedTimeoutMs, telemetry });
  const { SpeechToTextService } = require('./server/speechToText');
  const maxStreams = positiveInteger(env.MAX_CAPTION_STREAMS, 20, 1, 100);
  const maxSessionMs = positiveInteger(env.CAPTION_MAX_SESSION_SECONDS, 0, 0, 14400) * 1000;
  const idleMs = positiveInteger(env.CAPTION_IDLE_SECONDS, 0, 0, 300) * 1000;
  speech ||= new SpeechToTextService({ languageCode: env.LANGUAGE_CODE || 'en-US',
    maxStreams, maxSessionMs, idleMs, telemetry });
  interpretLetters ||= letters => require('./server/claudeService').interpretLetters(letters);
  synthesize ||= text => require('./server/textToSpeech').synthesize(text);
  const protocol = registerCallProtocol(io, { telemetry, speech, interpretLetters, synthesize, capabilities, authorizeRoom: (data) => !access.required || Boolean(access.verify(data.token, data.room)) });
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    const started = performance.now();
    res.once('finish', () => telemetry.observe((performance.now() - started) / 1000));
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  const roomRate = createRateLimit({ limit: 10, interval: 3600000 });
  const poseRate = createRateLimit({ limit: 10, interval: 60000 });
  const iceRate = createRateLimit({ limit: 30, interval: 60000 });
  app.post('/api/rooms', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!access.originAllowed(req)) return res.status(403).json({ error: 'Origin is not allowed.' });
    if (!roomRate(req.ip)) return res.status(429).set('Retry-After', '3600').json({ error: 'Too many invitations. Try again later.' });
    res.status(201).json(access.mint());
  });
  app.post('/api/rooms/validate', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!access.originAllowed(req)) return res.status(403).json({ error: 'Origin is not allowed.' });
    const invitation = access.verify(access.bearer(req), req.body?.room);
    if (!invitation) return res.status(403).json({ error: 'Invitation is invalid or expired.' });
    res.json({ room: invitation.room, expiresAt: invitation.exp });
  });
  app.use(['/api/predict', '/pose'], (req, res, next) => {
    if (access.required && !access.verify(access.bearer(req))) return res.status(403).json({ error: 'A valid invitation is required.' });
    if (req.originalUrl.split('?')[0] === '/pose' && !poseRate(req.ip)) return res.status(429).set('Retry-After', '60').json({ error: 'Too many signing requests.' });
    next();
  });
  app.use(express.static(path.join(__dirname, 'public')));
  if (capabilities.avatar) app.use(require('./server/poseProxy').createPoseProxy({ telemetry }));
  else app.get('/pose', (_req, res) => res.status(503).json({ error: 'Signing avatar is disabled.' }));

  const predictRates = new Map();
  app.post('/api/predict', async (req, res) => {
    if (!capabilities.recognition) return res.status(503).json({ error: 'Experimental recognition is disabled.' });
    const landmarks = req.body?.landmarks;
    if (!Array.isArray(landmarks) || landmarks.length !== 63 || !landmarks.every(
      value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10
    )) return res.status(400).json({ error: 'Expected 63 finite landmark coordinates.' });
    const now = Date.now();
    const ip = req.ip;
    let rate = predictRates.get(ip);
    if (!rate || now >= rate.until) {
      rate = { count: 0, until: now + 1000 };
      if (predictRates.size >= 10000) {
        for (const [key, entry] of predictRates) if (now >= entry.until) predictRates.delete(key);
        if (predictRates.size >= 10000) return res.status(429).json({ error: 'Too many requests.' });
      }
      predictRates.set(ip, rate);
    }
    if (++rate.count > 20) return res.status(429).json({ error: 'Too many requests.' });
    try {
      const upstream = await fetch(env.ASL_API_URL || 'http://127.0.0.1:5003/predict', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ landmarks }), signal: AbortSignal.timeout(3000),
      });
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch {
      res.status(503).json({ error: 'Recognition is unavailable. You can still type a reply.' });
    }
  });
  const instanceId = randomUUID();
  app.get('/ready', (_req, res) => res.status(draining ? 503 : 200).set('Cache-Control', 'no-store').json({ ready: !draining }));
  app.get('/metrics', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!telemetry.enabled) return res.sendStatus(404);
    if (!telemetry.authorized(req.headers.authorization)) return res.sendStatus(403);
    const rooms = [...io.sockets.adapter.rooms.keys()].filter(room => room.startsWith('call:')).length;
    const streams = [...(speech.recognizeStreams?.values() || [])].filter(info => info.stream).length;
    res.type('text/plain; version=0.0.4').send(telemetry.render({ sockets: io.sockets.sockets.size, rooms, streams, jobs: protocol.providerJobs(), ready: !draining }));
  });
  app.get('/health', (_req, res) => res.status(200).send('OK'));
  app.get('/capabilities', (_req, res) => res.set('Cache-Control', 'no-store').json(capabilities));
  app.get('/instance-id', (_req, res) => res.json({ id: instanceId }));
  app.get('/ice-config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const invitation = access.verify(access.bearer(req));
    if (access.required && !invitation) { telemetry.record('ice_denied'); return res.status(403).json({ error: 'A valid invitation is required.' }); }
    if (!iceRate(req.ip)) return res.status(429).set('Retry-After', '60').json({ error: 'Too many requests.' });
    const servers = iceConfig(invitation);
    if (env.TURN_SHARED_SECRET && servers[1]) res.set('X-Turn-Expires-At', servers[1].username.split(':')[0]);
    telemetry.record('ice_issued');
    res.json(servers);
  });
  app.use((error, _req, res, _next) => {
    const status = error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    if (status === 500) telemetry.failure('http_failed', status);
    res.status(status).json({ error: status === 500 ? 'Request failed.' : 'Invalid request body.' });
  });
  return { app, server, io, capabilities,
    close: () => { draining = true; return new Promise(resolve => io.close(resolve)); } };
}

if (require.main === module) {
  const application = createApplication();
  const port = Number(process.env.PORT || 3000);
  application.server.listen(port, () => console.log(`Tandem listening on http://localhost:${port}`));
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 10000).unref();
      application.close().then(() => { clearTimeout(deadline); });
    });
  }
}

module.exports = { createApplication };
