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

## Bounded browser audio operations

Worklet loading, audio resume and context close now have deadlines. A hung browser audio backend offers caption retry, detaches the PCM graph and leaves call-owned tracks and typed communication intact. Retired resume operations cannot publish stale capture state, and a superseded start cannot replace a newer capture after delayed cleanup. All 78 server/unit tests pass, including four new hung-operation/concurrent-start cases. All 29 Chrome and 58 Firefox/WebKit journeys pass. These changes are not yet deployed while the real relay-renewal check is running.

Media checkpoint CI (37678986269) stopped during Playwright dependency installation: Azure's Ubuntu mirror timed out before browser tests ran. CI now pins Ubuntu 24.04, uses the official HTTPS Ubuntu archive in the runner's existing mirror list, and bounds apt retries/timeouts. The previous three-engine CI run passed; the new mirror setup still needs its own hosted run.

Current long relay check uses `caffeinate -i` and writes count-only progress to `/private/tmp/tandem-relay-renewal-20261007-protected.jsonl`. The harness waits for local and remote media after asynchronous permission/admission and rejects peer-connection replacement. Do not restart staging or coturn until it finishes; do not record renewal success before media/text pass beyond original credential expiry.

## Camera and microphone selection

Added Devices on both call pages, with an inline camera/microphone panel, labelled native selects, explicit application and Close/Escape focus restoration. Selections are page-only, use exact constraints and preserve the socket, draft and mute/camera choices. Failed acquisition leaves old tracks live; unavailable devices remain labeled rather than silently switching cameras. Discovery is bounded and late results cannot replace a reopened list. Expanded/recovery sidebars can scroll without hiding reply controls.

All 32 Chrome and 64 Firefox/WebKit journeys passed. Test device IDs map to native synthetic streams; actual hardware selection/unplugging remains M14. WebKit fixture methods are installed on a stable MediaDevices wrapper. Valid desktop/mobile captures passed a scoped fresh Impeccable finish review with disposition `ship`, no material fixes. Mobile capture scrolls top and waits decoded frames before photographing the offscreen-optimized preview. The detector remains degraded; no complete contrast assurance is claimed. DESIGN.md and `.impeccable/design.json` record the incumbent built identity and selector contract. This feature is not yet deployed while the relay check runs.

Hosted CI 37682076263 passed package installation and Chrome, then failed four Firefox caption-start journeys. The helper inspected the action immediately after room admission, before concurrent capture setup settled, missing Firefox's later required Start gesture. It now awaits completion of media setup before inspecting the action; affected local checks are running, and hosted verification is still required. Do not report this CI run as green.

## Browser-history recovery, caption startup and relay hardening

A cached-page return now revalidates the invitation before reacquiring media, reconnects the existing socket handlers and retains the current page draft, device choices, mute/camera settings and explicit caption pause. Generation guards discard retired permission/capture/negotiation work. The server-instance check has a five-second deadline. Browser journeys simulate persisted page transitions; actual browser history/background behavior remains an owner device check.

Fixed an actual AudioWorklet startup race discovered in hosted Firefox: a context could become running before the worklet node existed, recording an enabled state without delivering it to the processor. Enablement now requires an attached node, with a delayed-module regression test. Provider-retry fixtures also perform Firefox's required Start gesture. A server caption-control test now waits for the requested pause rather than consuming the initial join-ready event. All 82 server/unit tests pass. Full local Chrome passed 37 journeys before the final audio fix; affected Firefox audio/retry and private-restart checks passed afterward. Full local compatibility had 73/74 passes, with a Firefox restart timeout during host interruption; its scoped rerun passed. Hosted CI 37684519296 failed two Firefox caption checks before these fixes; a new hosted run is required.

The idle-protected relay run ended after 3141 seconds, before renewal. Both sockets closed; no renewal success is established. Mac power logs show clamshell sleep at 16:59:43 EDT adjacent to the final report at 16:59:38. Staging retained its 19:24:16 UTC container start time with zero restarts, and aggregate socket/room/caption counts returned to zero. Repeat renewal on a continuously awake host; do not infer a pass from the interrupted run.

