# Staging deployment

Deployed on 2026-10-05 in project `project-af454814-40f3-4eb7-9f9`, following owner approval of the small-VM plan. URL: https://tandem-34-27-182-54.sslip.io. Owner confirmed a phone/laptop connection across Wi-Fi and cellular. Live captions are enabled for the next evaluation; paid text-to-speech, experimental ASL, and avatar remain disabled.

The existing `turn-server` e2-micro VM in us-central1-a uses reserved IPv4 34.30.255.171. With separate owner approval, coturn was migrated from static users to shared-secret authentication, preserving a root-only configuration backup. Its relay range is 49160–49200. Public/private mapping is explicitly 34.30.255.171/10.128.0.2 with relay-ip=10.128.0.2. No additional TURN VM was created. TURN TLS and restricted-network coverage remain release gates.

The new `tandem-staging` e2-small app VM in us-central1-a has a 20 GiB pd-standard boot disk and reserved IPv4 34.27.182.54 (`tandem-staging-ip`). Docker Compose runs Node and pinned Caddy 2.11.6 (2.11.7's Docker tag was unavailable during deployment). The app port and Caddy admin port are not published. Public metrics are blocked by the proxy. The app uses one explicitly trusted proxy hop; edge per-client limits remain a deployment gate.

The app is isolated from the legacy default network in VPC `tandem-staging`, subnet `tandem-staging-us-central1` (10.42.0.0/24). Public ingress permits TCP 80/443 only for tag tandem-staging; administrative TCP 22 permits IAP range 35.235.240.0/20. Existing TURN firewall rules were unchanged. No database, Redis, Kubernetes, artifact registry repository, or load balancer was added.

## Configuration

On the app VM, copy `.env.example` to `.env` and replace APP_HOST with the new app IPv4-derived temporary staging hostname, for example `tandem-<new-ip-with-hyphens>.sslip.io`. Verify public DNS resolution, certificate issuance and browser secure-context access before enabling calls. Third-party wildcard DNS is a temporary staging dependency, not a production domain ownership mechanism. Use a real owned domain before public release.

`refresh-runtime.py` retrieves the combined `tandem-staging-runtime` secret via the attached VM identity and atomically replaces owner-only `runtime.env`. The dedicated tandem-staging service account has secretAccessor on that secret only and project-level Cloud Speech Client for caption testing, with no downloaded key. `tandem-staging.service` fetches the secret before startup and starts healthy containers. To apply a new secret version, restart that service; changing a TURN secret also requires coordinated coturn rotation. Docker restart policies restore containers after process failure; systemd is enabled for boot. Secrets are never printed by the scripts.

Core TLS/admission/relay checks passed. `.env` now sets ENABLE_SPEECH=true using the VM's dedicated service account identity. Compose explicitly disables ENABLE_SPEECH_OUTPUT and overrides MAX_CAPTION_STREAMS to 2, allowing captions without paid synthesis and at most two simultaneous recognition streams. The stored runtime secret's previous concurrency value is overridden. Pausing captions or leaving stops that participant's stream; silence is still billable while audio is sent. No downloaded Google JSON key is supported.

For V1 latest_long at published no-data-logging rates, after the account-level free allowance, recognition costs $0.024/audio minute (approximately $1.44/microphone-hour). Two active microphones double the audio usage. We did not enable data-logging enrollment; existing project enrollment must still be checked in Google Cloud's Speech settings. The concurrency setting limits simultaneous use, not daily/monthly spending. Check billing and keep test sessions short. [Pricing](https://cloud.google.com/speech-to-text/pricing?authuser=0), [data logging](https://docs.cloud.google.com/speech-to-text/docs/v1/data-logging).

Files are installed under `/opt/tandem/tandem-app`. Initial setup runs `sudo bash deploy/staging/install.sh` on the Ubuntu 24.04 VM. From the staging directory, administrative checks are:

```sh
# Validate without printing resolved secrets:
sudo docker compose --project-directory /opt/tandem/tandem-app/deploy/staging -f /opt/tandem/tandem-app/deploy/staging/compose.yaml config --quiet
sudo docker compose --project-directory /opt/tandem/tandem-app/deploy/staging -f /opt/tandem/tandem-app/deploy/staging/compose.yaml ps
sudo systemctl restart tandem-staging
```

The local Node preflight checks hostname, secret independence/length/placeholder/interpolation safety, file permissions, and production room/TURN/monitoring configuration. It passed before provisioning. The image built for linux/amd64 locally and on the VM; read-only container health and pinned Caddy configuration validation passed. HTTPS health/readiness, rejected anonymous ICE access, blocked public metrics, private invitation admission and typed replies passed against the real deployment. Installed dependency audit reported zero vulnerabilities. The Docker build context is allowlisted; credentials, datasets and node_modules are excluded.

Forced TURN delivery passed after correcting the public/private mapping: both selected candidates were relay candidates and the received data matched the sent payload. Run `node deploy/staging/smoke.cjs https://tandem-34-27-182-54.sslip.io` from tandem-app with installed Chrome to check the public deployment and forced TURN data delivery. This is a short synthetic test, not separate-device video or long-call acceptance. The small VM reported approximately 1.3 GiB available RAM and 15 GiB free disk after deployment.

An actual systemd restart passed: runtime configuration was fetched again through the VM identity, both containers returned healthy/running, and public HTTPS health returned 200. Generated local secret inputs were removed after successful bootstrap; Secret Manager and the owner-only runtime file are the maintained copies. The TURN VM retains a root-only configuration copy with its shared secret, as required by coturn.

Caption validation also passed with the real Google provider and a short public Brooklyn Bridge speech sample: Chrome's fake microphone fed AudioWorklet PCM through Socket.IO, Google returned a final transcript, and the peer displayed it. Pause was acknowledged locally and by the peer. `captions-smoke.cjs` runs this check with an explicitly supplied WAV fixture; use `node deploy/staging/captions-smoke.cjs <staging-https-url> <public-sample.wav>`. Include a silence interval after the fixture's speech so finalization can be checked. All 59 server tests and the two relevant caption browser regressions pass. This does not establish real-user accuracy or long-call continuity.

The pre-caption image is retained as `tandem-staging-app:before-captions`, with `compose.before-captions.yaml` and `.env.before-captions` on the VM. To disable paid recognition immediately, set ENABLE_SPEECH=false in the root-owned staging `.env` and restart tandem-staging. Full code rollback requires restoring the retained image/configuration, not rebuilding from the updated source tree.

## Approval scope and cost

Owner approved the app VM/disk/IP, scoped identity/IAM, Secret Manager API/secret, app-only network/firewalls and initial deployment. They separately approved migrating the existing TURN server to shared-secret authentication to avoid an additional relay VM. Neither approval authorizes deleting the existing relay.

Estimate dated 2026-10-05, 730 hours/month, on-demand Iowa pricing, no discounts/free-tier credits:

| Additional item | Estimated monthly baseline |
| --- | ---: |
| e2-small app VM, $0.016752855/hour | $12.23 |
| App external IPv4, $0.005/hour | $3.65 |
| 20 GiB standard boot disk allowance | $1–2 |
| Planning range | $17–20 |

Speech/TTS usage, outbound traffic/relay bandwidth, Secret Manager/monitoring usage, taxes and the existing TURN VM costs are additional. This is a baseline estimate, not a spending cap. Confirm the actual disk/region price in the provisioning estimate. Billing alerts do not automatically stop spending. No commitment contracts or extra TURN VM are proposed.

Sources: [Compute pricing](https://cloud.google.com/products/compute/pricing/general-purpose), [IPv4/network pricing](https://cloud.google.com/vpc/network-pricing), [disk pricing](https://cloud.google.com/compute/disks-image-pricing), [temporary DNS provider](https://nip.io/), [Caddy HTTPS](https://caddyserver.com/docs/automatic-https).

Before declaring staging ready, complete the real-provider/network acceptance matrix in ../../../../docs/OPERATIONS.md. Retain a rollback to the previous application image; rollback does not undo secrets or unrelated relay changes. Stopping the app VM still leaves disk and reserved-IP charges; cleanup must explicitly address all approved resources.
