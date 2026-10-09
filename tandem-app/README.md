# Tandem

One-to-one video calls with typed replies, optional live captions and speech output, and experimental fingerspelling assistance. The project is under active redevelopment; it is not production ready.

## Run the core app

Use Node 24 (the repository .nvmrc selects it). Node 22.16+ is also accepted by the package, but deployment targets Node 24.

```sh
cd tandem-app
npm ci
npm start
```

Open http://localhost:3000. Share the session link with a second browser/device, then choose a role on each device. A room admits two participants. Share the **full invitation link**, including its fragment (`#invite=…`); the visible room code alone does not grant access. Invitations expire after eight hours by default. Calls and typed replies do not require a .env file, Google credentials, Python, an ASL model, or Anthropic credentials. If camera/microphone access is denied, typed replies still work.

Review your draft and choose **Send reply**, or press Enter. Shift+Enter inserts a newline. Speech output is an optional checkbox and requires a configured provider. Text is sent first even if speech synthesis fails. Spoken replies include native playback controls; the receiver chooses when to listen. Replies are ephemeral: recent messages and retry IDs are bounded in memory and are not saved across server restarts. Server acceptance is acknowledged; this is not a durable messaging service or proof that a peer read a reply.

For cross-network calls configure a TURN server. Browsers require localhost or HTTPS for camera/microphone access. Peer audio is controlled separately from your microphone.

## Private invitations and deployment

Private invitations are enabled by default. Their signed bearer credential is stored in the URL fragment, which is not included in HTTP request URLs; authenticated requests use the Authorization header. Anyone possessing the full link can join, subject to the two-participant limit. This is invitation-based access, not account authentication or participant identity verification. Do not publish invitation links.

Local development generates a random signing secret when ROOM_SIGNING_SECRET is omitted. Those invitations become invalid on restart. Supply a persistent random secret (at least 32 bytes, for example `openssl rand -hex 32`) to preserve invitations across restarts. ROOM_TTL_SECONDS controls new invitation lifetime (300–86400 seconds). Expiry blocks new admission and reconnection; it does not forcibly end an already admitted call. Rotating the secret invalidates existing invitations on their next validation/admission. There is no per-invitation revocation or durable room store yet.

For public deployments set NODE_ENV=production, ROOM_SIGNING_SECRET, and ALLOWED_ORIGIN to exact HTTPS origins (comma-separated). Startup rejects missing/weak secrets, wildcard/insecure origins, and REQUIRE_ROOM_TOKEN=false. WebSocket upgrades are origin-checked as well as HTTP room creation. Non-browser clients still need a valid invitation. Local development can explicitly set REQUIRE_ROOM_TOKEN=false for legacy room-code-only tests.

Invitation creation is limited to ten per IP per hour; socket handshakes to 60 per trusted client IP per minute; ICE configuration to 30 per IP per minute. Maps are bounded per instance. If using a reverse proxy, set TRUST_PROXY_HOPS to the exact trusted hop count (default zero) and prevent direct access to the application port. Otherwise all clients behind that proxy share its HTTP IP quota. Socket and HTTP quotas use the same configured proxy trust; with zero trusted hops they use the TCP peer address. Edge rate limiting still needs deployment load testing. These limits are not a distributed abuse-prevention system.

