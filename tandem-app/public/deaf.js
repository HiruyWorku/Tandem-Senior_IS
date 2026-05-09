// deaf.js - ASL Recognition for Deaf User
// NOTE: showPillToast() is provided by script.js (loaded before this file).

let lastASLPrediction = '';
const aslHistory = [];
const ASL_API_URL = '';

// Word boundary detection — letters accumulate here until the user pauses.
// 1.5 s of silence = word complete → flush to server for Claude interpretation.
const wordBuffer = [];
let wordBoundaryTimer = null;
const WORD_BOUNDARY_MS = 1500;


(async function init() {
  try {
    const roomCode = new URLSearchParams(window.location.search).get('room');
    if (!roomCode) {
      window.location.href = '/';
      return;
    }

    window.TandemApp.setStatus('Requesting camera and microphone…');
    await window.TandemApp.initMedia();

    window.TandemApp.setStatus('Loading ICE configuration…');
    await window.TandemApp.loadIceServers();

    window.TandemApp.setStatus('Creating peer connection…');
    await window.TandemApp.createPeerConnection();

    window.TandemApp.setStatus('Connecting to signaling server…');
    window.TandemApp.initSocket('deaf', roomCode);

    window.TandemApp.setStatus('Waiting for peer…');

    // Listen for the hearing user’s TTS completion signal.
    if (window.socket) {
      window.socket.on('ttsSpoken', () => {
        showPillToast('tandem-tts-toast', '🔊 Spoken', '#e9a84c');
      });
    } else {
      const waitForSocket = setInterval(() => {
        if (window.socket) {
          clearInterval(waitForSocket);
          window.socket.on('ttsSpoken', () => {
            showPillToast('tandem-tts-toast', '🔊 Spoken', '#e9a84c');
          });
        }
      }, 100);
    }

    // Kick off ASL recognition. Await it so errors surface in the status badge.
    try {
      await initASL();
    } catch (aslErr) {
      console.error('[ASL] initASL failed:', aslErr);
      const aslStatus = document.getElementById('aslStatus');
      if (aslStatus) aslStatus.textContent = 'ASL: Error — ' + aslErr.message;
    }
  } catch (err) {
    console.error(err);
    window.TandemApp.setStatus('Error initializing application. Check console.');
  }
})();

async function initASL() {
  const aslStatus = document.getElementById('aslStatus');
  const aslVideo = document.getElementById('aslVideo');
  const localVideo = document.getElementById('localVideo');

  console.log('Initializing ASL recognition...');
  if (aslStatus) aslStatus.textContent = 'ASL: Starting...';

  // Reuse the camera stream that TandemApp already acquired.
  // Wait up to 2 s for localVideo to have its stream (race with initMedia).
  let waited = 0;
  while ((!localVideo || !localVideo.srcObject) && waited < 2000) {
    await new Promise(r => setTimeout(r, 100));
    waited += 100;
  }

  if (localVideo && localVideo.srcObject) {
    console.log('Using camera stream from TandemApp');
    aslVideo.srcObject = localVideo.srcObject;
    try { await aslVideo.play(); } catch (e) { console.warn('ASL video play:', e); }
  } else {
    // Fallback: request our own camera stream
    console.log('No TandemApp stream — requesting own camera');
    if (aslStatus) aslStatus.textContent = 'ASL: Requesting camera...';
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    aslVideo.srcObject = stream;
    await aslVideo.play();
  }

  console.log('Camera ready');
  if (aslStatus) aslStatus.textContent = 'ASL: Loading model...';

  await loadMediaPipe();
  console.log('MediaPipe loaded');
  if (aslStatus) aslStatus.textContent = 'ASL: Ready — show your hand!';

  processVideo(aslVideo);
}

function loadMediaPipe() {
  return new Promise((resolve, reject) => {
    if (typeof Hands !== 'undefined') {
      console.log('Hands already loaded');
      resolve();
      return;
    }

    console.log('Loading MediaPipe Hands...');
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/hands.min.js';
    script.onload = () => {
      console.log('MediaPipe script loaded');
      resolve();
    };
    script.onerror = (e) => {
      console.error('Failed to load MediaPipe:', e);
      reject(e);
    };
    document.head.appendChild(script);
  });
}

