// hearing.js - Hearing user specific logic

let aslPredictions = [];


window.handleASLPrediction = function (prediction) {
  if (!prediction) return;

  const currentTime = Date.now();

  if (aslPredictions.length > 0) {
    const lastPrediction = aslPredictions[aslPredictions.length - 1];
    if (currentTime - lastPrediction.time < 1000 && lastPrediction.text === prediction) {
      return;
    }
  }

  aslPredictions.push({ text: prediction, time: currentTime });
  if (aslPredictions.length > 15) {
    aslPredictions.shift();
  }

  updateASLDisplay();
  // Audio is spoken by Google Cloud TTS via the server (script.js playTTSAudio).

  if (window.avatar && typeof window.avatar.setText === 'function') {
    const fullText = aslPredictions.map(p => p.text).join(' ');
    window.avatar.setText(fullText, 'en', 'ase');
  }
};

function updateASLDisplay() {
  const listEl = document.getElementById('aslPredictionsList');
  if (!listEl) return;

  // Render each prediction as an animated pill chip
  listEl.innerHTML = aslPredictions
    .slice(-12)
    .map(p => `<span class="sign-chip">${p.text}</span>`)
    .join('');

  // Auto-scroll to bottom
  listEl.scrollTop = listEl.scrollHeight;
}


(async function init() {
  try {
    window.TandemApp.setStatus('Requesting camera and microphone…');
    await window.TandemApp.initMedia();

    window.TandemApp.setStatus('Loading ICE configuration…');
    await window.TandemApp.loadIceServers();

    window.TandemApp.setStatus('Creating peer connection…');
    await window.TandemApp.createPeerConnection();

    window.TandemApp.setStatus('Connecting to signaling server…');
    window.TandemApp.initSocket('hearing');

    window.TandemApp.setStatus('Waiting for peer… The deaf user\'s signs will appear here.');
  } catch (err) {
    console.error(err);
    window.TandemApp.setStatus('Error initializing application. Check console.');
  }
})();
