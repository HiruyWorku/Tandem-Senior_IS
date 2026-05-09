const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
// All server-side modules live under server/ for a clean layout
const speechToText = require('./server/speechToText');
const poseProxy = require('./server/poseProxy');
const tts = require('./server/textToSpeech');
const { interpretLetters, interpretSentence } = require('./server/claudeService');

const app = express();
const server = http.createServer(app);

// In production set ALLOWED_ORIGIN to your domain (e.g. https://tandem.example.com).
// In development it defaults to * so localhost and ngrok both work without config.
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';

const io = new Server(server, {
  serveClient: true,
  pingTimeout: 20000,
  pingInterval: 10000,
  cors: { origin: allowedOrigin, methods: ['GET', 'POST'] },
  allowEIO3: true,
  transports: ['websocket', 'polling'],
});

app.use(express.json());
// Bypass the ngrok browser warning interstitial — without this header,
// the second device sees an ngrok warning page instead of the app.
app.use((_req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(poseProxy);

// Simple in-memory rate limiter for /api/predict: max 30 req/s per IP.
// Resets every second — no external dependency needed.
const predictRateMap = new Map();
function predictRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = predictRateMap.get(ip) || { count: 0, resetAt: now + 1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 1000; }
  entry.count++;
  predictRateMap.set(ip, entry);
  if (entry.count > 30) return res.status(429).json({ error: 'Too many requests' });
  next();
}
// Prune stale entries every 60 s so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of predictRateMap) if (now > e.resetAt + 5000) predictRateMap.delete(ip);
}, 60000);

// Proxy /api/predict → Python asl_api.py on port 5003
// This keeps the browser on a same-origin URL and avoids CORS entirely.
app.post('/api/predict', predictRateLimit, async (req, res) => {
  try {
    const upstream = await fetch('http://localhost:5003/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('[/api/predict] Python ASL API unreachable:', err.message);
    res.status(503).json({ error: 'ASL API unavailable. Make sure asl_api.py is running.' });
  }
});

// Unique token generated on each server start.
// Clients compare this to their saved value; a mismatch means the server
// restarted and they should hard-reload to get a fresh RTCPeerConnection.
const SERVER_INSTANCE_ID = Date.now().toString();

app.get('/health', (_req, res) => res.status(200).send('OK'));
app.get('/instance-id', (_req, res) => res.json({ id: SERVER_INSTANCE_ID }));

app.get('/ice-config', (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

  if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URLS.split(',').map(u => u.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
      credentialType: 'password',
    });
  } else if (process.env.NODE_ENV === 'production') {
    console.warn('[ice-config] TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL not set — cross-network calls will fail');
  }

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.json(iceServers);
});

const ROOM_CODE_RE = /^[A-Z0-9]{4,12}$/;

