// hearing.js - Hearing user specific logic

let aslPredictions = [];

// ---- Browser Text-to-Speech ----
// Uses the Web Speech API (built-in, no API key needed).
// Picks the best available English voice and speaks each ASL prediction aloud.
let _ttsVoice = null;

function loadTTSVoice() {
  const pick = () => {
    const voices = window.speechSynthesis.getVoices();
    // Prefer a natural-sounding English voice; fall back to any English voice.
    _ttsVoice =
      voices.find(v => v.lang.startsWith('en') && v.localService && !v.name.includes('Google')) ||
      voices.find(v => v.lang.startsWith('en')) ||
      null;
    console.log('[TTS] Selected voice:', _ttsVoice?.name ?? 'browser default');
  };
  pick();
  // Chrome loads voices asynchronously.
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = pick;
  }
}

function speakPrediction(text) {
  if (!window.speechSynthesis || !text) return;
  // Cancel any ongoing speech so words don't queue up.
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.voice = _ttsVoice;
  utt.lang = 'en-US';
  utt.rate = 0.9;   // slightly slower for clarity
  utt.pitch = 1.0;
  utt.volume = 1.0;
  window.speechSynthesis.speak(utt);
  console.log('[TTS] Speaking:', text);
}
// --------------------------------

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
  speakPrediction(prediction);

  if (window.avatar && typeof window.avatar.setText === 'function') {
    const fullText = aslPredictions.map(p => p.text).join(' ');
    window.avatar.setText(fullText, 'en', 'ase');
  }
};

function updateASLDisplay() {
  const listEl = document.getElementById('aslPredictionsList');
  if (!listEl) return;

  listEl.innerHTML = aslPredictions
    .slice(-8)
    .map(p => `<p>${p.text}</p>`)
    .join('');
}

(async function init() {
  try {
    // Pre-load the TTS voice so it's ready before the first prediction arrives.
    loadTTSVoice();

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