Prepared TURN TLS installation now also rejects custom peer allow exceptions, denies private/link-local/metadata/loopback relay peers, disables TCP relay allocations and CLI, and applies eight allocations per credential / forty total, 500000 bytes/s per allocation and 10000000 bytes/s aggregate. Client ICE pools gather on demand rather than preallocating ten pools. These are operational capacity limits, not a monthly spending cap. A raw trusted-TLS security probe verifies authentication, public permission, five private permission rejections and TCP-allocation rejection without sending packets to private peers. RFC 5769 message-integrity and malformed-response tests pass. TLS/security changes are prepared, not yet activated.

TURN TLS activation succeeded on the existing VM: certificate valid through 2027-01-05, trusted local handshake, coturn active with TCP 443 and retained 3478 listeners. Certbot renewal dry-run passed; timer enabled. Added only tagged default-network TCP 80/443 firewall rule `tandem-turn-tls-web`. Runtime secret version 2 appends the TLS endpoint, preserving version 1; protected local temporary secret file removed. Public app rollout/security probes are still pending.

Added an explicit `[relay-renewal]` production-rebuild push opt-in job to the existing workflow. It follows normal checks, uses a standard continuously awake Ubuntu runner, fixed staging origin, synthetic low-bitrate media and disabled captions, with a 75-minute job timeout and count-only artifact. It does not run on routine pushes or pull requests. Repository visibility is public. Do not deploy/restart app or coturn while the relay job runs. The probe now records sanitized page visibility/cache lifecycle events.

Released `tandem-staging-app:release-20261007-browser-lifecycle-tls`; retained rollback image `tandem-staging-app:rollback-f8ca47c908f74632ba35eca2714ab012`. Fresh audit, candidate configuration, image selection and readiness passed. Hosted 82-test / 37-Chrome / 74-Firefox-WebKit verification passed: https://github.com/HiruyWorku/Tandem-Senior_IS/actions/runs/37695300538. Public core forced-relay and TLS-only forced-relay delivery passed. The raw probe verified trusted TLS, authentication, public permission, five private-peer denials and rejection of TCP relay allocations. The installed Certbot hook reloaded at 22:50:56 UTC inside a timestamped existing-allocation window from 22:50:41 to 22:51:11; the same TLS connection/allocation remained usable afterward. This reload reused the current certificate; actual future certificate replacement remains covered by simulated rollover tests and the renewal dry-run.

The short one-microphone real Google caption check passed after rollout: native AudioWorklet, binary Socket.IO PCM, final peer delivery and explicit local/peer pause. No long paid-caption test was repeated.

## Persistent daily caption allowance (local, not deployed)

Added an optional aggregate daily submitted-audio guard with a persistent, mode-600 UTC-day ledger. It reserves conservative 15-second blocks before provider requests/audio, counts retries and replay, retains unused credit and stops new submissions on exhaustion/storage failure. A local nonblocking writer lock and atomic flushed replacement protect reservations; corrupt/oversized/symlinked/missing previously observed ledgers and backward clocks fail closed. Explicit rollover/restart/rebind tests pass.

The existing caption status offers Check captions for allowance exhaustion/unavailable storage, preserving video/text and live local tracks; a manual check after UTC rollover resumes fresh capture. This new journey passed in Chrome, Firefox and WebKit. Protected metrics expose only aggregate allowance gauges/counters. Prepared staging defaults to 3600 seconds in a named volume; the owner's optional preference question is pending. No staging restart/configuration mutation is made while the long relay job runs.

Docker build/fresh dependency audit passed with zero reported vulnerabilities. Actual non-root read-only container writes to its named volume and a recreated container retains an exhausted allowance. Verification used disposable local test volume tandem-budget-verification-20261007, which was removed afterward. All 91 tests passed before the added actual-server allowance-metrics case, which passed in its scoped group. Full browser suites and hosted verification remain pending.

All 92 server/unit tests now pass, including protected actual-server allowance metrics. Full local Chrome had 37/38 passes: the new rollover fixture advanced its clock before a repeated Start acknowledgement completed, causing its next click to pause a newly recovered stream. Added completion/action-label barriers; eight repeated Chrome runs passed. Full compatibility had 75/76 passes: WebKit replaced a MediaDevices wrapper and the deferred-permission fixture never installed its release callback. Permission fixtures now pin the wrapper, and three repetitions of four affected WebKit journeys passed. An explicit pending-permission callback/no-stream barrier was added afterward. Hosted full verification of this checkpoint remains required; do not report either earlier full run as all-green.

