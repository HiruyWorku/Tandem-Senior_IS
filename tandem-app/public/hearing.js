// hearing.js - Hearing user specific logic

// Completed sentences (cleaned by Claude) — shown prominently.
const sentenceHistory = [];

// Completed words (interpreted by Claude) shown as chips in the footer.
const interpretedWords = [];

// Live letter buffer shown while the deaf user is mid-word.
let liveLetters = [];

window.handleASLPrediction = function (prediction) {
  // Individual letter updates — show live in the pending chip only.
  if (!prediction) return;
  liveLetters.push(prediction);
  renderASLDisplay();
};

window.handleASLWordResult = function (word, letters) {
  liveLetters = [];
  interpretedWords.push(word);
  if (interpretedWords.length > 20) interpretedWords.shift();
  renderASLDisplay();
};

// Final Claude-cleaned sentence — clear the word chips and show in the sentence panel.
window.handleASLSentence = function (sentence) {
  interpretedWords.length = 0;
  liveLetters = [];
  sentenceHistory.push(sentence);
  if (sentenceHistory.length > 5) sentenceHistory.shift();
  renderASLDisplay();
  renderSentenceHistory();
};

// Server is working on interpretation — show pending state.
window.handleASLWordPending = function (letters) {
  liveLetters = ['…'];
  renderASLDisplay();
};

function renderASLDisplay() {
  const listEl = document.getElementById('aslPredictionsList');
  if (!listEl) return;

  const wordChips = interpretedWords
    .slice(-10)
    .map(w => `<span class="sign-chip sign-chip--word">${w}</span>`)
    .join('');

  const liveChip = liveLetters.length > 0
    ? `<span class="sign-chip sign-chip--live">${liveLetters.join('·')}</span>`
    : '';

  listEl.innerHTML = wordChips + liveChip;
}

function renderSentenceHistory() {
  let panel = document.getElementById('aslSentencePanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'aslSentencePanel';
    panel.style.cssText = [
      'position:fixed', 'bottom:72px', 'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(10,14,30,0.95)',
      'border:1px solid rgba(80,227,194,0.3)',
      'border-radius:12px', 'padding:12px 20px',
      'max-width:560px', 'width:90%',
      'font-size:1rem', 'font-weight:500',
      'color:#e2e8f0', 'line-height:1.5',
      'z-index:100', 'text-align:center',
      'box-shadow:0 0 24px rgba(80,227,194,0.12)',
    ].join(';');
    document.body.appendChild(panel);
  }

  panel.innerHTML = sentenceHistory
    .map((s, i) => {
      const opacity = 0.4 + (i / sentenceHistory.length) * 0.6;
      return `<div style="opacity:${opacity.toFixed(2)};margin-bottom:2px">${s}</div>`;
    })
    .join('');
}


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
    window.TandemApp.initSocket('hearing', roomCode);

    window.TandemApp.setStatus('Waiting for peer… The deaf user\'s signs will appear here.');
  } catch (err) {
    console.error(err);
    window.TandemApp.setStatus('Error initializing application. Check console.');
  }
})();
