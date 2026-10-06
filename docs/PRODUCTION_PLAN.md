# Tandem production plan

Status: engineering baseline, 2026-10-05. This is a working plan, not a claim of production readiness.

## Product target

Default first release: reliable one-to-one calls between Deaf ASL users and hearing users, with live captions, typed replies, and optional speech output. Preserve direct signing video. Treat automated recognition and signing avatars as experimental until evaluated with fluent Deaf ASL users. Confirm audience and priorities with the owner; change this scope if needed.

ASL is a language with its own grammar, spatial structure, facial expressions, and movement. Classifying static hand letters and correcting their spelling does not establish continuous ASL understanding. More capable language models alone do not close that gap. The existing implementation should be described as fingerspelling assistance, with model-generated corrections visible for user review.

## Baseline findings

Inspected: application entry point, browser call flow, speech services, avatar queue, Python prediction API, feature extraction, deployment scripts, and existing tests. No live two-device call, credentialed cloud transcription, model accuracy evaluation, Docker build, or load test has been completed.

| Area | Observed issue | Priority / direction |
| --- | --- | --- |
| Caption delivery | Google results were sent to the local socket and then through a browser data channel; the server listened for a client transcript event that the browser never emitted. The server's final-result buffer was bypassed. | Fixed first: one server-owned forwarding path. |
| Speech lifecycle | Stream state overwritten after creation, restart bindings lost, timers reset on results instead of stream age, retries outlived disconnect, failure window reset on retry. | Fixed first: preserve participant state, rotate by stream age, bounded retry window, cancel cleanup. |
| Speech cost/input | Cloud streams opened before room admission; arbitrary audio arrays accepted. | Fixed first: lazy stream start, joined-user gate, bounded PCM chunks and sample rates. Still needs per-user throughput and account quotas. |
| Room membership | Original repeated joins and room switching were unsafe; roles/signaling were insufficiently validated. | Implemented bounded two-person admission, idempotent joins, explicit leave, role/signaling validation; tested with actual clients. Single-instance only. |
| Calls | Stale peer state, duplicate data-channel creation, ICE timing and media failures have limited recovery; initialization catches camera errors and continues. | Test on real browsers; replace negotiation state management if needed. |
| User communication | Original app lacked typed fallback and reviewed sending. | Implemented typed replies, bounded session retry deduplication, acknowledgements, draft preservation, and private recognition suggestions. |
| Recognition | Single-hand landmark classification plus motion heuristics, temporal votes, and LLM correction; no demonstrated signer-independent continuous-ASL accuracy. | Separate experimental track with consented data and an explicit benchmark. |
| Generated language | Original guesses were spoken automatically. | Recognition now produces private drafts. Explicit sending is required; speech is opt-in. Late work is dropped on departure and speech targets its original recipient. |
| Browser security | Original hearing view interpolated peer/model content into innerHTML. | Removed that rendering path. Replies use textContent; literal malicious markup is covered by server and browser tests. |
| Avatar | Third-party CDN and pose service; completion estimated with timers; no evidence of linguistic correctness. | Optional experiment, visible failure states, Deaf-user evaluation; never make caption delivery depend on it. |
| Runtime/deployment | Docker uses Node 18 while npm startup uses a newer env-file flag; model startup requires a legacy artifact; Python dependencies are unpinned; entrypoint uses curl without installing it. | Reproducible runtime, independent optional services, deployment integration tests. |
| Operations | Health endpoint only proves Node is alive; no graceful shutdown, actionable provider status, structured telemetry, cost limits, or release CI. | Add observability and operational release gates. |
| Tests | Initial suite had three smoke tests, including a copy of room-size logic rather than exercising room behavior. | Add behavior tests for protocols, failures, and actual browser journeys. |

## Engineering decisions

1. Do not rewrite the entire app before establishing reproducible behavior. Retain working pieces; replace components when their contracts or failure modes justify it.
2. Calls, captions, and typed communication must operate without ASL artifacts, Anthropic credentials, or the avatar provider.
3. Use one authoritative caption delivery path. Local provider results go to the speaker; the server forwards peer interim captions and buffers nearby finals.
4. Keep experimental perception separate from confirmed communication. Do not silently invent and speak a user's intended meaning.
5. Avoid choosing a new model or infrastructure vendor before defining quality, latency, privacy, and cost requirements. Measure candidates against those requirements.
6. Preserve existing local changes in the ASL-interpreter reference project.

## Delivery sequence and acceptance gates

### 1. Reliable server foundation

