// script.js (ES module)
// Frontend logic for preparing local media, connecting to the signaling server,
// and wiring up the RTCPeerConnection. We intentionally separate concerns:
// - Socket handles signaling transport only
// - RTCPeerConnection handles media and NAT traversal via ICE (STUN/TURN)
// Offer/Answer exchange will be added next, but we scaffold the structure now.

const statusEl = document.getElementById('status-text');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

// Minimal baseline: no mic/camera control UI

// Default to public STUN; we will attempt to load TURN from /ice-config.
let ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' }
];

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
    } else {
      console.warn('[client] /ice-config returned empty; using default STUN');
    }
  } catch (err) {
    console.warn('[client] failed to load /ice-config; using default STUN', err);
  }
}

let pc; // RTCPeerConnection instance
let socket; // Socket.IO client
let localStream; // MediaStream of local tracks
let makingOffer = false; // Helps avoid glare
let ignoreOffer = false; // Polite peer logic
let isSettingRemoteAnswerPending = false;

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

async function initMedia() {
  // Reasoning: request both audio and video so the remote peer gets A/V immediately.
  console.log('[client] requesting getUserMedia');
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  console.log('[client] got localStream', {
    audio: localStream.getAudioTracks().map((t) => ({ id: t.id, enabled: t.enabled })),
    video: localStream.getVideoTracks().map((t) => ({ id: t.id, enabled: t.enabled }))
  });
  localVideo.srcObject = localStream;
}

function createPeerConnection() {
  // Reasoning: keep config minimal; public STUN helps across NATs.
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  console.log('[client] RTCPeerConnection created', pc);

  // Forward local tracks to the connection immediately.
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  // Display the remote stream when tracks arrive.
  pc.addEventListener('track', (event) => {
    console.log('[client] remote track event', {
      streams: event.streams.length,
      trackKind: event.track && event.track.kind
    });
    const [remoteStream] = event.streams;
    remoteVideo.srcObject = remoteStream;
  });

  // As ICE candidates are found locally, send them through signaling to the peer.
  pc.addEventListener('icecandidate', (event) => {
    console.log('[client] local icecandidate', { hasCandidate: !!event.candidate });
    if (event.candidate) {
      socket.emit('signal:ice-candidate', { candidate: event.candidate });
      console.log('[client] sent ice-candidate');
    }
  });

  // For simple logging and UX feedback.
  pc.addEventListener('connectionstatechange', () => {
    setStatus(`Peer connection: ${pc.connectionState}`);
    console.log('[client] connectionstatechange', pc.connectionState);
  });
}

function initSocket() {
  // Connect to the same-origin Socket.IO endpoint.
  socket = io();
  socket.on('connect', () => {
    console.log('[client] socket connected', socket.id);
  });

  // Attempt to join the default room; server enforces 1:1 size.
  socket.emit('join');

  socket.on('joined', ({ room, peers }) => {
    setStatus(`Joined room: ${room}. Peers: ${peers}`);
    console.log('[client] joined', { room, peers });
  });

  socket.on('room_full', () => {
    setStatus('Room is full. Please try again later.');
    console.warn('[client] room_full');
  });

  // When both peers are present, negotiation (offer/answer) can start.
  // We'll implement the full SDP exchange in the next step to keep changes isolated.
  socket.on('ready', () => {
    setStatus('Both peers present. Ready to negotiate.');
    console.log('[client] ready');
  });

  // Newly joined peer initiates the first offer.
  socket.on('initiate', async () => {
    console.log('[client] initiate received; making offer');
    try {
      await makeOffer();
    } catch (err) {
      console.error('Error creating offer', err);
    }
  });

  // Signaling relays that will be wired to RTCPeerConnection in the next step.
  socket.on('signal:offer', async (payload) => {
    console.log('[client] received offer');
    const offer = payload?.sdp;
    if (!offer) return;
    try {
      const offerCollision = makingOffer || pc.signalingState !== 'stable';
      ignoreOffer = !offerCollision ? false : true;
      console.log('[client] handling offer', { offerCollision, ignoreOffer, signalingState: pc.signalingState });
      if (ignoreOffer) return; // Polite peer: ignore glare offer

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
      isSettingRemoteAnswerPending = true;
      await pc.setRemoteDescription(answer);
      console.log('[client] applied remote answer');
    } catch (err) {
      console.error('Error applying remote answer', err);
    } finally {
      isSettingRemoteAnswerPending = false;
    }
  });

  socket.on('signal:ice-candidate', async ({ candidate }) => {
    console.log('[client] received remote ice-candidate', { hasCandidate: !!candidate });
    // When the remote peer finds candidates, we add them to our RTCPeerConnection.
    try {
      if (pc && candidate) await pc.addIceCandidate(candidate);
      if (candidate) console.log('[client] added remote ice-candidate');
    } catch (err) {
      console.error('Error adding remote ICE candidate', err);
    }
  });

  socket.on('peer_disconnected', () => {
    setStatus('Peer disconnected.');
    console.warn('[client] peer_disconnected');
  });
}

async function makeOffer() {
  try {
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

(async function main() {
  try {
    setStatus('Requesting camera and microphone…');
    await initMedia();
    // Minimal baseline: no controls to apply

    // Load ICE servers (TURN) from the server if available.
    setStatus('Loading ICE configuration…');
    await loadIceServers();

    setStatus('Creating peer connection…');
    createPeerConnection();

    setStatus('Connecting to signaling server…');
    initSocket();

    setStatus('Waiting for peer… Open this page on a second machine.');
  } catch (err) {
    console.error(err);
    setStatus('Error initializing application. Check console.');
  }
})();
