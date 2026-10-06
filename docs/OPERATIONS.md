# Tandem operations

This guide describes the implemented single-instance service. Google Cloud staging is deployed; HTTPS, private invitations, typed replies, forced coturn delivery and service restart have passed. The owner also confirmed phone/laptop connectivity across Wi-Fi and cellular. Public production release still requires the acceptance checks below. See [staging deployment](../tandem-app/deploy/staging/README.md) for resources and maintenance commands.

## Configuration and startup

Use Node 24 and the non-root container. Production requires a persistent random ROOM_SIGNING_SECRET and exact HTTPS ALLOWED_ORIGIN values. Configure coturn with TURN_SHARED_SECRET and TURN_URLS; static TURN credentials are rejected in production. Generate room, TURN, and metrics secrets independently and inject them through your hosting secret manager. Never commit them or include them in support tickets.

The app port should be reachable only through the trusted reverse proxy. Set TRUST_PROXY_HOPS to the actual proxy topology. HTTP quotas use that trust configuration; socket handshake quotas use the TCP peer IP and are shared behind a proxy. Add per-client edge limits and validate concurrency before deployment. The in-memory room adapter supports one application instance; do not scale replicas without atomic shared admission and signaling design.

## Health and metrics

- `/health`: process liveness, HTTP 200. It does not check paid providers.
- `/ready`: HTTP 200 with `{"ready":true}` while running. Shutdown marks readiness false before closing Socket.IO and the HTTP server. A shutdown may finish before a probe sees HTTP 503.
- `/metrics`: disabled (404) unless METRICS_TOKEN is configured. Scrapes must supply the exact bearer token in the Authorization header. Restrict scraping to your monitoring network as well as authenticating it.

Metrics expose process uptime/memory, active sockets/rooms/caption streams/provider jobs, request latency buckets, and fixed event counters. No conversation content, identifiers, IPs, or invitation credentials are metric labels. Counters reset on process restart. `client_*` reports are rate-limited diagnostics, not trusted accounting.

Configure your platform to redact Authorization headers and request bodies. The avatar request contains text in its query string; exclude those queries from access logs. Browser history contains private invitation links. Do not export browser traces from real conversations without an explicit privacy policy and consent.

## Failure response

| Signal | Check and response |
| --- | --- |
| Readiness/liveness unavailable | Check process/container events, resource pressure and startup configuration; restore the process before investigating provider quality. |
| `speech_unavailable` rises | Check Google identity, API permissions, quota and caption stream capacity. Typed replies remain the fallback. |
| `speech_limited` rises | Recognition auto-paused on a configured session or incoming-audio idle limit. Video/text continue; a deliberate Start captions action creates a fresh capture binding. |
| `speech_retry` rises | Check network/provider interruptions. Logs contain numeric status codes, not SDK messages. Automatic retries are bounded. |
| `audio_dropped` rises | Check congestion, provider backpressure and abusive submission. Do not increase buffers to hide delayed captions. |
| `client_ice_failed` rises | Check ICE endpoint errors, invitation expiry, TURN reachability and secret alignment. Validate from a separate network. |
| `speech_job_failed` / `avatar_provider_failed` rises | Check optional provider availability. Explicit text delivery remains independent. |
| Memory or active work rises continuously | Verify departure cleanup and load limits. Capture aggregate diagnostics without recording audio or messages. |

Relay credentials renew before expiry and trigger collision-safe ICE negotiation without replacing local tracks. An expired invitation cannot renew or reconnect. Caption rotation replays only a bounded window of unfinalized audio; long utterances and outages can still lose words. Validate both behaviors using actual providers before claiming seamless long-call support.

Optional CAPTION_MAX_SESSION_SECONDS (0–14400) and CAPTION_IDLE_SECONDS (0–300) default to disabled. Staging configures 900 and 15 respectively. Rotation/provider retries preserve the original time limit; leaving, reconnecting or deliberately restarting captions creates a new binding. Idle means missing incoming PCM, not a silent microphone that still sends audio. Limit expiry closes the provider stream, cancels its timers, clears private replay audio and publishes a paused state; incoming audio cannot reopen it automatically. These limits and concurrency controls do not constitute a daily/monthly spending cap. Invalid configured capacities/durations fail startup rather than falling back to a larger allowance.

## Deployment acceptance

Before public exposure, validate all of the following in staging:

1. Two real devices on different networks connect through TURN; prove relay use with WebRTC statistics, not successful localhost video alone.
2. Run beyond TURN credential expiry and multiple Google recognition rotations; measure media interruption, lost/duplicated captions and latency.
3. Exercise network loss, provider outage, media permission denial, server restart and graceful shutdown. Verify text fallback, drafts and cleanup.
4. Validate invitation expiry, secret rotation, origin rejection and trusted-proxy quotas against the actual hosting topology.
5. Scrape authenticated metrics, test alerts and confirm platform logs redact credentials and conversation content.
6. Complete supported-browser/accessibility checks, Deaf-user evaluation, retention/provider privacy decisions and spending limits.

Staging uses a temporary wildcard-DNS hostname and an attached VM identity. An owned domain, supported-browser/user evaluation and the remaining long-call/privacy/cost gates are required before production release. Infrastructure and caption testing were explicitly approved; further hosting scale or public production release should be reviewed separately.
