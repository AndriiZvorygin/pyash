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

## Paired MeetingBank prompt experiment

Use `prompt-ablation` to compare the existing generic `summary_direct` prompt
with a fixed MeetingBank-aware zero-shot municipal-minutes prompt for Qwen:

```bash
OLLAMA_BASE_URL=http://mriczo:11434 node command/criterion.mjs prompt-ablation \
  --dataset "$PYA_BENCHMARK_CACHE/meetingbank/test.jsonl" \
  --annotations "$PYA_BENCHMARK_CACHE/omnicseval/meetingbank-with-source-ids.json" \
  --source-run full-meetingbank-summary-direct-20260913 \
  --comparison-run meetingbank-meetscript-full-20260915 \
  --model qwen3.5:9b,hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M \
  --run-id meetingbank-qwen-prompt-ablation-20260915 --smoke --resume --json
```

The two variants are `qwen_baseline_generic` and
`qwen_meetingbank_reference`. The latter is zero-shot and has no examples or
reference summaries. The experiment is paired by exact MeetingBank source ID
and uses the same local transcript, profile, context, model, retry and output
parsing for both variants. It never overwrites the generic full-corpus run.

The annotation input must identify each source row explicitly. Criterion does
not guess from transcript text, array position or fuzzy similarity. It records
missing, duplicate and ambiguous joins and makes no model request for an
unmatched subset. This matters because some released OmniCSEval archive forms
contain 75 MeetingBank annotations but omit source IDs; provide an ID-bearing
local manifest before claiming a 75-sample result.

Every selected row stores the complete effective prompt and its hash. The
combined report verifies source hashes and generation settings, records model
digest equality when the provider exposes digests, and marks unavailable
digests as unverified. An unavailable digest makes a saved generic row
unverifiable for reuse, so it is regenerated in its own checkpoint. It renders
ROUGE, schema, latency, output length and
generation speed for each variant, paired sample deltas with deterministic
bootstrap 95% intervals, city/item-type/chunking groups, degraded/improved
examples and MeetingScript rows matched to the same IDs. Use
`--fact-judge-model` to attach the separate post-hoc fact-audit scores; this
does not regenerate either variant.

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

For fine-tuned open summarizers, Criterion supports `--engine huggingface`. The Node runner submits inference through Pyash's existing durable GPU duty lane and `gpu-housekeeper`; it does not create a second GPU manager or require a host virtual environment. Start `container/criterion-huggingface/command/begin.sh` on the CUDA host and point `PYA_GPU_HOUSEKEEPER_URL` at its housekeeper. The supported MeetingBank candidates are `ahmeddeldalyyy/meeting-summarizer-meetingbank`, `Shaelois/MeetingScript`, and `MingZhong/DialogLED-large-5120`. These are fine-tuned or pretrained Hugging Face models served by the external GPU runtime, while Qwen runs are general-purpose zero-shot Ollama prompts, so published model-card scores are not directly comparable until the same local data, references, scorer and generation configuration are used.

The Ahmed model defaults to 1,024 input tokens, 56-142 output tokens, four beams and length penalty 2.0. MeetingScript defaults to 4,096 input tokens and four beams. DialogLED-large-5120 defaults to 5,120 input tokens and four beams. MeetingScript and DialogLED use deterministic overlapping token windows for long inputs in the external runtime; each result explicitly records chunking and truncation metadata, and never silently drops over-limit input. Model loading and warm inference are separated; unavailable metrics remain null. Weights and datasets stay in the private Hugging Face cache on the execution host. Lead-3 is a CPU-only deterministic baseline and never enters the GPU lane.

## MeetingBank factuality pilot

The factuality-first pilot is a separate, post-generation evaluation lane:

```bash
OLLAMA_BASE_URL=http://mriczo:11434 \
PYA_GPU_HOUSEKEEPER_URL=http://mriczo:8090 \
node command/criterion.mjs meetingbank-factuality-pilot \
  --dataset "$PYA_BENCHMARK_CACHE/meetingbank/test.jsonl" \
  --run-id meetingbank-qwen-factuality-pilot-20260916 \
  --resume --json
```

It selects ten deterministic MeetingBank test samples and runs the same
MeetingBank-aware generation prompt for `qwen3.5:9b`,
`hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M`, and `qwen3.8:27b`.
Generation remains on remote Ollama. The reference summary is retained for
provenance but is hidden from the UniRRM judge.

The judge lane is transcript-grounded and provisional. It sends one UniRRM
pointwise request per successful summary, with a bounded claim list and
transcript turn evidence in the response. Criterion performs the arithmetic
locally for faithfulness, completeness, decision/action fidelity, relevance,
conciseness, and publication suitability. Faithfulness is
`(supported + 0.5 * partially-supported) / material claims`. Human-facing
values are percentages and the dimensions remain separate; no overall winner
is declared without human-labelled calibration.

