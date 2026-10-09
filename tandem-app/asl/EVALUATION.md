# Recognition evaluation

The existing local `dataset_v2.npz` has 34,000 rows with `X` and `y` only.
It contains no signer identities, held-out partition or provenance manifest.
The legacy training script fits its final artifact on the full dataset. Do not
evaluate that artifact on those same rows and call it unseen-user accuracy.
Random sample splits also allow related samples from one signer on both sides.
Use signer-separated training, validation and benchmark data, following the
[scikit-learn guidance for grouped evaluation](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data).

`evaluation.py` provides an offline evaluation path for the existing 73-feature
v2 single-frame classifier. It does not train a model, download data, contact a
provider or enable recognition in staging. It requires:

- An operator-trusted local pickle model and its JSON provenance manifest.
  Pickle can execute code: never use a user upload or unknown downloaded model.
- A numeric, non-pickle NPZ benchmark containing `X` (N × 73), `y` (letter labels
  or `__unknown__` for non-letter/unsupported input), `signer_id` and `sample_id`.
  Identities must be pseudonymous strings; sample identities must be unique.
- At least two benchmark signers, each absent from both training and validation,
  and unknown inputs. This minimum makes the plumbing usable; it is not evidence
  that two people represent the intended audience.
- Separate model and benchmark JSON manifests with `sha256`, `source`, `license`
  and `consent_review`. The model manifest also declares `training_signers` and
  `validation_signers`. A matching hash verifies identity of an artifact, not the
  truth of its provenance. An operator must verify the declarations against the
  collection and training records.
- An acceptance threshold chosen using separate validation data before looking
  at benchmark results. Repeated threshold/model tuning on the benchmark makes
  it validation data; obtain a new held-out benchmark for final evaluation.

Run from `tandem-app` in the model's compatible, isolated Python environment:

```sh
python asl/evaluation.py --model /private/model_v2.p \
  --model-manifest /private/model-provenance.json \
  --benchmark /private/held-out.npz \
  --benchmark-manifest /private/benchmark-provenance.json \
  --threshold 0.8 --report /private/evaluation.json
```

`0.8` is only an invocation example, not an approved quality threshold. The
report separates accepted predictions, abstentions and wrong accepted
predictions; includes coverage, accepted accuracy, per-letter counts, unknown
false acceptances and the worst observed signer wrong-acceptance rate. A model
that abstains on everything has zero coverage and undefined accepted accuracy,
not perfect accuracy. Model scores are not assumed to be calibrated confidence.
Batch inference duration measures this local batch, not end-to-end call latency.
Reports omit signer identities, sample identities and features; store the input
data privately under the agreed retention policy.

The report always says `production_ready: false`. It cannot establish dataset
rights/consent, representative coverage, calibration, browser motion handling,
end-to-end latency, continuous ASL understanding or Deaf-user acceptance.
Include lighting, viewpoint, dominant hands, background, no-hand and transition
inputs in the benchmark design. J/Z movement and contextual ASL require temporal
evaluation; still-image letter predictions do not validate these tasks.
Publish quality targets and review results with fluent Deaf ASL users before
making a product claim or enabling the experiment for real users.

## Training without signer leakage

For newly reviewed landmark sessions, use the [collection export format](COLLECTION.md)
to generate private, signer-separated partitions. Camera acquisition for that
format is implemented by the local collector, with physical camera/permission
verification still pending; do not substitute invented identities for the old
image-only collection.

`npm run asl:train -- ...` now invokes `python -m asl.train_reviewed`, not the
legacy sample-split/image trainer. Provide separate training and validation NPZ
files with the same `X`, `y`, `signer_id`, `sample_id` fields and reviewed manifests
described above. Training requires at least two signers and two known letters;
validation requires a different signer, supported letters and unknown inputs.
Signer and sample overlap, missing declarations, invalid arrays and mismatched
hashes fail before fitting. Never use real names or email addresses as identities.

```sh
python -m asl.train_reviewed \
  --training /private/training.npz --training-manifest /private/training.json \
  --validation /private/validation.npz --validation-manifest /private/validation.json \
  --threshold 0.8 --model-license 'Reviewed derived-model license' \
  --model-consent-review 'Reference to reviewed consent/retention record' \
  --output /private/new-candidate
```

Use the isolated pinned inference dependency environment for this offline command;
it requires no camera tools or downloaded datasets. The output directory must not
exist. It is created with mode 700, and `model_v2.p`, `model-provenance.json` and
`validation-report.json` use mode 600. Keep it outside the repository. The model
manifest includes partition hashes/declarations, pseudonymous signer sets and the
sklearn version; these remain private. Rights for the derived model require an
explicit operator declaration rather than inheriting a dataset license blindly.

The deterministic, single-threaded random-forest baseline fits only training rows;
validation never enters fitting or an internal random early-stopping split. The
threshold is explicit and may be adjusted using validation results. Reserve the
final signer-disjoint benchmark until the model/threshold are selected; this
trainer does not accept a benchmark argument. It makes no superiority, calibrated
confidence, continuous-ASL or production-quality claim. Synthetic CI checks prove
the partition/artifact contracts, not that the model is useful. Existing unlabeled
signer caches cannot be converted to reviewed partitions by inventing identities.
