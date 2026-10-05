// deaf.js — ASL Recognition (v2)
// MediaPipe Tasks HandLandmarker + temporal majority-vote + J/Z trajectory detector

// ── Word-boundary config ────────────────────────────────────────────────────
const WORD_BOUNDARY_MS = 1500;

// ── Temporal smoothing config ───────────────────────────────────────────────
const BUFFER_SIZE    = 7;
const REQUIRED_VOTES = 5;
const CONFIDENCE_MIN = 0.60;
const FRAME_INTERVAL = 80;   // ms (~12 fps)

// ── State ───────────────────────────────────────────────────────────────────
const temporalBuffer  = [];
const wordBuffer      = [];
let wordBoundaryTimer = null;
let lastAcceptedLetter = '';

// ════════════════════════════════════════════════════════════════════════════
// J / Z Trajectory Detector
// ─────────────────────────────────────────────────────────────────────────────
// J and Z are the only two ASL letters that require motion.  A static
// single-frame model cannot distinguish them from similar static poses
// (J looks like I mid-stroke; Z looks like a pointing gesture mid-stroke).
//
// This detector tracks the positions of the pinky tip (landmark 20, used for
// J) and index tip (landmark 8, used for Z) across frames, normalised to
// hand scale so it works regardless of camera distance.
//
// When motion stops it classifies the accumulated trajectory:
//   J — pinky moved ≥ 0.25 hand-units downward with a rightward hook at end
//   Z — index tip changed horizontal direction ≥ 2 times (zigzag pattern)
//
// False-positive reduction:
//   • A minimum total path length is required before classifying.
//   • The starting handshape must match: J requires the static model to have
//     recently predicted "I" (same hand pose); Z requires a pointing-like
//     letter (D, G, or pointing).
//   • A 1.2-second cooldown prevents repeated triggering.
// ════════════════════════════════════════════════════════════════════════════
class JZDetector {
  constructor() {
    this._buf      = [];     // {pinky:{x,y}, index:{x,y}, staticPred, t}
    this._moving   = false;
    this._lastEmit = 0;
    this._COOLDOWN = 1200;   // ms between J/Z emissions
    this._MAX_BUF  = 30;     // ~2 s at 15 fps
    // Velocity threshold (normalised hand-units per frame) to start/end motion
    this._VEL_ON   = 0.035;
    this._VEL_OFF  = 0.018;
  }

  // Call once per frame with the raw landmarks and the static model's current
  // best prediction.  Returns 'J', 'Z', or null.
  update(landmarks, staticPred) {
    const w   = landmarks[0];
    const mid = landmarks[9];  // middle finger MCP — used for scale
    const scale = Math.hypot(mid.x - w.x, mid.y - w.y) || 0.01;

    const norm = lm => ({
      x: (lm.x - w.x) / scale,
      y: (lm.y - w.y) / scale,
    });

    const frame = {
      pinky:      norm(landmarks[20]),
      index:      norm(landmarks[8]),
      staticPred: staticPred || '',
      t:          performance.now(),
    };

    this._buf.push(frame);
    if (this._buf.length > this._MAX_BUF) this._buf.shift();

    // Velocity over last 3 frames
    const n   = this._buf.length;
    const vel = n >= 4
      ? Math.hypot(
          frame.pinky.x - this._buf[n-4].pinky.x,
          frame.pinky.y - this._buf[n-4].pinky.y,
        )
      : 0;

    if (vel > this._VEL_ON) {
      this._moving = true;
      return null;
    }

    if (this._moving && vel < this._VEL_OFF) {
      this._moving = false;
      return this._classify();
    }

    return null;
  }

