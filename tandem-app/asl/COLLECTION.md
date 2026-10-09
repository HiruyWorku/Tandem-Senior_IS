# Reviewed landmark collection and export

The legacy camera collector writes annotated images without signer/session
records. Those images and the old X/y cache cannot substantiate unseen-signer
results. This export path accepts new reviewed per-session landmark records;
the new local collector implements acquisition for that format. Physical camera,
permissions, window controls and positive hand detection remain manual gates.

## Local camera capture

Use a separate Python 3.12 environment on macOS arm64 or Linux amd64/arm64:

```sh
python3.12 -m venv /private/collection-env
/private/collection-env/bin/python -m pip install --only-binary=:all: --require-hashes \
  -r asl/requirements-collection.lock
```

Choose a writable private path for that environment and the commands below. Do
not install these camera dependencies in the deployed inference image. The lock
contains nineteen exact packages/wheel hashes, including MediaPipe 1.1.0 and
OpenCV contrib 4.14.0.94. A fresh package-advisory scan reports no known issues;
this does not cover OS or unknown vulnerabilities.

Provide a trusted local HandLandmarker task asset and its independently checked
SHA256. See the [official model and Python setup](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/python).
The collector never downloads a model. A Google version-1 asset used for native
blank-frame verification had SHA256
`fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`;
this records the tested bytes, not a promise that every future asset is identical.

Create reviewed session metadata with `signer_id`, `session_id`, `source`,
`license`, `consent_review`, `lighting`, `viewpoint` and `dominant_hand`
(`left`, `right` or `ambidextrous`). Then, from `tandem-app`:

```sh
/private/collection-env/bin/python -m asl.capture_session \
  --metadata /private/reviewed-session.json \
  --landmarker-model /private/hand_landmarker.task \
  --landmarker-sha256 VERIFIED_SHA256 --output /private/new-session \
  --labels A B __unknown__
```

`npm run asl:collect -- ...` invokes the same collector using `python` from the
active environment. It validates inputs before loading native packages or opening
a camera. **Space** saves one explicitly labeled eligible sample, **N** changes
label, and **Q/Escape** or closing the preview finishes. Nothing is automatically
recorded. It refuses zero/multiple detected hands and invalid coordinates; at
most two samples/second are saved. Preview annotations never enter detection.
The detector considers up to two hands so it can refuse multi-hand frames rather
than silently selecting one.

`--camera` selects a local camera index. `--max-samples` defaults to 5000 and
`--duration-seconds` to 900 (range 1–3600); time expiry is checked between camera
frames. Normal stop, sample/time limit and camera interruption finalize existing
samples with an explicit stop reason and release the camera/window. Empty captures
leave no session directory. Exceptions abort unfinished files; a process/OS crash
may leave `.part` files, which cannot be exported as a completed session. Retain
or delete those under the agreed private-data policy, never fabricate a manifest.

Only `session.jsonl` and `session.json` are saved, with mode 600 in a new mode-700
directory. There are no saved images, audio, upload calls, labels guessed by a
classifier or automatic training. The manifest records actual detector versions,
asset hash and configuration. Keep the same signer identity across sessions.
This Tasks detector and the existing browser landmark pipeline require comparison
on real inputs before claiming matching perception quality.

For a native compatibility check without opening a camera/window:

```sh
/private/collection-env/bin/python -m asl.native_capture_check \
  --landmarker-model /private/hand_landmarker.task --landmarker-sha256 VERIFIED_SHA256
```

This passed on macOS arm64 with three blank frames using the actual pinned SDK,
shared detector construction, RGB conversion and preview annotation API. It does
not establish positive-hand accuracy, GUI behavior or camera permission handling.

## Session export

Before collecting, agree the task, labeling procedure, participant consent,
license, retention and the training/validation/benchmark signer assignment.
Use actual pseudonymous identities consistently across sessions. Do not derive
new signer IDs per image or invent identities for the legacy cache. Keep the
identity key and participant records separately under the agreed policy.

Each session has a UTF-8 JSONL file and an adjacent JSON manifest. For example,
`session1.jsonl` and `session1.json`. Each record has:

```json
{"sample_id":"unique-sample-id","label":"A","landmarks":["63 numeric coordinates in x,y,z order"]}
```

The string above describes the array shape; actual landmarks must contain 63
finite numbers within -10 to 10, matching the browser prediction boundary.
Labels are A–Z or `__unknown__` for unsupported gestures/transitions. Unknown
inputs belong in validation and benchmark, not the known-letter training set.
No-hand detection requires separate browser-perception evaluation; do not invent
hand landmarks for absent hands. Static frames cannot validate J/Z movement or
continuous ASL. Record lighting, viewpoint, hand preference and collection method
in the manifest/collection records and review representation before making claims.

The session manifest declares `sha256` of the exact JSONL bytes, `signer_id`,
`session_id`, `source`, `license` and `consent_review`. Sources and consent fields
refer to actual reviewed records, not placeholders. Hashes establish artifact
identity, not the truth of provenance. Extra manifest context is preserved.

The predeclared split manifest contains:

```json
{
  "training_signers": ["train-1", "train-2"],
  "validation_signers": ["validation-1"],
  "benchmark_signers": ["benchmark-1", "benchmark-2"],
  "dataset_license": "Reviewed rights for the derived dataset",
  "consent_review": "Reference to consent and retention review"
}
```

The example identifiers/rights text are illustrative. At least two training
signers, one validation signer and two benchmark signers are required. These
are plumbing minima, not representative-sample or accuracy targets. All assigned
signers need actual samples; no signer may occur in more than one partition.

From `tandem-app`, in the pinned Python environment:

```sh
python -m asl.export_partitions \
  --collection /private/session1.jsonl --collection /private/session2.jsonl \
  --split-manifest /private/predeclared-split.json --output /private/new-partitions
```

Pass every session needed for all assigned signers; the command above only shows
how to repeat the collection argument. The exporter rejects missing/mismatched
provenance, duplicate sessions/sample IDs, unassigned signers, overlap, invalid
coordinates and records over 16 KiB. The total limit is 100,000 samples. All
collections are validated before output creation. Existing output directories
are refused. Output uses directory mode 700/files 600 and contains training,
validation and benchmark NPZ/JSON pairs, with the shared 73-feature transform,
signer/session/sample IDs, collection declarations and split checksum. Partial
write failures remove the newly generated files. It never writes camera images,
loads pickle, contacts a provider or trains a model.

Store inputs/outputs outside the repo in private storage. Restrict benchmark
feature access until model/threshold selection is complete; pseudonyms still
identify a participant within this dataset. Use [training and evaluation](EVALUATION.md)
for the separate stages. Command summaries report aggregate counts only. Real collection,
label correctness, coverage and fluent Deaf-user evaluation remain required.
