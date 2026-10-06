# Cumulative owner testing checklist

Keep adding to this checklist during engineering. Run pending items together when the owner is ready; do not interrupt development to request each check individually. Record device, browser, network and result without pasting private invitations or conversation content.

## Already reported

- [x] Laptop and phone connected across Wi-Fi and cellular.
- [x] Live captions worked using Chrome on Mac for the Deaf role and Safari on phone for the hearing role (2026-10-06). No quantitative accuracy/latency measurements yet.

## Pending batch

| ID | Check | Expected result | Result |
| --- | --- | --- | --- |
| M01 | Confirm video, audio and typed replies in both directions; switch which device uses each role. | Each participant receives the other's video/audio/text. Use headphones or separate rooms. | Pending |
| M02 | Speak conversational sentences, names, numbers and pauses; note approximate caption delay. | Captions remain readable; record missed/repeated words and delays. Do not send private recordings. | Pending |
| M03 | Pause/restart captions, then mute/unmute the microphone. | Pause stops captions without turning off call audio; mute stops microphone audio and its captions; resume works. | Pending |
| M04 | Switch a phone between Wi-Fi and cellular during a call. | Call and fresh captions recover; typed draft remains. Record whether manual retry is needed. | Pending |
| M05 | Lock/unlock the phone or background Safari, then return. | Accurate interruption state, no stuck controls, clear recovery. Background media may be restricted by the browser. | Pending |
| M06 | Deny camera/microphone permission, then use text; later allow access and retry. | Text still works; media failure and recovery are clear. | Pending |
| M07 | Use supported devices/browsers beyond the confirmed Mac Chrome + phone Safari pairing, including Firefox and Android Chrome when available. | Admission, video, text, captions and Leave remain usable. Record browser versions. | Pending |
| M08 | Use keyboard-only navigation, screen reader and 200% zoom; check portrait/landscape and small screens. | Controls remain reachable/labeled and messages readable; no trapped focus or hidden Leave/Send. | Pending |
| M09 | Invite a third device, leave/rejoin, and try an invalid/expired invitation. | Third caller is refused; valid rejoin works; invalid links do not request camera/microphone. | Pending |
| M10 | A longer conversation spanning recognition rotation and TURN renewal. | Record actual interruptions, lost/repeated captions and recovery; coordinate duration with caption cost limits before running. | Pending |
| M11 | Caption limits: after 15 minutes, use Start captions to continue; also check recovery after mobile interruption. | Recognition pauses with Start captions available; video/text remain usable; deliberate restart works. The 15-second idle cutoff measures missing audio packets, not silence. | Pending |
| M12 | Evaluation with Deaf/ASL users when available. | Assess whether captions, attribution, typed reply flow and terminology meet the actual communication need. | Pending |

## Engineer-verified evidence (does not replace manual checks)

- Staging HTTPS/private invitation/typed replies/forced TURN delivery and service restart pass.
- Real Google sample transcription, peer final delivery and pause pass.
- One real recognition rotation passed at 270001 ms; no provider retry; largest final-result gap 5025 ms with an approximately 4.8-second repeating fixture.
- Controlled browser-offline plus transport interruption recovered fresh captions, peer video, local tracks, draft and typed delivery. Physical radio handoff remains M04.
- Real Google 15-second incoming-PCM idle cutoff and deliberate restart passed, including fresh peer final captions and typed delivery during pause. The session deadline is covered by deterministic rotation/retry tests and an accelerated browser journey.
- Post-test streams, sockets and rooms returned to zero. Tests use synthetic media, not measured real-user accuracy.

Pause captions or leave after testing to stop paid recognition. Two active microphones count as two audio streams. Experimental ASL/avatar remain disabled; do not interpret these checks as fluent ASL translation validation.
