# Security Policy

## Supported Versions

This project is an academic senior capstone. Only the `main` branch is actively maintained.

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not open a public GitHub issue**.

Instead, email the maintainer directly (hiruyworku00@gmail.com):


Please include:
- A description of the vulnerability
- Steps to reproduce it
- The potential impact
- Any suggested fixes (optional)

You can expect an acknowledgement within **48 hours** and a fix or mitigation plan within **7 days**.

## Credential Policy

- **Never commit** `.env`, API keys, service account JSON files, or TURN credentials
- The `.gitignore` in this repo blocks `.env*` — do not override this
- Rotate any credentials immediately if they are accidentally committed
- Run `git log --all --full-diff -p -- '*.json' '*.env'` to audit past commits for leaked secrets

## Known Attack Surface

| Component | Risk | Mitigation |
|---|---|---|
| `/api/predict` endpoint | Accepts arbitrary JSON from the browser | Input validated in `asl_api.py`; model only reads `features` array |
| `/pose` proxy | Forwards requests to sign.mt CDN | Validates `text` param is non-empty; no user data stored |
| WebRTC TURN credentials | In `.env` — could be harvested if committed | Gitignored; rotate periodically |
| Google Cloud credentials | Service account JSON — high-value secret | Gitignored; use least-privilege IAM roles |
