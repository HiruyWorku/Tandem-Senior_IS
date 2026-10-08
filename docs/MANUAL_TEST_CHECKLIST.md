# Cumulative owner testing checklist

Keep adding to this checklist during engineering. Run pending items together when the owner is ready; do not interrupt development to request each check individually. Record device, browser, network and result without pasting private invitations or conversation content.

Reload both devices before the batch so they use the current client and connection authentication.

## Already reported

- [x] Laptop and phone connected across Wi-Fi and cellular.
- [x] Live captions worked using Chrome on Mac for the Deaf role and Safari on phone for the hearing role (2026-10-06). No quantitative accuracy/latency measurements yet.

## Pending batch

| ID | Check | Expected result | Result |
| --- | --- | --- | --- |
| M01 | Confirm video, audio and typed replies in both directions; switch which device uses each role. | Each participant receives the other's video/audio/text. Use headphones or separate rooms. | Pending |
| M02 | Verify video/text before captions; choose Start captions on each microphone you want transcribed, then speak sentences, names, numbers and pauses. Note approximate delay. | Each caller chooses Google transcription independently; captions remain readable. Record missed/repeated words and delays without private recordings. | Pending |
| M03 | Pause/restart captions, then mute/unmute the microphone. | Pause stops captions without turning off call audio; mute stops microphone audio and its captions; resume works. | Pending |
| M04 | Switch a phone between Wi-Fi and cellular during a call. | Call and fresh captions recover; typed draft remains. Record whether manual retry is needed. | Pending |
| M05 | Lock/unlock the phone or background Safari, then return. | Accurate interruption state, no stuck controls, clear recovery. Background media may be restricted by the browser. | Pending |
| M06 | Leave permission unanswered and use text; deny access, then allow it in browser settings and use Retry camera & microphone. Try both roles. | Text works while permission waits; recovery preserves the draft and restores video/captions. Previous mute/camera choices remain. | Pending |
| M07 | Use supported devices/browsers beyond the confirmed Mac Chrome + phone Safari pairing, including Firefox and Android Chrome when available. | Admission, video, text, captions and Leave remain usable. Record browser versions. | Pending |
| M08 | Use keyboard-only navigation, screen reader and 200% zoom; check portrait/landscape and small screens. | Controls remain reachable/labeled and messages readable; no trapped focus or hidden Leave/Send. | Pending |
| M09 | Invite a third device, leave/rejoin, and try an invalid/expired invitation. | Third caller is refused; valid rejoin works; invalid links do not request camera/microphone. | Pending |
| M10 | A longer conversation spanning recognition rotation and TURN renewal. | Record actual interruptions, lost/repeated captions and recovery; coordinate duration with caption cost limits before running. | Pending |
| M11 | Caption limits: after 15 minutes, use Start captions to continue; also check recovery after mobile interruption. | Recognition pauses with Start captions available; video/text remain usable; deliberate restart works. The 15-second idle cutoff measures missing audio packets, not silence. | Pending |
| M12 | Evaluation with Deaf/ASL users when available. | Assess whether captions, attribution, typed reply flow and terminology meet the actual communication need. | Pending |
| M13 | If a connection is temporarily unavailable/busy, keep an unsent draft and wait for recovery; then send. | Retry preserves the current page draft and sends it once the call is ready. Record any stuck state. | Pending |
| M14 | Open Devices; select another camera/microphone or Browser default and apply. Try unplugging a selected USB device when available. | Device changes preserve text/drafts and mute/camera choices. A failed selection leaves existing tracks usable; missing hardware is labeled and another selection is available. Phone browsers may expose only one input. | Pending |
| M15 | Leave a call page using browser navigation, then return with Back/Forward. Also try an expired invitation. | A cached return preserves the current-page draft and mute choices, revalidates access and restores the call; expired access does not reacquire camera/microphone. A full reload may lose the unsent draft. | Pending |

Since the 2026-10-08 release, choose **Start captions** on each microphone you want transcribed. Camera/microphone permission alone does not start Google transcription. Staging allows 60 aggregate audio minutes per UTC day; two active microphones consume the allowance twice as fast. There is no need to exhaust the allowance deliberately for this batch. If it runs out during normal testing, video/text should continue and Check captions should recover after UTC midnight.

## Engineer-verified evidence (does not replace manual checks)

- Staging HTTPS/private invitation/typed replies/forced TURN delivery and service restart pass.
- Real Google sample transcription, peer final delivery and pause pass.
- One real recognition rotation passed at 270001 ms; no provider retry; largest final-result gap 5025 ms with an approximately 4.8-second repeating fixture.
- Hosted real TURN continuity passed for 3644 seconds, ending 46 seconds after original expiry. Both credentials renewed, all 120 samples showed moving displayed video, 120 typed exchanges passed and both peer connections remained intact. This used low-bandwidth synthetic media with captions disabled; physical long-call behavior remains M10.
- Hosted short capacity check passed ten simultaneous TLS-only calls with twenty native synthetic peers, three moving-video samples and sixty typed deliveries. Captions were disabled and video was capped at 24000 bits/s per peer; this does not establish high-resolution or all-transports capacity.
- Controlled browser-offline plus transport interruption recovered fresh captions, peer video, local tracks, draft and typed delivery. Physical radio handoff remains M04.
- Real Google 15-second incoming-PCM idle cutoff and deliberate restart passed, including fresh peer final captions and typed delivery during pause. The session deadline is covered by deterministic rotation/retry tests and an accelerated browser journey.
- Desktop/mobile controlled server-busy recovery preserves and delivers drafts. Local admission tests cover concurrent capacity, replacement admission, raw polling cleanup and preservation of active room members.
- Automated Chrome, Firefox and WebKit journeys cover native synthetic video, PCM capture, caption retry/pause, audio-context suspension, private invitations, reconnection and draft retention. This does not replace physical device/background/network checks.
- Media recovery journeys cover denied/deferred permission, retry in both roles, signing preview, capture restart, retained mute choices, stopped old tracks and discarded late grants after page exit. Expired reconnects stop local capture and keep the draft.
- Browser audio setup/resume/cleanup deadlines are covered with hung-operation fixtures. Native audio resume recovery keeps live call tracks and typed delivery; physical browser interruptions remain M05.
- Device selection journeys map test IDs to native synthetic streams, verifying exact constraints, sender replacement, old-track cleanup, mute choices, failed-selection preservation, missing-device labels and discovery timeout/stale-result cleanup. Actual hardware selection/unplugging remains M14.
- Post-test streams, sockets and rooms returned to zero. Tests use synthetic media, not measured real-user accuracy.

Pause captions or leave after testing to stop paid recognition. Two active microphones count as two audio streams. Experimental ASL/avatar remain disabled; do not interpret these checks as fluent ASL translation validation.
