---
name: criterion-benchmarking
description: "Run and extend Pyash criterion, nightmare, and reverie evaluations with local Ollama models and replayable artifacts."
---

# Criterion Benchmarking

Use `node command/criterion.mjs list` and `inspect` before selecting a suite. Keep public datasets and private HelpOS fixtures in a local cache; pass their path explicitly and record the dataset revision.

Use the same `--profile` and `--context-length` for every model in a comparison. The normal profiles are `summary_direct`, `summary_reasoned`, and `summary_reasoned_hidden` (`reasoning` remains a compatibility alias); the default comparison models are `qwen3.5:9b` and `hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M`.

For translation comparisons, use the `flores-200` suite with the
`translation_direct` profile and inspect chrF by language direction. The
translation-specific default is `qwen3.5:9b` when no model override is
provided; use `PYA_CRITERION_MODELS` or `--model` for an explicit comparison.
Supply a local normalized FLORES export; Criterion never downloads or commits
the dataset or model outputs. Route live model work through the existing GPU
housekeeper lane.

Start with `--smoke` and a small `--limit`. Long runs are resumable with `--resume` or `criterion again <run-id>`. Inspect the generated `.pya`, JSONL, Markdown, CSV and review HTML before using a golden.

Do not commit datasets or private model outputs. Route Criterion inference through Housekeeper. A non-empty queue is expected: submit independent bounded jobs without waiting for the queue to become empty, and let Housekeeper place/admit them across available hosts/devices. Same-device overlap still requires an explicitly registered `concurrencySafe` runtime and successful Housekeeper VRAM admission. `command/gpu_worker.mjs` may fan independent duties across hosts. `nightmare` repeat/stress modes remain bounded and must not bypass Housekeeper admission.
