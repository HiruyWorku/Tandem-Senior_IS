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
| Uni-Sign | The [authors](https://github.com/ZechengLi19/Uni-Sign) link released ASL pose-sequence weights. [How2Sign checkpoint](https://huggingface.co/ZechengLi19/Uni-Sign/blob/64a2e24003b6e6bdbafca4f24c5f387921cdc6f0/how2sign_pose_only_slt.pth) is downloadable, with an author-published SHA256. [Model card](https://huggingface.co/ZechengLi19/Uni-Sign) specifies CC BY-NC 4.0. | First executable research candidate. Original architecture and actual checkpoint now generate on CPU, including a no-sign failure. Real-input accuracy remains unmeasured; commercial deployment is not approved. |

Uni-Sign's checkpoint has been downloaded and executed on synthetic poses, as recorded below. No candidate has translated a real clip in Tandem, had its accuracy benchmarked locally, or been selected for production. Research scores from different datasets and evaluation protocols do not rank suitability for Tandem calls.

## Uni-Sign compatibility experiment

- Source revision: `eed438bcb49e30405cd6ccdfcccca330c134e830` (author repository, February 11, 2026).
- Weight revision: `64a2e24003b6e6bdbafca4f24c5f387921cdc6f0`, file `how2sign_pose_only_slt.pth`, 1,186,925,007 bytes, SHA256 `1bfd5f3312f04e4736f0a52f4ef9535916e6de9676a2a0d00c708748683fb00d`.
- Local asset: `/private/tmp/tandem-unisign-how2sign.pth`; no model binary committed or uploaded to staging.
- The initial Python 3.12 / PyTorch 2.14.1+cpu inspection loaded 627 state entries: 583 BF16 and 44 int64. Language embedding shape `[250112,768]`, pose projection `[768,1024]`. That inspection executed no author architecture source. Later isolated generation does execute the pinned source as described below. `weights_only=True` is a narrower loader, not a substitute for isolation.
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

The [author's inference code](https://github.com/ZechengLi19/Uni-Sign/blob/eed438bcb49e30405cd6ccdfcccca330c134e830/demo/online_inference.py) assumes CUDA, keeps the whole video's frames in memory, and concurrently invokes a shared pose extractor. Its [arguments](https://github.com/ZechengLi19/Uni-Sign/blob/eed438bcb49e30405cd6ccdfcccca330c134e830/utils.py) default to CSL_Daily; the ASL experiment explicitly selects How2Sign. Real input needs the original 133-point whole-body pose layout and preprocessing, not MediaPipe hand landmarks.

## Actual synthetic generation results

The saved [offline runner](../tandem-app/asl/research/unisign_generate.py) verifies hashes of six author source files and five official mT5 tokenizer/config files before execution. Tokenizer revision is `google/mt5-base@2eb15465c5dd7f72a8f7984306ad05ebc3dd1e1f`; the [asset manifest](../tandem-app/asl/research/unisign_assets.json) pins each file. The checkpoint includes the language weights, so model construction uses the official config on a meta device, then strictly loads the full checkpoint with `assign=True`. No duplicate base-language weights are downloaded. Both parameters and buffers must leave the meta device.

The only source-import change removes unused torchvision for the disabled RGB branch. Original pose encoder and text decoder operations are retained. Model dtype is checkpoint BF16. The experiment skips camera/pose extraction and supplies all-zero body/hand/face tensors, not participant data. Transformers 5.19.0, SentencePiece 0.2.1, einops 0.8.1 and protobuf 7.36.2 were added to the experimental container. The first run failed before loading the model because SentencePiece conversion required protobuf; after adding it, both runs passed.

| Input and decoding | Forward plus generation | Peak container-process RSS | Result |
| --- | --- | --- | --- |
| 16 zero-pose frames, 16-token cap, one beam | 2.902 s (forward 1.209 s) | 1,828,400 KiB | 10 output tokens, nonempty decoded text |
| 256 zero-pose frames, original 100-token cap/four beams | 24.698 s (forward 11.205 s) | 1,910,488 KiB | 25 output tokens, nonempty decoded text |

Timings exclude source/tokenizer loading, model construction and video pose extraction; they do not measure real-call latency. Both inputs contain **no signing**, yet the model produced text. This is a directly observed unsupported-output failure on synthetic input. It does not quantify real-camera hallucination frequency, and a no-sign gate alone would not establish semantic reliability. Keep all output private; do not enable this candidate in calls based on these results.

The author source inventory contains no small `.mp4`, `.webm`, `.npy`, `.npz` or `.pkl` reference sample at the pinned revision. Next is retrieving a bounded, licensed real reference pose/clip with its annotation, then checking original preprocessing and generation. Fluent ASL review remains a later owner-arranged milestone.

To reproduce from existing local images and the downloaded checkpoint:

```sh
# Use a new output directory. Downloads approximately 4.35 MB, no weights/video.
python3 tandem-app/asl/research/fetch_unisign_assets.py /private/tmp/tandem-unisign-assets
docker build -f tandem-app/asl/research/Dockerfile.unisign-execution \
  -t tandem-unisign:cpu-execution tandem-app/asl/research
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --memory 6g --cpus 2 --pids-limit 64 \
  --tmpfs /tmp:rw,size=32m \
  -v /private/tmp/tandem-unisign-how2sign.pth:/model/checkpoint.pth:ro \
  -v /private/tmp/tandem-unisign-assets:/assets:ro \
  -v "$PWD/tandem-app/asl/research:/research:ro" \
  tandem-unisign:cpu-execution /research/unisign_generate.py \
  /assets /model/checkpoint.pth --frames 256 --tokens 100 --beams 4
```

The build requires local `tandem-unisign:cpu-probe`; its [recipe](../tandem-app/asl/research/Dockerfile.unisign-probe) in turn requires `tandem-asl:runtime-check` built with the inference Dockerfile. These research recipes pin primary package versions but not all transitive wheels or base images; they are not a reproducible production dependency lock. The saved runner has a 120-second process alarm and fixed frame/token/beam bounds. No GPU, hosted inference service or staging change occurred.

## Data and release constraints

[How2Sign's own terms](https://how2sign.github.io/) identify research-only availability and CC BY-NC 4.0 dataset licensing. The MIT license on a code repository does not establish commercial permission for its data or model weights. Checkpoint-specific rights still need inspection. An offline research comparison cannot establish permission to ship a public translation service.

The site's existing partitions follow the source How2 dataset splits. We must inspect actual signer identities before describing them as signer-independent. Instructional recordings also do not establish accuracy on spontaneous, two-person conversation or phone cameras.

Full video sequences retain movement, both hands, body and facial information. The current manual collector saves single-hand landmarks only; it cannot supply all of these inputs. Do not silently extend that collector to record participant video under its current consent description.

## Next implementation and acceptance evidence

1. Complete real-input Uni-Sign compatibility using its inspected ASL checkpoint, tokenizer and original feature schema. Synthetic architecture/generation compatibility has passed; this does not establish real-input fidelity. External pickle-based checkpoints must run in an isolated, unprivileged environment without credentials, network or unrelated host mounts. The unavailable UPC reference remains an optional comparison, rather than a prerequisite for this experiment.
2. Reproduce inference on a small, explicitly licensed reference subset using its original feature extractor and preprocessing. Do not replace spatial/motion features with our letter landmarks. Retain actual reference text and model output locally for evaluation, outside Git and ordinary application logs.
3. Measure model loading, peak memory, per-clip inference time and end-to-end extraction time separately. Start with existing local hardware. A GPU VM, paid API or always-on inference service requires an actual cost/latency comparison before provisioning.
4. Evaluate meaning preservation with fluent Deaf ASL reviewers on consented, unseen signers and conversational clips. Include no-sign input, occlusion, unfamiliar vocabulary, handedness, lighting and phone framing. Measure unsupported generated text as well as translation quality; fluent output is not proof that the video supports it.
5. Only after a useful candidate exists, add bounded clip transport and private translation drafts to calls. Require explicit capture/processing consent, explicit sending, cancellation on departure, and defined retention/provider handling. Do not auto-send or speak generated text.

The first gate is executable inference on a licensed real reference. The second is measured useful translation. The third is justified integration and production rights. None is currently passed; synthetic execution is one prerequisite now established. This track preserves the full translation objective while preventing a working letter demo from being mistaken for its completion.
