// server/textToSpeech.js
// Google Cloud TTS service — converts ASL prediction words to MP3 audio
// sent to the hearing peer over Socket.IO.
const textToSpeech = require('@google-cloud/text-to-speech');

const client = new textToSpeech.TextToSpeechClient();

/**
 * Convert text to speech and return a base64-encoded MP3 string.
 * Uses the same Google Cloud credentials already configured for STT
 * (GOOGLE_APPLICATION_CREDENTIALS env var).
 *
 * @param {string} text - The text to synthesize (e.g. an ASL prediction like "help")
 * @returns {Promise<string>} base64-encoded MP3 audio content
 */
async function synthesize(text) {
    const request = {
        input: { text },
        voice: {
            languageCode: 'en-US',
            ssmlGender: 'NEUTRAL',
            // Wavenet voices are higher quality; falls back gracefully if unavailable.
            name: 'en-US-Wavenet-D',
        },
        audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 1.0,
            pitch: 0.0,
        },
    };

    const [response] = await client.synthesizeSpeech(request);
    // response.audioContent is a Buffer; encode it for JSON transport over Socket.IO.
    return response.audioContent.toString('base64');
}

module.exports = { synthesize };