For coturn, configure its `use-auth-secret` and `static-auth-secret` with the same random value as TURN_SHARED_SECRET, and set TURN_URLS. Authenticated ICE requests mint distinct credentials that expire after TURN_TTL_SECONDS (default one hour), capped by the invitation expiry. The signing secret stays on the server. Static TURN_USERNAME/TURN_CREDENTIAL are development-only and rejected in production. Credentials are cached for setup, refreshed before expiry, and applied to the existing peer connection with an ICE restart. Temporary fetch failures use bounded retries; invitation expiry prevents further renewal. Two-browser tests cover simultaneous restarts and preserve existing media tracks. Real coturn refresh and long-call continuity still require staging validation. Staging has passed actual coturn authentication, relay delivery, private-peer denial and TLS checks; the full credential-expiry continuity test remains outstanding. See the [coturn authentication configuration](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf) and [Socket.IO origin handling](https://socket.io/docs/v4/handling-cors).

## Optional providers

Copy .env.example to .env and uncomment only the settings you need. Never commit credentials.

- **Captions and speech output:** set GOOGLE_APPLICATION_CREDENTIALS to a valid service-account file, or ENABLE_SPEECH=true to use Application Default Credentials/workload identity. ENABLE_SPEECH=false overrides credentials. Each caller explicitly chooses Start captions before joined microphone audio is sent to Google; media permission alone does not authorize transcription. AudioWorklet sends 16 kHz mono binary PCM with no microphone feedback. Muting pauses recognition, while Pause captions stops caption transmission independently of your call audio. Start/Retry captions handles browser activation and recoverable outages. Configure MAX_CAPTION_STREAMS (default 20) to bound simultaneous recognizers in one instance; audio throughput is also limited. Recognition rotation/retry replays up to five seconds of accepted, unfinalized PCM audio from memory; timed final results suppress duplicates across rotations. The replay buffer is destroyed when captions stop or a peer leaves. Longer unfinished utterances, provider backpressure, and network outages can still lose speech. Speech output is opt-in for each reply.
- **Experimental recognition:** set ENABLE_ASL=true, install the Python dependencies, supply asl/model_v2.p or the legacy asl/model.p, and start `npm run asl` separately. ASL_API_URL changes the prediction service address. The Node boundary accepts only 63 finite coordinates and validates bounded A–Z/probability/model-version responses; backend failures return fixed errors and cannot forward arbitrary provider fields. `npm run start:all` still starts both processes for experimental development; a missing model stops that command. Recognized words become private reviewable drafts, not automatically spoken messages. ANTHROPIC_API_KEY optionally enables suggested word correction.

The experimental Python service defaults to loopback on port 5003, without browser CORS access. Set ASL_BIND_HOST only when deliberately exposing it to a private service network; public clients must use the authenticated Node endpoint. Its Flask factory can be loaded as `server.asl_api:create_app()` by a separately configured WSGI server. Pickle artifacts must come from an operator-trusted source. Training and inference share the v2 feature transform; the service rejects malformed/oversized input and unsupported or invalid model results with fixed errors. Its small contract suite runs with `python test/asl_api_test.py` after installing requirements-test.txt, without model downloads, scikit-learn or provider calls. See [Flask application factories](https://flask.palletsprojects.com/en/stable/patterns/appfactories/).

The optional [private inference container](deploy/asl/README.md) includes pinned dependencies, Gunicorn and isolated authenticated-app smoke checks. `npm run asl:train -- ...` requires explicitly signer-separated numeric training/validation partitions and reviewed provenance; see [training and evaluation](asl/EVALUATION.md). It writes a new private candidate directory and never overwrites the existing model or enables staging recognition. Legacy image collection and untracked dataset caches lack the records needed for this workflow.

The offline [recognition evaluation contract](asl/EVALUATION.md) requires verified provenance and a benchmark with unseen signers and unknown/non-letter inputs. It reports abstention, coverage and wrong accepted predictions separately. The legacy feature cache lacks signer metadata and cannot establish unseen-user quality. Run `python test/asl_evaluation_test.py` for its synthetic contract checks; these checks are not model accuracy evidence.
- **Experimental avatar:** set ENABLE_AVATAR=true. This enables the external sign.mt pose proxy and viewer. The browser sends bounded text through authenticated POST JSON; the upstream service still receives text in its query string. Viewer failure prevents pose submissions and preserves typed replies. Its linguistic accuracy and provider privacy have not been validated.

`GET /capabilities` reports configured features, not live cloud-service health. `/health` is process liveness; `/ready` reports whether the process is accepting work, not whether Google or TURN is healthy. Provider failures surface separately in the interface.

## Operations

Set a random METRICS_TOKEN (at least 32 bytes) to enable `GET /metrics`. The endpoint requires `Authorization: Bearer …`, returns Prometheus text, and disables caching. Without configuration it returns 404. It reports fixed aggregate event counters, HTTP latency buckets, active sockets/rooms/caption streams/provider jobs, process memory, uptime, and readiness. Metric labels contain no room/socket IDs, IPs, invitation tokens, transcript text, or reply content. A bounded client health event reports renewal/media failures; it is diagnostic, not authoritative.

Provider failures emit structured event names and sanitized numeric codes. SDK messages/stacks and avatar error bodies are not logged. In-memory metric counters reset on restart. Configure your reverse proxy, hosting platform, and monitoring exporter separately so they redact Authorization headers and conversation-bearing request queries; application sanitization cannot control their logging. Deployment and response procedures are documented in [the operations guide](../docs/OPERATIONS.md).

## Verify

Camera and microphone permission does not block typed room admission. If access is denied or a device stops, use the in-call Retry camera & microphone action after fixing browser permissions or reconnecting the device. Recovery retains the current draft and mute/camera choices. Leaving or an invitation rejection stops local capture; a late permission grant is discarded.

```sh
npm test
npm run test:browser
npm run test:browser:compat
```

The server tests use real local Socket.IO connections and fake paid providers. Browser tests use Playwright, local Google Chrome, and synthetic camera/microphone streams. On CI they use Playwright Chromium. To run Chromium locally instead of installed Chrome:

```sh
npx playwright install chromium
PLAYWRIGHT_CHANNEL=chromium npm run test:browser
```

Install the additional engines with `npx playwright install firefox webkit`, then run `npm run test:browser:compat` for the same journeys in Firefox and WebKit. Firefox uses fake media preferences; WebKit uses its automated capture devices with camera/microphone permissions. Both exercise native WebRTC and AudioWorklet paths. WebKit automation does not establish physical iPhone/Safari behavior; the owner device checklist remains required. Separate output directories keep compatibility artifacts from colliding with the primary suite. CI installs and checks all three engines without paid speech providers.

Tests exercise signed invitation tampering/expiry/room binding, authenticated ICE credentials, origin rejection, creation quotas, private browser invitations and restart recovery, room capacity/idempotency/isolation, validated signaling, caption cleanup and bounded replay/timed duplicate suppression, credential scheduling/retry/cleanup, two-browser simultaneous ICE restart, authenticated aggregate monitoring, AudioWorklet binary transport and PCM encoding, caption pause/mute/recovery, unsupported capture, explicit messages and retry deduplication, private recognition drafts, stale speech jobs, media permission denial, browser video, peer replacement, socket/server reconnection with preserved drafts, and desktop/mobile replies. Completed captions stay in the current page’s conversation history; they are not recorded or stored on disk. They do not establish cross-network reliability or ASL/speech accuracy.

Development-only axe checks inspect the rendered invitation and admitted call pages at 1440px and 390px, with actual fonts and a typed conversation. Findings fail the browser suite and include rule/element details. These automated checks cover those states, not full accessibility certification. Screen readers, keyboard navigation, 200% zoom, physical devices and the other error/provider states still need the saved manual checks.

## Container

```sh
npm run docker:build
npm run docker:run
```

The Node 24 container runs as a non-root user and starts the core app independently of Python/model files. `npm run docker:run` explicitly uses development mode for localhost. The image defaults to production mode; for deployment pass NODE_ENV=production, ROOM_SIGNING_SECRET, ALLOWED_ORIGIN, and your TURN configuration through your secret/configuration manager. Pass optional settings with `docker run --env-file ...`; mount Google credential files separately if using file-based credentials. Run a separately managed Python model service and set ASL_API_URL if enabling recognition. The old scripts/entrypoint.sh is a legacy experimental launcher and is not used by this image.

## Architecture

- server.js: application factory, HTTP routes, capability configuration, and process lifecycle.
- server/access.js and server/iceConfig.js: signed invitations, origin checks, bounded IP quotas, and temporary TURN credentials.
- server/callProtocol.js: in-memory two-participant room protocol, signaling, explicit replies, private drafts, and provider work limits.
- server/observability.js: authenticated aggregate metrics and sanitized provider failure events.
- public/iceLease.mjs: bounded credential renewal and stale-request cleanup.
- server/captionRelay.js and server/speechToText.js: server-owned caption forwarding and speech lifecycle.
- public/: static browser UI; no frontend build step.
- server/asl_api.py and asl/: optional recognition service and training tools.
- ../ASL-interpreter/: legacy research reference with existing local changes.

Room state is currently single-instance. Public deployment still needs operational validation of access/abuse limits and TURN, provider cost/privacy policy, supported-browser and network testing, and operational readiness. See ../docs/PRODUCTION_PLAN.md.
