# Criterion workspace

Benchmark datasets and generated results stay local to this directory. The repository tracks the runner and its contracts, not public dataset downloads, private transcripts, model output, or GPQA material.

The command surface is:

```bash
node command/criterion.mjs list
node command/criterion.mjs inspect --benchmark meetingbank
node command/criterion.mjs run --benchmark meetingbank --dataset /path/to/split.jsonl --model qwen3.5:9b,hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M --profile summary_direct --smoke
node command/criterion.mjs report <run-id>
node command/criterion.mjs compare <run-a> <run-b>
node command/criterion.mjs golden <run-id> --write
node command/criterion.mjs again <run-id>
node command/criterion.mjs meetingbank-fact-audit --dataset /path/to/meetingbank/test.jsonl --source-runs meetingbank-meetingscript-full-20260915 --judge-model <external-judge> --smoke --resume
node command/criterion.mjs omnicseval-meeting --dataset /path/to/meetingbank/test.jsonl --annotations /path/to/omnicseval-meeting.jsonl --source-runs meetingbank-meetingscript-full-20260915 --judge-model <external-judge> --resume
```

Use `OLLAMA_BASE_URL` (or the existing `OLLAMA_HOST`) for the Ollama endpoint. A run uses the same profile and context length for every model in a comparison. `--resume` reuses completed sample rows and is the benchmark equivalent of `again`. Reports persist `runScope: smoke` for `--smoke`; unrestricted runs are labelled `runScope: full`.

`helpos-local` reads one or more directories shaped like:

```text
fixtures/<id>/transcript.txt
fixtures/<id>/agenda.json
fixtures/<id>/reference.json
fixtures/<id>/expected_facts.json
```

`ami` and `icsi` accept prepared JSON/JSONL rows with `meeting_id`, `transcript` (or `turns`), `summary`, `speakers`, and optional `preparation`/`accessStatus` metadata. They also accept fixture directories containing `transcript.txt`, `summary.txt` or `reference.json`, optional `turns.json`, and `metadata.json`. Full corpora remain local and are never downloaded by the runner.

Official QMSum JSONL meeting rows containing `meeting_transcripts`, `general_query_list`, and `specific_query_list` are expanded into full-meeting and query-focused samples while preserving relevant spans. DialogSum CSV exports from the documented mirror are accepted directly.

`dialogsum` accepts the official or mirrored `id`, `dialogue`, `summary`, and `topic` fields. `longbench-summary` accepts prepared LongBench v1 rows with a `task`/`dataset` field and reports GovReport, MultiNews, QMSum, and VCSUM separately, plus a macro-average.

`nightmare` is single-flight by default. Its repeat, timeout, malformed-output, and stress controls are extension points for remote runners; local GPU-heavy work remains serialized by Pyash host policy. `reverie` runs controlled-response simulations without calling a model.

Long suites can use the runtime `runCriterionRefinery` adapter so each benchmark stage has the same dependency, retry, checkpoint and fail-fast semantics as other Pyash refinery work.

## Deterministic baselines

Criterion also supports non-model baselines through the same dataset, checkpoint and artifact path. MeetingBank Lead-3 selects the first three transcript sentences and makes no Ollama request:

```bash
node command/criterion.mjs baseline \
  --benchmark meetingbank \
  --dataset /path/to/meetingbank/test.jsonl \
  --split test \
  --baseline lead-3 \
  --run-id meetingbank-lead3-full \
  --resume \
  --json
```

The run is recorded as `baseline:lead-3`. Processing latency is recorded, while generation speed is unavailable because no model is called.

## Hugging Face sequence-to-sequence models

Criterion keeps dataset loading, scoring, checkpoints and reports in Node. Hugging Face inference runs as a GPU-managed Pyash duty through the existing `gpu-worker` and `gpu-housekeeper` services. The CUDA host owns the container and its private model cache; the development machine does not need a Python virtual environment or model dependencies:

```bash
PYA_GPU_HOUSEKEEPER_URL=http://mriczo:8090 \
node command/criterion.mjs run \
  --benchmark meetingbank \
  --engine huggingface \
  --model ahmeddeldalyyy/meeting-summarizer-meetingbank \
  --dataset /path/to/meetingbank/test.jsonl \
  --split test \
  --profile summary_direct \
  --run-id meetingbank-hf-ahmed-full \
  --resume \
  --json
```

Start the normal Pyash GPU worker for the Criterion lane when one is not already running:

```bash
PYA_GPU_HOUSEKEEPER_URL=http://mriczo:8090 \
node command/gpu_worker.mjs --world world
```

Supported MeetingBank defaults are `ahmeddeldalyyy/meeting-summarizer-meetingbank` (1,024 input tokens, 56-142 output tokens, four beams, length penalty 2.0), `Shaelois/MeetingScript` (4,096 input tokens, four beams), and `MingZhong/DialogLED-large-5120` (5,120 input tokens, four beams, deterministic generation). The latter two target profiles use deterministic overlapping token windows for over-limit inputs; each row records the original input count, processed count, window count and any actual truncation. Model/tokenizer revision, parameter count, dtype, CUDA device, load time and warm inference timing are also recorded. Model-card ROUGE numbers are published claims only until reproduced through the same local split, reference extraction, scorer and generation settings.

The container is the managed `huggingface` runtime in `gpu-housekeeper`, alongside `ollama`, `comfyui`, and `katago`. Its cache is `container/criterion-huggingface/cache/` on the GPU host and is ignored by Git. Criterion submits one JSON job per sample to the durable `criterion` GPU lane, so `--resume` does not rerun completed samples.

## Fact evaluation of saved outputs

Criterion can rescore existing MeetingBank model runs without calling the
evaluated model again. `meetingbank-fact-audit` is the full 862-sample
`automated_proxy` lane: an external judge extracts source key facts and summary
claims, then verifies support. `omnicseval-meeting` consumes the released
OmniCSEval Meeting annotations and is the exact-compatible lane for its 75
MeetingBank samples. The annotation archive is an external input and is never
silently inferred from the local task list; joins use an explicit source ID and
ambiguous or missing IDs are reported as unmatched.

The three fact scores are the paper's bidirectional measures:

* **Completeness** is gold key facts matched by at least one summary sentence,
  divided by the number of gold key facts.
* **Conciseness** is summary sentences matched to at least one key fact,
  divided by the number of summary sentences.
* **Faithfulness** is supported atomic summary claims divided by all atomic
  summary claims.

Runs persist the ratio and percentage forms, per-fact/per-claim source evidence,
municipal claim flags, judge explanation, hashes, source run ID and judge
configuration. Empty denominators are `null`, not fabricated zeros. The exact
OmniCSEval annotations use human-adjudicated key facts; the 862-sample lane is
explicitly an automated proxy, so its percentages are not interchangeable with
the exact subset or with ROUGE.

The judge is a separate external runtime. Configure it explicitly with
`--judge-model` or `PYA_CRITERION_FACT_JUDGE_MODEL` and keep its provider,
prompt version, temperature and scorer version in the run. The post-hoc path
does not generate new summaries. Every row is checkpointed in JSONL and
`--resume` skips completed source-run/model/sample tuples. The same durable run
produces JSON, JSONL, Markdown, CSV, `.pya` and HTML review artifacts.
