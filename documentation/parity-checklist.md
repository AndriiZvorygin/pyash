# Parity Checklist

This checklist tracks parity work with explicit gates.

## 1) Recurrence Grammar Lock

Status: done

Gate:
- Scheduler accepts canonical `per` recurrence declarations.
- Scheduler accepts `every` as alias of `per`.
- Scheduler keeps compatibility with legacy `during` recurrence declarations.
- Unit coverage includes minute/hour/day/week forms.

Verification:
- `node --test quiz/scheduler.test.mjs`

## 2) Matrix Mention/Reply Hardening

Status: done

Gate:
- Mention matching uses token boundaries (no substring false positives).
- Mention gate still allows replies to agent-authored thread/reply chains.
- Debug telemetry records receive/dispatch decisions.

Verification:
- `node --test quiz/channel_runtime.test.mjs`

## 3) Shared Channel Fanout Dispatcher

Status: done

Gate:
- One poll cycle can dispatch one event to multiple listener agents.
- Fanout runs from a single receive pass, with deterministic per-listener dispatch.
- Dedup runs before mind-loop invocation.

Verification:
- `node --test quiz/channel_runtime.test.mjs`

## 4) Scheduler Observability Expansion

Status: done

Gate:
- Scheduler status includes overlap/load signals (`overlapPct`, `utilizationPct`).
- Scheduler status includes error counters (`errorCount`, `consecutiveErrors`).
- Telemetry emits run/skip/error with these fields in `.pya`.

Verification:
- `node --test quiz/scheduler.test.mjs`

## 5) Scheduler + Channel Reliability Path (No Fixtures)

Status: done

Gate:
- A real scheduler instance can run repeated channel poll cycles.
- First cycle handles and fans out; repeated cycle dedups prior events.
- Scheduler and channel telemetry are emitted as `.pya` records.

Verification:
- `node --test quiz/scheduler_channel_reliability.test.mjs`

## 6) Parity Checklist Document

Status: done

Gate:
- This document exists and is updated with done/partial/missing style gates.
- Each gate links to concrete verification commands.

## 7) Filename Mutation Standard Verb Gate

Status: done

Gate:
- The canonical filename mutation signature matrix is frozen in `07-io-and-scripts.md`.
- Interpreter, compiled JavaScript, and compiled C agree on successful target results, same-path copy, touch preservation/timestamps, overwrite behavior, and stable guard categories.
- The runnable example uses only `examples/out/file-mutation/` and leaves that subtree empty after completion.

Verification:
```sh
node command/vocab_suggest.mjs examples/pyash/file-touch-copy-rename-delete.pya
node command/vocab_check.mjs examples/pyash/file-touch-copy-rename-delete.pya
node --test quiz/filename_mutation_contract.test.mjs quiz/touch_file.test.mjs quiz/copy_file.test.mjs quiz/rename_path.test.mjs quiz/delete_file.test.mjs quiz/directory_tools_flow.test.mjs quiz/compile_fs_bool_js.test.mjs quiz/compile_fs_bool_c.test.mjs quiz/filename_mutation_parity.test.mjs
env -u PYA_MIND_RESPONSE -u PYA_HEAR_FIXTURE -u PYA_PIPER_FIXTURE -u PYA_COMMAND_RESPONSE ./run examples/pyash/file-touch-copy-rename-delete.pya
env -u PYA_MIND_RESPONSE -u PYA_HEAR_FIXTURE -u PYA_PIPER_FIXTURE -u PYA_COMMAND_RESPONSE ./runjs examples/pyash/file-touch-copy-rename-delete.pya
env -u PYA_MIND_RESPONSE -u PYA_HEAR_FIXTURE -u PYA_PIPER_FIXTURE -u PYA_COMMAND_RESPONSE ./runc examples/pyash/file-touch-copy-rename-delete.pya
npm test
git diff --check
```
