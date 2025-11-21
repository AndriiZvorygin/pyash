# State of Project

## What the project is
Pyash is a small experimental language with a Node/ESM REPL, parser, interpreter, and a handful of verbs (add, giant, compile, mind, read). It treats case roles compositionally (axis + context mapped to keywords like `fromtext`, `as`, `become`) and stores every sentence as history in memory.

## Current goals
- Keep a red→green flow: add tests before code.
- Normalize compositional cases to keyword roles and avoid storing raw context.
- Support verbs that operate on text (read/compile/mind) and numeric verbs (add) with history tracking.
- Ensure all moods, including `do` and `def`, are persisted in memory for traceability.
- Stay aligned with the broader Pyash vision in `documentation/pyac.txt` while scoping to a minimal REPL/interpreter for now.

## Architecture at a glance
- `main.mjs`: REPL wiring parser → dispatcher → memory.
- `parser.mjs`: tokenization, quoted blocks, keywordized compositional roles (fromtext/during/become/totext/etc.), short role aliases (su/ob).
- `dispatcher.mjs`: mood routing, verb dispatch, memory writes for declarative/def/do, result facts stored for imperatives.
- `verbs/`: dynamic dispatch (add/read) and direct verbs (giant, mind, compile). Mind pulls config from keyword roles (`as`, `accordingto`), read dispatches to handlers, compile builds program JSON.
- `memory.mjs`: simple in-memory store with get/set/dump/reset.
- `library/compositionalCases.mjs`: axis/context grid and keyword mappings.

## What works now
- All tests green (`node --test`): parser quoting/text, compositional keyword normalization, mind config/use, read filename handler, compile paths, add/generation of result facts, moods `ya/def/do` stored.
- Imperatives store both the command and a result fact; bare add (`obj num 3 to num 4 be add do`) produces `result` with `num 7` in memory.
- Mind resolves model/prompt from stored config (`as` state, `accordingto` discourse) and returns text; compositional parsing emits keyword roles without lingering `context` fields.

## What is half-finished / open edges
- Result facts use a generic `subj result`; could evolve to track per-command identifiers.
- Read writes both the command and a result fact; additional result-shaping (e.g., filenames) not captured.
- Mind is stubbed against mocked generate in tests; real streaming/roles for replies aren’t modeled yet.
- Parser still assumes keyword tables; no validation against hnuc codes yet.
- Much of the 2019 spec (phonology, noun classes, tense/aspect, GPU/compiler ambitions) remains out-of-scope here.

## Tried and rejected
- Keeping `context` fields on parsed roles (removed in favor of keyword normalization).
- Storing arrays of compositional roles; now the last keyword wins per role.
- Fabricating generic result facts without storing the command first; ordering now records the `do` before the result fact.
