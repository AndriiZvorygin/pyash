# 26. Criterion, Nightmare, And Reverie

## Purpose

Benchmarking is a Pyash run, not a second evaluation framework. The public sentence surfaces are:

```text
be criterion do
be nightmare do
be reverie do
```

When a Criterion run names an external model runtime, it uses the same
provider/host/model vocabulary as `mind`:

```text
from filename <dataset>
from state <backend>
from space <runtime endpoint>
via state <model>
during state <criterion profile>
ob text <benchmark>
be criterion do
```

`from state` identifies the backend or external runner (`ollama`, `strata`, or
`pier`), `from space`
identifies that backend's endpoint, and `via state` identifies the model being
tested. `during state` selects the Criterion profile so it does not collide
with `via state`, which is normalized to the `as` case by the language parser.
The legacy `as state <profile>` form remains readable when no model is named.
Criterion keeps command-line/environment configuration as a compatibility path,
but this sentence form is the canonical Pyash representation.

The executable command adapter is `command/criterion.mjs`; the runtime is under `program/runtime/criterion/`. It uses the existing refinery/run/artifact/newspaper conventions and emits content-addressed evidence under `criterion/artifacts/`.

## Criterion

`criterion` is the normal deterministic evaluation suite. A run has a stable run ID, suite/dataset identity, model identity and digest, profile, context, input/prompt/output hashes, per-sample status, metrics, errors, timing and provenance. It writes `.pya`, JSONL, JSON, Markdown, CSV and a small human-review HTML projection. The JSONL is the resumable checkpoint: `--resume` is the operational `again` path and never repeats a completed model/sample/profile/context tuple.

The adapters are MeetingBank, QMSum, AMI, ICSI, DialogSum, LongBench v1 summarization, LongBench v2, IFEval and HelpOS-local. Public dataset files are supplied from a local cache or export. They are not implicitly downloaded or committed. MeetingBank and QMSum preserve the caller-selected official split (`train`, `validation`/`dev`, or `test`) in the run record. MeetingBank records city/date/agenda/segment metadata; QMSum records meeting ID, query type and relevant spans. AMI and ICSI accept prepared transcript-summary records or local fixture directories and preserve speaker turns, boundaries, access status and preparation provenance. DialogSum remains an adjacent dialogue benchmark. LongBench v1 summarization records GovReport, MultiNews, QMSum and VCSUM per-task scores and a macro-average; its QMSum rows are never silently merged into a standalone QMSum run. LongBench samples over the configured context length receive a structured skip result.

IFEval uses a deterministic built-in instruction contract for common list/JSON/length checks. An installed official verifier can be selected with `--ifeval-verifier`; the adapter sends one JSON sample to that configured executable and records its returned prompt/instruction scores.

Ollama is called through `/api/chat` with one shared profile per comparison.
Strata uses its OpenAI-compatible `/v1/chat/completions` endpoint and asks the
existing GPU Housekeeper to prepare and discharge the `strata` runtime; Criterion
does not own model residency or GPU lifecycle. The default profiles are:

| Profile | Thinking | Temperature | top-p | top-k | Context |
| --- | --- | ---: | ---: | ---: | ---: |
| `summary_direct` | false | 0.2 | 0.8 | 20 | 32768 |
| `summary_reasoned` | true | 0.6 | 0.95 | 20 | 32768 |
| `summary_reasoned_hidden` | true | 0.6 | 0.95 | 20 | 32768 |

`reasoning` remains a backward-compatible alias for `summary_reasoned`. Every sample records the effective `think` setting and reasoning mode. All scored visible answers remove `<think>...</think>` blocks; when Ollama returns a thinking field, its token count remains in the result metadata.

Provider counters `prompt_eval_count`, `prompt_eval_duration`, `eval_count`, `eval_duration` and `total_duration` are retained, with prompt and generation tokens/second and p50/p95 latency derived. Thinking blocks are not included in quality scoring or human-review output.

HelpOS-local keeps authoritative transcript and provenance separate from generated prose. Its fixture contract can score summary quality, expected facts, structured JSON, required provenance fields and unsupported-claim annotations. Existing HelpOS validators remain the source of truth for publishing; this adapter reports their relevant fixture-level conditions and does not promote model prose into source facts. Missing references are recorded as unavailable evidence rather than scored as zero-quality summaries.

Each run records a dataset hash when a file is supplied, input/prompt/output hashes per sample, source metadata, context-length buckets, effective profile settings, provider timing counters, average/median/p95 latency, throughput and quality-per-second. A run's Markdown and CSV are projections of the same durable record; `--smoke` persists `runScope: smoke` so smoke execution checks are visibly distinct from `runScope: full` aggregates and should not be treated as full-run estimates.

