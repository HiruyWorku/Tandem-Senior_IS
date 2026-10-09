# Continuous ASL implementation decision

Investigated 2026-10-08. This is a feasibility decision, not a model evaluation result.

The next recognition milestone is an **offline, sentence-level ASL-to-English baseline on video sequences**, followed by private, explicitly requested translation drafts in calls. The existing 73-feature letter model and its training tools remain a separate fingerspelling experiment. They are not the foundation for continuous translation.

## Candidates and actual availability

| Candidate | Evidence inspected | Decision |
| --- | --- | --- |
| Google SignGemma | Google's [May 2025 announcement](https://blog.google/innovation-and-ai/technology/developers-tools/google-ai-developer-updates-io-2025/) describes an upcoming ASL-to-English model. The current [model-card index](https://deepmind.google/models/model-cards/) and [Google model collections](https://huggingface.co/google/collections) did not establish a released checkpoint or serving API. | Do not build an integration against an announcement. Availability remains unverified; absence from these listings does not prove cancellation. |
| UPC How2Sign baseline | The authors' [project](https://imatge-upc.github.io/slt_how2sign_wicv2023/) and [implementation](https://github.com/imatge-upc/slt_how2sign_wicv2023) publish a video-feature Transformer, tokenizer and checkpoint instructions. The linked [asset repository](https://dataverse.csuc.cat/dataset.xhtml?persistentId=doi%3A10.34810%2Fdata693) returned HTTP 502 through the research browser. | First reference for a bounded offline compatibility experiment once assets and terms can be inspected. It provides a reproducibility target, not evidence of conversational quality. |
| SpaMo | The [authors' implementation](https://github.com/eddie-euijun-hwang/SpaMo) combines spatial and motion encoders. Its supplied [configuration](https://github.com/eddie-euijun-hwang/SpaMo/blob/main/configs/finetune.yaml) uses Flan-T5-XL and Phoenix14T; that configuration is not an ASL checkpoint. The linked checkpoint page reported a temporarily disabled Dropbox link. | Investigate after the reference baseline. Do not load a German-language checkpoint as ASL or assume third-party webcam forks supply reviewed weights. No local latency or memory measurements exist. |
| SignMouth | The [published research summary](https://scholars.hkbu.edu.hk/en/publications/mouthing-enhanced-multimodal-hierarchical-contrastive-learning-fo/) describes a mouth-aware improvement. The [author repository](https://github.com/wwf47/SignMouth) contains code but its visible README supplies no usable checkpoint/setup instructions. | Track as a candidate; insufficient evidence to select a reproducible runtime now. |

No candidate has been downloaded, executed, benchmarked or selected for production. Research scores from different datasets and evaluation protocols do not rank suitability for Tandem calls.

## Data and release constraints

[How2Sign's own terms](https://how2sign.github.io/) identify research-only availability and CC BY-NC 4.0 dataset licensing. The MIT license on a code repository does not establish commercial permission for its data or model weights. Checkpoint-specific rights still need inspection. An offline research comparison cannot establish permission to ship a public translation service.

The site's existing partitions follow the source How2 dataset splits. We must inspect actual signer identities before describing them as signer-independent. Instructional recordings also do not establish accuracy on spontaneous, two-person conversation or phone cameras.

Full video sequences retain movement, both hands, body and facial information. The current manual collector saves single-hand landmarks only; it cannot supply all of these inputs. Do not silently extend that collector to record participant video under its current consent description.

## Next implementation and acceptance evidence

1. Recover and inspect the author's checkpoint, tokenizer, feature schema, exact source revision and asset-specific terms. Record immutable hashes before any model loading. External pickle-based checkpoints must run in an isolated, unprivileged environment without credentials, network or unrelated host mounts.
2. Reproduce inference on a small, explicitly licensed reference subset using its original feature extractor and preprocessing. Do not replace spatial/motion features with our letter landmarks. Retain actual reference text and model output locally for evaluation, outside Git and ordinary application logs.
3. Measure model loading, peak memory, per-clip inference time and end-to-end extraction time separately. Start with existing local hardware. A GPU VM, paid API or always-on inference service requires an actual cost/latency comparison before provisioning.
4. Evaluate meaning preservation with fluent Deaf ASL reviewers on consented, unseen signers and conversational clips. Include no-sign input, occlusion, unfamiliar vocabulary, handedness, lighting and phone framing. Measure unsupported generated text as well as translation quality; fluent output is not proof that the video supports it.
5. Only after a useful candidate exists, add bounded clip transport and private translation drafts to calls. Require explicit capture/processing consent, explicit sending, cancellation on departure, and defined retention/provider handling. Do not auto-send or speak generated text.

The first gate is executable reference inference. The second is measured useful translation. The third is justified integration and production rights. None is currently passed. This track preserves the full translation objective while preventing a working letter demo from being mistaken for its completion.
