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