## Nightmare

`nightmare` repeats a criterion workload and records timeout/failure/skipped evidence. `nightmare run`, `soak` and `stress` are command modes. GPU/LLM-heavy execution remains single-flight by default per physical housekeeper device. The existing bounded `gpu_worker` coordinator may fan out independent duties across available housekeeper hosts/devices, while same-device overlap requires an explicitly registered `concurrencySafe` runtime and housekeeper capacity admission. This does not change the Criterion result contract.

## Reverie

`reverie` is an executable simulation hook for synthetic meetings, agendas and controlled model responses. It is useful for alignment/prompt experiments and consumes no model quota when responses are supplied. It writes the same criterion evidence shape, marked with `mode: reverie` and a scenario.

## Refinery, golden, and replay

Long benchmark runs can be wrapped with `runCriterionRefinery`, an adapter over the existing refinery runner. Its units use the normal dependency ordering, retries, checkpoints, smoke/full modes and fail-fast behaviour. `criterion golden <run-id> --write` records aggregate expectations; without `--write` it compares the current aggregate against that golden. Reports contain a reproducible `criterion run ... --resume` command and all result files carry hashes/content-addressed copies.

Datasets, private transcripts and GPQA files remain outside tracked source. Official source and licence/revision metadata belong in the run record. Missing data or unavailable models are errors/skips, never invented scores.

## Deterministic and Hugging Face execution

The `criterion baseline` command currently provides the MeetingBank `lead-3` baseline as `baseline:lead-3`. It selects three sentence boundaries from the normalized transcript and uses the ordinary Criterion checkpoint/artifact contract without a model request. Its processing latency is distinct from neural generation throughput.

The `criterion run --engine huggingface` path keeps orchestration in Node and delegates model loading/generation to a persistent `criterion-huggingface` container through the existing Pyash GPU duty queue and `gpu-housekeeper`. The container embeds `program/runtime/criterion/huggingface_worker.py`, uses a private ignored Hugging Face cache on the CUDA host, and is registered as the managed `huggingface` runtime. Each row preserves model/tokenizer revision, model size, dtype, device, input limit, truncation, generation settings, load time and warm inference timing. Open fine-tuned MeetingBank models and zero-shot Ollama models remain separate evaluation conditions even when they share a scorer. The `baseline:lead-3` lane is deterministic CPU work and does not use GPU management.

## DeepSWE external agent lane

`criterion deepswe` is an adapter over the official DeepSWE task corpus and
Pier runner. It is intentionally not a prompt-only model benchmark: each task
contains a `task.toml`, an isolated environment, an instruction, a verifier and
held-out solution material. Pier/Harbor owns the agent tool loop, sandbox,
commit collection and verifier execution; Criterion owns deterministic task
selection, model/runtime provenance, per-task checkpoints, reward mapping and
reports.

The smoke lane selects ten tasks using a recorded seed and runs them one at a
time, model-major, so a model is not repeatedly loaded and discharged between
tasks. Completed model/task rows are reused by `--resume`; failed rows remain
retryable. Verifier evidence is read from `reward.json` and `ctrf.json`, while
Pier stdout/stderr are retained under the ignored run result directory.

Install the official runner and place a checked-out corpus outside tracked
source before running:

```bash
git clone https://github.com/datacurve-ai/deep-swe "$PYA_BENCHMARK_CACHE/deep-swe"
uv tool install datacurve-pier
```

For a Qwen endpoint, configure the endpoint understood by the selected Pier
agent without putting model hosting inside Criterion:

```bash
PYA_DEEPSWE_MODEL_ENDPOINT="http://mriczo:11434/v1" \
PYA_DEEPSWE_API_KEY="ollama" \
node command/criterion.mjs deepswe \
  --tasks "$PYA_BENCHMARK_CACHE/deep-swe/tasks" \
  --model "qwen3.5:9b" \
  --sample-seed 0 \
  --smoke --resume --json
```

Criterion records the requested model tag as-is and supplies Pier's required
provider-qualified form internally. A raw tag such as `qwen3.5:9b` is sent as
`openai/qwen3.5:9b` to an OpenAI-compatible endpoint; use an explicit provider
prefix such as `ollama/qwen3.5:9b` when the selected Pier agent should use a
different provider contract.

The full corpus removes `--smoke`; a run is resumable with
`criterion again <run-id>`. DeepSWE reward/pass-fraction/verifier results are
reported independently from ROUGE or ordinary summary quality metrics.

## Fact evaluation

