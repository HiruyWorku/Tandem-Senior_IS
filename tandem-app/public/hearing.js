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
  const area = document.getElementById('sentenceArea');
  if (!area) return;

  if (sentenceHistory.length === 0) {
    area.innerHTML = '<p style="font-size:12.5px; color:var(--text-3); text-align:center; padding:16px 0;">ASL signs will appear here when the deaf user signs.</p>';
    return;
  }

  area.innerHTML = sentenceHistory
    .map((s, i) => {
      const isLatest = i === sentenceHistory.length - 1;
      return `<div class="interp-sentence${isLatest ? '' : ' faded'}">${s}</div>`;
    })
    .join('');

  // Scroll to bottom so latest sentence is always visible
  area.scrollTop = area.scrollHeight;
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
