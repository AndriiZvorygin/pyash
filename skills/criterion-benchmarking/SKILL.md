---
name: criterion-benchmarking
description: "Run and extend Pyash criterion, nightmare, and reverie evaluations with local Ollama models and replayable artifacts."
---

# Criterion Benchmarking

Use `node command/criterion.mjs list` and `inspect` before selecting a suite. Keep public datasets and private HelpOS fixtures in a local cache; pass their path explicitly and record the dataset revision.

Use the same `--profile` and `--context-length` for every model in a comparison. The normal profiles are `summary_direct`, `summary_reasoned`, and `summary_reasoned_hidden` (`reasoning` remains a compatibility alias); the default comparison models are `qwen3.5:9b` and `hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M`.

Start with `--smoke` and a small `--limit`. Long runs are resumable with `--resume` or `criterion again <run-id>`. Inspect the generated `.pya`, JSONL, Markdown, CSV and review HTML before using a golden.

Do not commit datasets or private model outputs. Local GPU/LLM work is single-flight by default per physical housekeeper device. Independent Criterion duties may be fanned out by `command/gpu_worker.mjs` across available housekeeper hosts/devices; same-device overlap requires an explicitly registered `concurrencySafe` runtime and successful VRAM admission. `nightmare` repeat/stress modes remain bounded and must not bypass housekeeper admission.
