# Private experimental inference runtime

This packages the existing single-frame fingerspelling boundary. It does not
validate recognition accuracy or provide continuous ASL translation. Staging
recognition remains disabled.

From `tandem-app`:

```sh
docker build -f deploy/asl/Dockerfile -t tandem-asl:runtime-check .
python3 deploy/asl/smoke.py
```

The smoke creates its own synthetic sklearn model inside the runtime image,
rejects missing and cross-version models before serving, makes actual HTTP
requests from a second container, checks bounded input/private response headers,
and verifies graceful shutdown. It removes its own containers/network and never
uses cloud providers or the existing trained model. These are runtime contracts,
not accuracy measurements.

For a trusted operator-owned model directory, set `ASL_MODEL_DIRECTORY` and run
`docker compose -f deploy/asl/compose.yaml up --build`. The service has no published
host ports. Its private Docker network denies external routing. An authenticated
Node container must deliberately join that network and use `http://asl:5003`;
the Node container may retain its separate application network. This Compose file
is a local validation tool, not a staging rollout or an automatic enablement.

Only mount reviewed local artifacts as read-only. Pickle can execute code:
version checks do not make untrusted files safe. No model upload/download,
dataset, training dependencies or model bytes are included in the image.
Dependencies are exact and wheel-hash pinned for Linux CPython 3.12 on amd64 and
arm64; incompatible sklearn versions fail startup with a fixed private error.
Gunicorn uses one bounded synchronous worker; BLAS uses one thread. The service
runs as UID 10001 with read-only root, dropped capabilities, no privilege gain,
one CPU, 384 MiB RAM, 64 processes and a bounded temporary filesystem.

Before enabling recognition, complete the provenance and signer-disjoint quality
evaluation in `asl/EVALUATION.md`, agree acceptance/abstention and latency targets,
and validate the actual Node-to-service deployment. The dependency lock is not a
vulnerability audit; deployment must also review current package/base-image
advisories. Do not expose port 5003 to the public internet.
