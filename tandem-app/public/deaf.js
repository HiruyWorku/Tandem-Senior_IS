// deaf.js - ASL Recognition for Deaf User
// NOTE: showPillToast() is provided by script.js (loaded before this file).

let lastASLPrediction = '';
const aslHistory = [];
// Use a relative URL so requests go through the Node.js /api/predict proxy.
// This avoids CORS and works regardless of where the app is deployed.
const ASL_API_URL = '';


(async function init() {
  try {
    window.TandemApp.setStatus('Requesting camera and microphone…');
    await window.TandemApp.initMedia();

    window.TandemApp.setStatus('Loading ICE configuration…');
    await window.TandemApp.loadIceServers();

    window.TandemApp.setStatus('Creating peer connection…');
    await window.TandemApp.createPeerConnection();

    window.TandemApp.setStatus('Connecting to signaling server…');
    window.TandemApp.initSocket('deaf');

    window.TandemApp.setStatus('Waiting for peer…');

    // Listen for the hearing user's TTS completion signal.
    // When the hearing peer finishes speaking a sign aloud, notify the deaf user.
    if (window.socket) {
      window.socket.on('ttsSpoken', () => {
        showPillToast('tandem-tts-toast', '🔊 Spoken', '#e9a84c');
      });
    } else {
      // socket may not be ready yet — attach after initSocket sets window.socket
      const waitForSocket = setInterval(() => {
        if (window.socket) {
          clearInterval(waitForSocket);
          window.socket.on('ttsSpoken', () => {
            showPillToast('tandem-tts-toast', '🔊 Spoken', '#e9a84c');
          });
        }
      }, 100);
    }

    // Kick off ASL recognition using the same camera stream TandemApp acquired
    initASL();
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

  // Reuse the camera stream that TandemApp already acquired
  if (localVideo && localVideo.srcObject) {
    console.log('Using camera stream from TandemApp');
    aslVideo.srcObject = localVideo.srcObject;
    try { await aslVideo.play(); } catch (e) { console.warn('ASL video play:', e); }
  } else {
    // Fallback: request our own camera stream
    console.log('No TandemApp stream yet — requesting own camera');
    if (aslStatus) aslStatus.textContent = 'ASL: Requesting camera...';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      aslVideo.srcObject = stream;
      await aslVideo.play();
    } catch (e) {
      console.error('Camera error:', e);
      if (aslStatus) aslStatus.textContent = 'ASL: Camera error - ' + e.message;
      return;
    }
  }

  console.log('Camera ready');
  if (aslStatus) aslStatus.textContent = 'ASL: Loading model...';

  await loadMediaPipe();
  console.log('MediaPipe loaded');
  if (aslStatus) aslStatus.textContent = 'ASL: Ready - show your hand!';

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
  console.log('Starting video processing');

  // Wait for Hands to be available (async)
  async function waitForHands() {
    let attempts = 0;
    while (typeof Hands === 'undefined' && attempts < 50) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    return typeof Hands !== 'undefined';
  }

  waitForHands().then(handsLoaded => {
    if (!handsLoaded) {
      console.error('Hands never loaded');
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

    function sendFrame() {
      if (video.readyState >= 2) {
        hands.send({ image: video });
      }
      requestAnimationFrame(sendFrame);
    }

    sendFrame();
    console.log('Processing started');
  });
}


async function onHandsResults(results) {
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    return;
  }

  // Hand detected!
  console.log('Hand detected!');
  const landmarks = results.multiHandLandmarks[0];

  // Extract features
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

      // Threshold of 0.4 filters out low-confidence noise while still being responsive.
      if (data.prediction && data.probability > 0.4) {
        showPrediction(data.prediction);
        return;
      }
    } else {
      const err = await resp.json().catch(() => ({}));
      console.warn('[ASL] API error:', resp.status, err.error || '');
    }
  } catch (e) {
    console.warn('[ASL] API unreachable (is asl_api.py running via npm run start:all?):', e.message);
  }

  // Fallback
  const pred = predictHeuristic(landmarks);
  if (pred) {
    showPrediction(pred);
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
  // Debounce: don't fire faster than 700 ms to avoid flooding the API.
  if (aslHistory.length > 0 && now - aslHistory[aslHistory.length - 1].time < 700) {
    return;
  }

  lastASLPrediction = prediction;
  aslHistory.push({ prediction, time: now });

  console.log('Showing:', prediction);

  const el = document.getElementById('aslPrediction');
  if (el) el.textContent = prediction;

  // Send to peer
  if (window.socket && window.socket.connected) {
    window.socket.emit('aslPrediction', { prediction });
  }
}