- Finish room admission, idempotent joins, role validation, disconnect cleanup, payload validation, and bounded provider calls.
- Boot and run calls without configured optional AI providers.
- Add typed messages and an explicit send/review contract for recognized text.
- Remove unsafe HTML insertion and conversation content from routine logs.
- Gate: automated tests exercise actual room and message behavior, malformed input, disconnected peers, expired work, and provider failure.

### 2. Reliable browser calling and captions

- Explicit device permission handling, join/leave lifecycle, network recovery, mute behavior, device selection, and readable caption history.
- AudioWorklet and binary PCM transport implemented; validate actual cloud transcription and long-call behavior.
- Decide P2P versus managed calling after a browser/network baseline; use expiring TURN credentials for public deployment.
- Gate: two-device calls across separate networks; Chrome/Safari/Firefox; reconnect, device denial, mute, 30-minute caption session, and provider outage all tested.

### 3. Useful ASL assistance

- Define supported tasks: reviewed fingerspelling, constrained vocabulary, or continuous ASL. Each needs a separate quality claim.
- Evaluate candidate recognition systems on held-out signers, motion, lighting, camera angles, dominant hands, and out-of-vocabulary input. Include fluent Deaf ASL evaluators.
- Review recognized text before speaking. Keep raw recognition distinct from suggested corrections.
- Gate: documented dataset provenance, signer-independent results, latency and abstention behavior; user evaluation supports the stated scope.
- Avatar gate: fluent users assess comprehension and meaning preservation. Offer it only where validated.

### 4. Public release

- Reproducible container, pinned dependencies, CI, preview environment, production configuration, shutdown, dependency readiness, errors/metrics, cost budgets, and rollback.
- Establish access model, room-link security, abuse prevention, retention policy, provider data handling, and operational owner.
- Gate: staging passes end-to-end tests, accessibility review, failure drills, concurrency targets, and release checklist; owner approves hosting spend and public deployment.

The next few days can establish a usable product baseline. Production claims and fluent-ASL quality depend on passing these gates, not the calendar.

## Work completed in the first engineering session

- Replaced speech stream lifecycle management with lazy startup, participant-state preservation, fixed-age rotation, tracked retries, and disconnect cleanup.
- Added PCM validation, explicit little-endian encoding, and backpressure handling. Audio during backpressure is dropped rather than growing a delayed queue; this can reduce transcription completeness under sustained congestion and must be surfaced in later status/metrics work.
- Added a server-owned caption relay with final-result buffering and cancellation on departure.
- Removed browser data-channel caption forwarding to avoid a competing path.
- Expanded the npm test command to discover all test files and added deterministic lifecycle/relay regression tests using fake cloud streams and timers.
- Historical remaining items from this session: status presentation and manual retries have since been implemented. Stream rotation remains non-gapless and needs long-call validation.

## Reference sources

- Google streaming recognition limits: https://docs.cloud.google.com/speech-to-text/docs/quotas
- Google streaming transcription: https://docs.cloud.google.com/speech-to-text/docs/v1/transcribe-streaming-audio
- Node env-file support: https://nodejs.org/en/blog/release/v20.6.0
- WFD/WASLI avatar statement (2018; context, not a benchmark of current models): https://wfdeaf.org/resources/statement-on-use-of-signing-avatars/

## Second engineering session

- Application factory imports without opening ports or constructing paid clients. Core app starts without .env/model files; capabilities configure optional providers.
- Two-participant room admission, validated signaling, explicit leave, duplicate-join handling, and in-memory isolation tested with actual Socket.IO clients.
- Explicit typed replies and bounded retry-ID deduplication; no delivery while peer absent; 1,000-character limit and per-participant rate limits.
- Recognition produces a private reviewable draft. Automatic generated-sentence forwarding and automatic speech were removed.
- Optional speech targets its original recipient, so a delayed result cannot leak to a replacement peer. Pending captions are canceled when either participant leaves.
- Browser fallback works after media denial. Caption-provider state and mute control are separate from call state; ICE candidates wait for remote description; reconnect preserves the reply draft.
- Added desktop/mobile conversation UI, synthetic-media Playwright journeys, and a GitHub Actions workflow. Node 24 core container no longer depends on Python/model startup and runs as non-root.
- Updated dependency lockfile with compatible patches and a scoped express/qs override; npm reported zero vulnerabilities at installation.
- Remaining release work: cross-network/long-call/provider testing; SFU/P2P decision; secure room access and abuse controls; dynamic TURN credentials; deeper accessibility and browser coverage; ASL benchmark and Deaf-user input; production telemetry/privacy/cost policy.
- Validation: 25 Node/server tests and five Chrome browser journeys pass, including native playback of a synthetic audio reply. Scoped independent UI review scored all three mobile/persistence/provider-copy fixes resolved. npm reports zero vulnerabilities. Docker definition and CI configuration are written; Docker cannot be built locally while its daemon is stopped, and CI has not run remotely. Provider capability status describes configuration, not service readiness.

