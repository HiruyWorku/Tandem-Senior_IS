// script.js - Shared WebRTC logic for Tandem

const statusEl = document.getElementById('status-text');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const toggleMicBtn = document.getElementById('toggleMic');
const toggleCameraBtn = document.getElementById('toggleCamera');

let audioContext;
let sourceNode;
let processorNode;
let audioStream;
let isProcessingAudio = false;
let audioProcessingInitialized = false;

let lastTranscriptUpdate = 0;
const TRANSCRIPT_TIMEOUT = 3000;
// Per-strip timers so local and remote resets don't cancel each other
const _transcriptTimers = {};

function setupDataChannel(channel) {
  channel.onopen = () => {
    console.log('Data channel is open and ready');
  };

  channel.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'transcript') {
        updateTranscript(data.text, data.isFinal, false);
        // Only send FINAL transcripts to the avatar so an in-progress signing
        // animation is never preempted by an interim (partial) result.
        if (data.isFinal && window && window.avatar && typeof window.avatar.enqueue === 'function') {
          window.avatar.enqueue(data.text, 'en', 'ase');
        }
      }
      if (data.type === 'aslPrediction') {
        if (typeof window.handleASLPrediction === 'function') {
          window.handleASLPrediction(data.prediction);
        }
      }
    } catch (err) {
      console.error('Error parsing data channel message:', err);
    }
  };

  channel.onclose = () => {
    console.log('Data channel closed');
  };

  channel.onerror = (error) => {
    console.error('Data channel error:', error);
  };
}

function updateTranscript(transcript, isFinal = true, isLocal = true) {
  const captionsEl = isLocal
    ? document.getElementById('localCaptions')
    : document.getElementById('remoteCaptions');

  if (!captionsEl) return;

  captionsEl.textContent = transcript;

  // Highlight the subtitle strip while speech is active
  const strip = captionsEl.closest('.subtitle-strip');
  if (strip) strip.classList.add('has-text');

  lastTranscriptUpdate = Date.now();

  if (isLocal && dataChannel && dataChannel.readyState === 'open') {
    try {
      dataChannel.send(JSON.stringify({
        type: 'transcript',
        text: transcript,
        isFinal: isFinal
      }));
    } catch (err) {
      console.error('Error sending caption:', err);
    }
  }

  clearTimeout(_transcriptTimers[captionsEl.id]);
  _transcriptTimers[captionsEl.id] = setTimeout(() => {
    if (Date.now() - lastTranscriptUpdate >= TRANSCRIPT_TIMEOUT) {
      // Reset to idle placeholder text
      if (captionsEl) {
        captionsEl.textContent = isLocal
          ? 'Speak \u2014 your words appear here\u2026'
          : 'Waiting for speech\u2026';
      }
      if (strip) strip.classList.remove('has-text');
    }
  }, TRANSCRIPT_TIMEOUT);
}

let isMicOn = true;
let isCameraOn = true;

let ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

async function loadIceServers() {
  try {
    const res = await fetch('/ice-config', { cache: 'no-store' });
    if (!res.ok) {
      console.warn('[client] /ice-config HTTP error', res.status);
      return;
    }
    const servers = await res.json();
    if (Array.isArray(servers) && servers.length) {
      ICE_SERVERS = servers;
      console.log('[client] loaded ICE servers', ICE_SERVERS);
    }
  } catch (err) {
    console.warn('[client] failed to load /ice-config; using default STUN', err);
  }
}

let pc;
let socket;
let localStream;
let makingOffer = false;
let dataChannel;
let ignoreOffer = false;

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

async function initMedia() {
  try {
    console.log('[client] requesting getUserMedia');
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    console.log('[client] got localStream', {
      audio: localStream.getAudioTracks().map((t) => ({ id: t.id, enabled: t.enabled })),
      video: localStream.getVideoTracks().map((t) => ({ id: t.id, enabled: t.enabled }))
    });

    if (localVideo) {
      localVideo.srcObject = localStream;
    }

    await setupAudioProcessing(localStream);
    setupMediaControls();
  } catch (error) {
    console.error('Error initializing media:', error);
    setStatus('Error accessing media devices: ' + error.message);
  }
}

