# Criterion Benchmark Reference

The criterion lane compares the local HelpOS-facing Qwen profiles with the same sampling settings:

```text
qwen3.5:9b
hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M
```

Endpoint selection is external configuration:

```bash
OLLAMA_BASE_URL=http://localhost:11434
```

## Dataset sources

- MeetingBank: [dataset](https://meetingbank.github.io/dataset/), [license](https://meetingbank.github.io/license/), and [official utilities](https://github.com/YebowenHu/MeetingBank-utils). The published license page identifies the dataset release as CC BY-NC-ND 4.0.
- QMSum: [official repository](https://github.com/Yale-LILY/QMSum) and [repository license](https://github.com/Yale-LILY/QMSum/blob/main/LICENSE), identified by the repository as MIT. Preserve any upstream data terms alongside the local export.
- AMI: [official corpus](https://groups.inf.ed.ac.uk/ami/corpus/) and [annotation documentation](https://groups.inf.ed.ac.uk/ami/corpus/annotation.shtml). The corpus site states that released signals/transcriptions/annotations are CC BY 4.0; access and annotation availability vary by resource.
- ICSI: [official corpus](https://groups.inf.ed.ac.uk/ami/icsi/index.shtml) and [license](https://groups.inf.ed.ac.uk/ami/icsi/license.shtml). The corpus site states that released signals/transcription/annotations are CC BY 4.0; follow its download instructions and retain access metadata in prepared rows.
- DialogSum: [official repository](https://github.com/cylnlp/dialogsum), [paper](https://aclanthology.org/2021.findings-acl.449), and [Hugging Face mirror](https://huggingface.co/datasets/knkarthick/dialogsum). The mirror identifies the dataset as CC BY-NC-SA 4.0; preserve that license in local cache metadata.
- LongBench v1: [official repository](https://github.com/THUDM/LongBench) and [task/scoring description](https://github.com/THUDM/LongBench/blob/main/LongBench/task.md). The v1 summary lane keeps GovReport, MultiNews, QMSum and VCSUM task rows separate.
- LongBench v2: [official repository and scoring format](https://github.com/THUDM/LongBench).
- IFEval: [official instruction-following evaluator](https://github.com/google-research/google-research/tree/master/instruction_following_eval).

Download or export these into a private cache and pass the local file with `--dataset`. For AMI/ICSI, use a local preparation step that converts the original NXT/XML annotations into the documented JSON/JSONL or fixture-directory shape; do not commit the corpus. One reproducible AMI preparation starting point is the community XML converter used for corpus annotations:

```bash
git clone https://github.com/gcunhase/AMICorpusXML "$PYA_BENCHMARK_CACHE/AMICorpusXML"
python "$PYA_BENCHMARK_CACHE/AMICorpusXML/main_obtain_meeting2summary_data.py" --summary_type abstractive
```

Inspect that converter's input/output directory options for the local AMI release, then map its transcript, summary, speaker and turn files into the prepared JSON/JSONL contract above. The runner records the source URL, caller-provided dataset revision, dataset hash, access status and preparation provenance; it deliberately does not silently fetch large or access-controlled datasets.

## Typical runs

```bash
node command/criterion.mjs list
node command/criterion.mjs run --benchmark meetingbank --dataset "$PYA_BENCHMARK_CACHE/meetingbank/test.jsonl" --profile summary_direct --smoke
node command/criterion.mjs run --benchmark meetingbank --dataset "$PYA_BENCHMARK_CACHE/meetingbank/test.jsonl" --profile summary_reasoned --smoke
node command/criterion.mjs run --benchmark qmsum --dataset "$PYA_BENCHMARK_CACHE/qmsum/test.jsonl" --profile summary_direct --limit 100 --resume
node command/criterion.mjs run --benchmark qmsum --dataset "$PYA_BENCHMARK_CACHE/qmsum/test.jsonl" --profile summary_reasoned_hidden --limit 100 --resume
node command/criterion.mjs run --benchmark ami --fixtures "$PYA_BENCHMARK_CACHE/ami-fixtures" --profile summary_direct --smoke
node command/criterion.mjs run --benchmark icsi --dataset "$PYA_BENCHMARK_CACHE/icsi/prepared.jsonl" --profile summary_direct --smoke
node command/criterion.mjs run --benchmark dialogsum --dataset "$PYA_BENCHMARK_CACHE/dialogsum/test.jsonl" --profile summary_direct --smoke
node command/criterion.mjs run --benchmark longbench-summary --dataset "$PYA_BENCHMARK_CACHE/longbench-v1/summarization.jsonl" --profile summary_reasoned_hidden --smoke
node command/criterion.mjs run --benchmark longbench --dataset "$PYA_BENCHMARK_CACHE/longbench-v2/test.jsonl" --context-length 32768 --smoke
node command/criterion.mjs run --benchmark ifeval --dataset "$PYA_BENCHMARK_CACHE/ifeval/input.jsonl" --profile reasoning --smoke
node command/criterion.mjs run --benchmark helpos-local --fixtures ./fixtures --profile summary_direct --smoke
```

For a controlled simulation:

```bash
node command/criterion.mjs reverie run --benchmark helpos-local --fixtures ./fixtures --responses ./responses.json
```

Reports appear under `criterion/results/<run-id>.*` and review samples under `criterion/review/<run-id>.html`. The `.pya` result is the canonical sentence-shaped manifest; JSONL is the per-sample evidence/checkpoint. `criterion report`, `criterion compare` and `criterion golden` read those persisted records after the original process exits.

## Baseline and open-model lanes

The deterministic MeetingBank baseline uses the same loader, reference extraction, ROUGE scorer and artifact writer as model runs:

```bash
node command/criterion.mjs baseline --benchmark meetingbank --dataset "$PYA_BENCHMARK_CACHE/meetingbank/test.jsonl" --split test --baseline lead-3 --run-id meetingbank-lead3-full --resume --json
```

`baseline:lead-3` selects the first three actual sentences from the transcript. It records CPU processing latency and leaves generation token speed unavailable because it does not call Ollama. Published MeetingBank Lead-3 figures (ROUGE-1 28.15%, ROUGE-2 19.53%, ROUGE-L 25.75%) are validation references, not forced targets; differences must be explained by split, transcript, reference or scorer differences.

For fine-tuned open summarizers, Criterion supports `--engine huggingface`. The Node runner submits inference through Pyash's existing durable GPU duty lane and `gpu-housekeeper`; it does not create a second GPU manager or require a host virtual environment. Start `container/criterion-huggingface/command/begin.sh` on the CUDA host and point `PYA_GPU_HOUSEKEEPER_URL` at its housekeeper. The first supported MeetingBank candidates are `ahmeddeldalyyy/meeting-summarizer-meetingbank` and `Shaelois/MeetingScript`. These are fine-tuned on MeetingBank, while Qwen runs are general-purpose zero-shot Ollama prompts, so published model-card scores are not directly comparable until the same local data, references, scorer and generation configuration are used.

The Ahmed model defaults to 1,024 input tokens, 56-142 output tokens, four beams and length penalty 2.0. MeetingScript defaults to 4,096 input tokens and four beams. Truncation is explicit in per-sample evidence. Model loading and warm inference are separated; unavailable metrics remain null. Weights and datasets stay in the private Hugging Face cache on the execution host. Lead-3 is a CPU-only deterministic baseline and never enters the GPU lane.
