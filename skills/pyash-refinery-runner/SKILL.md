---
name: pyash-refinery-runner
description: "Run and debug refineries, approval gates, and newspapers in the Pyash repo; use when working on refinery behavior, ratify/resume flows, or run/newspaper output."
---

# Pyash Refinery Runner

Use this skill to work on refinery execution, ratify gates, and run newspaper behavior.

## Run paths

- Use inline invocation in programs: `from name <refinery> be refinery do`.
- Use the CLI runner for newspaper/again mode: `node command/run_pya_program.mjs ...`.
- Prefer a runnable `.pya` example through the standard runner when validating a
  new refinery. The runner owns the outer run identity, result artifact,
  checkpoint callbacks, and newspaper projection; a JavaScript adapter should
  own only resource access, provider calls, and non-Pyash file writes.

## Artifact-first refinery contract

- A refinery job has one semantic destination and one run artifact folder.
  The destination names the goal state; stage maps, manifests, queue evidence,
  checkpoints, and derived files are artifacts of that same job.
- Keep the workflow graph, stage names, typed map contracts, and dependency
  edges in `.pya`. Use `from name` for one dependency and `from ve name` for
  multiple dependencies; make root stages explicit when a stage has no input.
- Every stage should produce a truthful typed output map. The next stage reads
  the latest completed stage output, rather than rebuilding from the original
  surface input. Preserve accepted records when a later stage remains
  unresolved.
- Store durable state as parser-readable `.pya` artifacts. Do not add a JSON
  state file, a parallel transcript, or extra CLI destination flags to carry
  intermediate stages.

## Checkpoints and newspapers

- Run with `--newspaper --run-id <stable-id>` and reuse that same id to resume
  matching work. Choose a new id for a fresh run.
- Checkpoints are append-only evidence in the run newspaper, normally
  `newspaper/<sanitized-run-id>.pya`; the run artifact folder normally lives at
  `artifacts/<sanitized-run-id>/`. The canonical conversation or source record
  remains the refinery's `.pya` output, while the newspaper is replay evidence.
- A checkpoint may be reused only when its source/resource identities match.
  Stale or legacy checkpoints rerun the affected stages while retaining valid
  accepted evidence; do not overwrite old stage records or pretend a stale
  output is current.
- Inspect durable progress without rerunning when a refinery provides an
  artifact reader. For the source-to-VLIW refinery use:
  `node command/read_translation_refinery.mjs <run-id> [checkpoint-cwd]`.
  General newspaper replay uses:
  `node command/replay_newspaper.mjs --run-id <id> --run-root <dir>`.
- Use `node command/pya_to_json.mjs <artifact>.pya --pretty` or
  `node command/read_pya_trace.mjs <artifact>.pya` to inspect `.pya`; do not
  parse durable state with grep or ad-hoc JSON assumptions.

## Provider and retry boundaries

- Route mind/provider work through the existing Pyash Housekeeper/future queue
  and await the returned duty. Do not call Ollama or another provider directly
  from a refinery adapter.
- Keep retries bounded and stage-local. A malformed provider response gets the
  existing bounded repair/retry path; retain valid rows and write an explicit
  uncertain/error record for the rest instead of hanging or silently dropping
  work.
- Obey the repository single-flight rule for GPU/LLM-heavy runs. Record model,
  queue, provider, and attempt evidence in the run artifacts/newspaper.

## Ratify / resume checklist

- Expect surfaced `be ratify do` with resume token and prompt text.
- Resume should emit `be ratify ya` with `ob bool truth|lie` and resume token.
- Declines should exit the refinery run without aborting the rest of the program.

## Debug workflow

1. Reproduce with a small `.pya` fixture in `examples/pyash/`.
2. Run via `node command/run_pya_program.mjs --newspaper --run-id <id> <file>`.
3. Inspect `newspaper/<id>.pya` for evoke/result/ratify lines.
4. If needed, run `node command/replay_newspaper.mjs --run-id <id> --run-root <dir>`.
5. If the refinery is file-backed, inspect its latest stage artifact before
   rerunning. Confirm the stage that failed, isolate it with a focused test,
   then rerun the complete example end to end.

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
- Run the refinery's focused quiz and every modified example with fixture
  provider variables explicitly unset.
- Run `node command/vocab_suggest.mjs` for new Pyash workflow tokens.
- Finish with `npm test`; report unrelated baseline failures separately from
  failures caused by the refinery change.
