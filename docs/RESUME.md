# Resume on 2026-10-06

Owner requested an overnight pause after Google live-caption validation and asked for all project changes to be pushed to GitHub.

## Current checkpoint

- Project: `project-af454814-40f3-4eb7-9f9`, zone `us-central1-a`.
- App: `tandem-staging`, e2-small, reserved IP `34.27.182.54`.
- Relay: existing `turn-server`, e2-micro, reserved IP `34.30.255.171`.
- Staging URL: https://tandem-34-27-182-54.sslip.io.
- Both VMs were stopped overnight, then restarted on 2026-10-06 at the owner's request. Reserved addresses stayed unchanged. Automatic startup fetched runtime secrets and brought both containers back healthy; public HTTPS and forced TURN delivery passed again. Both VMs are currently running, so normal compute/usage charges have resumed.
- Local Node preview was terminated; browser tests finished and no local test containers were running.
- Caption configuration: ENABLE_SPEECH=true, ENABLE_SPEECH_OUTPUT=false, MAX_CAPTION_STREAMS=2. ASL and avatar remain off.
- Dedicated VM identity has Cloud Speech Client and access only to its own runtime secret. No downloaded key or populated runtime.env is committed.
- Real Google final-caption delivery and pause passed using a public audio fixture; aggregate caption streams, sockets and rooms returned to zero after the test. All 59 server tests and two relevant caption browser regressions passed. Earlier full browser suite passed 19 journeys before the caption-only flag change.
- The pushed checkpoint's GitHub Actions run passed: https://github.com/HiruyWorku/Tandem-Senior_IS/actions/runs/37372093743.
- Owner confirmed phone/laptop connection across Wi-Fi and cellular, then reported that real-microphone captions worked fine using Chrome on Mac for the Deaf role and Safari on phone for the hearing role. This is a successful manual pairing check, not measured latency/accuracy or complete browser coverage.
- Legacy ASL source and existing local edits were preserved as normal parent-repository files, replacing the broken gitlink. Models, environments and caches are excluded; upstream attribution is in ASL-interpreter/UPSTREAM.md.

## Restart when work resumes

```sh
gcloud compute instances start turn-server tandem-staging \
  --zone=us-central1-a --project=project-af454814-40f3-4eb7-9f9
```

The app's enabled systemd service fetches its Secret Manager runtime configuration and starts Compose. Verify HTTPS health and container readiness with the staging harnesses. Accumulate owner checks in [MANUAL_TEST_CHECKLIST.md](MANUAL_TEST_CHECKLIST.md) for a later batch; the owner requested uninterrupted engineering rather than individual test requests.

Recognition uses V1 latest_long. Published no-data-logging rate after the account free allowance is $0.024 per audio minute; concurrency limits do not cap monthly spending. Existing project data-logging enrollment remains to be checked. See deploy/staging/README.md for deployment details and rollback resources.

Next work: real-user caption accuracy/latency; long-call recognition rotation and TURN renewal; mobile/Safari/Firefox testing; restricted-network TURN/TLS; privacy/billing/abuse controls; owned production domain and user evaluation. Do not claim production readiness from the staging smoke checks.

## Current test preparation

Core smoke checks keep synthetic microphone audio out of paid recognition. Caption smoke checks use only one paid microphone; optional `--rotation` mode checks final-caption delivery after the scheduled 270-second stream replacement. `--recovery` mode interrupts the speaking browser's transport while its context is offline, then checks reconnection, preserved live local tracks, peer video, fresh final captions and draft delivery. Tests report counts/timings only and close the browser on completion/failure.

Both modes passed against the real Google provider on 2026-10-06: rotation at 270001 ms, 57 final results by the post-rotation check, largest final-result gap 5025 ms with a repeating approximately 4.8-second fixture. Recovery passed with a new socket, unchanged live local track IDs, peer video, a new peer final caption, a retained unsent draft and successful typed delivery. Pause was acknowledged locally and by the peer. This is one actual recognition rotation and a controlled browser-offline/transport interruption; it does not prove hour-long TURN renewal, physical Wi-Fi/cellular handoff or arbitrary outage resilience.