Criterion also exposes a post-hoc fact-evaluation lane over persisted model
outputs. `meetingbank-fact-audit` is the 862-sample automated proxy and
`omnicseval-meeting` is the exact-compatible released 75-sample MeetingBank
subset. Both reuse source-run rows, sample IDs, output hashes, the existing
checkpoint boundary and artifact writers; neither calls the evaluated model.

For a fact run, the external judge is a separate engine adapter. It extracts
source key facts, summary atomic claims and sentence/fact matches, then returns
supported, unsupported, contradiction or unresolved decisions with evidence.
Judge model/provider, prompt version, scorer version, sampling and timing are
stored separately from the evaluated model's provenance.

The persisted fact ratios are the OmniCSEval definitions:

```text
completeness = matched gold key facts / gold key facts
conciseness = summary sentences matched to a key fact / summary sentences
faithfulness = supported atomic claims / atomic summary claims
```

Reports render percentage projections and preserve the raw counts. Empty
denominators are unknown (`null`). The exact lane requires explicit source ID
joins to released annotations and fails closed on missing or ambiguous joins;
the full lane is labelled `automated_proxy` because automated fact extraction is
not the paper's human-adjudicated annotation process. Municipal claim flags are
evidence annotations only. Per-row JSONL is restart-safe and `--resume` never
rejudges a completed source-run/model/sample tuple. The same durable state
renders JSON, JSONL, Markdown, CSV, `.pya` and HTML.

## Prompt ablation

The MeetingBank Qwen prompt experiment is a Criterion evaluation, not a model
or hosting subsystem. `criterion prompt-ablation` takes an existing generic
`summary_direct` run and an explicit OmniCSEval Meeting annotation manifest.
It emits two paired labels: `qwen_baseline_generic` for the saved generic
prompt and `qwen_meetingbank_reference` for the fixed zero-shot
MeetingBank-aware prompt. The prompt text and hash are durable per-sample
evidence. No reference summary or generated output is used as an in-context
example.

The experiment joins the exact 75-sample target only by explicit source ID.
Missing, duplicate and ambiguous IDs fail closed and are included in
`subsetJoins.unmatched`; Criterion never guesses by source text, row order or
fuzzy similarity. It records annotation/local input hash mismatches. Generic
rows are reused only when their input hash, generic prompt hash, status and
profile/context/sampling settings and model digest match the source run. Missing or unverifiable
rows are regenerated under a separate checkpoint run ID, leaving the original
full-corpus artifacts unchanged.

Both variants are run with the same model list and non-thinking
`summary_direct` settings. The durable paired report contains ROUGE-1/2/L,
schema status, latency, output length and generation speed, grouped city,
item-type and chunking aggregates, paired deltas and reproducible bootstrap
confidence intervals. Saved MeetingScript rows may be projected for comparison
only when their IDs match the selected subset. An optional separate external
fact judge can attach completeness, conciseness and faithfulness after output
generation; that post-hoc step is independent of the generation model and can
be resumed with `--resume`.

## MeetingBank judge pilot

The `meetingbank-judge-pilot` lane is a small, resumable comparison experiment,
not a model-hosting subsystem. It deterministically selects ten MeetingBank
samples and generates identical-prompt rows for `qwen3.5:9b`,
`hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M` and `qwen3.8:27b` through the
remote Ollama adapter. Requested and resolved tags, digests, source hashes and
the full prompt hash are retained; missing tags produce explicit unavailable
rows and are never silently substituted.

Successful rows are judged by the external `judge:unirrm-8b` adapter. The
existing GPU queue still submits a `huggingface-generate` job to the managed
`criterion-huggingface` runtime, with only a backwards-compatible
`operation: "judge"` payload extension. The external worker loads
`SUSTech-NLP/UniRRM-8B` as a causal language model; Criterion remains the
owner of samples, prompts, scoring, checkpoints, provenance and reports.
UniRRM receives only the transcript, candidate summary, task description and
municipal rubric. It does not receive the reference summary used for ROUGE.

The native 1-5 UniRRM scores are preserved with the explicit normalization
`((score - 1) / 4) * 100`. Pointwise rows retain evidence, unsupported and
contradicted claims, omissions, confidence, raw response and repair history.
Pairwise rows retain deterministic displayed order, model identity mapping,
winner, margin, confidence and the order-swapped result. Malformed JSON gets
one bounded repair request; transport, model, malformed-output and successful
statuses remain distinct. Pilot generation and judge rows are checkpointed
independently, and `--resume` reuses successful identities without repeating
them.

The current Hugging Face service does not expose a sequence-classification
endpoint, so Skywork reward scoring is explicitly optional and is not required
for this pilot. The normal external-runtime deployment remains:

```bash
cd /home/htaf/pyac/pyash
git pull --ff-only origin master
./container/criterion-huggingface/command/begin.sh
```