## Third engineering session

- Replaced ScriptProcessor with an AudioWorklet, 16 kHz mono PCM16 in transferable 2 KB binary packets. Output is silent; the capture object never stops call-owned camera/microphone tracks. Volatile audio transport discards congestion rather than buffering stale speech.
- Added independent caption pause/start/retry controls, browser activation/unsupported states, peer caption status, and ephemeral completed-caption history. Muting closes the recognizer; unmuting preserves video and the user's separate caption preference.
- Provider status becomes active on received provider data, not stream construction. Invalid configuration stops automatic retries; transient failure can retry manually without leaving the call. Caption concurrency (default 20 per instance), audio-time budgets, and rate-change limits constrain provider work. Backpressure is exposed as a limited-caption state.
- Added generation guards around asynchronous peer setup and discarded callbacks from old peer connections. Socket/server reconnection preserves the current page's draft; rejected rooms now provide actionable reply-panel feedback. Connection indicators no longer infer connected status from the substring in “disconnected.”
- Added a scrollable sidebar layout for shorter desktop viewports. Existing warm dark/amber UI is retained.
- Validation: 35 server/unit tests and 13 Chrome browser journeys pass. Tests use synthetic media and fake cloud results, including actual AudioWorklet → Socket.IO → recognizer transport. These tests establish wiring and recovery, not Google transcription accuracy, ASL accuracy, real-network resilience, or latency targets.
- Independent scoped UI review passed after corrected mobile captures: caption controls/status, attribution, composer and Leave access, and short desktop sidebar scrolling. Local provider-disabled preview responds successfully at localhost:3000.
- Remaining: real Google credentials/provider evaluation, supported-browser and two-device network testing, seamless long-call caption rotation, secure public room admission, expiring TURN credentials, telemetry/privacy/cost policy, and ASL evaluation.

### Audio implementation references

- AudioWorklet processor lifecycle: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process
- AudioWorklet main/audio-thread messaging: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet
- Socket.IO volatile events: https://socket.io/docs/v4/emitting-events/


## Fourth engineering session

- Default admission now requires a signed, room-bound invitation with eight-hour expiry. Links carry the bearer credential in the URL fragment; HTTP authentication uses a header. Browser role links remain disabled until creation/validation succeeds. Invalid/expired invitations are rejected before camera/microphone access and provide an explicit new-session recovery action.
- Production startup requires a persistent signing secret and exact HTTPS allowed origins. Legacy room-code-only access and static TURN credentials are rejected in production. Persistent secrets allow page reconnection after server restart; ephemeral local secrets intentionally invalidate old invitations on restart.
- ICE configuration requires a valid invitation and issues distinct coturn-compatible HMAC credentials with bounded expiry. Shared secrets never appear in ICE responses. Prediction and avatar proxy requests also require invitations; the avatar client fetches authenticated pose data into a temporary object URL.
- Added bounded invitation, handshake, ICE, and pose request quotas. HTTP proxy trust is explicit and defaults to zero. Socket handshake quotas use TCP peer addresses and therefore remain shared behind a reverse proxy; edge limits and load validation remain required.
- Landing copy now describes available video/text, conditional captions/speech, and experimental fingerspelling assistance rather than claiming fluent ASL translation. Existing visual identity retained. Scoped independent invitation UI review disposition: ship, with no material fixes in the extension.
- Validation: 45 server/unit tests and 18 Chrome browser journeys pass; final five invitation journeys also pass after the recovery-button visibility correction. Coverage includes token expiry/tampering/room binding, authenticated TURN responses, origin rejection, quotas, default private sharing, no media request on rejected invitations, and restart recovery. Docker and remote CI remain unvalidated.
- Remaining release gates: real coturn deployment and cross-network calls; in-call credential refresh/long-call rotation; production proxy/topology/concurrency validation; distributed abuse controls and account/identity decisions; invitation revocation policy; Google/provider evaluation; telemetry, retention, privacy and cost policy; Deaf-user and supported-browser/accessibility evaluation. A shared invitation proves possession, not identity; existing admitted calls are not forcibly ended at invitation expiry. Room state is still single-instance and ephemeral.


