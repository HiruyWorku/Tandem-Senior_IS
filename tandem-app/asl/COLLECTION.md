# Reviewed landmark collection and export

The legacy camera collector writes annotated images without signer/session
records. Those images and the old X/y cache cannot substantiate unseen-signer
results. This export path accepts new reviewed per-session landmark records;
camera acquisition for this format is still to be implemented/verified.

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
for the separate stages. Logs report aggregate counts only. Real collection,
label correctness, coverage and fluent Deaf-user evaluation remain required.
