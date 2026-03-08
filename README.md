# Tandem 

Tandem is a near-real-time video conferencing application that enables natural communication between Deaf or Hard of Hearing(DHH) and hearing individuals. A DHH user signs via webcam; the ML model recognises the ASL letter/gesture, converts it to text, and the hearing user hears it spoken aloud and vice versa, speech is captioned and rendered as a signing avatar.

view full wiki indexing here: https://deepwiki.com/HiruyWorku/Tandem-Senior_IS-/1-overview

---
<img width="1070" height="310" alt="newapi" src="https://github.com/user-attachments/assets/267fd84f-39ac-4fce-89a3-0b9af426db5a" />



## Sub-projects

| Folder | Purpose |
|---|---|
| [`tandem-app/`](tandem-app/) | The full application — run this |
| [`ASL-interpreter/`](ASL-interpreter/) | Standalone training pipeline (data collection, model training, inference scripts) |

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
- https://sign.mt/ - production signing translation service
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