async function setupAudioProcessing(stream) {
  try {
    if (audioProcessingInitialized && audioStream && audioStream.id === stream.id) {
      console.log('Audio processing already initialized for this stream');
      return true;
    }

    console.log('Setting up audio processing...');
    await cleanupAudioProcessing();
    audioStream = stream;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContext();
    sourceNode = audioContext.createMediaStreamSource(stream);
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);

    processorNode.onaudioprocess = (event) => {
      if (!isProcessingAudio || !socket || !socket.connected) return;

      try {
        const inputData = event.inputBuffer.getChannelData(0);
        if (!inputData || inputData.length === 0) return;

        const output = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        if (socket && socket.connected) {
          socket.emit('audioData', {
            buffer: Array.from(output),
            sampleRate: audioContext.sampleRate,
            isFinal: false
          });
        }
      } catch (error) {
        console.error('Error processing audio:', error);
      }
    };

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    audioProcessingInitialized = true;
    isProcessingAudio = true;
    console.log('Audio processing started');

    return true;
  } catch (error) {
    console.error('Error setting up audio processing:', error);
    return false;
  }
}

async function cleanupAudioProcessing() {
  isProcessingAudio = false;
  audioProcessingInitialized = false;

  if (processorNode) {
    try {
      if (sourceNode) sourceNode.disconnect();
      processorNode.disconnect();
      processorNode.onaudioprocess = null;
    } catch (err) {
      console.error('Error disconnecting audio nodes:', err);
    }
    processorNode = null;
  }

  if (audioContext && audioContext.state !== 'closed') {
    try {
      await audioContext.close();
    } catch (err) {
      console.error('Error closing audio context:', err);
    }
    audioContext = null;
  }

  if (audioStream) {
    audioStream.getTracks().forEach(track => {
      try {
        track.stop();
      } catch (err) {
        console.error('Error stopping audio track:', err);
      }
    });
    audioStream = null;
  }

  sourceNode = null;
}

