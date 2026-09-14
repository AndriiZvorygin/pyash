# 26. Criterion, Nightmare, And Reverie

## Purpose

Benchmarking is a Pyash run, not a second evaluation framework. The public sentence surfaces are:

```text
be criterion do
be nightmare do
be reverie do
```

The executable command adapter is `command/criterion.mjs`; the runtime is under `program/runtime/criterion/`. It uses the existing refinery/run/artifact/newspaper conventions and emits content-addressed evidence under `criterion/artifacts/`.

## Criterion

`criterion` is the normal deterministic evaluation suite. A run has a stable run ID, suite/dataset identity, model identity and digest, profile, context, input/prompt/output hashes, per-sample status, metrics, errors, timing and provenance. It writes `.pya`, JSONL, JSON, Markdown, CSV and a small human-review HTML projection. The JSONL is the resumable checkpoint: `--resume` is the operational `again` path and never repeats a completed model/sample/profile/context tuple.

The first adapters are MeetingBank, QMSum, LongBench v2, IFEval and HelpOS-local. Public dataset files are supplied from a local cache or export. They are not implicitly downloaded or committed. QMSum relevant spans and LongBench context metadata remain in each result. LongBench samples over the configured context length receive a structured skip result.

IFEval uses a deterministic built-in instruction contract for common list/JSON/length checks. An installed official verifier can be selected with `--ifeval-verifier`; the adapter sends one JSON sample to that configured executable and records its returned prompt/instruction scores.

Ollama is called through `/api/chat` with one shared profile per comparison. The default profiles are:

| Profile | Thinking | Temperature | top-p | top-k | Context |
| --- | --- | ---: | ---: | ---: | ---: |
| `summary_direct` | false | 0.2 | 0.8 | 20 | 32768 |
| `reasoning` | true | 0.6 | 0.95 | 20 | 32768 |

Provider counters `prompt_eval_count`, `prompt_eval_duration`, `eval_count`, `eval_duration` and `total_duration` are retained, with prompt and generation tokens/second and p50/p95 latency derived. Thinking blocks are not included in quality scoring or human-review output.

HelpOS-local keeps authoritative transcript and provenance separate from generated prose. Its fixture contract can score summary quality, expected facts, structured JSON, required provenance fields and unsupported-claim annotations. Existing HelpOS validators remain the source of truth for publishing; this adapter reports their relevant fixture-level conditions and does not promote model prose into source facts.

## Nightmare

`nightmare` repeats a criterion workload and records timeout/failure/skipped evidence. `nightmare run`, `soak` and `stress` are command modes. The default local execution is single-flight because Pyash treats GPU/LLM-heavy pipelines as exclusive. A remote execution adapter may add bounded concurrency without changing the result contract.

## Reverie

`reverie` is an executable simulation hook for synthetic meetings, agendas and controlled model responses. It is useful for alignment/prompt experiments and consumes no model quota when responses are supplied. It writes the same criterion evidence shape, marked with `mode: reverie` and a scenario.

## Refinery, golden, and replay

Long benchmark runs can be wrapped with `runCriterionRefinery`, an adapter over the existing refinery runner. Its units use the normal dependency ordering, retries, checkpoints, smoke/full modes and fail-fast behaviour. `criterion golden <run-id> --write` records aggregate expectations; without `--write` it compares the current aggregate against that golden. Reports contain a reproducible `criterion run ... --resume` command and all result files carry hashes/content-addressed copies.

Datasets, private transcripts and GPQA files remain outside tracked source. Official source and licence/revision metadata belong in the run record. Missing data or unavailable Ollama models are errors/skips, never invented scores.
