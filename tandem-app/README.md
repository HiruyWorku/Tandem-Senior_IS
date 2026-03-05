# Tandem — Bridging Deaf and Hearing Communities

A unified video conferencing app that enables real-time communication between deaf and hearing individuals using ASL recognition, a signing avatar, and Google Cloud speech services.

## Features

- **Deaf User**: Signs via webcam → ASL letters recognised by ML model → text sent to hearing peer → spoken aloud by TTS
- **Hearing User**: Speaks normally → speech-to-text captions → signing avatar shows what was said to the deaf user
- **WebRTC P2P video** with STUN/TURN fallback for cross-network calls
- **Sentence buffering** on the server merges rapid partial transcripts before signing begins

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js 18+, Express 4, Socket.IO 4 |
| Speech-to-Text | Google Cloud STT (streaming) |
| Text-to-Speech | Google Cloud TTS (WaveNet MP3) |
| ASL ML API | Python 3.8+, Flask, scikit-learn Random Forest |
| Hand tracking | MediaPipe Hands (browser, via CDN) |
| Signing avatar | [pose-viewer](https://sign.mt/) web component |
| WebRTC | Native browser APIs + TURN server |

## Prerequisites

- **Node.js 18+** — https://nodejs.org
- **Python 3.8+** — https://python.org
- **Google Cloud project** with Speech-to-Text and Text-to-Speech APIs enabled
- A GCP service account key JSON file (download from GCP Console → IAM → Service Accounts)
- Webcam and microphone

## Setup

### 1. Clone and install Node dependencies
```bash
git clone <repo-url>
cd tandem-app
npm install
```

### 2. Install Python dependencies
```bash
pip install -r requirements.txt
```

### 3. Configure environment variables
```bash
cp .env.example .env
```
Edit `.env` and set:
- `GOOGLE_APPLICATION_CREDENTIALS` — absolute path to your GCP service account JSON
- `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` — your TURN server details (optional for LAN testing)

### 4. Ensure the ASL model is present
The trained model file `asl/model.p` is **not committed to git** (it's 98 MB).  
Options:
- Download it from your team's cloud storage and place at `tandem-app/asl/model.p`
- Re-train it by running the pipeline in `ASL-interpreter/scripts/`

## Running

### One command (recommended)
```bash
npm run start:all
```
This starts both the Node.js server (`:3000`) and the Python ASL API (`:5003`) concurrently.

### Two terminals
```bash
# Terminal 1 — Node.js server
npm start

# Terminal 2 — Python ASL prediction API
python server/asl_api.py
```

> **Optional:** `server/asl_server.py` provides a webcam MJPEG stream (`:5001`) used for debugging; it is not required for the main app.

## Usage

1. Open **http://localhost:3000**
2. Open the same URL in a second browser tab or window
3. One tab → **Deaf or Hard of Hearing User**; other tab → **Hearing User**
4. The video call connects automatically when both users have joined

## Project Structure

See [`STRUCTURE.md`](../STRUCTURE.md) for a full folder map.

```
tandem-app/
├── server.js              # Entry point: Express + Socket.IO server
├── server/
│   ├── speechToText.js    # Google Cloud STT streaming service
│   ├── textToSpeech.js    # Google Cloud TTS synthesis service
│   ├── poseProxy.js       # Proxy for sign.mt pose API
│   ├── asl_api.py         # Flask ASL prediction API (port 5003)  ← PRIMARY
│   └── asl_server.py      # Flask webcam MJPEG stream (port 5001) ← optional
├── public/
│   ├── index.html         # Landing / user-type selection page
│   ├── deaf.html + deaf.js       # Deaf user interface
│   ├── hearing.html + hearing.js # Hearing user interface
│   ├── script.js          # Shared WebRTC + audio logic
│   ├── avatar.js          # Signing avatar (pose-viewer)
│   └── style.css / avatar.css
├── asl/
│   ├── model.p            # Trained Random Forest model (gitignored — download separately)
│   ├── data.pickle        # Training dataset (gitignored)
│   └── labels_dict.py     # ASL label mappings
├── .env                   # Real secrets (gitignored — never commit)
├── .env.example           # Safe template to copy from
└── requirements.txt       # Python dependencies
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `Error: Could not load the default credentials` | Set `GOOGLE_APPLICATION_CREDENTIALS` in `.env` to the path of your service account JSON |
| ASL predictions not working | Make sure `python server/asl_api.py` is running and `asl/model.p` exists |
| Video call doesn't connect across networks | Configure `TURN_*` env vars with a real TURN server |
| `npm run start:all` exits immediately | Check that both `node server.js` and `python server/asl_api.py` work individually |
| Camera/mic permission denied | Open the page over HTTPS or `localhost` — browsers block getUserMedia on plain HTTP |

## License

MIT — see [LICENSE](../LICENSE)
