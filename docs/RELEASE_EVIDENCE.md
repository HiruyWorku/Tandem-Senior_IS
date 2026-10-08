# Release evidence and remaining gates

As of 2026-10-08. **The complete project is not production ready.** This records
the scope of each result and the next evidence needed. It does not replace
`PRODUCTION_PLAN.md` or redefine completion as the currently working subset.

## Calling, captions and deployment

| Requirement | Authoritative evidence | Status / next gate |
| --- | --- | --- |
| Reproducible core runtime and rollback | Guarded `release.py` checks candidate production dependencies, actual configuration/startup/image/readiness and retains the exact prior image. Active staging image is `release-20261008-accessible-labels`, started 2026-10-08 23:06:02 UTC, zero restarts at inspection. | Verified for this single-instance staging topology. Public release remains unapproved. |
| Private two-person admission, text and TLS relay | Post-rollout `smoke.cjs --tls` passed private invitation/WebSocket/text and actual forced TLS allocation/data delivery with temporary credentials. Admission overflow/cleanup/replacement passed on the preceding code-equivalent core release. | Automated staging evidence. Owner role-swapping, audio/video and third-device checks M01/M09 remain pending. |
| Credential renewal without replacing the call | Hosted run 37792694914: 3644 seconds, 46 seconds beyond original expiry, one renewal per peer, 120 moving-video samples and 120 typed exchanges, unchanged peers. | Low-bandwidth synthetic result on an earlier release; physical long-call M10 remains pending. |
| Simultaneous isolated calls | Hosted run 37831609340: ten calls, twenty moving peers on three samples, sixty typed checks, exact room histories, ten isolated rooms. | Short synthetic TLS check at 24000 bits/s per peer. High-resolution/physical-device capacity and final service targets are unproven. |
| Actual cloud transcription | Real Google fixture final captions/peer delivery/pause passed after the core rollout; a prior real 270-second rotation and transport recovery passed. | Does not prove real-user speech accuracy, attributed conversation usability, multiple rotations on physical devices or interruption-free captions. M02–M05/M10–M12 remain pending. |
| Caption cost and cleanup | Durable UTC ledger survived deployments: 3600-second aggregate limit, 30 seconds reserved, 3570 remaining at the last protected inspection. Sockets/rooms/recognizers/provider jobs all zero after probes. | The app caption allowance is enforced. It is not an account-wide cloud billing cap; other cloud services and optional providers need separate budgets. |
| Permission/device/lifecycle recovery | Hosted native-media journeys cover denied/deferred permission, device sender replacement, old-track cleanup, cached return, reconnect, drafts, provider failure and bounded shutdown. | Physical hardware, Safari background restrictions and radio handoff are pending M04–M07/M14–M15. |
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
| Private reviewed recognition | Node/Python input/output bounds, shared feature extraction, encoded-label decoding, fixed private failures and explicit reviewed sending are tested. | Runtime plumbing is covered; optional Python deployment and useful model quality are not established. |
| Signer-independent recognition | Legacy cache has 34000 × 73 finite features and 26 labels, but only X/y arrays: no signer identities, split or provenance manifest. Offline evaluator requires provenance hashes, disjoint signers and unknown inputs; five synthetic contracts pass. | Obtain rights/consent-reviewed data, collect unseen-signer benchmarks, set acceptance/abstention/latency targets and evaluate actual models. Pipeline tests are not accuracy evidence. |
| Motion and continuous ASL | Current perception is a single-frame letter classifier with browser heuristics. No validated temporal language benchmark or fluent-user evaluation exists. | Unfinished. The supported recognition task and first-release scope need explicit agreement; static letter results cannot substantiate continuous ASL translation. |
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