function processVideo(video) {
  console.log('[ASL] Starting video processing');
  const aslStatus = document.getElementById('aslStatus');

  async function waitForHands() {
    // Give MediaPipe up to 30 s to fully initialise its WASM runtime.
    let attempts = 0;
    while (typeof Hands === 'undefined' && attempts < 300) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    return typeof Hands !== 'undefined';
  }

  // Wait for the video to have actual pixel data before feeding frames.
  async function waitForVideoReady() {
    // Method 1: canplay event (fires when enough data to play)
    if (video.readyState < 3) {
      await new Promise(resolve => {
        video.addEventListener('canplay', resolve, { once: true });
        // Safety: also resolve after 5s so we don't hang forever
        setTimeout(resolve, 5000);
      });
    }
    // Method 2: ensure videoWidth is non-zero (real pixel data available)
    let tries = 0;
    while (video.videoWidth === 0 && tries < 50) {
      await new Promise(r => setTimeout(r, 100));
      tries++;
    }
    console.log(`[ASL] Video ready — readyState=${video.readyState}, ${video.videoWidth}×${video.videoHeight}`);
    if (aslStatus) aslStatus.textContent = video.videoWidth > 0
      ? 'ASL: Ready — show your hand!'
      : `ASL: Camera not rendering (readyState=${video.readyState})`;
  }

  waitForHands().then(async handsLoaded => {
    if (!handsLoaded) {
      console.error('[ASL] MediaPipe Hands never loaded (WASM timeout)');
      if (aslStatus) aslStatus.textContent = 'ASL: Error — MediaPipe timeout';
      return;
    }

    console.log('[ASL] Hands loaded, waiting for video...');
    await waitForVideoReady();

    if (video.videoWidth === 0) {
      console.error('[ASL] Video has no pixel data — cannot send frames');
      if (aslStatus) aslStatus.textContent = 'ASL: Camera not ready (no frames)';
      return;
    }

    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.3,
      minTrackingConfidence: 0.3
    });

    hands.onResults(onHandsResults);
    console.log('[ASL] Hands instance ready, starting frame loop');

    // Await each send so MediaPipe is never sent overlapping frames
    // (causes dropped callbacks on the old 0.4.x runtime).
    let sending = false;
    async function sendFrame() {
      if (!sending && video.readyState >= 2 && video.videoWidth > 0) {
        sending = true;
        try {
          await hands.send({ image: video });
        } catch (e) {
          console.warn('[ASL] hands.send error:', e.message || e);
        }
        sending = false;
      }
      requestAnimationFrame(sendFrame);
    }

    sendFrame();
    console.log('[ASL] Frame loop started');
  });
}