Post-test aggregate metrics confirmed one server rotation, zero provider retries/unavailable events, and zero remaining sockets, rooms or caption streams. Both VMs remain running for continued staging work.

## Caption cost controls and dependency patch

Staging now configures a 900-second recognition session deadline and a 15-second incoming-PCM idle cutoff. Provider rotation/retry cannot extend the session deadline; automatic pause destroys the provider stream and replay audio, and requires deliberate Start captions. Video/text continue. Silence still sends PCM and is billable; restarting/reconnecting creates a fresh binding. These are session safeguards, not a monthly spending cap.

Updated proxy-addr from 2.0.7 to 2.0.8 for [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h). The app uses numeric proxy-hop trust rather than the advisory's affected subnet configuration. Docker builds now fail on high/critical production dependency audit findings. All 63 server tests and 20 Chrome browser journeys pass; the rebuilt staging image reports zero dependency vulnerabilities.

Real Google idle cutoff and deliberate restart passed with fresh peer final captions and typed delivery during automatic pause. Aggregate metrics confirmed one limit event, one provider retry during deliberately withheld PCM, no unavailable event, and zero remaining sockets/rooms/recognizers. The redeployed HTTPS/private invitation/text/forced TURN smoke checks also pass. Session expiry uses deterministic and accelerated browser tests to avoid an unnecessary paid 15-minute fixture run. Both VMs remain running.

## Bounded admission checkpoint

Staging now sets MAX_CONNECTIONS=20 and UNJOINED_TIMEOUT_SECONDS=30. Middleware reserves namespace admission before concurrent registration, and closes connections without a call room. Separate raw transport cleanup runs before Socket.IO's graceful polling timeout so abandoned polling clients release resources. Active callers remain connected, including one caller waiting for a partner. Initial transport checks and existing quotas provide early rejection; transient simultaneous handshakes are not a hard network-level connection cap.

Server-busy namespace rejection retries after a short randomized delay while keeping the current page draft. Server-triggered disconnect also retries; page exit cancels pending retries. All 70 server tests and 22 Chrome browser journeys pass. Desktop/mobile busy-state captures and detector pass. A fresh production dependency audit reports zero vulnerabilities. Prior checkpoint CI passed: https://github.com/HiruyWorku/Tandem-Senior_IS/actions/runs/37488670320.

Pre-admission rollback resources: `tandem-staging-app:before-admission-limits` and `compose.before-admission-limits.yaml`. Manual checks, including busy-state draft recovery, remain accumulated for the owner's later batch.

The public staging admission harness passed: 20 clients connected, an extra client was rejected, unjoined clients closed, two admitted callers remained connected and exchanged text, and replacement admission succeeded. No microphone audio was sent. HTTPS/private invitation/text/forced TURN smoke checks also passed after rollout.

Aggregate metrics confirmed one rejected connection, 18 idle closures, zero started recognition streams, and zero remaining sockets/rooms/caption streams after the checks.

## 2026-10-07: application release tooling

Owner deferred device testing until tonight and requested continued development. Pending checks remain in the cumulative checklist; no additional owner test was required for this operational change.

Added `package-source.py` and a locked `release.py` command. Source archives exclude local runtime settings/secrets and retained release files. Releases use unique image tags, fresh dependency auditing, startup validation with actual Compose configuration and aggregate idle checks. APP_IMAGE is atomically pinned in the owner-only `.env`; failed activation restores and verifies the prior image. Configuration/IAM/secret rollback is outside this command's scope, and single-instance restarts still interrupt service briefly.

All 71 server tests pass, including six Python release scenarios using simulated command failures. Prior checkpoint GitHub CI passed: https://github.com/HiruyWorku/Tandem-Senior_IS/actions/runs/37491039909.

Actual staging release succeeded: `tandem-staging-app:release-20261007-deployment-check`; preserved rollback image `tandem-staging-app:rollback-18e3f87612eb4ac9ac815201d4ad7c86`. Candidate audit/startup validation, selected-image verification and readiness passed. Both existing VMs remain running; no new infrastructure was added.

