// server.js
// Express + Socket.IO signaling server for a 1:1 WebRTC.
// serve static files from /public and relay signaling messages.
// This server does NOT touch media; it only helps peers find each other and exchange SDP/ICE.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const speechToText = require('./speech-to-text');
const poseProxy = require('./server/poseProxy');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Reasoning: defaults are fine for most cases; CORS is implicitly allowed for same-origin usage.
  serveClient: true
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));
// Proxy for Sign MT pose endpoint
app.use(poseProxy);

// Health check
app.get('/health', (_req, res) => res.status(200).send('OK'));

// Return ICE server configuration from environment variables to avoid exposing
// TURN credentials in the client bundle. Expected env variables:
// - TURN_URLS: comma-separated list, e.g. "turn:host:3478,turns:host:5349?transport=tcp"
// - TURN_USERNAME
// Serve the ICE configuration
app.get('/ice-config', (req, res) => {
  const turnUrls = process.env.TURN_URLS ? 
    process.env.TURN_URLS.split(',').map(url => url.trim()) : 
    [
      'turn:34.41.176.41:3478?transport=udp',
      'turn:34.41.176.41:3478?transport=tcp'
    ];
    
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { 
      urls: turnUrls,
      username: process.env.TURN_USERNAME || 'turnuser',
      credential: process.env.TURN_CREDENTIAL || 'turnpass',
      credentialType: 'password'
    }
  ];
  
  console.log('Serving ICE servers:', 
    iceServers.map(s => ({...s, credential: '***'})));
    
  // Set cache control headers
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.json(iceServers);
});

// use a single default room so that two different machines opening the page automatically meet.
// Reasoning: Simple UX: open the same URL -> you connect. This is sufficient for a 1:1 demo.
const DEFAULT_ROOM = 'main-room';

// Keep room size at 2 for 1:1 calls.
function getRoomSize(roomName) {
  const room = io.sockets.adapter.rooms.get(roomName);
  return room ? room.size : 0;
}

// Handle socket.io connections with better error handling and timeouts
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Set a timeout for the socket to detect disconnections
  socket.conn.on('heartbeat', () => {
    socket.lastHeartbeat = Date.now();
  });
  
  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`Client ${socket.id} disconnected:`, reason);
    // Clean up any resources for this socket
    if (socket.room) {
      socket.leave(socket.room);
      console.log(`Client ${socket.id} left room ${socket.room}`);
    }
  });
  
  // Handle errors
  socket.on('error', (error) => {
    console.error(`Socket error from ${socket.id}:`, error);
  });
  
  // Set a keepalive interval
  const keepAlive = setInterval(() => {
    if (socket.connected) {
      socket.emit('ping');
    }
  }, 30000);
  
  // Clean up on disconnect
  socket.on('disconnect', () => {
    clearInterval(keepAlive);
  });
  
  // Handle reconnection attempts
  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`Client ${socket.id} reconnection attempt ${attemptNumber}`);
  });
  
  console.log('[io] connection', socket.id);
  
  // Initialize speech-to-text for this socket
  speechToText.createRecognizeStream(socket.id);
  speechToText.bindSocketToStream(socket.id, socket);

    // Handle audio data from client
  socket.on('audioData', (data) => {
    try {
      speechToText.processAudio(socket.id, data);
    } catch (error) {
      console.error('Error processing audio data:', error);
    }
  });
  
  // Handle transcript data from client (for debugging)
  socket.on('transcript', (data) => {
    console.log(`Transcript from ${socket.id}:`, data);
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    speechToText.cleanup(socket.id);
    console.log('[io] disconnect', socket.id);
    // Inform the remaining peer (if any) that the other side left.
    socket.to(DEFAULT_ROOM).emit('peer_disconnected');
  });

  // Each new connection attempts to join the default room immediately.
  socket.on('join', () => {
    const size = getRoomSize(DEFAULT_ROOM);
    console.log('[io] join requested', { socketId: socket.id, currentSize: size });

    if (size >= 2) {
      // Room is full for a 1:1 session.
      console.log('[io] room_full for', socket.id);
      socket.emit('room_full');
      return;
    }

    socket.join(DEFAULT_ROOM);

    const newSize = getRoomSize(DEFAULT_ROOM);
    console.log('[io] joined room', { socketId: socket.id, newSize });
    socket.emit('joined', { room: DEFAULT_ROOM, peers: newSize });

    if (newSize === 2) {
      // Notify both peers that the room is ready to start negotiation.
      console.log('[io] room ready; initiating offer from', socket.id);
      io.to(DEFAULT_ROOM).emit('ready');
      // Designate the newly joined socket to start the offer.
      socket.emit('initiate');
    }
  });

  // Signaling relays. We keep event names explicit for clarity.
  socket.on('signal:offer', (payload) => {
    console.log('[io] relay offer from', socket.id);
    socket.to(DEFAULT_ROOM).emit('signal:offer', payload);
  });

  socket.on('signal:answer', (payload) => {
    console.log('[io] relay answer from', socket.id);
    socket.to(DEFAULT_ROOM).emit('signal:answer', payload);
  });

  socket.on('signal:ice-candidate', (payload) => {
    console.log('[io] relay ice-candidate from', socket.id);
    socket.to(DEFAULT_ROOM).emit('signal:ice-candidate', payload);
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

