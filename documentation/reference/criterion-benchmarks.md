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

- MeetingBank: [dataset](https://meetingbank.github.io/dataset/) and [official utilities](https://github.com/YebowenHu/MeetingBank-utils).
- QMSum: [official repository](https://github.com/Yale-LILY/QMSum).
- LongBench v2: [official repository and scoring format](https://github.com/THUDM/LongBench).
- IFEval: [official instruction-following evaluator](https://github.com/google-research/google-research/tree/master/instruction_following_eval).

Download or export these into a private cache and pass the local file with `--dataset`. The runner records the source URL and caller-provided dataset revision; it deliberately does not silently fetch large datasets.

## Typical runs

```bash
node command/criterion.mjs list
node command/criterion.mjs run --benchmark meetingbank --dataset "$PYA_BENCHMARK_CACHE/meetingbank/test.jsonl" --profile summary_direct --smoke
node command/criterion.mjs run --benchmark qmsum --dataset "$PYA_BENCHMARK_CACHE/qmsum/test.jsonl" --profile summary_direct --limit 100 --resume
node command/criterion.mjs run --benchmark longbench --dataset "$PYA_BENCHMARK_CACHE/longbench-v2/test.jsonl" --context-length 32768 --smoke
node command/criterion.mjs run --benchmark ifeval --dataset "$PYA_BENCHMARK_CACHE/ifeval/input.jsonl" --profile reasoning --smoke
node command/criterion.mjs run --benchmark helpos-local --fixtures ./fixtures --profile summary_direct --smoke
```

For a controlled simulation:

```bash
node command/criterion.mjs reverie run --benchmark helpos-local --fixtures ./fixtures --responses ./responses.json
```

Reports appear under `criterion/results/<run-id>.*` and review samples under `criterion/review/<run-id>.html`. The `.pya` result is the canonical sentence-shaped manifest; JSONL is the per-sample evidence/checkpoint. `criterion report`, `criterion compare` and `criterion golden` read those persisted records after the original process exits.
