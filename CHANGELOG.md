# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] — 2026-03-05

### Added
- `CONTRIBUTING.md` — branch naming, commit style, PR guidelines
- `CHANGELOG.md` — this file
- `SECURITY.md` — security vulnerability reporting policy
- `STRUCTURE.md` — annotated folder map for the entire repo
- `tandem-app/.env.example` — safe template for all environment variables
- Minimal smoke test at `tandem-app/test/smoke.test.js`

### Changed
- Moved `tandem-app/speech-to-text.js` → `tandem-app/server/speechToText.js`
- Moved `tandem-app/asl_api.py` + `asl_server.py` → `tandem-app/server/`
- Updated `tandem-app/server.js` `require` paths to match new layout
- Fixed duplicate `socket.on('disconnect')` handlers in `server.js` (merged into one)
- Removed duplicate `showPillToast()` from `deaf.js` (already defined in `script.js`)
- Fixed `tandem-app/requirements.txt`: added `flask-cors`, `numpy`; removed unused `flask-sockets`, `gevent`, `gevent-websocket`
- Normalized indentation in `server/textToSpeech.js` (4-space → 2-space)
- Rewrote root `README.md` — replaced raw link dump with project overview
- Rewrote `tandem-app/README.md` — correct entry-points, troubleshooting table
- Updated `.gitignore` — added `node_modules/`, `*.p`, `*.pickle`, `model.json`, `venv/` patterns

### Removed
- `chat-vid/` — superseded prototype directory
- Root-level `package-lock.json` and `requirements.txt` (both empty/stale)
- All `.DS_Store` files
- Stopped tracking large binary model files from git (`asl/model.p`, `asl/model.json`, `asl/data.pickle`)

---

## Previous work (pre-cleanup, undocumented)

- Implemented WebRTC peer-to-peer video calling (Node.js + Socket.IO)
- Added Google Cloud Speech-to-Text streaming for hearing user captions
- Added Google Cloud Text-to-Speech for ASL-to-audio conversion
- Integrated MediaPipe hand tracking in the browser for ASL recognition
- Added signing avatar via [pose-viewer](https://sign.mt/) web component
- Implemented `SigningQueue` to prevent mid-sign interruptions
- Added sentence-buffering on server to merge rapid STT partial results
- Added TURN server configuration for cross-network WebRTC
