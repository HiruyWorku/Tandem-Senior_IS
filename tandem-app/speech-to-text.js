// speech-to-text.js
const speech = require('@google-cloud/speech');
const { Writable } = require('stream');

class SpeechToTextService {
  constructor() {
    this.client = new speech.SpeechClient();
    this.recognizeStreams = new Map();
    this.STREAM_TIMEOUT = 4.5 * 60 * 1000; // 4.5 minutes (before the 5-minute limit)
  }

  /**
   * Create a streaming recognizer for a socket connection
   */
  createRecognizeStream(socketId, languageCode = 'en-US') {
    console.log(`Creating recognize stream for socket ${socketId}`);
    
    // Clean up any existing stream for this socket
    this.cleanup(socketId);
    
    // Create a new stream info object
    const streamInfo = {
      stream: null,
      socket: null,
      restartTimer: null,
      languageCode: languageCode,
      lastRestart: Date.now()
    };
    
    this.recognizeStreams.set(socketId, streamInfo);
    
    // Setup restart timer
    const setupRestartTimer = () => {
      if (streamInfo.restartTimer) {
        clearTimeout(streamInfo.restartTimer);
      }
      
      streamInfo.restartTimer = setTimeout(() => {
        console.log(`Restarting speech recognition for socket ${socketId} to prevent timeout`);
        this.createRecognizeStream(socketId, languageCode);
      }, this.STREAM_TIMEOUT);
    };
    
    const request = {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 48000,
        languageCode: languageCode,
        model: 'latest_long',
        useEnhanced: true,
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        metadata: {
          interactionType: 'DISCUSSION',
          microphoneDistance: 'NEARFIELD',
          recordingDeviceType: 'SMARTPHONE',
          originalMediaType: 'AUDIO',
        },
        speechContexts: [{
          phrases: [
            'WebRTC', 'video', 'chat', 'microphone', 'camera', 'speaker', 'connection',
            'Hello', 'Hi', 'Hey', 'How are you', 'Can you hear me', 'Thanks', 'Bye'
          ],
          boost: 20.0
        }]
      },
      interimResults: true, // Get interim results
      singleUtterance: false
    };

    const recognizeStream = this.client
      .streamingRecognize(request);
      
    // Store the stream in our stream info
    streamInfo.stream = recognizeStream;
    
    // Set up event handlers
    recognizeStream
      .on('error', (err) => {
        console.error('Error in speech recognition stream:', {
          error: err.message,
          code: err.code,
          details: err.details,
          socketId: socketId
        });
        
        // Try to recover by creating a new stream
        try {
          console.log('Attempting to recover speech recognition stream...');
          this.createRecognizeStream(socketId, languageCode);
        } catch (recoveryError) {
          console.error('Failed to recover speech recognition stream:', recoveryError);
          this.cleanup(socketId);
        }
      })
      .on('data', (data) => {
        // Reset the restart timer on each data event
        setupRestartTimer();
        try {
          const result = data.results[0];
          
          // Only process if we have a valid result with alternatives
          if (!result || !result.alternatives || result.alternatives.length === 0) {
            return;
          }
          
          const isFinal = result.isFinal;
          const transcript = result.alternatives[0].transcript || '';
          const stability = result.stability;
          
          // Log the transcript
          console.log(`[${isFinal ? 'FINAL' : 'INTERIM'}] ${transcript}`, { 
            stability,
            confidence: result.alternatives[0].confidence
          });
          
          // Get the socket and emit the transcript
          const socket = this.recognizeStreams.get(socketId)?.socket;
          if (socket) {
            socket.emit('transcript', { 
              transcript, 
              isFinal,
              stability,
              confidence: result.alternatives[0].confidence
            });
          }
          
          // If this is a final result, we can optionally do something with it
          if (isFinal) {
            console.log('Final transcript:', transcript);
          }
        } catch (error) {
          console.error('Error processing speech recognition result:', error);
        }
      })
      .on('end', () => {
        console.log(`Speech recognition stream ended for socket ${socketId}`);
        // Optionally create a new stream if needed
        // this.createRecognizeStream(socketId, languageCode);
      });

    this.recognizeStreams.set(socketId, {
      stream: recognizeStream,
      socket: null, // Will be set when binding to socket
    });

    return recognizeStream;
  }

  /**
   * Bind a socket to a recognize stream
   */
  bindSocketToStream(socketId, socket) {
    const streamInfo = this.recognizeStreams.get(socketId);
    if (streamInfo) {
      streamInfo.socket = socket;
      
      // Clean up on socket disconnect
      socket.on('disconnect', () => {
        console.log(`Client ${socketId} disconnected, cleaning up speech recognition`);
        this.cleanup(socketId);
      });
    } else {
      // If no stream exists yet, create one
      this.createRecognizeStream(socketId);
      this.recognizeStreams.get(socketId).socket = socket;
      this.recognizeStreams.get(socketId).socket.on('disconnect', () => {
        console.log(`Client ${socketId} disconnected, cleaning up speech recognition`);
        this.cleanup(socketId);
      });
    }
  }

  /**
   * Process audio data
   */
  processAudio(socketId, data) {
    const streamInfo = this.recognizeStreams.get(socketId);
    if (!streamInfo || !streamInfo.stream || !streamInfo.stream.writable) {
      console.error(`No valid stream found for socket ${socketId}`);
      return;
    }

    try {
      // If we received a buffer array, convert it back to a Buffer
      let audioBuffer;
      if (Array.isArray(data.buffer)) {
        audioBuffer = Buffer.from(Int16Array.from(data.buffer).buffer);
      } else if (data.buffer && data.buffer.type === 'Buffer') {
        audioBuffer = Buffer.from(data.buffer.data);
      } else if (Buffer.isBuffer(data.buffer)) {
        audioBuffer = data.buffer;
      } else if (data.buffer) {
        audioBuffer = Buffer.from(data.buffer);
      } else {
        console.error('Invalid audio data format:', data);
        return;
      }

      // Write the audio data to the recognition stream
      if (audioBuffer && audioBuffer.length > 0) {
        streamInfo.stream.write(audioBuffer);
      }

      // If this is the final chunk, end the stream
      if (data.isFinal) {
        console.log('Received final audio chunk, ending stream');
        streamInfo.stream.end();
      }
    } catch (error) {
      console.error('Error processing audio data:', error);
    }
  }

  /**
   * Clean up resources
   */
  cleanup(socketId) {
    const streamInfo = this.recognizeStreams.get(socketId);
    if (streamInfo) {
      // Clear any pending restart timer
      if (streamInfo.restartTimer) {
        clearTimeout(streamInfo.restartTimer);
      }
      
      // Destroy the stream if it exists
      if (streamInfo.stream && !streamInfo.stream.destroyed) {
        try {
          streamInfo.stream.destroy();
        } catch (err) {
          console.error('Error destroying stream:', err);
        }
      }
      
      // Remove from the map
      this.recognizeStreams.delete(socketId);
      console.log(`Cleaned up speech recognition for socket ${socketId}`);
    }
  }
}

module.exports = new SpeechToTextService();
