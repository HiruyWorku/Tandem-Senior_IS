# Security Policy

## Supported Versions

Tandem began as a senior capstone and is being rebuilt toward a production release on `production-rebuild`. Staging is for verification; the project does not yet claim production readiness. Follow [the current checkpoint](docs/RESUME.md) for the deployed version and outstanding release gates.

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not open a public GitHub issue**.

Instead, email the maintainer directly (hiruyworku00@gmail.com).
Please include:
- A description of the vulnerability
- Steps to reproduce it
- The potential impact
- Any suggested fixes (optional)

A response-time commitment has not been established for the rebuilt service. Include the affected revision and whether the issue was reproduced in staging; omit real conversations, invitation links and credentials from reports.

## Credential Policy

- **Never commit** `.env`, API keys, service account JSON files, or TURN credentials
- The `.gitignore` in this repo blocks `.env*` — do not override this
- Rotate any credentials immediately if they are accidentally committed
- Run `git log --all --full-diff -p -- '*.json' '*.env'` to audit past commits for leaked secrets

## Known Attack Surface

| Component | Risk | Mitigation |
|---|---|---|
| Private invitations | Anyone holding the complete link can join | Signed expiry and room binding, two-caller admission, origin checks and bounded quotas. Links do not verify a participant's identity. |
| `/api/predict` endpoint | Sends hand landmarks to an optional Python backend | Valid invitation, 63 bounded finite coordinates, per-IP quota, three-second deadline and a bounded validated letter/probability response. Disabled in staging. |
| `/pose` proxy | Sends conversation text to an external signing service | Authenticated POST, bounded text/languages, quota and deadline; fixed errors. The upstream service receives query text. Disabled in staging pending quality/privacy evaluation. |
| WebRTC TURN credentials | Temporary relay access can be shared or abused | Short-lived server-minted credentials, authenticated issuance and relay capacity/private-peer restrictions. Keep the shared signing secret server-side. |
| Google Cloud credentials and audio | Provider access and cloud processing of conversations | Explicit caption start, session/concurrency/daily limits, protected runtime secrets; provider enrollment and privacy decisions remain release gates. |
| Operational logs and browser traces | May expose bearer links or conversation content | Application diagnostics use fixed labels; configure infrastructure to redact headers, bodies and provider queries. Avoid traces from real conversations without a privacy policy and consent. |

These controls describe repository code. Consult the checkpoint before assuming every change has reached staging. The single-instance service has no durable account system, per-invitation revocation or distributed denial-of-service protection.
