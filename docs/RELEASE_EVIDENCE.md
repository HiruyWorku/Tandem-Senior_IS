# Release evidence and remaining gates

As of 2026-10-08. **The complete project is not production ready.** This records
the scope of each result and the next evidence needed. It does not replace
`PRODUCTION_PLAN.md` or redefine completion as the currently working subset.

## Calling, captions and deployment

| Requirement | Authoritative evidence | Status / next gate |
| --- | --- | --- |
| Reproducible core runtime and rollback | Guarded `release.py` checks candidate production dependencies, actual configuration/startup/image/readiness and retains the exact prior image. Active staging image is `release-20261008-http-bounds`, started 2026-10-09 01:53:11 UTC, zero restarts at inspection. Retained rollback `rollback-6104ab13c8764abd81869af822a0fc73`. | Verified for this single-instance staging topology. Public release remains unapproved. |
| Private two-person admission, text and TLS relay | Post-rollout `smoke.cjs --tls` passed private invitation/WebSocket/text and actual forced TLS allocation/data delivery with temporary credentials. Admission overflow/cleanup/replacement passed on the preceding code-equivalent core release. | Automated staging evidence. Owner role-swapping, audio/video and third-device checks M01/M09 remain pending. |
| Credential renewal without replacing the call | Hosted run 37792694914: 3644 seconds, 46 seconds beyond original expiry, one renewal per peer, 120 moving-video samples and 120 typed exchanges, unchanged peers. | Low-bandwidth synthetic result on an earlier release; physical long-call M10 remains pending. |
| Simultaneous isolated calls | Hosted run 37831609340: ten calls, twenty moving peers on three samples, sixty typed checks, exact room histories, ten isolated rooms. | Short synthetic TLS check at 24000 bits/s per peer. High-resolution/physical-device capacity and final service targets are unproven. |
| Actual cloud transcription | Real Google fixture final captions/peer delivery/pause passed after the core rollout; a prior real 270-second rotation and transport recovery passed. | Does not prove real-user speech accuracy, attributed conversation usability, multiple rotations on physical devices or interruption-free captions. M02–M05/M10–M12 remain pending. |
| Caption cost and cleanup | Durable UTC ledger survived deployments: 3600-second aggregate limit, 30 seconds reserved, 3570 remaining at the last protected inspection. Sockets/rooms/recognizers/provider jobs all zero after probes. | The app caption allowance is enforced. It is not an account-wide cloud billing cap; other cloud services and optional providers need separate budgets. |
| Permission/device/lifecycle recovery | Hosted native-media journeys cover denied/deferred permission, device sender replacement, old-track cleanup, cached return, reconnect, drafts, provider failure and bounded shutdown. | Physical hardware, Safari background restrictions and radio handoff are pending M04–M07/M14–M15. |
| HTTP transport pressure | Deployed server bounds total TCP transports (including WebSockets/polling), incomplete headers/body and idle no-byte connections. Four actual TCP/configuration checks verify overflow/408 cleanup, retained admitted callers and peer text after pressure. Hosted 37871013080 passed 117 Node, 138 browser and 32 combined Python checks. Post-rollout private calls/text/TLS relay and health passed; all aggregate active resources returned to zero. | Verified at server scope and deployed. Public-proxy/physical load is not established by the synthetic checks. |
| Automated regression suite | Run 37840027697 passed 111 Node tests, 44 Chrome journeys, 88 Firefox/WebKit journeys and 12 Python contracts. | Accessibility candidate 281c9f0f passed in 37855866240: 111 Node tests, 46 Chrome, 92 Firefox/WebKit and 12 Python contracts. Never count a pending or superseded run as passed. |
| Fonts and interface privacy | Live landing/both call pages on verified-fonts loaded expected local faces with zero external requests. Upstream font licenses/checksums are committed. | Verified for the enabled core; optional signing/recognition dependencies still contact their providers when enabled. |
| Accessibility | Actual contrast failures were measured and fixed in source. Scoped axe checks pass for invitation and admitted typed call pages at 1440px/390px in Chrome, Firefox and WebKit; six renders inspected. | Contrast patch deployed; live three-page checks found zero violations, with color-contrast/video-caption items still requiring manual review. Keyboard, screen reader, zoom, other provider/error states and physical-device M08 remain pending. Automated checks are not certification. |
| Operational monitoring | Credential-free health/certificate probe passes. Default now `production-rebuild`, health workflow active, manual default-branch run 37857699347 passed six checks; old `main` unchanged. | Default-branch activation completed; first actual scheduled execution is unobserved. Notification delivery is not verified; this is not an availability SLA. |
| Access/privacy release policy | Signed bearer invitations, origin boundaries, temporary relay credentials, provider consent controls, fixed telemetry and ephemeral app history implemented and tested. | Confirm access model, provider enrollment/retention, log handling, owned domain, spend and public release policy before launch. |

