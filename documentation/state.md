# State of Project

## What the project is
Pyash is a small experimental language with a Node/ESM REPL, parser, interpreter, and a handful of verbs (add, subtract, giant/tiny/equally conditionals, understand, mind, read). It treats case roles compositionally (axis + context mapped to keywords like `fromtext`, `as`, `become`) and stores every sentence as history in memory. Ceremonies run in sandpits; the evoking sentence is the source of truth (including control cases like `fromindex`/`toindex`), and returned state is carried by the updated evoker rather than separate register facts.

## Current goals
- Keep a red→green flow: add quizzes before code.
- Normalize compositional cases to keyword roles and avoid storing raw context.
- Support verbs that operate on text (read/understand/mind) and numeric verbs (add/subtract) with history tracking.
- Ensure all moods, including `do` and `def`, are persisted in memory for traceability.
- Stay aligned with the broader Pyash vision in `documentation/pyac.txt` while scoping to a minimal REPL/interpreter for now.

## Architecture at a glance
- `program/main.mjs`: REPL wiring understand → bridge → memory.
- `program/understand/index.mjs`: tokenization, quoted blocks, keywordized compositional roles (fromtext/during/become/totext/etc.), short role aliases (su/ob).
- `program/bridge/index.mjs`: mood routing, verb dispatch, memory writes for declarative/def/do/ret, result facts stored for imperatives, sandpit execution for ceremonies with multi-word names.
- `program/verbs/`: dynamic dispatch (add/subtract/read) and direct verbs (giant, tiny, equally, mind, understand). Mind pulls config from keyword roles (`as`, `accordingto`), read dispatches to handlers, understand builds program JSON.
- `program/remember/index.mjs`: simple in-memory store with get/set/dump/reset, definition index, sandpit traces.
- `program/library/compositionalCases.mjs`: axis/context grid and keyword mappings.

## What works now
- All quizzes green (`node --test quiz`): parser quoting/text, compositional keyword normalization, mind config/use, read filename handler, understand paths, vector indexing and math, at-all mapping for vectors, add/subtract/multiply/divide, remains, conditionals, translation/compile paths, moods `ya/def/do/ret` stored, sandpit execution for ceremonies.
- Imperatives store both the command and a result fact; bare add (`ob num 3 to num 4 be plus do`) or subtract produces `result` with updated value in memory. `result` can be chained into subsequent calls.
- Ceremonies run in a sandpit context; `this` bindings and `ret` update the evoke/target/result in main memory; multi-word ceremony names work end-to-end. Registers should be read from the evoking sentence; separate register facts are being phased out.
- Mind resolves model/prompt from stored config (`as` state, `accordingto` discourse) and returns text; compositional parsing emits keyword roles without lingering `context` fields.
- Compile emits JS/C code that keeps the sentence ABI: `exists` produces sentence objects (not scalars), vector `at all` lowers to a map helper, and the JS remember shim returns `undefined` when a name is missing.

## What is half-finished / open edges
- Result facts use a generic `su result`; could evolve to track per-command identifiers.
- Read writes both the command and a result fact; additional result-shaping (e.g., filenames) not captured.
- Mind is stubbed against mocked generate in quizzes; real streaming/roles for replies aren’t modeled yet.
- Parser still assumes keyword tables; no validation against hnuc codes yet.
- Much of the 2019 spec (phonology, noun classes, tense/aspect, GPU/compiler ambitions) remains out-of-scope here.
- Register facts (e.g., `fromindex`/`toindex`) should ultimately be derived from the evoking sentence only; no separate register facts should be emitted long-term. Mutations to `to` targets inside sandpits are now written back when a loop invocation completes; general sandpit write-back beyond evoker/result is still limited.
- Interpreter “at all” currently mirrors compiled helper but still needs further integration for future verbs and richer result shaping.

## Tried and rejected
- Keeping `context` fields on parsed roles (removed in favor of keyword normalization).
- Storing arrays of compositional roles; now the last keyword wins per role.
- Fabricating generic result facts without storing the command first; ordering now records the `do` before the result fact.