function getRoomSize(roomName) {
  const room = io.sockets.adapter.rooms.get(roomName);
  return room ? room.size : 0;
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.conn.on('heartbeat', () => {
    socket.lastHeartbeat = Date.now();
  });

  socket.on('error', (error) => {
    console.error(`Socket error from ${socket.id}:`, error);
  });

  const keepAlive = setInterval(() => {
    if (socket.connected) socket.emit('ping');
  }, 30000);

  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`Client ${socket.id} reconnection attempt ${attemptNumber}`);
  });

  speechToText.createRecognizeStream(socket.id);
  speechToText.bindSocketToStream(socket.id, socket);

  socket.on('audioData', (data) => {
    try {
      speechToText.processAudio(socket.id, data);
    } catch (error) {
      console.error('Error processing audio data:', error);
    }
  });

  // STT sentence buffer — merges rapid successive STT finals before forwarding.
  const sentenceBuffer = { text: '', timer: null };
  const SENTENCE_HOLD_MS = 600;

  // ASL sentence buffer — accumulates Claude-interpreted words until the user
  // pauses signing for 3 s, then flushes as a complete sentence.
  const aslSentenceBuffer = { words: [], timer: null };
  const ASL_SENTENCE_HOLD_MS = 3000;

  socket.on('transcript', (data) => {
    if (!socket.room) return;
    if (!data.isFinal) {
      socket.to(socket.room).emit('transcript', {
        transcript: data.transcript,
        isFinal: false,
        isLocal: false,
      });
      return;
    }

    clearTimeout(sentenceBuffer.timer);
    sentenceBuffer.text = (sentenceBuffer.text + ' ' + data.transcript).trim();

    sentenceBuffer.timer = setTimeout(() => {
      const merged = sentenceBuffer.text;
      sentenceBuffer.text = '';
      sentenceBuffer.timer = null;
      if (merged) {
        console.log('[sentence-buffer] forwarding merged final:', merged);
        socket.to(socket.room).emit('transcript', {
          transcript: merged,
          isFinal: true,
          isLocal: false,
        });
      }
    }, SENTENCE_HOLD_MS);
  });

  // Single consolidated disconnect handler — previously this was split across
  // two separate socket.on('disconnect') calls (a bug that caused the second
  // handler to silently shadow the first).
  socket.on('disconnect', (reason) => {
    console.log(`Client ${socket.id} disconnected:`, reason);
    clearInterval(keepAlive);
    clearTimeout(sentenceBuffer.timer);
    sentenceBuffer.text = '';
    clearTimeout(aslSentenceBuffer.timer);
    aslSentenceBuffer.words = [];
    if (socket.room) {
      socket.to(socket.room).emit('peer_disconnected');
      socket.leave(socket.room);
    }
    speechToText.cleanup(socket.id);
  });

  socket.on('join', ({ userType, room } = {}) => {
    // Validate the room code — reject anything that doesn't look like one.
    if (!room || !ROOM_CODE_RE.test(room)) {
      socket.emit('invalid_room');
      return;
    }

    // Evict zombie sockets so they don't block new legitimate connections.
    const roomMembers = io.sockets.adapter.rooms.get(room);
    if (roomMembers) {
      for (const sid of [...roomMembers]) {
        const s = io.sockets.sockets.get(sid);
        if (!s || !s.connected) {
          roomMembers.delete(sid);
          console.log(`[io] Evicted zombie socket ${sid} from room ${room}`);
        }
      }
    }

    const size = getRoomSize(room);
    socket.userType = userType || 'hearing';
    console.log('[io] join requested', { socketId: socket.id, room, currentSize: size, userType: socket.userType });

    if (size >= 2) {
      socket.emit('room_full');
      return;
    }

    socket.room = room;
    socket.join(room);
    const newSize = getRoomSize(room);
    socket.emit('joined', { room, peers: newSize, userType: socket.userType });

    if (newSize === 2) {
      io.to(room).emit('ready');
      socket.emit('initiate');
    }
  });

  socket.on('signal:offer', (payload) => {
    if (socket.room) socket.to(socket.room).emit('signal:offer', payload);
  });

  socket.on('signal:answer', (payload) => {
    if (socket.room) socket.to(socket.room).emit('signal:answer', payload);
  });

  socket.on('signal:ice-candidate', (payload) => {
    if (socket.room) socket.to(socket.room).emit('signal:ice-candidate', payload);
  });

  socket.on('signingDone', () => {
    if (socket.room) socket.to(socket.room).emit('signingDone');
  });

  socket.on('ttsSpoken', () => {
    if (socket.room) socket.to(socket.room).emit('ttsSpoken');
  });

  socket.on('aslPrediction', async (data) => {
    // Individual letter updates — forwarded to peer for live display only, no TTS.
    // TTS is triggered by aslWord (after Claude interprets the full word).
    if (!socket.room) return;
    socket.to(socket.room).emit('aslPrediction', {
      prediction: data.prediction,
      isLocal: true
    });
  });

  socket.on('aslWord', async (data) => {
    if (!socket.room || !Array.isArray(data.letters) || data.letters.length === 0) return;

    const letters = data.letters;
    console.log(`[aslWord] letters: ${letters.join('-')}`);

    // Show a pending indicator to the hearing peer while Claude works.
    socket.to(socket.room).emit('aslWordPending', { letters });

    let word;
    try {
      word = await interpretLetters(letters);
    } catch (err) {
      console.error('[aslWord] interpretLetters error:', err.message);
      return;
    }
    if (!word) return;

    // Show the interpreted word immediately on both sides.
    socket.to(socket.room).emit('aslWordResult', { word, letters });
    socket.emit('aslWordConfirm', { word });

    // Accumulate into the sentence buffer and (re)start the flush timer.
    clearTimeout(aslSentenceBuffer.timer);
    aslSentenceBuffer.words.push(word);

    aslSentenceBuffer.timer = setTimeout(async () => {
      const words = [...aslSentenceBuffer.words];
      aslSentenceBuffer.words = [];
      aslSentenceBuffer.timer = null;
      if (words.length === 0 || !socket.room) return;

      console.log(`[aslSentence] flushing ${words.length} word(s): ${words.join(' ')}`);

      let sentence;
      try {
        sentence = await interpretSentence(words);
      } catch (err) {
        console.error('[aslSentence] interpretSentence error:', err.message);
        sentence = words.join(' ');
      }
      if (!sentence) return;

      // Broadcast the final cleaned sentence and speak it.
      socket.to(socket.room).emit('aslSentence', { sentence });
      socket.emit('aslSentenceConfirm', { sentence });

      try {
        const audioBase64 = await tts.synthesize(sentence);
        socket.to(socket.room).emit('ttsAudio', { audioBase64 });
        console.log(`[TTS] "${sentence}" → sent audio to peer`);
      } catch (err) {
        console.error('[TTS] synthesize error:', err.message);
      }
    }, ASL_SENTENCE_HOLD_MS);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
