# Repository Structure

```
Tandem-Senior_IS-/
│
├── tandem-app/                  ← PRIMARY APPLICATION (run this)
│   ├── server.js                  Entry point: Express 4 + Socket.IO 4
│   ├── package.json               Node deps + npm scripts
│   ├── requirements.txt           Python deps for the ASL API
│   ├── .env.example               Safe template for environment variables
│   │
│   ├── server/                    All server-side modules
│   │   ├── speechToText.js          Google Cloud STT streaming service
│   │   ├── textToSpeech.js          Google Cloud TTS MP3 synthesis
│   │   ├── poseProxy.js             Proxy for sign.mt /pose endpoint
│   │   ├── asl_api.py               Flask ASL prediction API  (port 5003) ← PRIMARY
│   │   └── asl_server.py            Flask webcam MJPEG debug stream (port 5001, optional)
│   │
│   ├── public/                    Static files served to the browser
│   │   ├── index.html               Landing page (user-type selection)
│   │   ├── deaf.html                Deaf user view (ASL camera + avatar)
│   │   ├── hearing.html             Hearing user view (captions + avatar)
│   │   ├── script.js                Shared WebRTC + audio processing logic
│   │   ├── deaf.js                  Deaf-specific: MediaPipe hand tracking + ASL API calls
│   │   ├── hearing.js               Hearing-specific: TTS voice + ASL display
│   │   ├── avatar.js                Signing avatar (pose-viewer web component)
│   │   ├── style.css                Global styles
│   │   └── avatar.css               Avatar panel styles
│   │
│   └── asl/                       ML model artefacts (NOT tracked in git)
│       ├── model.p                  Trained Random Forest classifier (98 MB — download separately)
│       ├── data.pickle              Training dataset (9 MB — gitignored)
│       ├── model.json               Alternative model export (66 MB — gitignored)
│       └── labels_dict.py           ASL character label mappings
│
├── ASL-interpreter/             ← TRAINING PIPELINE (reference / research)
│   ├── scripts/
│   │   ├── 01_collect_imgs.py       Collect training images via webcam
│   │   ├── 02_create_dataset.py     Extract MediaPipe landmarks → pickle
│   │   ├── 03_train_classifier.py   Train a Random Forest and save model.p
│   │   └── 04_inference_classifier.py  Run live inference for testing
│   ├── app.py                     Simple Flask web demo for the classifier
│   ├── inference_classifier.py    Standalone inference script
│   ├── labels_dict.py             ASL label mappings
│   ├── model.p                    Trained model (gitignored — large binary)
│   ├── data.pickle                Training data (gitignored — large binary)
│   └── requirements.txt           Python deps for the training pipeline
│
├── .gitignore                   Repo-wide gitignore (Node, Python, secrets, binaries)
├── README.md                    Mono-repo overview + quick start
├── LICENSE                      MIT
├── CONTRIBUTING.md              How to contribute
├── CHANGELOG.md                 Version history
├── SECURITY.md                  Security policy
└── STRUCTURE.md                 ← This file
```

## Key Design Decisions

- **`server/` directory**: All server-side Node.js modules (`speechToText.js`, `textToSpeech.js`, `poseProxy.js`) and Python services (`asl_api.py`) live here, separate from the top-level `server.js` entry point.
- **`public/` is fully static**: No build step — the browser loads raw HTML, CSS, and JS directly.
- **Model files are gitignored**: `*.p`, `*.pickle`, `model.json` are too large for git. Store them in cloud storage and document the download step.
- **One `npm run start:all`**: Uses `concurrently` to start both Node.js and the Python ASL API in a single terminal.
