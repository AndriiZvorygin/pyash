---
name: pyash-refinery-runner
description: "Run and debug refineries, approval gates, and newspapers in the Pyash repo; use when working on refinery behavior, ratify/resume flows, or run/newspaper output."
---

# Pyash Refinery Runner

Use this skill to work on refinery execution, ratify gates, and run newspaper behavior.

## Run paths

- Use inline invocation in programs: `from name <refinery> be refinery do`.
- Use the CLI runner for newspaper/again mode: `node command/run_pya_program.mjs ...`.

## Ratify / resume checklist

- Expect surfaced `be ratify do` with resume token and prompt text.
- Resume should emit `be ratify ya` with `ob bool truth|lie` and resume token.
- Declines should exit the refinery run without aborting the rest of the program.

## Debug workflow

1. Reproduce with a small `.pya` fixture in `examples/pyash/`.
2. Run via `node command/run_pya_program.mjs --newspaper --run-id <id> <file>`.
3. Inspect `newspaper/<id>.pya` for evoke/result/ratify lines.
4. If needed, run `node command/replay_newspaper.mjs --run-id <id> --run-root <dir>`.

## Key files

- `program/bridge/refinery.mjs` — refinery execution logic and ratify gates.
- `command/run_pya_program.mjs` — runner behavior, newspaper emission, interactive approval.
- `program/verbs/refinery.mjs` — inline `be refinery do` behavior.
- Specs: `documentation/specifications/10-pipelines.md` (refinery) and `documentation/specifications/11-translation.md` (translation-related notes).

## Tests to run

- `node --test quiz/refinery_propose.test.mjs`
- `node --test quiz/refinery_ratify_resume.test.mjs`
- `node --test quiz/refinery_ratify_decline.test.mjs`
- `node --test quiz/refinery_runner_golden.test.mjs`