## Recognition, signing and spoken replies

These remain part of the project objective. Disabling them in staging does not
prove their completion.

| Requirement | Evidence | Status / next gate |
| --- | --- | --- |
| Private reviewed recognition | Node/Python bounds, shared feature extraction, encoded-label decoding, fixed private failures and reviewed sending are tested. Linux arm64 runtime smoke and eight Flask tests pass. Hosted c318a36f fully passes, including amd64 patched dependency audit/build and actual private-network production Node-to-Gunicorn synthetic HTTP with invitation rejection/valid prediction. | Authenticated runtime integration is verified; actual deployment environment, base-image OS advisory review and useful model quality remain pending. Recognition stays off in staging. |
| Signer-independent recognition | Legacy cache has 34000 × 73 finite features and 26 labels, but only X/y arrays: no signer identities, split or provenance manifest. New local collector saves explicitly labeled single-hand landmarks and reviewed session records, with private hashed output and bounded capture/cleanup. Actual pinned MediaPipe/OpenCV macOS arm64 blank-frame check passes without camera/window access; collection dependency audit reports no known issues. Collector/export/trainer/evaluator/inference have 32 synthetic Python contracts. Hosted c318a36f passes 113 Node, 138 browser journeys and 24 Python contracts plus authenticated runtime. | Physical collection permission/window/positive-hand checks are M16; obtain rights/consent-reviewed data, compare native/browser perception, collect unseen-signer benchmarks, set acceptance/abstention/latency targets and evaluate models. No real participant collection/training or continuous-ASL evidence. Latest collector hosted verification is pending. |
| Motion and continuous ASL | Current call perception remains a single-frame letter classifier. [Sequence-model investigation](CONTINUOUS_ASL.md) now executes original Uni-Sign pose encoder/text decoder with verified ASL weights on isolated CPU. Both 16-frame and 256-frame all-zero inputs generated unsupported text. Real signing input/preprocessing and accuracy remain untested; later owner-arranged review is saved as M17. | Unfinished. Synthetic execution establishes compatibility and a no-sign failure, not useful translation or a production model. Noncommercial terms remain a release constraint. |
| Generated signing avatars | Optional queue/cancellation/failure paths tested; production staging keeps the service off. | Linguistic correctness, comprehension, meaning preservation and provider privacy remain unvalidated. |
| Spoken reviewed replies | Explicit opt-in and native playback exercised with synthetic audio; late jobs cannot reach replacement peers. | Actual paid synthesis, identity permissions, provider handling and its own spend allowance remain unverified/off in staging. |

The recommended first-release baseline is the functioning video/captions/text
workflow, with recognition/signing offered only after their stated tasks are
validated. This remains an engineering recommendation, not owner approval to
remove those features from the full project objective.

## Owner and external evidence still needed

- Run the existing M01–M15 batch when available; record devices, versions,
  network and observations without private links or conversation recordings.
- Agree on the intended recognition task and whether validated automated
  translation is required for the first public release.
- Arrange fluent Deaf-user evaluation and consented recognition benchmark data.
- Confirm provider data handling, public access/retention policy, domain and
  production spending/release decisions.
- Verify the chosen alert destination receives failures. No external recipient
  has been configured or contacted by the agent.

Until these gates pass, report the verified staging behavior precisely and keep
the full production goal open. See `RESUME.md` for release/probe history and
`MANUAL_TEST_CHECKLIST.md` for the accumulated test batch.
