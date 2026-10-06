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
- [Cumulative testing checklist](docs/MANUAL_TEST_CHECKLIST.md): owner checks saved for a later testing batch, with completed results recorded.
- [Product context](PRODUCT.md): audience, product limitations, and current UI scope.

The application is not yet production ready. Google Cloud staging has passed HTTPS, private admission, typed replies, forced TURN delivery, restart and a real Google caption smoke test. The owner confirmed phone/laptop connectivity across Wi-Fi and cellular. Real-user caption accuracy, long-call behavior, supported browsers and Deaf-user evaluation remain outstanding. See the [resume checkpoint](docs/RESUME.md) for the overnight pause and restart instructions.

MIT licensed. See [LICENSE](LICENSE).
