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