## Fifth engineering session

- Added relay lease scheduling, expiry metadata, bounded renewal retries, abort/generation cleanup, and ICE restart on the existing peer connection. Admission establishes deterministic polite/impolite roles to resolve simultaneous offers. Existing camera/microphone tracks remain owned by the call.
- Caption rotation/retry now replays a bounded five-second window of accepted, unfinalized PCM, using provider end timestamps to suppress duplicate final results. Repeated words at different times are preserved. Sample-rate changes clear incompatible replay audio. Peer departure explicitly destroys provider context and replay audio before a replacement can join.
- Added protected Prometheus aggregate counters, HTTP latency buckets, resource/process gauges, and process readiness. Fixed event labels accept no arbitrary client text or identifiers. Client health reporting is joined-user-only and rate-limited. Provider error logs are sanitized; avatar upstream bodies/stacks are no longer returned or logged.
- Added deterministic credential renewal/backoff/expiry/abort tests, replay/timestamp/privacy regressions, aggregate monitoring authentication/privacy checks, and a two-browser accelerated renewal and simultaneous ICE restart journey. Validation: all 57 server/unit tests and 19 Chrome browser journeys pass; git diff --check is clean. These use fake provider streams and accelerated ICE endpoint responses, not a deployed relay or paid transcription.
- Remaining: actual Google long-call latency/accuracy and coturn allocation refresh testing; supported-browser and network/failure matrix; production reverse-proxy and monitoring setup; user evaluation and public deployment acceptance. Bounded replay improves continuity but is not a lossless transcription guarantee. Monitoring never establishes provider health merely from process readiness.

## Sixth engineering session: low-cost staging

- With owner approval, deployed `tandem-staging` in Google Cloud us-central1-a: e2-small, 20 GiB pd-standard, reserved IPv4 34.27.182.54. Temporary HTTPS hostname: https://tandem-34-27-182-54.sslip.io. Estimated additional baseline $17–20/month plus usage; existing TURN charges remain separate.
- Dedicated VPC/subnet avoids broad legacy default-network rules. Only web ingress is public; SSH uses IAP. App and Caddy admin ports are unpublished; public metrics are blocked. Single app instance and ephemeral room state remain deliberate staging constraints.
- Dedicated VM identity reads only its runtime Secret Manager secret. Owner-only atomic runtime file refresh and enabled systemd/Compose startup replace downloaded cloud keys. Speech, ASL and avatar stay disabled, avoiding speech/model charges during core validation.
- Owner separately approved reusing and migrating the existing TURN server to temporary HMAC credentials. Preserved coturn backups and corrected public/private address mapping after the forced-relay test exposed a delivery failure. No additional relay VM or broader TURN firewall rule was created.
- Validation: 58 local server tests pass; linux/amd64 image builds locally and on VM, installed dependency audit reports zero vulnerabilities, read-only container health and pinned Caddy config pass. Public HTTPS health/readiness, private invitations, typed replies, rejected anonymous ICE, hidden public metrics, and forced relay-to-relay data delivery pass.
- Next gates: separate-device/network video and audio, Chrome/Safari/Firefox and mobile coverage, TURN TLS/restricted-network behavior, provider IAM and paid caption evaluation, long-call renewal/recovery, abuse and bandwidth controls, alerting/retention, real domain and product/privacy evaluation. Deployment details and maintenance commands are in `tandem-app/deploy/staging/README.md`.

## Seventh engineering session: live caption staging

- Owner confirmed phone/laptop connection across Wi-Fi and cellular, then approved enabling live captions. Granted the dedicated VM Cloud Speech Client; recognition uses its attached identity.
- Added independent ENABLE_SPEECH_OUTPUT=false support so captions can run without paid synthesis. Staging enables captions, disables synthesis and limits simultaneous recognition to two streams. Existing production behavior remains compatible when the new output flag is absent.
- Preserved the previous application image/configuration before rollout. Deployment restarted successfully; runtime secrets remain in Secret Manager and an owner-only file.
- Validation: 59 server tests and two relevant Chrome caption regressions pass. A real Google streaming test using public sample audio passed through Chrome microphone simulation, AudioWorklet PCM, Socket.IO, Google recognition and peer final-caption delivery; pause was acknowledged on both devices.
- V1 published no-data-logging recognition rate is $0.024/audio minute after the account-level free allowance (~$1.44/microphone-hour). Two microphones double usage. No new data-logging enrollment was enabled; existing enrollment remains a privacy verification item. Concurrency is not a financial spending cap.
- Remaining: real-user caption accuracy/latency on phone and laptop, long-call rotation and TURN renewal, supported browsers, provider/project privacy settings, billing controls and the production release gates above.

