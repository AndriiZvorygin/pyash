# Quiz Plan

## What is covered
- Parser: quoted text and blocks, short aliases (`su/ob`), compositional keyword mapping (fromtext/during/become/totext/as, plus quantity `times/by/per`, plus limit `atleast/exactly/atmost`), minimal declaratives, bare names.
- Core interpreter: declaratives, last-write wins, plus/subtract/multiply/divide imperatives, giant conditional, topic sugar, def mood, storing `do` commands and result facts, bare plus without explicit target.
- Compositional roles: keyword normalization across contexts/axes (fromtext/during/become/totext, etc.).
- Mind: registration with state/discourse, invocation pulling config and calling a stubbed Ollama generate.
- Read: filename handler loads sandpit file, stores text fact.
- Compile: in-memory program text to parsed sentences + JSON.
- Motor: Ollama HTTP client streaming mock quizzes.

## Gaps / needs
- hnuc/code validation for compositional cases against `compositionalCases.mjs`.
- Mind reply mapping for assistant/thinking/time fields; streaming behaviour.
- Additional verb coverage for other noun classes hinted in specs (files/models/pipeline nodes beyond current verbs).
- More REPL-level integration quizzes (typing sentences and inspecting memory output order).
- Error-path quizzes for missing handlers or malformed inputs in dynamic verbs.

## Example cases to plus
- Mind: malformed config (missing model) and ensuring errors surface; streaming stub to ensure multi-chunk prompts are handled.
- Read: non-existent filename should throw; different handler types (if added) should be validated via dispatch.
- Add: other type combinations (name+num, num+str) with expected failures or handlers.
- Compositional: ensure unknown context/axis keywords are rejected; hnuc lookup once implemented.

## Examples and manual REPL verification
- The `examples/` directory holds curated REPL transcripts and scenarios (`core/`, `features/`, `bugs/`, `docs/`) and a `TEMPLATE.md` for new entries.
- Examples complement automated quizzes: use them to manually drive the REPL, confirm memory contents (and sandpit traces), and reproduce bugs/features that are hard to assert in code (streaming, UX).
- When adding a new behavior, prefer adding an automated quiz first; if interactive steps are useful, plus/update an example alongside the quiz and note its intent/status in `examples/`.
- Keep examples small and deterministic; when an example exposes a bug, plus an automated regression quiz to lock it in.

## How to run
- Full suite: `npm test` or `node --test quiz`
- Single file: `node --test quiz/core.test.mjs` (or any `quiz/*.test.mjs`)

Quizzes use Node’s built-in `node:test` with `assert/strict`; keep new quizzes close to the behaviour they cover.