Hosted workflow 37698924881 passed the baseline verification job and started relay-renewal at 23:01:28 UTC. Its actual media phase and final expiry result still need confirmation. Keep cloud app/relay unchanged while that job runs.

The owner chose 60 aggregate audio minutes/day for staging. Prepared Compose's 3600-second default matches that choice; activate after the current long relay check and an idle guard. Hosted allowance CI passed all checks: https://github.com/HiruyWorku/Tandem-Senior_IS/actions/runs/37701127379 (92 server/unit tests, 38 Chrome and 76 Firefox/WebKit journeys).

## Explicit cloud caption start (local, not deployed)

Camera/microphone permission no longer enables cloud transcription. Each role starts captions explicitly; the header and an associated visible description explain that audio goes to Google. Consent remains page-only and survives reconnect/media recovery/cached-page return through the existing pause choice. Video/text work before transcription and no recognizer is opened. The local speech overlay/sidebar now follow actual caption state rather than a fixed 2.5-second timer; pause clears transient captions but keeps already displayed conversation history.

Affected caption/audio/recovery checks passed across Chrome, Firefox and WebKit. Desktop/mobile captures and header overlap checks passed; the short-desktop reply-scroll check passed. All 39 Chrome journeys passed before the diagnostic refinement; full 78-engine compatibility is still running. Fixed browser diagnostics omit native peer objects, socket/room identifiers and raw RTC/provider exceptions. A malformed signaling journey verifies its private marker is absent from console output and typed communication survives. Latest full hosted verification is still required.

The long hosted relay media phase started at 23:02:19 UTC. An aggregate read confirmed the unchanged app image/container start, two sockets, one room and zero recognizers. No cloud mutations were performed after the probe began.

The 78-journey local Firefox/WebKit suite finished all-green. Latest diagnostic refinement's Chrome malformed-signaling case passed; the same case is now checking the other engines. origin now uses the repository's canonical URL, https://github.com/HiruyWorku/Tandem-Senior_IS.git. Read-only TURN IAP SSH succeeded, and installed coturn matches the current Ubuntu candidate package. Public administrative-port hardening can now be scoped to the TURN VM after the long relay run; do not alter global legacy firewall rules.

## 2026-10-08: hosted failure diagnosis

Hosted workflow 37705618935 passed server tests and all 40 Chrome journeys, then failed one Firefox mobile recovery assertion. The retained trace shows the microphone unmute handler ran, but the next camera click did not reach its handler while the caption header changed. The fixture now waits for caption recovery and the microphone pressed state before the next native camera click. Ten unmodified local repeats and six repeats with the barrier passed; full hosted verification is still required. The staging caption smoke also waits for capture setup and the visible explicit Start choice after admission.

Hosted relay workflow 37698924881 failed at 3590 seconds, before original expiry, with two consecutive aggregate RTP-counter comparisons reporting no progress. Both sockets and peer connections remained connected and both credentials renewed. One inbound counter dropped from roughly 10 MB to 61 KB after restart; this report does not establish whether displayed video stopped. A short real-credential restart diagnostic passed video/text/tracks without modifying server TTL or enabling captions. It does not establish actual expiry continuity. The probe now compares RTP counters by report identity and independently requires displayed-frame progression; tests cover replacement/disappearance and genuine transport/decoder stalls. Failure artifacts include a sanitized reason and frame counts.

Read-only TURN inspection found a pending kernel reboot, active coturn/google guest/osconfig agents, and no project IAM bindings for its attached default service account. No global IAM/firewall changes or VM restarts were made. The owner-approved 3600-second daily caption guard and explicit cloud-caption choice remain prepared, not deployed.

