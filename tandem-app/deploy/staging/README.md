# Staging deployment

Deployed on 2026-10-05 in project `project-af454814-40f3-4eb7-9f9`, following owner approval of the small-VM plan. URL: https://tandem-34-27-182-54.sslip.io. Owner confirmed a phone/laptop connection across Wi-Fi and cellular. Live captions are enabled for the next evaluation; paid text-to-speech, experimental ASL, and avatar remain disabled.

The existing `turn-server` e2-micro VM in us-central1-a uses reserved IPv4 34.30.255.171. With separate owner approval, coturn was migrated from static users to shared-secret authentication, preserving a root-only configuration backup. Its relay range is 49160–49200. Public/private mapping is explicitly 34.30.255.171/10.128.0.2 with relay-ip=10.128.0.2. No additional TURN VM was created. TURN TLS and restricted-network coverage remain release gates.

### TURN TLS activation

`turn-tls.py` was activated on the existing Ubuntu 22.04 coturn 4.5.2 VM on 2026-10-07. Trusted TLS is listening on `tandem-turn-34-30-255-171.sslip.io:443`; Certbot renewal dry-run passed and its timer is enabled. The application runtime secret has a new version 2 appending TLS; version 1 is retained for configuration rollback. Application release `release-20261007-browser-lifecycle-tls`, core and TLS-only relay delivery, public security probes and an existing-allocation check across the installed reload hook passed. It preserves shared-secret authentication, the UDP/TCP 3478 listener and relay range. Initial installation adds TLS on TCP 443, protected certificate revisions, a bind capability/reload systemd drop-in, a root-only prior configuration and a Certbot deploy hook. Run initial activation only on idle staging because it restarts coturn. Certificate renewal uses coturn's SIGUSR2 certificate reload and verifies the actual trusted certificate served locally; failed activation restores and verifies prior service/certificate state. Failed recovery is reported explicitly, with protected backups retained.

Before activation, issue a trusted certificate for a DNS hostname resolving to the relay's reserved IPv4. A temporary IP-derived sslip.io hostname can serve staging; owned DNS remains a production gate. Install Certbot on the existing VM and allow HTTP-01 TCP 80 to that relay only, plus TCP 443 for TLS. Standalone issuance needs port 80 free; the existing coturn listener must remain on 3478. Use a Certbot lineage directly under `/etc/letsencrypt/live`, then run:

```sh
sudo python3 turn-tls.py --hostname <relay-hostname> --lineage /etc/letsencrypt/live/<certificate-name>
sudo certbot renew --dry-run
```

Only add `turns:<relay-hostname>:443?transport=tcp` to the application's TURN_URLS after trusted TLS activation passes; preserve existing TURN URLs and the shared secret. Reload runtime configuration on idle app staging, then run `node deploy/staging/smoke.cjs <https-origin> --tls`. This mode filters to TURN TLS endpoints and requires a relay allocation/data delivery with temporary credentials. It does not prove traversal of arbitrary corporate proxies. Test on an actually restricted network separately. The eight simulated TLS installation/renewal failure cases are included in `npm test`; they do not replace certificate issuance, real reload/allocation checks or restricted-network device testing.

The prepared configuration denies private, loopback, link-local and metadata peer addresses and rejects existing allow exceptions that would override those denials. It disables RFC 6062 TCP relay allocations (TCP/TLS client transport still carries UDP WebRTC relay traffic), multicast and the CLI. Limits are eight allocations per credential, forty total, 500000 bytes/s per allocation and 10000000 bytes/s aggregate. The browser uses on-demand ICE gathering to avoid unused preallocations. These bound capacity rather than monthly charges.

After runtime URLs are updated, run `node deploy/staging/turn-security-smoke.cjs <https-origin>` to check trusted TLS, temporary credential authentication, a public peer permission, rejection of five private peer permissions and rejection of TCP relay allocation. This probe requests permissions only; it sends no payload to private endpoints. Protocol tests include the RFC 5769 integrity vector. Optional `--reload-window` holds an authenticated allocation for 30 seconds and timestamps it; run the installed certificate hook during that interval and compare timestamps before claiming continuity. This check passed with the existing certificate on 2026-10-07.

Coturn's installed-version reload behavior is documented in its [4.5.2 source](https://github.com/coturn/coturn/blob/4.5.2/src/apps/relay/mainrelay.c); Certbot standalone and deployment hooks are covered by the [Certbot guide](https://eff-certbot.readthedocs.io/en/stable/using.html).

