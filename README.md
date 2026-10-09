# Tandem

Tandem is a one-to-one video calling project for communication between Deaf ASL users and hearing users. Originally a senior capstone, it is now being rebuilt toward a usable, production-ready application.

The core app supports video and explicit typed replies without AI credentials or model files. Google Cloud captions and speech output can be enabled separately. Fingerspelling recognition and signing avatars remain experimental; fluent ASL translation has not been established.

## Start locally

Use Node 24, then:

```sh
cd tandem-app
npm ci
npm start
```

Open http://localhost:3000 and share the full private invitation link with a second browser or device. See [application setup](tandem-app/README.md) for optional providers, TURN configuration, and tests.

## Project map

- [tandem-app/](tandem-app/): active application, server, browser UI, and optional ASL tools.
- [ASL-interpreter/](ASL-interpreter/): legacy training/reference project.
- [Production plan](docs/PRODUCTION_PLAN.md): audit findings, decisions, and release acceptance gates.
- [Release evidence](docs/RELEASE_EVIDENCE.md): verified results, their limits, and the remaining full-project gates.
- [Cumulative testing checklist](docs/MANUAL_TEST_CHECKLIST.md): owner checks saved for a later testing batch, with completed results recorded.
- [Product context](PRODUCT.md): audience, product limitations, and current UI scope.
- [Continuous ASL direction](docs/CONTINUOUS_ASL.md): video translation candidates, availability findings, and the next implementation gates.

The application is not yet production ready. Google Cloud staging has passed HTTPS, private admission, typed replies, forced TURN delivery, restart and real Google caption checks. A hosted synthetic call kept displayed video and typed replies moving for 3644 seconds, beyond its original relay credential expiry. The owner confirmed phone/laptop connectivity across Wi-Fi and cellular and captions using Chrome on Mac with Safari on phone. Real-user caption accuracy, physical long calls, supported-browser/accessibility coverage and Deaf-user evaluation remain outstanding. See the [resume checkpoint](docs/RESUME.md) for current deployment and verification status.

Staging captions require an explicit Start captions action and share a persistent allowance of 60 aggregate audio minutes per UTC day. Each active microphone consumes its own minutes; video and typed replies continue when the allowance is exhausted. This limits the application's caption usage, not the whole Google Cloud bill.

MIT licensed. See [LICENSE](LICENSE).