  _classify() {
    const now = performance.now();
    if (now - this._lastEmit < this._COOLDOWN) return null;

    const pts   = this._buf;
    const n     = pts.length;
    if (n < 12) return null;

    // ── J check ────────────────────────────────────────────────────────────
    // Requires: started from an I-like pose AND pinky moved down + hook right
    const startedAsI = pts.slice(0, Math.ceil(n/3))
      .some(f => f.staticPred === 'I');

    const pStart = pts[0].pinky;
    const pEnd   = pts[n - 1].pinky;
    const netDown  = pEnd.y - pStart.y;   // positive = downward in camera coords
    const netRight = pEnd.x - pStart.x;

    // Total path length (not just net displacement)
    let pathLen = 0;
    for (let i = 1; i < n; i++) {
      pathLen += Math.hypot(
        pts[i].pinky.x - pts[i-1].pinky.x,
        pts[i].pinky.y - pts[i-1].pinky.y,
      );
    }

    const hookAtEnd = (() => {
      const late = pts.slice(Math.floor(n * 0.6));
      const xR   = Math.max(...late.map(f => f.pinky.x))
                 - Math.min(...late.map(f => f.pinky.x));
      return xR > 0.12;
    })();

    if (startedAsI && netDown > 0.25 && pathLen > 0.3 && hookAtEnd) {
      this._lastEmit = now;
      this._buf      = [];
      return 'J';
    }

    // ── Z check ────────────────────────────────────────────────────────────
    // Requires: started from a pointing pose AND index tip made a zigzag
    const POINTING = new Set(['D', 'G', 'L', 'Z', '1']);
    const startedPointing = pts.slice(0, Math.ceil(n/3))
      .some(f => POINTING.has(f.staticPred));

    const zPattern = (() => {
      const xs  = pts.map(f => f.index.x);
      let changes = 0, lastDir = 0;
      for (let i = 1; i < xs.length; i++) {
        const d = xs[i] - xs[i - 1];
        if (Math.abs(d) > 0.025) {
          const dir = d > 0 ? 1 : -1;
          if (lastDir !== 0 && dir !== lastDir) changes++;
          lastDir = dir;
        }
      }
      return changes >= 2;
    })();

    let indexPathLen = 0;
    for (let i = 1; i < n; i++) {
      indexPathLen += Math.hypot(
        pts[i].index.x - pts[i-1].index.x,
        pts[i].index.y - pts[i-1].index.y,
      );
    }

    if (startedPointing && zPattern && indexPathLen > 0.35) {
      this._lastEmit = now;
      this._buf      = [];
      return 'Z';
    }

    // Not J or Z — clear to avoid stale data affecting the next motion
    this._buf = [];
    return null;
  }

  reset() {
    this._buf    = [];
    this._moving = false;
  }
}

const jzDetector = new JZDetector();
let lastEmitTime       = 0;
const MIN_SAME_LETTER_INTERVAL = 900; // ms — don't re-emit same letter too fast

// ── Init ────────────────────────────────────────────────────────────────────
(async function init() {
  try {
    const roomCode = new URLSearchParams(window.location.search).get('room');
    if (!roomCode) { window.location.href = '/'; return; }
    if (!await window.TandemApp.authorizeInvitation(roomCode)) return;

    window.TandemApp.setStatus('Requesting camera and microphone…');
    await window.TandemApp.initMedia();

    window.TandemApp.setStatus('Loading ICE configuration…');
    await window.TandemApp.loadIceServers();

    window.TandemApp.setStatus('Creating peer connection…');
    await window.TandemApp.createPeerConnection();

    window.TandemApp.setStatus('Connecting to signaling server…');
    window.TandemApp.initSocket('deaf', roomCode);
    window.TandemApp.setStatus('Waiting for peer…');

    // TTS spoken feedback
    const attachTtsToast = () => {
      if (window.socket) {
        window.socket.on('ttsSpoken', () =>
          window.TandemApp.showPillToast('tandem-tts-toast', '🔊 Spoken', '#e8a84c'));
      }
    };
    attachTtsToast();
    if (!window.socket) {
      const t = setInterval(() => { if (window.socket) { clearInterval(t); attachTtsToast(); } }, 100);
    }

    const stream = document.getElementById('localVideo')?.srcObject;
    const signingVideo = document.getElementById('aslVideo');
    if (stream && signingVideo) {
      signingVideo.srcObject = stream;
      signingVideo.play().catch(() => {});
    }
    try {
      if (window.TandemApp.capabilities?.recognition && stream) await initASL();
    } catch (err) {
      console.error('[ASL] initASL failed:', err);
      const s = document.getElementById('aslStatus');
      if (s) s.textContent = 'ASL error — ' + err.message;
    }
  } catch (err) {
    console.error(err);
    window.TandemApp.setStatus('Error initializing. Check console.');
  }
})();