The new `tandem-staging` e2-small app VM in us-central1-a has a 20 GiB pd-standard boot disk and reserved IPv4 34.27.182.54 (`tandem-staging-ip`). Docker Compose runs Node and pinned Caddy 2.11.6 (2.11.7's Docker tag was unavailable during deployment). The app port and Caddy admin port are not published. Public metrics are blocked by the proxy. The app uses one explicitly trusted proxy hop; edge per-client limits remain a deployment gate.

The app is isolated from the legacy default network in VPC `tandem-staging`, subnet `tandem-staging-us-central1` (10.42.0.0/24). Public ingress permits TCP 80/443 only for tag tandem-staging; administrative TCP 22 permits IAP range 35.235.240.0/20. Existing TURN firewall rules were unchanged. No database, Redis, Kubernetes, artifact registry repository, or load balancer was added.

## Configuration

Private Socket.IO clients must provide the signed invitation as `auth.token` when connecting, then send the same invitation with the room join. Invitations are carried in the link fragment and protocol payloads, never URL query credentials. Connections without a valid invitation are rejected before namespace admission and their transports are reclaimed. A socket cannot use another invitation to switch rooms. Existing browser pages must reload after the socket-authentication rollout. Expired reconnects retain the local draft and require a new invitation.

On the app VM, copy `.env.example` to `.env` and replace APP_HOST with the new app IPv4-derived temporary staging hostname, for example `tandem-<new-ip-with-hyphens>.sslip.io`. Verify public DNS resolution, certificate issuance and browser secure-context access before enabling calls. Third-party wildcard DNS is a temporary staging dependency, not a production domain ownership mechanism. Use a real owned domain before public release.

`refresh-runtime.py` retrieves the combined `tandem-staging-runtime` secret via the attached VM identity and atomically replaces owner-only `runtime.env`. The dedicated tandem-staging service account has secretAccessor on that secret only and project-level Cloud Speech Client for caption testing, with no downloaded key. `tandem-staging.service` fetches the secret before startup and starts healthy containers. To apply a new secret version, restart that service; changing a TURN secret also requires coordinated coturn rotation. Docker restart policies restore containers after process failure; systemd is enabled for boot. Secrets are never printed by the scripts.

Core TLS/admission/relay checks passed. `.env` now sets ENABLE_SPEECH=true using the VM's dedicated service account identity. Compose explicitly disables ENABLE_SPEECH_OUTPUT and overrides MAX_CAPTION_STREAMS to 2, allowing captions without paid synthesis and at most two simultaneous recognition streams. CAPTION_MAX_SESSION_SECONDS=900 and CAPTION_IDLE_SECONDS=15 auto-pause a capture session after 15 minutes, or 15 seconds without incoming PCM. Rotation and provider retry do not extend its deadline. The existing Start captions action deliberately opens a fresh binding; video/text remain usable. Reconnects also create a fresh binding. Idle means missing PCM packets; silent microphone audio remains billable while sent. These are per-session controls, not a monthly spending cap. No downloaded Google JSON key is supported.

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

`node deploy/staging/relay-renewal-smoke.cjs <https-origin>` runs the actual browser call with relay-only candidates through the original TURN expiry plus 45 seconds. It disables caption/speech-output capabilities in the test contexts, mutes synthetic audio, and caps each video sender to 24 kbit/s and 5 fps. It checks credential extension, selected relay candidates, unchanged live local tracks, advancing inbound bytes/decoded frames and periodic typed replies. Output contains only counts/timings, never invitations, credentials or conversation data. Expect about one hour with the current 3600-second TTL; TTLs requiring more than 75 minutes abort. Do not deploy or stop VMs while it runs. This controlled check does not establish restricted-network, mobile backgrounding or arbitrary outage behavior.

An actual systemd restart passed: runtime configuration was fetched again through the VM identity, both containers returned healthy/running, and public HTTPS health returned 200. Generated local secret inputs were removed after successful bootstrap; Secret Manager and the owner-only runtime file are the maintained copies. The TURN VM retains a root-only configuration copy with its shared secret, as required by coturn.

On Mac, wrap the hour-long check in `caffeinate -i node deploy/staging/relay-renewal-smoke.cjs <https-origin>` to prevent idle sleep while the process runs. The first attempt stopped before expiry after local sleep/wake and connection interruption; it is not a renewal pass. The harness reports sanitized socket/peer event history and rejects peer-connection replacement during this continuous-call check. `caffeinate` does not establish physical network-handoff resilience or prevent every externally requested/lid-triggered sleep.

Caption validation also passed with the real Google provider and a short public Brooklyn Bridge speech sample: Chrome's fake microphone fed AudioWorklet PCM through Socket.IO, Google returned a final transcript, and the peer displayed it. Pause was acknowledged locally and by the peer. `captions-smoke.cjs` runs this check with an explicitly supplied WAV fixture; use `node deploy/staging/captions-smoke.cjs <staging-https-url> <public-sample.wav>`. Include a silence interval after the fixture's speech so finalization can be checked. All 59 server tests and the two relevant caption browser regressions pass. This does not establish real-user accuracy or long-call continuity.

Caption smoke checks use only one paid microphone. Append `--rotation --recovery` to run for approximately five minutes, check a final result after the scheduled 270-second recognition replacement, then interrupt the speaker's transport while its browser context is offline. Recovery requires a new socket, preserved live local tracks, active peer video, fresh peer final captions, preserved draft and successful typed delivery. It reports counts/timings without transcript content. Core `smoke.cjs` overrides caption capability only in its synthetic browsers, so relay/admission testing does not start paid recognition.

Both extended modes passed against Google on 2026-10-06. Stream rotation occurred at 270001 ms; 57 finals had arrived by the post-rotation check, with largest final-result gap 5025 ms for the approximately 4.8-second repeating fixture. No provider retry/capacity error occurred during rotation. Recovery and pause checks passed. This validates one recognition rotation and a controlled offline/transport interruption, not physical radio handoff or hour-long TURN credential renewal. The owner also reported successful captions with Chrome on Mac (Deaf role) and Safari on phone (hearing role); wider supported-browser coverage remains outstanding.

The pre-caption image is retained as `tandem-staging-app:before-captions`, with `compose.before-captions.yaml` and `.env.before-captions` on the VM. To disable paid recognition immediately, set ENABLE_SPEECH=false in the root-owned staging `.env` and restart tandem-staging. Full code rollback requires restoring the retained image/configuration, not rebuilding from the updated source tree.

The image/configuration immediately before caption limits is retained as `tandem-staging-app:before-caption-limits` and `compose.before-caption-limits.yaml`. Owner-requested manual checks are accumulated in [the testing checklist](../../../../docs/MANUAL_TEST_CHECKLIST.md) for a later batch, rather than requested one by one.

On 2026-10-06, `--limits` passed against Google: suppressing outgoing PCM triggered the configured idle pause, typed delivery stayed available, and deliberate restart produced fresh peer final captions. The 15-minute deadline is covered by deterministic rotation/retry tests and an accelerated Chrome journey rather than a paid 15-minute fixture run. All 63 server tests and 20 browser journeys pass. The deployed proxy-addr dependency is 2.0.8; the image audit reports zero vulnerabilities and Docker builds reject high/critical production dependency findings.

Staging sets MAX_CONNECTIONS=20 and UNJOINED_TIMEOUT_SECONDS=30. Namespace admission reserves capacity before concurrent Socket.IO registration; extra clients are refused without evicting existing callers. Connections with no call room and raw transports with no namespace are closed after the configured interval, including polling clients that never request another response. Room members waiting for a partner remain connected. Namespace overload retries use a delayed browser retry while preserving the page draft. Initial transport count checks and existing handshake quotas add early rejection; simultaneous transport handshakes can temporarily exceed the preliminary count check, while namespace reservations remain bounded. See [operations](../../../../docs/OPERATIONS.md) for limits and deployment boundaries.

`node deploy/staging/admission-smoke.cjs <staging-https-url> 20` fills staging capacity temporarily, checks overflow rejection, awaits unjoined-client cleanup, and verifies that admitted callers still exchange text and a replacement can connect. It sends no microphone audio. Run on quiet staging; do not use it as a public-production load test. The pre-admission image and Compose configuration are retained as `tandem-staging-app:before-admission-limits` and `compose.before-admission-limits.yaml`.

This admission check and the core HTTPS/private invitation/text/forced TURN smoke check passed on 2026-10-06. All 70 server tests and 22 Chrome browser journeys pass, including desktop/mobile draft recovery from controlled namespace rejection. A fresh dependency audit reports zero vulnerabilities.

## Application releases

For an opt-in simultaneous media check, run `node deploy/staging/media-capacity-smoke.cjs https://<staging-host> 3` from tandem-app. Count must be 1–10; each call uses two clients and one newly minted invitation, so respect the invitation quota and existing callers. The harness forces TLS relay, disables all paid/experimental providers, caps video at 24000 bits/s per peer, and exchanges typed replies in both directions while requiring moving displayed video and unchanged peer connections. It samples three times at ten-second intervals after setup and closes the browser at a three-minute deadline. Output contains counts and fixed failure reasons only. This is a short synthetic capacity check, not a long-call, physical-device or all-transports load guarantee. Do not run it concurrently with the hour-long relay test. Live verification of this new harness is pending.

A push to production-rebuild whose head commit message includes `[media-capacity]` runs the ten-call version after full verification. It shares the live relay job's concurrency lock, preventing simultaneous probes, and retains a count-only artifact for seven days. Keep staging unchanged while either live media step runs. Routine commits skip this job.

Use `python3 tandem-app/deploy/staging/package-source.py /private/tmp/tandem-staging-source.tar.gz` from the repository root to prepare source. The packager excludes local `.env`, runtime secrets, release locks, prior Compose snapshots, caches and model artifacts. Upload the archive, verify its checksum and extract it under `/opt/tandem`; preserve the VM's existing `.env` and `runtime.env`. Installing source does not change the running container.

On idle staging, run:

```sh
sudo python3 /opt/tandem/tandem-app/deploy/staging/release.py \
  --image tandem-staging-app:release-<unique-identifier>
```

The release command holds a local lock and refuses reused tags. It checks authenticated aggregate metrics for connected clients before building and again before activation; if clients are connected or metrics cannot be checked, it postpones the release. It builds a uniquely tagged candidate, performs a fresh production dependency audit outside Docker's cached build layers, and validates startup with Compose's actual configuration without opening a listener or calling paid providers. Only then does it atomically pin APP_IMAGE in the owner-only `.env`, restart the service, verify the selected image, and check readiness.

If activation fails, it pins the exact previous image under a unique rollback tag, restarts and verifies readiness again. Failed rollback is reported explicitly with the retained recovery image. Audit/configuration failure leaves running settings untouched. Automated failure-path tests cover these cases; they simulate command failures rather than intentionally breaking a live Google VM.

This is an application-image release, not a rollback of Compose/source/IAM/secret changes. Review and separately preserve configuration changes. Runtime secrets continue to refresh through the VM identity. The single-instance restart has a brief interruption; idle checks are best-effort, not atomic draining or zero-downtime deployment. Retained image tags consume disk space: review them before pruning, and keep a verified recovery image. Use `install.sh` for initial installation, not routine updates.

The successful release path passed on staging on 2026-10-07, using `tandem-staging-app:release-20261007-deployment-check`. Audit, startup configuration, selected-image verification and readiness passed, followed by HTTPS/private invitation/text/forced TURN checks. The retained prior image is `tandem-staging-app:rollback-18e3f87612eb4ac9ac815201d4ad7c86`. All 71 server tests pass, including six simulated release failure/recovery scenarios.

## Persistent caption allowance (deployed 2026-10-08)

The owner approved 60 aggregate audio minutes per UTC day. The deployed Compose release defaults CAPTION_DAILY_SECONDS to 3600, configurable in the protected .env; 0 disables. A named caption_budget volume at /app/state retains a mode-600 aggregate ledger across releases/container recreation. The image initializes that directory for the non-root Node user; the rest of the container root remains read-only. Conservative 15-second reservations precede provider audio, counting retries/replay and retaining unused credit. Release release-20261008-caption-budget-negotiation activated the allowance. Protected metrics confirmed a 3600-second limit and a 15-second reservation after the short real-provider check; active sockets/rooms/recognizers returned to zero. Both roles now require an explicit Start captions choice before Google transcription.

Corrupt/unavailable/locked storage refuses new caption credit while video/text continue. Protected allowance gauges support monitoring. Preserve the volume and ledger during rollback; old images do not enforce the cap. Do not remove volumes during maintenance. See [operations](../../../../docs/OPERATIONS.md) for semantics and stale-lock recovery. This application audio allowance does not cap other Google Cloud charges.

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
