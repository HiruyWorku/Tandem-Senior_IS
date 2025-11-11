# Video Chat with Live Captions

A real-time video chat application with live speech-to-text captions powered by Google Cloud Speech-to-Text API.

## Features

- Real-time video and audio calling
- Live captions for both local and remote participants
- Toggle camera and microphone on/off
- Responsive design that works on desktop and mobile

## Prerequisites

1. Node.js (v14 or later)
2. npm (comes with Node.js)
3. Google Cloud account with Speech-to-Text API enabled
4. Google Cloud service account key (JSON file)

## Setup Instructions

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd chat_vid
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Google Cloud credentials**
   - Enable the Speech-to-Text API in your Google Cloud Console
   - Create a service account and download the JSON key file
   - Rename the key file to `service-account-key.json` and place it in the project root
   - Or update the `.env` file with the correct path to your key file

4. **Configure environment variables**
   - Copy `.env.example` to `.env`
   - Update the environment variables in `.env` with your configuration

5. **Start the server**
   ```bash
   npm start
   ```

6. **Open the application**
   - Open your browser and navigate to `http://localhost:3000`
   - Open another browser window/tab and navigate to the same URL to start a video call

## Usage

1. **Starting a call**
   - Open the application in two different browser windows/tabs or on different devices
   - The application will automatically connect the two participants

2. **Controlling the call**
   - Click the microphone icon to mute/unmute your audio
   - Click the camera icon to turn your video on/off

3. **Viewing captions**
   - Live captions will appear below each participant's video
   - Your own captions will be shown in green
   - The other participant's captions will be shown in blue

## Environment Variables

- `PORT`: Port to run the server on (default: 3000)
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to your Google Cloud service account key file
- `LANGUAGE_CODE`: Language code for speech recognition (default: 'en-US')
- `TURN_URLS`: Comma-separated list of TURN server URLs (optional)
- `TURN_USERNAME`: TURN server username (if using TURN)
- `TURN_CREDENTIAL`: TURN server credential (if using TURN)

## Troubleshooting

- If you see "Permission denied" errors, make sure your Google Cloud service account has the necessary permissions
- If captions aren't working, check the browser console for any errors
- Make sure your microphone has the necessary permissions in your browser

## License

MIT
