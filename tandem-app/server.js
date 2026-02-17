const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const speechToText = require('./speech-to-text');
const poseProxy = require('./server/poseProxy');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  serveClient: true
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(poseProxy);

app.get('/health', (_req, res) => res.status(200).send('OK'));

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
  
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.json(iceServers);
});

const DEFAULT_ROOM = 'main-room';

function getRoomSize(roomName) {
  const room = io.sockets.adapter.rooms.get(roomName);
  return room ? room.size : 0;
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.conn.on('heartbeat', () => {
    socket.lastHeartbeat = Date.now();
  });
  
  socket.on('disconnect', (reason) => {
    console.log(`Client ${socket.id} disconnected:`, reason);
    if (socket.room) {
      socket.leave(socket.room);
    }
  });
  
  socket.on('error', (error) => {
    console.error(`Socket error from ${socket.id}:`, error);
  });
  
  const keepAlive = setInterval(() => {
    if (socket.connected) {
      socket.emit('ping');
    }
  }, 30000);
  
  socket.on('disconnect', () => {
    clearInterval(keepAlive);
  });
  
  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`Client ${socket.id} reconnection attempt ${attemptNumber}`);
  });

  speechToText.createRecognizeStream(socket.id);
  speechToText.bindSocketToStream(socket.id, socket);

  socket.on('audioData', (data) => {
    try {
      speechToText.processAudio(socket.id, data);
    } catch (error) {
      console.error('Error processing audio data:', error);
    }
  });

  socket.on('transcript', (data) => {
    console.log(`Transcript from ${socket.id}:`, data);
  });

  socket.on('disconnect', () => {
    speechToText.cleanup(socket.id);
    socket.to(DEFAULT_ROOM).emit('peer_disconnected');
  });

  socket.on('join', (userType) => {
    const size = getRoomSize(DEFAULT_ROOM);
    socket.userType = userType || 'hearing';
    console.log('[io] join requested', { socketId: socket.id, currentSize: size, userType: socket.userType });

    if (size >= 2) {
      socket.emit('room_full');
      return;
    }

    socket.join(DEFAULT_ROOM);
    const newSize = getRoomSize(DEFAULT_ROOM);
    socket.emit('joined', { room: DEFAULT_ROOM, peers: newSize, userType: socket.userType });

    if (newSize === 2) {
      io.to(DEFAULT_ROOM).emit('ready');
      socket.emit('initiate');
    }
  });

  socket.on('signal:offer', (payload) => {
    socket.to(DEFAULT_ROOM).emit('signal:offer', payload);
  });

  socket.on('signal:answer', (payload) => {
    socket.to(DEFAULT_ROOM).emit('signal:answer', payload);
  });

  socket.on('signal:ice-candidate', (payload) => {
    socket.to(DEFAULT_ROOM).emit('signal:ice-candidate', payload);
  });

  socket.on('aslPrediction', (data) => {
    socket.to(DEFAULT_ROOM).emit('aslPrediction', {
      prediction: data.prediction,
      isLocal: true
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
