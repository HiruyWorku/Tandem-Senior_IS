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
| Uni-Sign | The [authors](https://github.com/ZechengLi19/Uni-Sign) link released ASL pose-sequence weights. [How2Sign checkpoint](https://huggingface.co/ZechengLi19/Uni-Sign/blob/64a2e24003b6e6bdbafca4f24c5f387921cdc6f0/how2sign_pose_only_slt.pth) is downloadable, with an author-published SHA256. [Model card](https://huggingface.co/ZechengLi19/Uni-Sign) specifies CC BY-NC 4.0. | First executable research candidate. Download verified and isolated CPU weights-only loading passed; translation remains unexecuted and commercial deployment is not approved. |

Uni-Sign's checkpoint has been downloaded and loaded for inspection, as recorded below. No candidate has translated a clip in Tandem, been benchmarked locally, or been selected for production. Research scores from different datasets and evaluation protocols do not rank suitability for Tandem calls.

## Uni-Sign compatibility experiment

- Source revision: `eed438bcb49e30405cd6ccdfcccca330c134e830` (author repository, February 11, 2026).
- Weight revision: `64a2e24003b6e6bdbafca4f24c5f387921cdc6f0`, file `how2sign_pose_only_slt.pth`, 1,186,925,007 bytes, SHA256 `1bfd5f3312f04e4736f0a52f4ef9535916e6de9676a2a0d00c708748683fb00d`.
- Local asset: `/private/tmp/tandem-unisign-how2sign.pth`; no model binary committed or uploaded to staging.
- Python 3.12 / PyTorch 2.14.1+cpu on Linux arm64 loaded 627 state entries: 583 BF16 and 44 int64. Language embedding shape `[250112,768]`, pose projection `[768,1024]`. No arbitrary pickle loader or author source was executed. `weights_only=True` is a narrower loader, not a substitute for isolation.
- The probe used a non-root, read-only, network-disabled container, two CPUs, 4 GiB memory, 64 PIDs and only two read-only file mounts. Initial mmap loading took 0.048 seconds and reported 234,960 KiB peak RSS. These figures cover loading metadata/mapped tensors, **not touched-weight memory, model construction, translation latency or capacity**.

The reusable [inspection command](../tandem-app/asl/research/unisign_probe.py) verifies the exact asset before loading. Experimental local image `tandem-unisign:cpu-probe` adds CPU-only PyTorch to the existing local inference-check image; its extra dependencies are not a production lock or audited deployment candidate. It is not used by the app or regular CI. Reproduce the inspected loader with:

```sh
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --memory 4g --cpus 2 --pids-limit 64 \
  --tmpfs /tmp:rw,size=32m \
  -v /private/tmp/tandem-unisign-how2sign.pth:/model/checkpoint.pth:ro \
  -v "$PWD/tandem-app/asl/research/unisign_probe.py:/probe.py:ro" \
  tandem-unisign:cpu-probe /probe.py /model/checkpoint.pth
```

The [author's inference code](https://github.com/ZechengLi19/Uni-Sign/blob/eed438bcb49e30405cd6ccdfcccca330c134e830/demo/online_inference.py) assumes CUDA, keeps the whole video's frames in memory, and concurrently invokes a shared pose extractor. Its [arguments](https://github.com/ZechengLi19/Uni-Sign/blob/eed438bcb49e30405cd6ccdfcccca330c134e830/utils.py) default to CSL_Daily; the ASL experiment must explicitly select How2Sign. The input needs the original 133-point whole-body pose layout and preprocessing, not MediaPipe hand landmarks. Next: isolated CPU architecture/tokenizer setup and generation on a bounded synthetic pose sequence to establish compatibility, then an explicitly licensed real clip. Synthetic generation cannot establish accuracy or useful translation.

## Data and release constraints

[How2Sign's own terms](https://how2sign.github.io/) identify research-only availability and CC BY-NC 4.0 dataset licensing. The MIT license on a code repository does not establish commercial permission for its data or model weights. Checkpoint-specific rights still need inspection. An offline research comparison cannot establish permission to ship a public translation service.

The site's existing partitions follow the source How2 dataset splits. We must inspect actual signer identities before describing them as signer-independent. Instructional recordings also do not establish accuracy on spontaneous, two-person conversation or phone cameras.

Full video sequences retain movement, both hands, body and facial information. The current manual collector saves single-hand landmarks only; it cannot supply all of these inputs. Do not silently extend that collector to record participant video under its current consent description.

## Next implementation and acceptance evidence

1. Complete Uni-Sign tokenizer/architecture compatibility using its inspected ASL checkpoint and original feature schema. Record immutable hashes for remaining assets. External pickle-based checkpoints must run in an isolated, unprivileged environment without credentials, network or unrelated host mounts. The unavailable UPC reference remains an optional comparison, rather than a prerequisite for this experiment.
2. Reproduce inference on a small, explicitly licensed reference subset using its original feature extractor and preprocessing. Do not replace spatial/motion features with our letter landmarks. Retain actual reference text and model output locally for evaluation, outside Git and ordinary application logs.
3. Measure model loading, peak memory, per-clip inference time and end-to-end extraction time separately. Start with existing local hardware. A GPU VM, paid API or always-on inference service requires an actual cost/latency comparison before provisioning.
4. Evaluate meaning preservation with fluent Deaf ASL reviewers on consented, unseen signers and conversational clips. Include no-sign input, occlusion, unfamiliar vocabulary, handedness, lighting and phone framing. Measure unsupported generated text as well as translation quality; fluent output is not proof that the video supports it.
5. Only after a useful candidate exists, add bounded clip transport and private translation drafts to calls. Require explicit capture/processing consent, explicit sending, cancellation on departure, and defined retention/provider handling. Do not auto-send or speak generated text.

The first gate is executable reference inference. The second is measured useful translation. The third is justified integration and production rights. None is currently passed. This track preserves the full translation objective while preventing a working letter demo from being mistaken for its completion.
