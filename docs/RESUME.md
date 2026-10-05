# Resume on 2026-10-06

Owner requested an overnight pause after Google live-caption validation and asked for all project changes to be pushed to GitHub.

## Current checkpoint

- Project: `project-af454814-40f3-4eb7-9f9`, zone `us-central1-a`.
- App: `tandem-staging`, e2-small, reserved IP `34.27.182.54`.
- Relay: existing `turn-server`, e2-micro, reserved IP `34.30.255.171`.
- Staging URL: https://tandem-34-27-182-54.sslip.io.
- Both VMs were stopped for the pause; disks, addresses, IAM and secret resources are retained. The staging URL will be unavailable until the app VM starts. Stopped VMs still incur disk and reserved-IP charges.
- Local Node preview was terminated; browser tests finished and no local test containers were running.
- Caption configuration: ENABLE_SPEECH=true, ENABLE_SPEECH_OUTPUT=false, MAX_CAPTION_STREAMS=2. ASL and avatar remain off.
- Dedicated VM identity has Cloud Speech Client and access only to its own runtime secret. No downloaded key or populated runtime.env is committed.
- Real Google final-caption delivery and pause passed using a public audio fixture; aggregate caption streams, sockets and rooms returned to zero after the test. All 59 server tests and two relevant caption browser regressions passed. Earlier full browser suite passed 19 journeys before the caption-only flag change.
- Owner confirmed phone/laptop connection across Wi-Fi and cellular. They have not yet evaluated real-microphone captions or explicitly confirmed all audio/video/text directions.
- Legacy ASL source and existing local edits were preserved as normal parent-repository files, replacing the broken gitlink. Models, environments and caches are excluded; upstream attribution is in ASL-interpreter/UPSTREAM.md.

## Restart when work resumes

```sh
gcloud compute instances start turn-server tandem-staging \
  --zone=us-central1-a --project=project-af454814-40f3-4eb7-9f9
```

The app's enabled systemd service fetches its Secret Manager runtime configuration and starts Compose. Verify HTTPS health and container readiness, then ask the owner to refresh both devices and test captions from a real microphone. Start captions on the speaking device and pause when done to keep recognition usage low.

Recognition uses V1 latest_long. Published no-data-logging rate after the account free allowance is $0.024 per audio minute; concurrency limits do not cap monthly spending. Existing project data-logging enrollment remains to be checked. See deploy/staging/README.md for deployment details and rollback resources.

Next work: real-user caption accuracy/latency; long-call recognition rotation and TURN renewal; mobile/Safari/Firefox testing; restricted-network TURN/TLS; privacy/billing/abuse controls; owned production domain and user evaluation. Do not claim production readiness from the staging smoke checks.