## Eighth engineering session: rotation and recovery

- Restarted both retained VMs at the owner's request. Reserved addresses stayed unchanged, secret bootstrap and container startup succeeded, and public HTTPS/core calls/forced relay passed again. Yesterday's pushed GitHub Actions checkpoint passed.
- Owner reported live captions worked fine with Chrome on Mac for the Deaf role and Safari on phone for the hearing role. Quantitative accuracy/latency and broader device coverage are not established by that report.
- Extended the staging harness to use one paid microphone, check scheduled provider rotation and simulate a brief browser-offline plus signaling-transport interruption. Core relay tests suppress paid recognition in synthetic browsers.
- Real Google validation passed: recognition replaced at 270001 ms; final captions continued (57 results by the post-rotation check), with largest final gap 5025 ms for a repeating approximately 4.8-second audio fixture and no provider interruption during rotation.
- Recovery passed: new socket admission, same live local capture tracks, active peer video, fresh peer final captions, preserved unsent draft, successful typed delivery and caption pause acknowledgement.
- Remaining: hour-long TURN credential renewal, physical network/radio handoff and broader outage matrix; extended recognition rotations and real conversational audio; supported browsers and accessibility; billing/abuse/privacy controls and owned production domain. A controlled interruption and one rotation do not establish lossless captions or production readiness.

## Ninth engineering session: caption limits and deferred owner checks

- Owner requested a cumulative manual testing batch. Pending device, network, caption quality, accessibility and user-evaluation checks are tracked in [MANUAL_TEST_CHECKLIST.md](MANUAL_TEST_CHECKLIST.md); engineering proceeds without requesting each check individually.
- Added configurable recognition session and incoming-PCM idle limits, with fail-closed configuration validation. Staging uses 900/15 seconds and two concurrent streams. Expiry pauses captions, closes recognition and clears replay audio while video/text continue. Rotation/retry cannot extend the session deadline; deliberate restart/reconnection creates a new binding. These controls do not enforce a monthly budget.
- Patched proxy-addr to 2.0.8 for [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h); Docker builds now reject high/critical production dependency audit findings. Existing numeric hop trust does not use the advisory's vulnerable subnet form.
- Validation: all 63 server tests and 20 Chrome browser journeys pass, including automatic pause with live video, typed delivery and deliberate caption restart. Rebuilt staging image reports zero dependency vulnerabilities.
- Actual Google idle cutoff/restart passed with fresh peer final captions and typed delivery during pause. Redeployed HTTPS/private invitation/text/forced relay checks pass. The 15-minute session deadline is verified with deterministic and accelerated browser tests to avoid unnecessary paid fixture usage.

## Tenth engineering session: bounded connection admission

- Added MAX_CONNECTIONS (default 100, staging 20) with synchronous middleware reservations so concurrent namespace registration cannot bypass the cap. Initial transport count/origin/rate checks reject excess handshakes; draining rejects new connections.
- UNJOINED_TIMEOUT_SECONDS (default/staging 30) closes connections without a call room, while active room members remain connected. Added explicit raw transport cleanup before the library's graceful polling close to release clients that never poll again. Reservations and timers release on transport close even when namespace connection never completes.
- Added delayed retry for server-busy namespace rejection and server-triggered disconnect, preserving the current page draft. Desktop/mobile controlled recovery delivers the retained draft. Page exit cancels retries.
- Validation: all 70 server tests and 22 Chrome browser journeys pass, including concurrent capacity/replacement, raw polling cleanup and active caller preservation. Fixed an existing caption browser test race by waiting for the provider-failure state before selecting the failed participant. Mechanical UI detector passes; desktop/mobile error-state captures inspected.
- Added a no-audio staging admission harness. These application limits complement edge/network controls; simultaneous initial transports can transiently exceed the preliminary count check. Load capacity, per-client proxy quotas and denial-of-service protection remain release gates.
- Actual staging admission harness passed: 20 connected clients, overflow rejection, unjoined cleanup, admitted caller preservation, typed delivery and replacement admission. Post-rollout HTTPS/private invitation/text/forced TURN regressions passed. No audio was submitted to Google during these tests.
