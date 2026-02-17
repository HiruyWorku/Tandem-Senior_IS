// deaf.js - Deaf user specific logic including ASL recognition (client-side)

const ASL_LABELS = {
  "dad": "dad", "mom": "mom", "boy": "boy", "girl": "girl", "baby": "baby",
  "cold": "cold", "food": "food", "drink": "drink", "cup": "cup", "water": "water",
  "cookie": "cookie", "shirt": "shirt", "mad": "mad", "sorry": "sorry", "love": "love",
  "sad": "sad", "A": "A", "B": "B", "C": "C", "D": "D", "E": "E", "F": "F",
  "G": "G", "H": "H", "I": "I", "K": "K", "L": "L", "M": "M", "N": "N",
  "O": "O", "P": "P", "Q": "Q", "R": "R", "S": "S", "T": "T", "U": "U",
  "V": "V", "W": "W", "X": "X", "Y": "Y", "3": "3", "5": "5", "6": "6",
  "7": "7", "8": "8", "9": "9", "10": "10", "again": "again", "applause": "applause",
  "full": "full", "help": "help", "no": "no", "learn": "learn", "money": "money",
  "more": "more", "name": "name", "know": "know", "person": "person", "please": "please",
  "short": "short", "stop": "stop", "tall": "tall", "teach": "teach", "thank you": "thank you",
  "understand": "understand", "what": "what", "yellow": "yellow", "yes": "yes"
};

let lastASLPrediction = '';
let aslHistory = [];
const ASL_DEBOUNCE = 800;
let aslProcessingInterval = null;

async function initASLRecognition() {
  const aslStatusEl = document.getElementById('aslStatus');
  const aslVideo = document.getElementById('aslVideo');
  
  if (aslStatusEl) {
    aslStatusEl.textContent = 'ASL Recognition: Loading MediaPipe...';
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { width: 640, height: 480 } 
    });
    aslVideo.srcObject = stream;
    await aslVideo.play();

    await loadMediaPipe();
    
    if (aslStatusEl) {
      aslStatusEl.textContent = 'ASL Recognition: Active';
    }
    
    startASLProcessing();
    
  } catch (error) {
    console.error('Failed to start ASL recognition:', error);
    if (aslStatusEl) {
      aslStatusEl.textContent = 'ASL Recognition: Error - ' + error.message;
    }
  }
}

async function loadMediaPipe() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/hands.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function startASLProcessing() {
  const aslVideo = document.getElementById('aslVideo');
  
  const hands = new Hands({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`;
    }
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  hands.onResults(onHandsResults);

  aslProcessingInterval = setInterval(() => {
    if (aslVideo.readyState >= 2) {
      hands.send({ image: aslVideo });
    }
  }, 100);
}

function onHandsResults(results) {
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];
    
    const data_aux = [];
    const xCoords = landmarks.map(l => l.x);
    const yCoords = landmarks.map(l => l.y);
    
    const minX = Math.min(...xCoords);
    const minY = Math.min(...yCoords);
    
    for (let i = 0; i < landmarks.length; i++) {
      data_aux.push(landmarks[i].x - minX);
      data_aux.push(landmarks[i].y - minY);
    }
    
    while (data_aux.length < 84) {
      data_aux.push(0);
    }
    
    predictASL(data_aux);
  }
}

function predictASL(features) {
  const mockPrediction = getHeuristicPrediction(features);
  
  if (mockPrediction) {
    handleASLPrediction(mockPrediction);
  }
}

function getHeuristicPrediction(features) {
  const fingerTips = [4, 8, 12, 16, 20];
  const fingerBases = [2, 5, 9, 13, 17];
  
  const fingers = [];
  for (let i = 0; i < 5; i++) {
    const tip = features[fingerTips[i] * 2];
    const base = features[fingerBases[i] * 2];
    fingers.push(tip < base ? 1 : 0);
  }
  
  const [thumb, index, middle, ring, pinky] = fingers;
  
  if (!index && !middle && !ring && !pinky && thumb) return 'A';
  if (index && middle && !ring && !pinky && !thumb) return 'V';
  if (index && !middle && !ring && !pinky && !thumb) return 'I';
  if (index && middle && ring && !pinky && !thumb) return 'Y';
  if (!index && !middle && !ring && !pinky && !thumb) return 'O';
  if (index && middle && ring && pinky && !thumb) return 'B';
  if (index && middle && ring && pinky && thumb) return 'E';
  if (!index && middle && ring && pinky && !thumb) return '3';
  if (!thumb && index && !middle && !ring && !pinky) return 'L';
  if (!thumb && index && !middle && !ring && pinky) return 'Y';
  if (!index && !middle && !ring && pinky) return 'F';
  
  const avgX = features.slice(0, 42).reduce((a, b) => a + b, 0) / 42;
  const spread = Math.max(...features.slice(0, 42)) - Math.min(...features.slice(0, 42));
  
  if (spread < 0.1) return 'O';
  if (spread > 0.3 && thumb) return 'K';
  
  return null;
}

function handleASLPrediction(prediction) {
  if (!prediction || prediction === lastASLPrediction) return;

  const currentTime = Date.now();
  if (aslHistory.length > 0) {
    const lastTime = aslHistory[aslHistory.length - 1].time;
    if (currentTime - lastTime < ASL_DEBOUNCE) {
      return;
    }
  }

  lastASLPrediction = prediction;

  const predictionEl = document.getElementById('aslPrediction');
  if (predictionEl) {
    predictionEl.textContent = prediction;
  }

  aslHistory.push({ prediction, time: currentTime });
  if (aslHistory.length > 20) {
    aslHistory.shift();
  }

  updateASLHistory();

  if (window.socket && window.socket.connected) {
    window.socket.emit('aslPrediction', { prediction });
  }
}

function updateASLHistory() {
  const historyEl = document.getElementById('aslHistory');
  if (!historyEl) return;

  historyEl.innerHTML = aslHistory
    .slice(-5)
    .reverse()
    .map(item => `<p>${item.prediction}</p>`)
    .join('');
}

window.handleASLPrediction = handleASLPrediction;

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

    await initASLRecognition();

    window.TandemApp.setStatus('Waiting for peer… Open this page on a second device.');
  } catch (err) {
    console.error(err);
    window.TandemApp.setStatus('Error initializing application. Check console.');
  }
})();