Recovery checkpoint CI passed all 94 server, 40 Chrome and 80 Firefox/WebKit checks: https://github.com/HiruyWorku/Tandem-Senior_IS/actions/runs/37787210002. Stronger displayed-frame checks subsequently confirmed a frozen short-relay attempt despite connected transports; another attempt passed. Do not dismiss the original relay failure as counter reset alone. The client now uses argument-free setLocalDescription for offer/answer selection, following the W3C perfect-negotiation example's race guidance. A short actual-relay diagnostic with that local client override passed both presented-video counters, credential replacement, text and unchanged tracks. It is not an expiry result or proof that the intermittent stall is resolved.

The local renewal journey now verifies moving video before and after restarts. WebKit's two-call same-browser synthetic-camera fixture yielded only one received frame before renewal; independent browser processes restore moving video for both callers. The strengthened independent-camera journey passed WebKit, Chrome and Firefox. A full compatibility run encountered an unsupported explicit Firefox camera permission in the new fixture; removed that option for Firefox and the affected rerun passed. Full hosted verification of the final changes is still required.

Scoped administrative firewall rules were activated after the short relay probe finished: tandem-turn-admin-iap (priority 800, IAP range TCP 22) and tandem-turn-admin-deny-public (priority 900, public TCP 22/3389). Inventory confirmed only turn-server carries the target tag. IAP SSH and active coturn were verified before and after; global legacy rules remain untouched. TLS relay delivery verification is in progress. No VM reboot has occurred yet.

Latest negotiation checkpoint CI passed 94 server, 40 Chrome and 80 Firefox/WebKit checks: https://github.com/HiruyWorku/Tandem-Senior_IS/actions/runs/37789167650. Full local Chrome passed all 40; local compatibility passed 79/80 before correcting the unsupported Firefox fixture permission, followed by the affected Firefox pass. Do not represent that earlier compatibility run as all-green.

Idle TURN reboot activated kernel 6.8.0-1070-gcp. IAP SSH, coturn and certbot.timer are active; reboot-required is false. The first connection attempt occurred during boot and failed; the retry succeeded. Public trusted TLS authentication, five private-peer denials and TCP-allocation rejection passed. A security probe initially lacked sandbox network access and passed with approved network access.

Deployed tandem-staging-app:release-20261008-caption-budget-negotiation using source archive SHA256 403ebf8a9f30fd3053586b630d9b1eaf390b9473a1c96412324c96251367e403. Retained rollback image tandem-staging-app:rollback-1962615c91fb44cf80a628bb916d2700. Fresh audit, candidate startup, exact image and readiness passed. This activates explicit per-microphone cloud captions, the owner-approved 3600-second persistent daily guard, private browser diagnostics and atomic negotiation. Protected metrics confirmed limit 3600, reserved 15, remaining 3585, valid ledger and zero sockets/rooms/caption streams after tests.

Public TLS-only relay, private admission/text and the short one-microphone real Google final-caption/pause checks passed. The first concurrent default relay probe delivered text but failed its raw candidate-stat assertion; an unchanged rerun passed. No exact candidate details survived that first failure. The probe now selects the transport's actual pair first and reports only candidate-type enums on assertion failure. The full hour-long expiry check remains required; no successful expiry result is established yet. Owner physical tests remain accumulated in the updated checklist.

The refined default relay probe passed. Pushed checkpoint 6d176e62 opts into the long hosted relay test. Workflow 37792694914 passed baseline verification and is running actual continuous media; keep app/coturn unchanged until completion. The new probe checks displayed frames as well as RTP progress, preserves local track/peer identities, records fixed failure reasons and count-only playback state, and disables captions.

Added a credential-free health/certificate canary and separate lightweight GitHub workflow. It checks readiness, anonymous access rejection and trusted app/relay certificates (seven-day threshold), with bounded HTTP bodies/network deadlines and count-only fixed diagnostics. Four failure-oriented tests pass, including malformed/oversized bodies, unsafe redirects, untrusted/near-expiry certificates, hung TLS cleanup and private-error omission. Actual read-only staging probe passed all six checks: app certificate 87 days and relay certificate 89 days remaining. Hosted push verification is pending; hourly scheduling will not activate until merged into main. No notifications or new infrastructure were configured. This does not establish media/provider health or notification delivery.

Hosted canary workflow 37796055580 passed. Checkpoint 57125c00 also passed full application workflow 37796055441: 98 server, 40 Chrome and 80 Firefox/WebKit checks. Hourly scheduling remains inactive on this development branch.

