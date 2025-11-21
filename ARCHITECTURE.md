# Architecture

## Overview
Pyash is a small ESM Node app that parses Pyash sentences, dispatches verbs, and records every sentence (ya/def/do) in memory. The system is intentionally lightweight: no database, direct module imports, and dynamic verb dispatch for extensibility. It implements a thin slice of the broader language described in `documentation/pyac.txt`.

## Modules
- `main.mjs`: CLI REPL. Reads lines, hands them to `parse`, then `interpret`, prints results. Supports `mem`, `reset`, `quit` commands.
- `parser.mjs`: Tokenizes input, supports quoted blocks, short role aliases (`su/ob`), and compositional keyword mapping. Context+axis pairs become keyword roles (`fromtext`, `during`, `become`, `totext`, `as`, etc.). Emits plain JS objects: `{mood, subj, obj, fromtext, ...}`.
- `dispatcher.mjs`: Routes by `mood`.
  - `ya/def`: stored via `setMemory`.
  - `do`: finds verb, resolves targets, invokes verb, stores updated targets, always stores a `result` fact, and stores the command itself for history.
  - `que`: returns stored fact rendered via `sentenceToPyash`.
- `memory.mjs`: In-memory array store with `setMemory`, `getMemory`, `dumpMemory`, `resetMemory`.
- `pretty.mjs`: Renders sentence objects back into Pyash strings for queries.
- `verbs/`: Implement behaviors. Patterns:
  - `add.mjs` / `read.mjs`: dynamic dispatch to type-specific handlers (`read_from_filename.mjs`, `add_obj_num_to_num.mjs`, etc.).
  - `giant.mjs`: conditional control.
  - `compile.mjs`: builds programs via `program.mjs` and writes JSON/text results to memory.
  - `mind.mjs`: resolves model/prompt from stored mind config (keywords `as`, `accordingto`) and calls Ollama HTTP via `motor/ollama.mjs`.
- `program.mjs`: Builds a program (sentences + labels) from plain text; used by compile.
- `library/compositionalCases.mjs`: Axis/context grid and keyword table (e.g., state→`as`/`become`, discourse→`fromtext`/`totext`). Full case/hnuc usage from the spec is not surfaced yet.

## Data Flow
1) REPL/input → `parser.mjs` → sentence object with keyworded roles.
2) `dispatcher.mjs` selects verb by `mood`/`be`, calls verb with resolved targets/inputs.
3) Verbs return `{ obj, be? }`; dispatcher normalizes and writes:
   - command sentence to memory,
   - updated targets (if any),
   - a `result` fact with normalized output.
4) Memory (`memory.mjs`) accumulates history; queries return rendered sentences.

## Conventions & Patterns
- Always add tests first (red→green); every verb change gets coverage.
- Keywordized compositional roles: contexts are mapped to keywords, not stored as `{context: ...}`.
- Imperatives are historical: commands and results are stored; moods `ya`, `def`, `do` all persist.
- Dynamic verb dispatch: new typed handlers follow `verb_from_<type>.mjs` or `verb_obj_<type>_to_<type>.mjs` naming.
- Mind config is declarative (`be mind` with `from`/`as`/`accordingto`) and reused on calls to `be mind do`.
- Files: prefer `test/sandpit` for fixtures; keep dependencies minimal (built-in modules + optional Ollama HTTP).
- Larger language features in `pyac.txt` (phonology, noun classes, control constructs, GPU/compiler path) are acknowledged but currently out of scope.