Post-release HTTPS/private invitation/typed reply/forced TURN delivery smoke checks passed. The source archive was checked to exclude runtime `.env`, `runtime.env`, Python caches and bytecode. Evening owner checklist is unchanged.

## 2026-10-07: authenticated socket admission

Private Socket.IO connections now supply the fragment invitation through `auth.token`, verify it before namespace capacity reservation, and bind the socket to that invitation's room. Joining independently rechecks room and expiry. Invalid credentials receive a terminal error; rejected underlying transports close within one second. Reconnect rejection retains the draft and closes the old peer connection. Socket handshake quotas now follow the same configured proxy trust as HTTP requests; forwarded-header spoofing and caller separation are covered with zero/one trusted hops.

All 74 server tests and 24 Chrome journeys passed, followed by both scoped desktop/mobile expired-reconnect checks after cleanup refinement. Prior release CI passed: https://github.com/HiruyWorku/Tandem-Senior_IS/actions/runs/37660451090.

Deployed `tandem-staging-app:release-20261007-socket-auth`; retained prior image as `tandem-staging-app:rollback-68876f9e60544bc98326d67ed893d196`. Fresh audit, candidate startup, selected image and readiness passed. Public checks passed for anonymous socket rejection, private invitation/text, forced TURN, short real Google final captions/pause, and authenticated 20-client admission/overflow/unjoined cleanup/replacement. Aggregate metrics returned to zero sockets, rooms and recognizers, with one recognition start and no provider retry/unavailable event. Both VMs remain running; no infrastructure was added.

The owner explicitly requested continued development through the remaining release work. Firefox/WebKit automation and an hour-long real TURN credential-renewal check are next independent verification tasks. Real-device and user-evaluation gates remain accumulated in the manual checklist.

All 25 Chrome and 50 Firefox/WebKit journeys passed, including a new audio-context suspension/resume journey. Fixed WebKit's caption retry cancellation by the replacement context's intermediate suspended state, retaining recognizer cleanup on a later interruption. Compatibility artifacts have a separate ignored directory after a harness collision. Linux CI required a virtual audio output for Firefox; the full three-engine run passed after adding PulseAudio: https://github.com/HiruyWorku/Tandem-Senior_IS/actions/runs/37671364174. The obsolete Chromium-install run was canceled.

The first real relay-renewal attempt ended after roughly 35 minutes with connection replacement/disconnection, before expiry. App container start time remained 18:02:52 UTC with restart count zero. Mac sleep/wake events around 14:57–15:00 EDT coincide with the interruption. The harness now records sanitized socket/peer events and rejects connection replacement. Rerun with `caffeinate -i node deploy/staging/relay-renewal-smoke.cjs <origin>` on Mac; keep captions disabled and do not deploy while it runs. Do not record a renewal pass from the interrupted attempt.

## In-call media recovery

Implemented persistent camera/microphone errors with retry, independent admission while permission is pending, sender-track replacement, capture restart and signing-preview recovery. Retains drafts, sockets and mute/camera choices; stops old tracks and discards late grants after exit or invitation rejection. Controls bind once and expose pressed/disabled states. Connected text-only stages no longer show an indefinite peer-waiting spinner.

All 28 Chrome and 56 Firefox/WebKit journeys pass, followed by repeated/scoped recovery checks. Hardware-ended behavior is simulated by invoking the handler with an ended native track; physical permission/hardware/background checks remain in the owner batch. Desktop/mobile recovery states were inspected and final mobile wrapping passed overlap checks in all three engines. Static detector was degraded (missing parser modules), with incumbent font/easing findings; do not claim a complete mechanical contrast pass.

Released `tandem-staging-app:release-20261007-media-recovery`; retained prior image as `tandem-staging-app:rollback-3f44a850b88e495184a6c97d4be45862`. Candidate fresh audit/startup, selected image and readiness passed. Public private-call/typed reply/anonymous rejection/forced TURN checks and short real Google final-caption delivery/pause passed. An idle-protected long relay rerun is next; avoid deployment while it runs. Relay inspection confirms current listeners are UDP/TCP 3478, with no TLS listener yet. Device selection, bounded browser audio setup/resume and restricted-network/TURN TLS are remaining independent engineering tasks.
