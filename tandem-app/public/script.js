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

function setupDataChannel(channel) {
  channel.onopen = () => {
    console.log('Data channel is open and ready');
  };
  
  channel.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'transcript') {
        updateTranscript(data.text, data.isFinal, false);
        if (window && window.avatar && typeof window.avatar.setText === 'function') {
          window.avatar.setText(data.text, 'en', 'ase');
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
  
  const container = captionsEl.closest('.captions-container');
  if (container) {
    container.style.display = 'block';
  }
  
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
  
  clearTimeout(window.transcriptTimeout);
  window.transcriptTimeout = setTimeout(() => {
    if (Date.now() - lastTranscriptUpdate >= TRANSCRIPT_TIMEOUT) {
      captionsEl.textContent = '';
      if (container) {
        container.style.display = 'none';
      }
    }
  }, TRANSCRIPT_TIMEOUT);
}

let isMicOn = true;
let isCameraOn = true;

let ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { 
    urls: [
      'turn:34.41.176.41:3478?transport=udp',
      'turn:34.41.176.41:3478?transport=tcp'
    ],
    username: 'turnuser',
    credential: 'turnpass',
    credentialType: 'password'
  }
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
    
    if (pc.connectionState === 'disconnected' || 
        pc.connectionState === 'failed' || 
        pc.connectionState === 'closed') {
      setTimeout(() => {
        if (pc.connectionState !== 'connected' && pc.connectionState !== 'connecting') {
          console.log('[client] Attempting to reconnect...');
          initMedia().catch(console.error);
        }
      }, 2000);
    }
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

function initSocket(userType) {
  socket = io();
  window.socket = socket;
  socket.on('connect', () => {
    console.log('[client] socket connected', socket.id);
    
    if (audioStream && !isProcessingAudio) {
      isProcessingAudio = true;
    }
    
    socket.emit('join', userType);
  });
  
  socket.on('transcript', (data) => {
    console.log('[client] received transcript:', data);
    if (data.transcript) {
      updateTranscript(data.transcript, data.isFinal, data.isLocal);
      try {
        if (data.isLocal === false && window && window.avatar && typeof window.avatar.setText === 'function') {
          window.avatar.setText(data.transcript, 'en', 'ase');
        }
      } catch (e) {
        console.warn('Avatar update failed:', e);
      }
    }
  });

  socket.on('aslPrediction', (data) => {
    console.log('[client] received ASL prediction:', data);
    if (typeof window.handleASLPrediction === 'function') {
      window.handleASLPrediction(data.prediction);
    }
    if (data.prediction && dataChannel && dataChannel.readyState === 'open') {
      try {
        dataChannel.send(JSON.stringify({
          type: 'aslPrediction',
          prediction: data.prediction
        }));
      } catch (err) {
        console.error('Error sending ASL prediction:', err);
      }
    }
  });

  socket.emit('join', userType);

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
    
    if (isMicOn) {
      toggleMicBtn.classList.remove('mic-off');
      toggleMicBtn.classList.add('mic-on');
      toggleMicBtn.querySelector('.text').textContent = 'Unmute';
    } else {
      toggleMicBtn.classList.remove('mic-on');
      toggleMicBtn.classList.add('mic-off');
      toggleMicBtn.querySelector('.text').textContent = 'Mute';
    }
    
    console.log(`[client] Microphone ${isMicOn ? 'unmuted' : 'muted'}`);
  }
}

function toggleCamera() {
  if (!localStream) return;
  
  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length > 0) {
    isCameraOn = !isCameraOn;
    videoTracks[0].enabled = isCameraOn;
    
    if (isCameraOn) {
      toggleCameraBtn.classList.remove('camera-off');
      toggleCameraBtn.classList.add('camera-on');
      if (localVideo) localVideo.style.opacity = '1';
    } else {
      toggleCameraBtn.classList.remove('camera-on');
      toggleCameraBtn.classList.add('camera-off');
      if (localVideo) localVideo.style.opacity = '0.5';
    }
    
    console.log(`[client] Camera turned ${isCameraOn ? 'on' : 'off'}`);
  }
}

function setupMediaControls() {
  if (!toggleMicBtn || !toggleCameraBtn) return;
  
  toggleMicBtn.classList.add('mic-on');
  toggleCameraBtn.classList.add('camera-on');
  
  toggleMicBtn.addEventListener('click', toggleMic);
  toggleCameraBtn.addEventListener('click', toggleCamera);
}

window.TandemApp = {
  initMedia,
  loadIceServers,
  createPeerConnection,
  initSocket,
  setStatus,
  socket
};
