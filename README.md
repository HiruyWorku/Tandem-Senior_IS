# Tandem — Bridging Deaf and Hearing Communities

Tandem is a real-time video conferencing application that enables natural communication between deaf and hearing individuals. A deaf user signs via webcam; the ML model recognises the ASL letter/gesture, converts it to text, and the hearing user hears it spoken aloud — and vice versa, speech is captioned and rendered as a signing avatar.

---

## Sub-projects

| Folder | Status | Purpose |
|---|---|---|
| [`tandem-app/`](tandem-app/) | ✅ **Active** | The full application — run this |
| [`ASL-interpreter/`](ASL-interpreter/) | 📚 Reference | Standalone training pipeline (data collection, model training, inference scripts) |

> `chat-vid/` was a previous prototype and has been removed.

---

## Quick Start

See **[`tandem-app/README.md`](tandem-app/README.md)** for full setup instructions.

```bash
cd tandem-app
cp .env.example .env          # add your Google Cloud credentials
npm install
pip install -r requirements.txt
npm run start:all              # starts Node.js + Python ASL API together
```

Open **http://localhost:3000** — choose Deaf or Hearing to join a session.

---

## Research Resources

### Signing Avatar
- https://sign.mt/ — production signing translation service
- https://github.com/sign/translate
- https://github.com/aws-samples/genai-asl-avatar-generator

### ASL Recognition
- https://github.com/SomyanshAvasthi/Sign-Language-Detection-using-MediaPipe
- https://github.com/dxli94/WLASL
- https://github.com/laplaces42/sign-language-interpreter

### WebRTC Video Calling
- https://getstream.io/video/sdk/react/tutorial/video-calling/

---

## License

MIT — see [LICENSE](LICENSE)