Generation is batched before judging to avoid GPU/VRAM thrashing: Criterion
preflights and generates all selected rows for one Qwen model, discharges that
model, then continues with the next Qwen model. Only after every Qwen
generation batch is complete does Criterion load UniRRM and judge the
successful summaries. UniRRM is discharged after the judge batch completes.

ROUGE is excluded from the default factuality report and remains historical
reference-similarity evidence in the older model-run artifacts. A judge row is
complete only when all required passes return structured native UniRRM
evaluations with evidence. Transport, model, malformed-output, truncated, and
incomplete responses are recorded separately, with one bounded JSON repair
retry. The judge uses a bounded 2,048-token response budget by default so
native UniRRM evidence JSON is not cut off mid-claim. The JSONL checkpoint is
resumable and preserves raw response hashes.

The default UniRRM judge target is the quantized Ollama tag
`hf.co/mradermacher/UniRRM-8B-GGUF:Q4_K_M`, configured through
`PYA_CRITERION_FACTUALITY_JUDGE_MODEL` or `--judge-model`. Criterion first
discharges every Qwen generation model and polls `/api/ps` until those models
are no longer resident. Only then does it load the judge. After judging it
requests and verifies judge discharge as well, without stopping Ollama. This
keeps the existing external model-hosting boundary intact and prevents the
large judge from occupying VRAM after a pilot.

The original BF16 `SUSTech-NLP/UniRRM-8B` target remains available through the
external `criterion-huggingface` service with
`--judge-engine huggingface --judge-model SUSTech-NLP/UniRRM-8B` when that
heavier path is explicitly required. Its GPU jobs declare a 20 GB VRAM request
so the existing housekeeper can discharge competing residency before
admission.

## MeetingBank fact audit

The OmniCSEval-style fact lane is post-hoc scoring over saved Criterion output
runs. It never regenerates MeetingScript, Qwen, DialogLED or Lead-3 outputs.
The paper defines completeness as the fraction of gold key facts matched by a
summary sentence, conciseness as the fraction of summary sentences matched to a
key fact, and faithfulness as the fraction of atomic summary claims supported by
the source. Criterion stores these ratios plus percentage projections and the
source sentence, summary sentence, fact/claim, decision, explanation,
confidence, and hash evidence.

There are two deliberately separate modes:

* `omnicseval-meeting` is exact-compatible with the released 75-sample
  MeetingBank portion when the local annotation package is supplied. It joins
  only by explicit MeetingBank source ID and reports missing, ambiguous and
  source-hash-mismatched joins.
* `meetingbank-fact-audit` is an `automated_proxy` over all 862 local test rows.
  A separately configured external judge extracts key facts, summary claims and
  support decisions. It is not human-adjudicated OmniCSEval and should be
interpreted as a broad audit, not an exact reproduction.

The currently published benchmark archive is an external download. If an
archive version contains MeetingBank records without a source ID, Criterion
reports all 75 as unmatched rather than joining by transcript text or array
position; this is intentional fail-closed behaviour.

Example post-hoc smoke and resume command:

```bash
node command/criterion.mjs meetingbank-fact-audit \
  --dataset "$PYA_BENCHMARK_CACHE/meetingbank/test.jsonl" \
  --source-runs meetingbank-meetingscript-full-20260915 \
  --judge-model <separate-external-judge> \
  --run-id meetingbank-meetingscript-fact-smoke --smoke --resume --json

node command/criterion.mjs meetingbank-fact-audit \
  --dataset "$PYA_BENCHMARK_CACHE/meetingbank/test.jsonl" \
  --source-runs meetingbank-meetingscript-full-20260915,meetingbank-lead3-full,meetingbank-dialogled-full-20260915,full-meetingbank-summary-direct-20260913 \
  --judge-model <separate-external-judge> \
  --run-id meetingbank-fact-audit-full --judge-max-output-tokens 4096 --resume --json
```

The judge model/provider, prompt version, scorer version and temperature are
recorded separately from each evaluated source run. The JSONL checkpoint is the
resume boundary; generated `.json`, `.jsonl`, `.md`, `.csv`, `.pya` and review
HTML files remain under ignored `criterion/results` and `criterion/review`.
Municipal flags such as motion, vote, amount, date, deadline and final outcome
are evidence labels only. They do not rewrite summaries or promote judge output
to authoritative source material. See the [OmniCSEval paper](https://arxiv.org/html/2606.15974v1)
and [official repository](https://github.com/zhouweixiao/OmniCSEval) for the
reference benchmark and its human-adjudicated construction.