// ── Camera setup ─────────────────────────────────────────────────────────────
async function initASL() {
  const aslStatus = document.getElementById('aslStatus');
  const aslVideo  = document.getElementById('aslVideo');
  const localVideo = document.getElementById('localVideo');

  if (aslStatus) aslStatus.textContent = 'Starting camera…';

  // Reuse the WebRTC stream (avoids a second getUserMedia)
  let waited = 0;
  while ((!localVideo || !localVideo.srcObject) && waited < 2000) {
    await new Promise(r => setTimeout(r, 100));
    waited += 100;
  }

  if (localVideo?.srcObject) {
    aslVideo.srcObject = localVideo.srcObject;
    try { await aslVideo.play(); } catch (_) {}
  } else {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }, audio: false,
    });
    aslVideo.srcObject = stream;
    await aslVideo.play();
  }

  // Wait for pixel data
  if (aslVideo.readyState < 3) {
    await new Promise(r => {
      aslVideo.addEventListener('canplay', r, { once: true });
      setTimeout(r, 5000);
    });
  }
  let tries = 0;
  while (aslVideo.videoWidth === 0 && tries++ < 50)
    await new Promise(r => setTimeout(r, 100));

  if (aslVideo.videoWidth === 0) throw new Error('Camera produced no frames');

  if (aslStatus) aslStatus.textContent = 'Loading hand detector…';
  const detector = await loadHandLandmarker();
  if (aslStatus) aslStatus.textContent = 'Show your hand';

  startFrameLoop(aslVideo, detector, aslStatus);
}

// ── MediaPipe Tasks HandLandmarker ───────────────────────────────────────────
async function loadHandLandmarker() {
  // MediaPipe Tasks Vision — more accurate than the legacy 0.4 Hands solution.
  // Uses a float16 quantised model (~8 MB) that runs well on CPU and GPU.
  const VISION_CDN  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm';
  const WASM_PATH   = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
  const MODEL_URL   = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  const { HandLandmarker, FilesetResolver } = await import(VISION_CDN);

  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',         // falls back to CPU automatically
    },
    runningMode:               'VIDEO',
    numHands:                  1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence:  0.5,
    minTrackingConfidence:      0.5,
  });

  console.log('[ASL] HandLandmarker v2 ready');
  return handLandmarker;
}

// ── Frame loop ───────────────────────────────────────────────────────────────
function startFrameLoop(video, detector, statusEl) {
  let lastInferenceAt = 0;

  function loop(timestamp) {
    requestAnimationFrame(loop);

    if (video.readyState < 2 || video.videoWidth === 0) return;
    if (timestamp - lastInferenceAt < FRAME_INTERVAL) return;
    lastInferenceAt = timestamp;

    // detectForVideo is synchronous in VIDEO mode
    const results = detector.detectForVideo(video, timestamp);
    handleResults(results, statusEl);
  }

  requestAnimationFrame(loop);
}