async function createPeerConnection() {
  console.log('[client] creating RTCPeerConnection');

  try {
    const res = await fetch('/ice-config', { cache: 'no-store' });
    if (res.ok) {
      const servers = await res.json();
      if (servers && servers.length > 0) {
        ICE_SERVERS = servers;
      }
    }
  } catch (err) {
    console.warn('[client] Error fetching ICE config, using defaults', err);
  }

  console.log('[client] Using ICE servers:', ICE_SERVERS);

  const config = {
    iceServers: ICE_SERVERS,
    iceTransportPolicy: 'all',
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  };

  pc = new RTCPeerConnection(config);

  try {
    dataChannel = pc.createDataChannel('captions');
    setupDataChannel(dataChannel);
    console.log('Created data channel for captions');
  } catch (err) {
    console.error('Error creating data channel:', err);
  }

  pc.ondatachannel = (event) => {
    if (event.channel.label === 'captions') {
      dataChannel = event.channel;
      setupDataChannel(dataChannel);
      console.log('Received remote data channel for captions');
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[client] connection state changed: ${pc.connectionState}`);
    setStatus(`Connection: ${pc.connectionState}`);
    // NOTE: Do NOT call initMedia() on disconnect — that creates a new camera
    // stream not attached to pc, which orphans the old tracks and blacks out
    // remote video. Re-negotiation is handled by the server join handler.
  };

  console.log('[client] RTCPeerConnection created', pc);

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.addEventListener('track', (event) => {
    console.log('[client] remote track event', {
      streams: event.streams.length,
      trackKind: event.track && event.track.kind
    });
    const [remoteStream] = event.streams;
    if (remoteVideo) {
      remoteVideo.srcObject = remoteStream;
      // Explicitly play — browsers don't auto-play when srcObject is replaced
      // on a video element that was already used (causes black video on reconnect).
      remoteVideo.play().catch(e => {
        console.warn('[client] remoteVideo.play() failed:', e.message);
      });
    }
  });

  pc.addEventListener('icecandidate', (event) => {
    console.log('[client] local icecandidate', { hasCandidate: !!event.candidate });
    if (event.candidate) {
      socket.emit('signal:ice-candidate', { candidate: event.candidate });
    }
  });

  pc.addEventListener('connectionstatechange', () => {
    setStatus(`Peer connection: ${pc.connectionState}`);
    console.log('[client] connectionstatechange', pc.connectionState);
  });
}

// Fetch the server's per-boot instance ID and store it in sessionStorage.
// If the ID changes on reconnect (server was restarted), reload the page so
// a fresh RTCPeerConnection is guaranteed without the user having to manually
// hit Cmd+Shift+R on both devices.
async function checkServerInstance() {
  try {
    const res = await fetch('/instance-id', { cache: 'no-store' });
    if (!res.ok) return;
    const { id } = await res.json();
    const stored = sessionStorage.getItem('tandem_server_id');
    if (stored && stored !== id) {
      console.log('[client] Server restarted (instance ID changed) — reloading page for fresh RTCPeerConnection');
      sessionStorage.setItem('tandem_server_id', id);
      window.location.reload();
      return;
    }
    sessionStorage.setItem('tandem_server_id', id);
  } catch (e) {
    // Non-fatal — fall through and connect anyway
  }
}

function initSocket(userType, roomCode) {
  socket = io();
  window.socket = socket;
  socket.on('connect', async () => {
    console.log('[client] socket connected', socket.id);

    await checkServerInstance();

    if (pc && (pc.signalingState === 'closed' || pc.connectionState === 'closed' || pc.connectionState === 'failed')) {
      console.log('[client] Stale RTCPeerConnection detected on reconnect — recreating');
      try { pc.close(); } catch (_) {}
      await createPeerConnection();
    }

    if (audioStream && !isProcessingAudio) {
      isProcessingAudio = true;
    }

    socket.emit('join', { userType, room: roomCode });
  });

  socket.on('invalid_room', () => {
    setStatus('Invalid room code. Return to the home page to start a new session.');
    console.error('[client] server rejected room code');
  });

  socket.on('transcript', (data) => {
    console.log('[client] received transcript:', data);
    if (data.transcript) {
      updateTranscript(data.transcript, data.isFinal, data.isLocal);
      // Avatar only gets queued on final results — never on interim partials.
      // This prevents a new sentence from interrupting the avatar mid-sign.
      try {
        if (data.isFinal && data.isLocal === false &&
          window && window.avatar && typeof window.avatar.enqueue === 'function') {
          window.avatar.enqueue(data.transcript, 'en', 'ase');
        }
      } catch (e) {
        console.warn('Avatar enqueue failed:', e);
      }
    }
  });

  socket.on('aslPrediction', (data) => {
    console.log('[client] received ASL prediction:', data);
    if (typeof window.handleASLPrediction === 'function') {
      window.handleASLPrediction(data.prediction);
    }
  });

  socket.on('aslWordPending', (data) => {
    console.log('[client] aslWordPending:', data.letters);
    if (typeof window.handleASLWordPending === 'function') {
      window.handleASLWordPending(data.letters);
    }
  });

  socket.on('aslWordResult', (data) => {
    console.log('[client] aslWordResult:', data.word);
    if (typeof window.handleASLWordResult === 'function') {
      window.handleASLWordResult(data.word, data.letters);
    }
  });

  socket.on('aslWordConfirm', (data) => {
    const el = document.getElementById('aslPrediction');
    if (el) el.textContent = data.word;
    console.log('[client] word confirmed:', data.word);
  });

  // Final cleaned sentence arrives — show it and queue the avatar.
  socket.on('aslSentence', (data) => {
    console.log('[client] aslSentence:', data.sentence);
    if (typeof window.handleASLSentence === 'function') {
      window.handleASLSentence(data.sentence);
    }
  });

  // Sentence confirmed back to the deaf user.
  socket.on('aslSentenceConfirm', (data) => {
    const el = document.getElementById('aslPrediction');
    if (el) el.textContent = data.sentence;
    console.log('[client] sentence confirmed:', data.sentence);
  });

  // Receive synthesized TTS audio from the server and play it.
  socket.on('ttsAudio', (data) => {
    if (data && data.audioBase64) {
      playTTSAudio(data.audioBase64).catch(err =>
        console.error('[TTS] playback error:', err)
      );
    }
  });

  // The deaf peer's avatar finished signing — show confirmation to the hearing user.
  socket.on('signingDone', () => {
    showSigningDoneToast();
  });

  socket.on('joined', ({ room, peers }) => {
    setStatus(`Joined room: ${room}. Peers: ${peers}`);
    console.log('[client] joined', { room, peers });
  });

  socket.on('room_full', () => {
    setStatus('Room is full. Please try again later.');
    console.warn('[client] room_full');
  });

  socket.on('ready', () => {
    setStatus('Both peers present. Ready to negotiate.');
    console.log('[client] ready');
  });

  socket.on('initiate', async () => {
    console.log('[client] initiate received; making offer');
    try {
      await makeOffer();
    } catch (err) {
      console.error('Error creating offer', err);
    }
  });

  socket.on('signal:offer', async (payload) => {
    console.log('[client] received offer');
    const offer = payload?.sdp;
    if (!offer) return;
    try {
      const offerCollision = makingOffer || pc.signalingState !== 'stable';
      ignoreOffer = !offerCollision ? false : true;
      console.log('[client] handling offer', { offerCollision, ignoreOffer, signalingState: pc.signalingState });
      if (ignoreOffer) return;

      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal:answer', { sdp: pc.localDescription });
      console.log('[client] sent answer');
    } catch (err) {
      console.error('Error handling remote offer', err);
    }
  });

  socket.on('signal:answer', async (payload) => {
    console.log('[client] received answer');
    const answer = payload?.sdp;
    if (!answer) return;
    try {
      await pc.setRemoteDescription(answer);
      console.log('[client] applied remote answer');
    } catch (err) {
      console.error('Error applying remote answer:', err);
    }
  });

  socket.on('signal:ice-candidate', async ({ candidate }) => {
    console.log('[client] received remote ice-candidate', { hasCandidate: !!candidate });
    try {
      if (pc && candidate) await pc.addIceCandidate(candidate);
      if (candidate) console.log('[client] added remote ice-candidate');
    } catch (err) {
      console.error('Error adding remote ICE candidate:', err);
    }
  });

  socket.on('peer_disconnected', () => {
    setStatus('Peer disconnected.');
    console.warn('[client] peer_disconnected');
  });
}

async function makeOffer() {
  try {
    // Recreate pc only for truly terminal states.
    // 'disconnected' is temporary — ICE will retry automatically and the
    // existing pc can still create a new offer (implicit ICE restart).
    // 'failed' and 'closed' are terminal and need a fresh pc.
    const terminalState = !pc
      || pc.signalingState === 'closed'
      || pc.connectionState === 'failed'
      || pc.connectionState === 'closed';
    if (terminalState) {
      console.log(`[client] makeOffer: terminal pc state="${pc?.connectionState}" — recreating`);
      try { pc?.close(); } catch (_) {}
      await createPeerConnection();
    }
    makingOffer = true;
    console.log('[client] creating offer');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal:offer', { sdp: pc.localDescription });
    console.log('[client] sent offer');
  } finally {
    makingOffer = false;
  }
}

function toggleMic() {
  if (!localStream) return;

  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length > 0) {
    isMicOn = !isMicOn;
    audioTracks[0].enabled = isMicOn;

    toggleMicBtn.classList.toggle('active-off', !isMicOn);

    console.log(`[client] Microphone ${isMicOn ? 'unmuted' : 'muted'}`);
  }
}

function toggleCamera() {
  if (!localStream) return;

  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length > 0) {
    isCameraOn = !isCameraOn;
    videoTracks[0].enabled = isCameraOn;

    toggleCameraBtn.classList.toggle('active-off', !isCameraOn);
    if (localVideo) localVideo.style.opacity = isCameraOn ? '1' : '0.5';

    console.log(`[client] Camera turned ${isCameraOn ? 'on' : 'off'}`);
  }
}

function setupMediaControls() {
  if (!toggleMicBtn || !toggleCameraBtn) return;
  toggleMicBtn.addEventListener('click', toggleMic);
  toggleCameraBtn.addEventListener('click', toggleCamera);
}

// --- Text-to-Speech playback ---
// Simple sequential queue: waits for the current audio to finish before playing the next.
let _ttsChain = Promise.resolve();

/**
 * showPillToast — reusable pill toast injected into the DOM.
 * Uses a module-level timer map so clearTimeout always gets the right handle,
 * and double-rAF so the browser always paints the hidden state before animating in.
 */
const _toastTimers = {};
function showPillToast(id, message, color) {
  let toast = document.getElementById(id);
  if (!toast) {
    toast = document.createElement('div');
    toast.id = id;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '28px',
      left: '50%',
      transform: 'translateX(-50%) translateY(12px)',
      background: 'rgba(10, 14, 30, 0.92)',
      padding: '6px 18px',
      borderRadius: '999px',
      fontSize: '0.8rem',
      fontWeight: '600',
      letterSpacing: '0.04em',
      opacity: '0',
      transition: 'opacity 0.25s ease, transform 0.25s ease',
      pointerEvents: 'none',
      zIndex: '9999',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(toast);
  }

  // Reset to hidden so the slide-in always replays, even on repeated calls.
  toast.style.opacity = '0';
  toast.style.transform = 'translateX(-50%) translateY(12px)';
  toast.textContent = message;
  toast.style.color = color;
  toast.style.border = `1.5px solid ${color}`;
  toast.style.boxShadow = `0 0 8px ${color}40`;

  // Cancel any pending hide timer.
  clearTimeout(_toastTimers[id]);

  // Double-rAF: first frame commits the reset styles, second frame triggers
  // the CSS transition into the visible state.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';

      // Auto-hide after 2 s.
      _toastTimers[id] = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(10px)';
      }, 2000);
    });
  });
}

/** Shown on the HEARING user's page when avatar finishes signing (teal). */
function showSigningDoneToast() {
  showPillToast('tandem-signing-toast', '✓ Done signing', '#4ecca3');
}


/**
 * Decode a base64 MP3 string (sent from the server) and play it through the
 * device speakers using the Web Audio API.
 * @param {string} audioBase64 - Base64-encoded MP3 bytes
 */
async function playTTSAudio(audioBase64) {
  _ttsChain = _ttsChain.then(async () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();

      // Decode base64 → ArrayBuffer
      const binary = atob(audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // Decode MP3 → AudioBuffer → play
      const buffer = await ctx.decodeAudioData(bytes.buffer);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      await new Promise((resolve) => {
        source.onended = resolve;
        source.start(0);
      });

      // Notify the DEAF user (peer) that their sign has been fully spoken.
      if (socket && socket.connected) {
        socket.emit('ttsSpoken');
      }

      ctx.close();
    } catch (err) {
      console.error('[TTS] Audio playback failed:', err);
    }
  });
  return _ttsChain;
}

window.TandemApp = {
  initMedia,
  loadIceServers,
  createPeerConnection,
  initSocket,
  setStatus,
  socket
};
