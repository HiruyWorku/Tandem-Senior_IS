# Tandem product context

Tandem supports one-to-one communication between Deaf ASL users and hearing users. This project began as a capstone and is being developed toward a production release.

The owner has delegated routine engineering and implementation decisions. The first-release engineering default is reliable video calling, live captions where configured, typed replies, and optional speech output. Audience and workflow validation with Deaf users remains outstanding.

Explicitly sent text is the dependable communication fallback. Camera or microphone denial and unavailable AI providers must not block room admission or text replies. Drafts remain in the current page during disconnects; they are not a durable cross-device store. No transcript retention or recording service is implemented.

Automated recognition is experimental fingerspelling assistance, not validated continuous ASL translation. Recognition produces a private draft; the signer reviews and explicitly sends their reply. LLM suggestions may be wrong. Generated signing avatars are optional and unvalidated. Speech services process conversation content through external providers when enabled.

Current UI work extends the existing warm dark surfaces, amber accents, and existing typography. It does not replace the visual identity. For the conversation panel, success means readable messages, labeled drafts, keyboard submission, clear acknowledgement and provider states, and complete desktop/mobile access to Send and Leave.

Release readiness depends on the acceptance gates in docs/PRODUCTION_PLAN.md, including two-device cross-network calls, supported-browser checks, Deaf-user evaluation, privacy/access controls, and operational verification.

Private invitations are the default admission method. Share the complete link, not its visible room code. Links are bearer credentials and anyone holding one can join, up to two callers. Invalid/expired links must provide an explicit recovery path, and must not trigger camera/microphone requests. Invitation UI extends the incumbent warm dark/amber design.
