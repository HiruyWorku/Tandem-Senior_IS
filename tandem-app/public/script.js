import { IceLease } from '/iceLease.mjs';
import { AudioCapture } from '/audioCapture.js';
import { invitationToken, invitationHeaders } from '/invitation.js';

// script.js - Shared WebRTC logic for Tandem

const statusEl = document.getElementById('status-text');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const toggleMicBtn = document.getElementById('toggleMic');
const toggleCameraBtn = document.getElementById('toggleCamera');

let capture;
let joinedRoom = false;
let captionPaused = false;
let captureState = 'unavailable';
let providerState = 'disabled';
let providerRetryable = false;
let captionRequest = 0;
let captionBusy = false;

const TRANSCRIPT_TIMEOUT = 3000;
// Per-strip timers so local and remote resets don't cancel each other
const _transcriptTimers = {};

function setupDataChannel(channel) {
  channel.onopen = () => {
    console.log('Data channel is open and ready');
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

  clearTimeout(_transcriptTimers[captionsEl.id]);
  _transcriptTimers[captionsEl.id] = setTimeout(() => {
      // Reset to idle placeholder text
      if (captionsEl) {
        captionsEl.textContent = isLocal
          ? 'Speak \u2014 your words appear here\u2026'
          : 'Waiting for speech\u2026';
      }
      if (strip) strip.classList.remove('has-text');
  }, TRANSCRIPT_TIMEOUT);
}

let isMicOn = true;
let isCameraOn = true;

let ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const iceLease = new IceLease({
  fetchConfig: async signal => {
    const response = await fetch('/ice-config', { cache: 'no-store', headers: invitationHeaders(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
    if (!response.ok) { const error = new Error('ICE configuration unavailable'); error.status = response.status; throw error; }
    const expires = response.headers.get('X-Turn-Expires-At');
    return { servers: await response.json(), expiresAt: expires ? Number(expires) * 1000 : null };
  },
  onRenewed: servers => {
    ICE_SERVERS = servers;
    if (!pc || pc.signalingState === 'closed') return;
    pc.setConfiguration({ ...pc.getConfiguration(), iceServers: servers });
    if (joinedRoom && peerPresent && socket?.connected) {
      pc.restartIce();
      socket.emit('client:health', { event: 'ice_renewed' });
    }
  },
  onFailure: ({ terminal, expired }) => {
    socket?.emit('client:health', { event: 'ice_failed' });
    if (terminal && expired) setStatus('Relay access expired. Typed replies may still work.', 'error');
  },
});

async function loadIceServers() {
  try { const servers = await iceLease.load(); if (servers) ICE_SERVERS = servers; }
  catch { console.warn('[client] Relay configuration unavailable; using current ICE servers.'); }
}

let pc;
let socket;
let localStream;
let makingOffer = false;
let polite = false;
let peerPresent = false;
let isSettingRemoteAnswerPending = false;
let recoveryTimer;
let connectionRetryTimer;
let pageClosing = false;
function retryConnection() {
  clearTimeout(connectionRetryTimer);
  connectionRetryTimer = setTimeout(() => { if (!pageClosing) socket.connect(); }, 5000 + Math.random() * 2000);
}
let dataChannel;
let ignoreOffer = false;
let pendingIceCandidates = [];
let peerReset = Promise.resolve();
let hasConnected = false;
let connectionGeneration = 0;

async function flushIceCandidates() {
  for (const candidate of pendingIceCandidates.splice(0)) await pc.addIceCandidate(candidate);
}

function setStatus(text, state) {
  if (statusEl) statusEl.textContent = text;
  const dot = document.getElementById('status-dot');
  const resolved = state || (/invalid|unavailable|error|full/i.test(text) ? 'error' : 'waiting');
  if (dot) dot.className = `status-dot ${resolved}`;
}

async function authorizeInvitation(room) {
  try {
    const response = await fetch('/capabilities', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Connection unavailable. Reload to try again.');
    const capabilities = await response.json();
    window.TandemApp.capabilities = capabilities;
    if (!capabilities.privateRooms && !invitationToken) return true;
    const result = await fetch('/api/rooms/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...invitationHeaders() },
      body: JSON.stringify({ room }), signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) throw new Error('Invitation invalid or expired. Ask your partner for the full invitation link.');
    return true;
  } catch (error) {
    const message = error.message || 'Invitation unavailable. Reload to try again.';
    setStatus(message, 'error');
    const reply = document.getElementById('replyStatus');
    if (reply) reply.textContent = message;
    const waiting = document.getElementById('stageWaiting');
    if (waiting) {
      const label = waiting.querySelector('p');
      if (label) label.textContent = message;
      const spinner = waiting.querySelector('.spinner');
      if (spinner) spinner.hidden = true;
    }
    if (toggleMicBtn) toggleMicBtn.disabled = true;
    if (toggleCameraBtn) toggleCameraBtn.disabled = true;
    return false;
  }
}

async function initMedia() {
  try {
    const response = await fetch('/capabilities');
    window.TandemApp.capabilities = await response.json();
  } catch {
    window.TandemApp.capabilities = {};
  }
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

    if (window.TandemApp.capabilities.captions) await setupAudioProcessing(localStream);
    setupMediaControls();
  } catch (error) {
    console.error('Error initializing media:', error);
    setStatus('Camera or microphone unavailable. You can still type replies.');
    const waiting = document.getElementById('stageWaiting');
    if (waiting) {
      const label = waiting.querySelector('p');
      if (label) label.textContent = 'Camera or microphone unavailable. You can still type replies.';
      const spinner = waiting.querySelector('.spinner');
      if (spinner) spinner.hidden = true;
    }
    if (toggleMicBtn) toggleMicBtn.disabled = true;
    if (toggleCameraBtn) toggleCameraBtn.disabled = true;
    setupSpeakerControl();
    return false;
  }
}

function updateCaptionState() {
  const status = document.getElementById('captionStatus');
  const action = document.getElementById('captionAction');
  const captionsConfigured = window.TandemApp.capabilities?.captions;
  const labels = {
    ready: 'Captions ready', starting: 'Starting captions…', active: 'Your captions on',
    paused: 'Your captions paused', reconnecting: 'Captions reconnecting…',
    unavailable: 'Captions unavailable · type a reply', limited: 'Captions limited · some audio was skipped',
  };
  let text = labels[providerState] || 'Captions unavailable · type a reply';
  let label = 'Pause captions';
  let visible = Boolean(captionsConfigured && localStream?.getAudioTracks().length && joinedRoom);
  if (!captionsConfigured) { text = 'Captions unavailable · type a reply'; visible = false; }
  else if (captureState === 'unsupported') {
    text = 'Captions unsupported in this browser · type a reply'; visible = false;
  } else if (captureState === 'failed' || captureState === 'unavailable') {
    text = 'Caption capture unavailable · type a reply'; label = 'Retry captions';
  } else if (!isMicOn) { text = 'Microphone off · captions paused'; visible = false; }
  else if (captionPaused) { text = 'Your captions paused'; label = 'Start captions'; }
  else if (captureState !== 'running') { text = 'Start captions to use your microphone'; label = 'Start captions'; }
  else if (providerState === 'unavailable') { label = 'Retry captions'; visible = providerRetryable; }
  else if (providerState === 'paused') { label = 'Start captions'; }
  if (status) status.textContent = text;
  if (action) { action.hidden = !visible; action.textContent = label; action.disabled = captionBusy; }
}

function syncCapture() {
  capture?.setEnabled(joinedRoom && isMicOn && !captionPaused && captureState === 'running' &&
    !['unavailable', 'reconnecting', 'disabled', 'paused'].includes(providerState));
  updateCaptionState();
}

async function setupAudioProcessing(stream) {
  capture ||= new AudioCapture({
    onAudio: packet => {
      if (joinedRoom && isMicOn && !captionPaused && socket?.connected) {
        // Audio is live: discard congestion instead of replaying stale speech later.
        socket.volatile.emit('audioData', packet);
      }
    },
    onState: state => {
      captureState = state;
      syncCapture();
      if (joinedRoom && ['suspended', 'interrupted', 'failed'].includes(state)) setCaptionEnabled(false);
    },
  });
  try {
    await capture.start(stream);
    captureState = capture.context?.state || 'unavailable';
    syncCapture();
    return true;
  } catch (error) {
    captureState = error.code === 'unsupported' ? 'unsupported' : 'failed';
    updateCaptionState();
    return false;
  }
}

async function cleanupAudioProcessing() {
  await capture?.close();
  captureState = 'unavailable';
}

async function setCaptionEnabled(enabled) {
  if (!joinedRoom || !window.TandemApp.capabilities?.captions) return;
  const request = ++captionRequest;
  captionBusy = true;
  capture?.setEnabled(false);
  updateCaptionState();
  if (enabled) {
    if (!capture?.node) await setupAudioProcessing(localStream);
    if (!capture?.node) { captionBusy = false; updateCaptionState(); return; }
    try { await capture?.resume(); } catch { captureState = 'failed'; captionBusy = false; updateCaptionState(); return; }
  }
  if (request !== captionRequest || !joinedRoom) return;
  socket.timeout(5000).emit('caption:state', { enabled }, (error, result) => {
    if (request !== captionRequest || !joinedRoom) return;
    captionBusy = false;
    if (error || !result?.ok) {
      providerState = 'unavailable'; providerRetryable = true;
    } else {
      providerState = enabled ? 'ready' : 'paused';
    }
    syncCapture();
  });
}

document.getElementById('captionAction')?.addEventListener('click', () => {
  const enabled = captionPaused || captureState !== 'running' || ['unavailable', 'paused'].includes(providerState);
  captionPaused = !enabled;
  setCaptionEnabled(enabled);
});

async function createPeerConnection() {
  const generation = ++connectionGeneration;
  pendingIceCandidates = [];
  ignoreOffer = false;
  console.log('[client] creating RTCPeerConnection');

  clearTimeout(recoveryTimer);
  await loadIceServers();

  if (generation !== connectionGeneration) return;
  const config = {
    iceServers: ICE_SERVERS,
    iceTransportPolicy: 'all',
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  };

  const connection = new RTCPeerConnection(config);
  pc = connection;

  try {
    dataChannel = pc.createDataChannel('control');
    setupDataChannel(dataChannel);
    console.log('Created control data channel');
  } catch (err) {
    console.error('Error creating data channel:', err);
  }

  pc.ondatachannel = (event) => {
    if (pc !== connection) return;
    if (event.channel.label === 'control') {
      dataChannel = event.channel;
      setupDataChannel(dataChannel);
      console.log('Received control data channel');
    }
  };

  console.log('[client] RTCPeerConnection created', pc);

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.addEventListener('track', (event) => {
    if (pc !== connection) return;
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
    if (pc !== connection || !socket?.connected || !joinedRoom) return;
    console.log('[client] local icecandidate', { hasCandidate: !!event.candidate });
    if (event.candidate) {
      socket.emit('signal:ice-candidate', { candidate: event.candidate });
    }
  });

  pc.addEventListener('negotiationneeded', async () => {
    if (pc !== connection || !joinedRoom || !peerPresent || !socket?.connected) return;
    try { await makeOffer(); } catch { socket.emit('client:health', { event: 'ice_failed' }); }
  });
  pc.addEventListener('connectionstatechange', () => {
    if (pc !== connection) return;
    const labels = { new: 'Waiting for your peer…', connecting: 'Connecting to your peer…', connected: 'Connected to your peer',
      disconnected: 'Connection interrupted. Reconnecting…', failed: 'Video connection failed. Typed replies may still work.', closed: 'Video connection closed.' };
    setStatus(labels[pc.connectionState] || 'Waiting for your peer…', pc.connectionState === 'connected' ? 'connected' : pc.connectionState === 'failed' ? 'error' : 'waiting');
    clearTimeout(recoveryTimer);
    if (['disconnected', 'failed'].includes(connection.connectionState) && joinedRoom && peerPresent) {
      recoveryTimer = setTimeout(async () => {
        if (pc !== connection || !joinedRoom || !peerPresent || !socket?.connected) return;
        try { await iceLease.refresh(); }
        catch { if (pc === connection && connection.signalingState !== 'closed') connection.restartIce(); }
      }, connection.connectionState === 'failed' ? 1000 : 5000);
    }
    console.log('[client] connectionstatechange', pc.connectionState);
  });
}

// Fetch the server's per-boot instance ID and store it in sessionStorage.
// Server restarts recreate the peer connection while preserving the reply draft.
async function checkServerInstance() {
  try {
    const res = await fetch('/instance-id', { cache: 'no-store' });
    if (!res.ok) return;
    const { id } = await res.json();
    const stored = sessionStorage.getItem('tandem_server_id');
    if (stored && stored !== id) {
      console.log('[client] Server restarted — resetting peer connection');
      sessionStorage.setItem('tandem_server_id', id);
      return true;
    }
    sessionStorage.setItem('tandem_server_id', id);
  } catch (e) {
    // Non-fatal — fall through and connect anyway
  }
}

function initSocket(userType, roomCode) {
  socket = io({ auth: { token: invitationToken } });
  window.socket = socket;
  window.dispatchEvent(new CustomEvent('tandem:socket', { detail: socket }));
  socket.on('captionStatus', data => {
    providerState = data.status;
    providerRetryable = data.retryable !== false;
    syncCapture();
  });
  socket.on('peerCaptionStatus', data => {
    const element = document.getElementById('peerCaptionStatus');
    const labels = { ready: 'Peer captions ready', starting: 'Peer captions starting…', active: 'Peer captions on',
      paused: 'Peer captions paused', disabled: 'Peer captions unavailable', reconnecting: 'Peer captions reconnecting…',
      unavailable: 'Peer captions unavailable · you can exchange typed replies', limited: 'Peer captions limited · some audio was skipped' };
    if (element) element.textContent = labels[data.status] || 'Peer captions unavailable';
  });
  socket.on('disconnect', reason => {
    clearTimeout(recoveryTimer); clearTimeout(connectionRetryTimer);
    peerPresent = false; joinedRoom = false; captionRequest++; captionBusy = false; syncCapture();
    if (!pageClosing) {
      setStatus('Connection interrupted. Reconnecting…');
      if (reason === 'io server disconnect') retryConnection();
    }
  });
  socket.on('connect_error', error => {
    clearTimeout(connectionRetryTimer);
    if (pageClosing) return;
    if (error.data?.code === 'invalid_invitation') {
      setStatus('Invitation invalid or expired. Ask your partner for a new link.', 'error');
      joinedRoom = false; syncCapture();
      pc?.close();
      if (remoteVideo) remoteVideo.srcObject = null;
      const reply = document.getElementById('replyStatus');
      if (reply) reply.textContent = 'Invitation invalid or expired. Ask your partner for a new link.';
    } else if (error.data?.code === 'server_busy') {
      setStatus('Calls are busy. Retrying… Your draft is saved here.');
      // Namespace rejection stops Socket.IO's built-in reconnect; retry without losing the page draft.
      retryConnection();
    } else setStatus('Connection unavailable. Retrying… Your draft is saved here.');
  });
  socket.on('protocolError', ({ code }) => {
    if (code === 'invalid_invitation') {
      setStatus('Invitation invalid or expired. Ask your partner for a new link.', 'error');
      joinedRoom = false; syncCapture();
      const reply = document.getElementById('replyStatus');
      if (reply) reply.textContent = 'Invitation invalid or expired. Ask your partner for a new link.';
    }
    if (code === 'invalid_role' || code === 'leave_room_first') setStatus('Unable to join this room. Return home and try again.');
  });
  socket.on('connect', async () => {
    clearTimeout(connectionRetryTimer);
    console.log('[client] socket connected', socket.id);

    const restarted = await checkServerInstance();

    if (restarted || hasConnected || (pc && (pc.signalingState === 'closed' || pc.connectionState === 'closed' || pc.connectionState === 'failed'))) {
      console.log('[client] Stale RTCPeerConnection detected on reconnect — recreating');
      try { pc.close(); } catch (_) {}
      await createPeerConnection();
    }

    hasConnected = true;
    socket.emit('join', { userType, room: roomCode, token: invitationToken });
  });

  socket.on('invalid_room', () => {
    setStatus('Invalid room code. Return to the home page to start a new session.');
    console.error('[client] server rejected room code');
  });

  socket.on('transcript', (data) => {
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

  // The deaf peer's avatar finished signing — show confirmation to the hearing user.
  socket.on('signingDone', () => {
    showSigningDoneToast();
  });

  socket.on('joined', ({ room, peers }) => {
    joinedRoom = true;
    peerPresent = peers === 2;
    if (!localStream) socket.emit('client:health', { event: 'media_failed' });
    providerState = window.TandemApp.capabilities?.captions ? 'ready' : 'disabled';
    if (!isMicOn || captionPaused || captureState !== 'running') setCaptionEnabled(false);
    syncCapture();
    setStatus(`Joined room: ${room}. Peers: ${peers}`);
    console.log('[client] joined', { room, peers });
  });

  socket.on('room_full', () => {
    setStatus('Room is full. Please try again later.');
    console.warn('[client] room_full');
  });

  socket.on('ready', (data) => {
    polite = Boolean(data?.polite);
    peerPresent = true;
    setStatus('Both peers present. Ready to negotiate.');
    console.log('[client] ready');
  });

  socket.on('initiate', async () => {
    console.log('[client] initiate received; making offer');
    try {
      await peerReset;
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
      await peerReset;
      const readyForOffer = !makingOffer && (pc.signalingState === 'stable' || isSettingRemoteAnswerPending);
      const offerCollision = !readyForOffer;
      ignoreOffer = !polite && offerCollision;
      console.log('[client] handling offer', { offerCollision, ignoreOffer, signalingState: pc.signalingState });
      if (ignoreOffer) return;

      await pc.setRemoteDescription(offer);
      await flushIceCandidates();
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
      isSettingRemoteAnswerPending = true;
      await pc.setRemoteDescription(answer);
      isSettingRemoteAnswerPending = false;
      await flushIceCandidates();
      console.log('[client] applied remote answer');
    } catch (err) {
      console.error('Error applying remote answer:', err);
    } finally { isSettingRemoteAnswerPending = false; }
  });

  socket.on('signal:ice-candidate', async ({ candidate }) => {
    console.log('[client] received remote ice-candidate', { hasCandidate: !!candidate });
    try {
      if (pc && candidate) {
        if (!pc.remoteDescription) pendingIceCandidates.push(candidate);
        else await pc.addIceCandidate(candidate);
      }
      if (candidate) console.log('[client] added remote ice-candidate');
    } catch (err) {
      if (!ignoreOffer) console.error('Error adding remote ICE candidate:', err);
    }
  });

  socket.on('peer_disconnected', () => {
    peerPresent = false;
    clearTimeout(recoveryTimer);
    setStatus('Your peer left. Waiting for someone to join…');
    pc?.close();
    if (remoteVideo) remoteVideo.srcObject = null;
    peerReset = createPeerConnection();
    console.warn('[client] peer_disconnected');
  });
}

async function makeOffer() {
  if (makingOffer || !socket?.connected || !joinedRoom || !peerPresent) return;
  makingOffer = true;
  try {
    // Failed ICE can restart on the existing connection; only closed peers need replacement.
    if (!pc || pc.signalingState === 'closed' || pc.connectionState === 'closed') {
      pc?.close();
      await createPeerConnection();
    }
    const connection = pc;
    if (connection.signalingState !== 'stable') return;
    const offer = await connection.createOffer();
    if (pc !== connection || connection.signalingState !== 'stable' || !joinedRoom || !peerPresent) return;
    await connection.setLocalDescription(offer);
    if (pc === connection && joinedRoom && peerPresent && socket.connected) socket.emit('signal:offer', { sdp: connection.localDescription });
  } finally { makingOffer = false; }
}

function toggleMic() {
  if (!localStream) return;

  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length > 0) {
    isMicOn = !isMicOn;
    audioTracks[0].enabled = isMicOn;
    if (window.TandemApp.capabilities?.captions) setCaptionEnabled(isMicOn && !captionPaused);
    syncCapture();

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
  setupSpeakerControl();
}

function setupSpeakerControl() {
  const button = document.getElementById('toggleSpeaker');
  if (!button || !remoteVideo) return;
  button.addEventListener('click', async () => {
    remoteVideo.muted = !remoteVideo.muted;
    button.textContent = remoteVideo.muted ? 'Peer audio off' : 'Peer audio on';
    button.setAttribute('aria-pressed', String(!remoteVideo.muted));
    button.setAttribute('aria-label', remoteVideo.muted ? 'Turn on peer audio' : 'Turn off peer audio');
    try { await remoteVideo.play(); } catch { setStatus('Peer audio could not start. Try turning it on again.'); }
  });
}

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


window.TandemApp = {
  authorizeInvitation,
  invitationHeaders,
  initMedia,
  loadIceServers,
  createPeerConnection,
  initSocket,
  setStatus,
  showPillToast,
  socket
};

window.addEventListener('online', () => { if (joinedRoom) iceLease.refresh().catch(() => {}); });

window.addEventListener('pagehide', () => {
  pageClosing = true;
  clearTimeout(connectionRetryTimer);
  iceLease.stop();
  clearTimeout(recoveryTimer);
  socket?.disconnect();
  pc?.close();
  localStream?.getTracks().forEach(track => track.stop());
  cleanupAudioProcessing();
});
