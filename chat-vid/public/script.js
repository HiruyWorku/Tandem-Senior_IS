// script.js (ES module)
// Frontend logic for preparing local media, connecting to the signaling server,
// and wiring up the RTCPeerConnection. We intentionally separate concerns:
// - Socket handles signaling transport only
// - RTCPeerConnection handles media and NAT traversal via ICE (STUN/TURN)
// Offer/Answer exchange will be added next, but we scaffold the structure now.

const statusEl = document.getElementById('status-text');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const toggleMicBtn = document.getElementById('toggleMic');
const toggleCameraBtn = document.getElementById('toggleCamera');
const localCaptionsEl = document.getElementById('localCaptions');
const remoteCaptionsEl = document.getElementById('remoteCaptions');

// Audio context and nodes for processing
let audioContext;
let sourceNode;
let processorNode;
let audioStream;
let isProcessingAudio = false;
let audioProcessingInitialized = false;

// Track the last transcript update time to clear old captions
let lastTranscriptUpdate = 0;
const TRANSCRIPT_TIMEOUT = 3000; // Clear captions after 3 seconds of no updates

// Set up data channel for captions
function setupDataChannel(channel) {
  channel.onopen = () => {
    console.log('Data channel is open and ready');
  };
  
  channel.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'transcript') {
        updateTranscript(data.text, data.isFinal, false);
        // Drive signing avatar for remote captions arriving via data channel
        try {
          if (window && window.avatar && typeof window.avatar.setText === 'function') {
            window.avatar.setText(data.text, 'en', 'ase');  //this were the text data is sent to the avatar
          }
        } catch (e) {
          console.warn('Avatar update (data channel) failed:', e);
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

// Update the transcript display
function updateTranscript(transcript, isFinal = true, isLocal = true) {
  const captionsEl = isLocal 
    ? document.getElementById('localCaptions')
    : document.getElementById('remoteCaptions');
    
  if (!captionsEl) return;
  
  // Update the transcript text
  captionsEl.textContent = transcript;
  
  // Show the captions container
  const container = captionsEl.closest('.captions-container');
  if (container) {
    container.style.display = 'block';
  }
  
  // Update the last transcript time
  lastTranscriptUpdate = Date.now();
  
  // If this is a local transcript, send it over the data channel so there avatar can sign what is said 
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
  
  // Clear the transcript after a delay if no new updates
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

// Track the state of mic and camera
let isMicOn = true;
let isCameraOn = true;

// Default to public STUN and TURN servers with fallback
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
let dataChannel; // For sending captions between peers
let ignoreOffer = false; // Polite peer logic
let isSettingRemoteAnswerPending = false;

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

async function initMedia() {
  try {
    // Request both audio and video so the remote peer gets A/V immediately.
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
    
    localVideo.srcObject = localStream;
    
    // Initialize audio processing for speech-to-text
    await setupAudioProcessing(localStream);
    
    // Initialize UI controls
    setupMediaControls();
  } catch (error) {
    console.error('Error initializing media:', error);
    setStatus('Error accessing media devices: ' + error.message);
  }
}

async function setupAudioProcessing(stream) {
  try {
    // Don't reinitialize if already set up with the same stream
    if (audioProcessingInitialized && audioStream && audioStream.id === stream.id) {
      console.log('Audio processing already initialized for this stream');
      return true;
    }
    
    console.log('Setting up audio processing...');
    
    // Clean up existing resources
    await cleanupAudioProcessing();
    
    // Store the audio stream
    audioStream = stream;
    
    try {
      // Create audio context
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContext();
      
      // Create a media stream source from the microphone
      sourceNode = audioContext.createMediaStreamSource(stream);
      
      // Create a script processor node to process the audio
      processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      
      console.log('Audio context and nodes created');
    } catch (error) {
      console.error('Error creating audio context:', error);
      throw error;
    }
    
    // Set up the audio processing
    processorNode.onaudioprocess = (event) => {
      // Don't process if we're not connected or not supposed to be processing
      if (!isProcessingAudio || !socket || !socket.connected) return;
      
      try {
        // Get the audio data
        const inputData = event.inputBuffer.getChannelData(0);
        
        // Only process if we have valid data
        if (!inputData || inputData.length === 0) return;
        
        // Convert Float32 to Int16 for WebM/Opus
        const output = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Convert from float to 16-bit PCM
          const s = Math.max(-1, Math.min(1, inputData[i]));
          output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Send the audio data to the server if connected
        if (socket && socket.connected) {
          try {
            socket.emit('audioData', {
              buffer: Array.from(output),
              sampleRate: audioContext.sampleRate,
              isFinal: false
            });
          } catch (emitError) {
            console.error('Error sending audio data:', emitError);
          }
        }
      } catch (error) {
        console.error('Error processing audio:', error);
      }
    };
    
    // Connect the nodes
    try {
      sourceNode.connect(processorNode);
      processorNode.connect(audioContext.destination);
      
      // Mark as initialized
      audioProcessingInitialized = true;
      isProcessingAudio = true;
      console.log('Audio processing started');
      
      // Set up track ended handler
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const track = audioTracks[0];
        track.onended = () => {
          console.log('Audio track ended');
          cleanupAudioProcessing();
          
          if (socket && socket.connected) {
            try {
              socket.emit('audioData', {
                buffer: [],
                sampleRate: audioContext ? audioContext.sampleRate : 48000,
                isFinal: true
              });
            } catch (err) {
              console.error('Error sending final audio data:', err);
            }
          }
        };
      }
      
      return true;
    } catch (error) {
      console.error('Error connecting audio nodes:', error);
      await cleanupAudioProcessing();
      throw error;
    }
    
  } catch (error) {
    console.error('Error setting up audio processing:', error);
    await cleanupAudioProcessing();
    return false;
  }
}

async function cleanupAudioProcessing() {
  console.log('Cleaning up audio processing...');
  
  // Stop processing audio
  isProcessingAudio = false;
  audioProcessingInitialized = false;
  
  // Disconnect and clean up audio nodes
  if (processorNode) {
    try {
      if (sourceNode) {
        sourceNode.disconnect();
      }
      processorNode.disconnect();
      processorNode.onaudioprocess = null;
    } catch (err) {
      console.error('Error disconnecting audio nodes:', err);
    }
    processorNode = null;
  }
  
  // Close the audio context
  if (audioContext && audioContext.state !== 'closed') {
    try {
      await audioContext.close();
    } catch (err) {
      console.error('Error closing audio context:', err);
    }
    audioContext = null;
  }
  
  // Stop audio tracks
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
  console.log('Audio processing cleaned up');
}

function convertFloat32ToInt16(buffer) {
  const l = buffer.length;
  const buf = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    buf[i] = Math.min(1, buffer[i]) * 0x7FFF;
  }
  return buf;
}

async function createPeerConnection() {
  console.log('[client] creating RTCPeerConnection');
  
  // Try to get updated ICE servers from the server first
  try {
    const res = await fetch('/ice-config', { cache: 'no-store' });
    if (res.ok) {
      const servers = await res.json();
      if (servers && servers.length > 0) {
        console.log('[client] Using updated ICE servers from server');
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
  
  // Create a data channel for captions
  try {
    dataChannel = pc.createDataChannel('captions');
    setupDataChannel(dataChannel);
    console.log('Created data channel for captions');
  } catch (err) {
    console.error('Error creating data channel:', err);
  }
  
  // Handle incoming data channel
  pc.ondatachannel = (event) => {
    if (event.channel.label === 'captions') {
      dataChannel = event.channel;
      setupDataChannel(dataChannel);
      console.log('Received remote data channel for captions');
    }
  };
  
  // Set up connection state change handler
  pc.onconnectionstatechange = () => {
    console.log(`[client] connection state changed: ${pc.connectionState}`);
    setStatus(`Connection: ${pc.connectionState}`);
    
    if (pc.connectionState === 'disconnected' || 
        pc.connectionState === 'failed' || 
        pc.connectionState === 'closed') {
      // Try to reconnect after a delay
      setTimeout(() => {
        if (pc.connectionState !== 'connected' && pc.connectionState !== 'connecting') {
          console.log('[client] Attempting to reconnect...');
          initMedia().catch(console.error);
        }
      }, 2000);
    }
  };
  
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
    
    // Start audio processing after socket is connected
    if (audioStream && !isProcessingAudio) {
      isProcessingAudio = true;
    }
    
    // Join the default room
    socket.emit('join');
  });
  
  // Handle transcript events from the server
  // Handle transcriptions from the server
  socket.on('transcript', (data) => {
    console.log('[client] received transcript:', data);
    if (data.transcript) {
      // Update the UI with the transcription
      updateTranscript(data.transcript, data.isFinal, data.isLocal);
      // Forward far-end (remote) transcript to the signing avatar
      try {
        if (data.isLocal === false && window && window.avatar && typeof window.avatar.setText === 'function') {
          // Defaults can be adjusted based on detected language
          window.avatar.setText(data.transcript, 'en', 'ase');
        }
      } catch (e) {
        console.warn('Avatar update failed:', e);
      }
    }
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

function toggleMic() {
  if (!localStream) return;
  
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length > 0) {
    isMicOn = !isMicOn;
    audioTracks[0].enabled = isMicOn;
    
    // Update UI
    if (isMicOn) {
      toggleMicBtn.classList.remove('mic-off');
      toggleMicBtn.classList.add('mic-on');
      toggleMicBtn.querySelector('.text').textContent = 'UnMute';
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
    
    // Update UI
    if (isCameraOn) {
      toggleCameraBtn.classList.remove('camera-off');
      toggleCameraBtn.classList.add('camera-on');
      localVideo.style.opacity = '1';
    } else {
      toggleCameraBtn.classList.remove('camera-on');
      toggleCameraBtn.classList.add('camera-off');
      localVideo.style.opacity = '0.5';
    }
    
    console.log(`[client] Camera turned ${isCameraOn ? 'on' : 'off'}`);
  }
}

function setupMediaControls() {
  // Set initial button states
  toggleMicBtn.classList.add('mic-on');
  toggleCameraBtn.classList.add('camera-on');
  
  // Add event listeners
  toggleMicBtn.addEventListener('click', toggleMic);
  toggleCameraBtn.addEventListener('click', toggleCamera);
  
  // Add keyboard shortcuts (optional)
  document.addEventListener('keydown', (e) => {
    // Ctrl+Alt+M to toggle mic
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      toggleMic();
    }
    // Ctrl+Alt+C to toggle camera
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      toggleCamera();
    }
  });
}

(async function main() {
  try {
    setStatus('Requesting camera and microphone…');
    await initMedia();

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