// ── Result handling ──────────────────────────────────────────────────────────
async function handleResults(results, statusEl) {
  if (!results?.landmarks?.length) {
    pushToTemporalBuffer(null);
    jzDetector.reset();
    if (statusEl) statusEl.textContent = 'Show your hand';
    return;
  }

  if (statusEl) statusEl.textContent = 'Detecting…';

  // Build flat [x0,y0,z0, x1,y1,z1, …, x20,y20,z20] (63 values)
  const raw = results.landmarks[0];
  const flat63 = [];
  for (const lm of raw) flat63.push(lm.x, lm.y, lm.z);

  // Call the Python prediction server
  let prediction = null, confidence = 0, modelVersion = 1;
  try {
    const res = await fetch('/api/predict', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...window.TandemApp.invitationHeaders() },
      body:    JSON.stringify({ landmarks: flat63 }),
    });
    if (res.ok) {
      const d = await res.json();
      prediction   = d.prediction   || null;
      confidence   = d.confidence   ?? d.probability ?? 0;
      modelVersion = d.model_version ?? 1;
    }
  } catch (e) {
    console.warn('[ASL] API unreachable:', e.message);
  }

  // ── J / Z trajectory detector (runs every frame, parallel to static model) ─
  // Pass the static model's best guess so the detector can validate starting poses.
  const jzResult = jzDetector.update(raw, prediction);
  if (jzResult) {
    // Clear the temporal buffer so a stale static vote doesn't immediately
    // overwrite the J/Z result.
    temporalBuffer.length = 0;
    onAcceptedLetter(jzResult, 1.0, modelVersion, statusEl);
    return;
  }

  // ── Temporal majority-vote buffer (static letters) ────────────────────────
  const vote     = (prediction && confidence >= CONFIDENCE_MIN) ? prediction : null;
  const accepted = pushToTemporalBuffer(vote);

  if (accepted) {
    onAcceptedLetter(accepted, confidence, modelVersion, statusEl);
  } else if (statusEl) {
    const pct = Math.round(confidence * 100);
    statusEl.textContent = prediction
      ? `${prediction} (${pct}%) — stabilising…`
      : 'Show your hand';
  }
}

// Returns the majority-vote winner, or null if not enough consensus yet.
function pushToTemporalBuffer(vote) {
  temporalBuffer.push(vote);
  if (temporalBuffer.length > BUFFER_SIZE) temporalBuffer.shift();
  if (temporalBuffer.length < BUFFER_SIZE) return null;

  // Count non-null votes
  const counts = {};
  for (const v of temporalBuffer) {
    if (v !== null) counts[v] = (counts[v] || 0) + 1;
  }

  let winner = null, top = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (n > top) { top = n; winner = k; }
  }

  return top >= REQUIRED_VOTES ? winner : null;
}

// ── Letter accepted by temporal filter ──────────────────────────────────────
function onAcceptedLetter(letter, confidence, modelVersion, statusEl) {
  const now = Date.now();

  // Don't re-emit the same letter faster than MIN_SAME_LETTER_INTERVAL
  if (letter === lastAcceptedLetter && now - lastEmitTime < MIN_SAME_LETTER_INTERVAL) {
    if (statusEl) {
      statusEl.textContent = `✓ ${letter} (${Math.round(confidence*100)}%)`;
    }
    return;
  }

  lastAcceptedLetter = letter;
  lastEmitTime       = now;

  // Update hero display
  const predEl = document.getElementById('aslPrediction');
  if (predEl) predEl.textContent = letter;

  if (statusEl) {
    const src = modelVersion >= 2 ? 'MLP' : 'RF';
    statusEl.textContent = `✓ ${letter} · ${Math.round(confidence*100)}% · ${src}`;
  }

  // Accumulate into word buffer
  wordBuffer.push(letter);
  updateWordBufferDisplay();

  // Update footer history
  const histEl = document.getElementById('aslHistoryLine');
  if (histEl) histEl.textContent = wordBuffer.join('·');

  // Reset/start the word-boundary timer
  clearTimeout(wordBoundaryTimer);
  wordBoundaryTimer = setTimeout(flushWordBuffer, WORD_BOUNDARY_MS);
}

// ── Word display ─────────────────────────────────────────────────────────────
function updateWordBufferDisplay() {
  const el = document.getElementById('aslPrediction');
  if (el && wordBuffer.length > 0) el.textContent = wordBuffer.join('·');
}

// ── Word flush → Claude ──────────────────────────────────────────────────────
function flushWordBuffer() {
  if (wordBuffer.length === 0) return;

  const letters = [...wordBuffer];
  wordBuffer.length = 0;

  const el = document.getElementById('aslPrediction');
  if (el) el.textContent = '…';

  const histEl = document.getElementById('aslHistoryLine');
  if (histEl) histEl.textContent = '';

  if (window.socket?.connected) {
    window.socket.emit('aslWord', { letters });
  }
}