Prepared optional-feature hardening stops pose requests when both signing-viewer loaders fail, shows a readable desktop/mobile fallback and preserves typed replies. Recognition/viewer failures omit raw private exceptions from diagnostics. Browser signing requests now use authenticated POST JSON; legacy GET is rejected when the provider is enabled. The upstream signing service still receives query text, so its privacy and logging decisions remain a release gate. ASL and avatars remain disabled in staging; this change is not deployed while the hour-long relay test runs.

The new failure journey passed in Chrome, Firefox and WebKit, including missing viewers, private exception omission, POST body validation and continued typed communication. Desktop/mobile confirmation captures show aligned fallback text and accessible controls without horizontal overflow. All 98 server tests passed. An earlier scoped test run failed the capacity replacement fixture because room departure preceded transport teardown; the fixture now waits for both events before opening a replacement connection. Hosted verification of the new 41 Chrome / 82 compatibility journeys remains required.

Prepared recognition boundary now accepts only an A–Z prediction, finite 0–1 confidence and supported model version from a JSON response of at most 1024 bytes. It rejects redirects, normalizes backend errors, cancels oversized/failed streams and retains the three-second deadline through response-body reads. Fixed aggregate recognition-failure telemetry omits provider details. Four new tests verify safe-field projection, invalid responses/private errors, cancellation and an actual stalled local HTTP body. All 102 server tests pass; no external recognition provider was called and staging remains unchanged.

Prepared signing lifecycle now interrupts on peer departure, socket disconnect, invitation rejection and page exit. Interruption aborts pending fetches, clears queued work/viewer URLs, removes completion listeners and invalidates stale timer callbacks. A native browser journey deliberately resolves an aborted old-peer request after a replacement joins: it cannot render or submit the old queued text, while a new-peer request renders and clears on departure. The journey passes Chrome, Firefox and WebKit; the earlier optional-failure journey also passes all three after this change. Its first Chrome run used an overlong invalid fixture room code; shortening that fixture restored valid admission. No cloud deployment occurred while workflow 37792694914 remained active. Latest full hosted verification is required.

Pushed provider-boundary and lifecycle checkpoints e8c154b1, ba7d7395 and 59b10073. Their hosted workflows 37799965068, 37800334713 and 37800797735 remain in progress at 15:27 UTC; do not claim completion yet. Prepared source-only archive /private/tmp/tandem-staging-source-20261008-provider-boundaries.tar.gz has SHA256 fe87c2e4ba94e9272222d31a73b158472626610b2b13d6a1a1b6c0a6352f3bb4, containing app source through 59b10073. Local candidate tandem-app:verify-20261008-provider-boundaries builds successfully; a fresh uncached audit reports zero vulnerabilities and non-root/read-only production startup passes with synthetic configuration and paid providers disabled. No cloud upload or rollout yet. Relay workflow 37792694914 remains active; expected media completion is about 15:40 UTC. Verify terminal status/artifact and latest CI before guarded deployment. An owner first-public-release scope question is pending; physical tests remain deferred in the cumulative checklist.

At 15:36 UTC, all three hosted code checkpoints passed: 37799965068 (98 server/41 Chrome/82 compatibility), 37800334713 (102/41/82), 37800797735 (102/42/84). The read-only staging health/certificate canary remains green. Read-only VM disk inspection found 13 GB available and retained images; no pruning, resizing or cloud mutation occurred.

Prepared an opt-in TLS media-capacity harness for 1–10 simultaneous two-person calls. It bounds browser lifetime to three minutes, disables all paid/experimental providers, caps video at 24000 bits/s per peer, requires moving displayed frames/live tracks/unchanged peers and tests both text directions in each room over three samples. Fixed failure phase/count output cannot reveal invitation arguments; invalid-target/count/privacy checks pass. Full 103 server tests passed before the final fixed-phase refinement, followed by its scoped test pass. Live media verification remains pending. The new `[media-capacity]` hosted opt-in checks ten calls after CI and shares the continuous-relay concurrency lock so the probes cannot overlap. Do not deploy during either live media step. No additional infrastructure was created.