async function onHandsResults(results) {
  const aslStatus = document.getElementById('aslStatus');

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    // No hand in frame — update status indicator
    if (aslStatus && !aslStatus.textContent.startsWith('ASL: Error')) {
      aslStatus.textContent = 'ASL: Show your hand!';
      aslStatus.style.color = 'var(--text-muted, #888)';
    }
    return;
  }

  // Hand is in frame
  if (aslStatus) {
    aslStatus.textContent = 'ASL: ✋ Detecting...';
    aslStatus.style.color = 'var(--teal, #50e3c2)';
  }

  const landmarks = results.multiHandLandmarks[0];

  // Extract features: normalised x, y per landmark — 42 features total.
  // The Python model expects 84 features and pads the remaining 42 with zeros;
  // this matches the format the model was trained on (x, y only, no z).
  const features = [];
  const xCoords = landmarks.map(l => l.x);
  const yCoords = landmarks.map(l => l.y);
  const minX = Math.min(...xCoords);
  const minY = Math.min(...yCoords);

  for (let i = 0; i < landmarks.length; i++) {
    features.push(landmarks[i].x - minX);
    features.push(landmarks[i].y - minY);
  }

  // Send landmarks to Python model via the Node.js /api/predict proxy.
  try {
    const resp = await fetch(`${ASL_API_URL}/api/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features })
    });

    if (resp.ok) {
      const data = await resp.json();
      console.log('[ASL] Prediction:', data.prediction, 'Confidence:', data.probability);

      // Threshold lowered to 0.25 so more signs pass (model gets 63 features
      // padded to 84; some accuracy loss is compensated by the lower bar).
      if (data.prediction && data.probability > 0.25) {
        showPrediction(data.prediction);
        if (aslStatus) {
          aslStatus.textContent = `ASL: ✓ ${data.prediction} (${Math.round(data.probability * 100)}%)`;
          aslStatus.style.color = 'var(--teal, #50e3c2)';
        }
        return;
      }
    } else {
      const err = await resp.json().catch(() => ({}));
      console.warn('[ASL] API error:', resp.status, err.error || '');
    }
  } catch (e) {
    console.warn('[ASL] API unreachable (is asl_api.py running via npm run start:all?):', e.message);
  }

  // Fallback heuristic predictor
  const pred = predictHeuristic(landmarks);
  if (pred) {
    showPrediction(pred);
    if (aslStatus) {
      aslStatus.textContent = `ASL: ~ ${pred} (heuristic)`;
      aslStatus.style.color = '#e9a84c';
    }
  }
}

function predictHeuristic(landmarks) {
  const tips = [4, 8, 12, 16, 20];
  const bases = [2, 5, 9, 13, 17];
  const fingers = [];

  for (let i = 0; i < 5; i++) {
    if (i === 0) {
      fingers.push(landmarks[4].x > landmarks[2].x ? 1 : 0);
    } else {
      fingers.push(landmarks[tips[i]].y < landmarks[bases[i]].y ? 1 : 0);
    }
  }

  const [t, i, m, r, p] = fingers;

  if (!i && !m && !r && !p && t) return 'A';
  if (!i && !m && !r && !p && !t) return 'S';
  if (i && m && !r && !p && !t) return 'V';
  if (i && !m && !r && !p && !t) return 'I';
  if (!i && m && !r && !p && !t) return 'U';
  if (i && m && r && !p && !t) return 'Y';
  if (i && m && r && p && !t) return 'B';
  if (i && m && r && p && t) return 'E';
  if (!t && i && !m && !r && !p) return 'L';
  if (!t && !i && m && !r && !p) return 'W';

  return null;
}

function showPrediction(prediction) {
  if (prediction === lastASLPrediction) return;

  const now = Date.now();
  if (aslHistory.length > 0 && now - aslHistory[aslHistory.length - 1].time < 700) {
    return;
  }

  lastASLPrediction = prediction;
  aslHistory.push({ prediction, time: now });

  console.log('Signing:', prediction);

  // Update the local prediction chip with the current letter.
  const el = document.getElementById('aslPrediction');
  if (el) el.textContent = prediction;

  // Accumulate into the word buffer and reset the boundary timer.
  wordBuffer.push(prediction);
  updateWordBufferDisplay();

  clearTimeout(wordBoundaryTimer);
  wordBoundaryTimer = setTimeout(flushWordBuffer, WORD_BOUNDARY_MS);
}

function updateWordBufferDisplay() {
  const el = document.getElementById('aslPrediction');
  if (el && wordBuffer.length > 0) {
    el.textContent = wordBuffer.join('·');
  }
}

function flushWordBuffer() {
  if (wordBuffer.length === 0) return;

  const letters = [...wordBuffer];
  wordBuffer.length = 0;

  const el = document.getElementById('aslPrediction');
  if (el) el.textContent = '…';

  console.log('[word] flushing:', letters);

  if (window.socket && window.socket.connected) {
    window.socket.emit('aslWord', { letters });
  }
}

// Also update the history display in the footer.
function updateHistoryLine() {
  const histEl = document.getElementById('aslHistoryLine');
  if (!histEl) return;
  histEl.textContent = aslHistory.slice(-8).map(h => h.prediction).join(' ');
}
