# Specifications Index

Purpose: provide the normative specs for Pyash. Each module follows the same template and links to existing examples and quizzes.

Reading order (core):
1. `01-sentence-and-grammar.md`
2. `02-core-execution.md`
3. `03-vyah-and-aspect.md`
4. `04-runtime-primitives.md`
5. `05-run-recording-and-artifacts.md`
6. `06-data-formats.md`

Recommended practice loop
1. Read `01-sentence-and-grammar.md`, then run `examples/pyash/compile-plus-to-js-text.pya`.
2. Read `03-vyah-and-aspect.md`, then run `examples/pyash/fizzbuzz.pya`.
3. Read `02-core-execution.md`, then trigger a signature inconsistency (see `quiz/ceremony_signature_inconsistency.test.mjs`).
4. Read `02-core-execution.md`, then run `examples/pyash/ceremony-invoke.pya` and `examples/pyash/ceremony-plus-two.pya`.
5. Read `02-core-execution.md`, then run `examples/pyash/insertion-sort.pya`.
6. Read `02-core-execution.md`, then run `quiz/exists_do.test.mjs` and inspect `err.sentence`.

If you need code locations without scanning the repo, read `documentation/specifications/90-implementation-map.md`.

Contributing overview (quick)
1. Core modules and entry files
- Parser: `program/understand/index.mjs` (`parse`)
- Sentence splitting: `program/library/sentenceSplitter.mjs` (`splitSentences`, `splitSentencesWithLines`)
- Interpreter bridge/dispatch: `program/bridge/index.mjs` (`interpret`), `program/bridge/signature.mjs` (signature derivation)
- Exchange + artifacts: `program/bridge/exchange.mjs` (`recordArtifact`, `recordExchange`)
- Compiler: `program/verbs/exchange/compile.mjs` (`transpileProgram`, runtime helper wiring)
- Runtime helpers:
  - JS: `program/verbs/exchange/compile/js/runtime_helpers.mjs` (`exchangeRuntimeHelper`, `newspaperRuntimeHelper`)
  - C: `program/verbs/exchange/compile/c/helpers_c.mjs` (EXCHANGE_HELPER, MIND_RUNTIME_HELPER, CSV/YAML helpers)

2. Primary tests and how to run them
- Full suite: `npm test`
- Targeted: `node --test quiz/<file>.test.mjs`
- Interpreter: `node program/main.mjs` (REPL), `./run <file.pya>`
- Compiled JS/C: `./runjs <file.pya>`, `./runc <file.pya>`

3. Source of truth for keywords and ordering
- Keywords (moods, cases, types, vyah): `program/library/grammar/keywords.mjs`
- Compositional case mapping/order: `program/library/compositionalCases.mjs`
- Official JSON key ordering: `documentation/specifications/06-data-formats.md`

Feature specs (optional, when blessed):
- `01-sentence-and-grammar.md` (merged)
- `02-core-execution.md` (merged)
- `03-vyah-and-aspect.md` (merged)
- `04-runtime-primitives.md` (merged)
- `05-run-recording-and-artifacts.md` (merged)
- `06-data-formats.md` (merged)
- `07-io-and-scripts.md` (merged)
- `08-tools-and-mcp.md` (merged)
- `09-speech-and-hear.md` (merged)
- `10-pipelines-and-translation.md` (merged)
- `11-modules.md` (v0.1)
- `documentation/whisper_initial_prompt.md` (draft)
