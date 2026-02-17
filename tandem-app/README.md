# Tandem - Bridging Deaf and Hearing Communities

A unified video conferencing application that connects deaf and hearing individuals through real-time ASL recognition and signing avatars.

## Features

- **User Selection**: Choose to join as a Deaf user or Hearing user
- **Deaf User View**: 
  - ASL recognition from your webcam
  - Live video of the remote user
  - Signing avatar that shows what the hearing person is saying
- **Hearing User View**:
  - Live video of yourself and the remote user
  - Signing avatar that shows what the deaf user is signing
  - Speech-to-text captions

## Prerequisites

- Node.js (v14+)
- Python 3.8+
- Google Cloud account with Speech-to-Text API (for hearing user captions)
- Webcam and microphone

## Installation

1. Install Node.js dependencies:
   ```bash
   cd tandem-app
   npm install
   ```

2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Configure environment variables:
   - Copy `.env.example` to `.env` and add your Google Cloud credentials
   - For Speech-to-Text, set `GOOGLE_APPLICATION_CREDENTIALS` to your service account JSON file

## Running the Application

You need to run both servers:

### Terminal 1 - Express Server (Video Calling)
```bash
cd tandem-app
npm start
```
This starts the main server on http://localhost:3000

### Terminal 2 - ASL Recognition Server
```bash
cd tandem-app
python asl_server.py
```
This starts the ASL recognition server on http://localhost:5001

## Usage

1. Open http://localhost:3000 in your browser
2. Choose your user type:
   - **Deaf User**: Select this if you're deaf and want to communicate using ASL
   - **Hearing User**: Select this if you're hearing and want to communicate using speech
3. Open the same URL in a second browser/window and select the opposite user type
4. The video call will automatically connect

## Project Structure

```
tandem-app/
├── server.js              # Main Express + Socket.IO server
├── asl_server.py          # Flask server for ASL recognition
├── public/
│   ├── index.html         # Landing page with user selection
│   ├── deaf.html          # Deaf user interface
│   ├── hearing.html       # Hearing user interface
│   ├── script.js          # Shared WebRTC logic
│   ├── deaf.js            # Deaf-specific ASL recognition
│   └── hearing.js        # Hearing-specific logic
├── asl/
│   ├── model.p            # Trained ASL classifier
│   ├── labels_dict.py     # Label mappings
│   └── data.pickle        # Training data
└── package.json
```

## How It Works

1. **Video Calling**: Uses WebRTC for peer-to-peer video/audio
2. **ASL Recognition**: Uses MediaPipe for hand tracking + Random Forest classifier
3. **Signing Avatar**: Uses the Sign MT API to convert text to ASL animations
4. **Speech-to-Text**: Uses Google Cloud Speech-to-Text for captions

## License

MIT
