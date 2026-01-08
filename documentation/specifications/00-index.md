# Specifications Index

Purpose: provide the normative specs for Pyash. Each module follows the same template and links to existing examples and quizzes.

Reading order (core):
1. `01-sentence-and-grammar.md`
2. `08-vyah-and-aspect.md`
3. `03-dispatch-and-signatures.md`
4. `04-ceremonies-and-this.md`
5. `05-control-flow.md`
6. `06-errors.md`

Recommended practice loop
1. Read `01-sentence-and-grammar.md`, then run `examples/pyash/compile-add-to-js-text.pya`.
2. Read `08-vyah-and-aspect.md`, then run `examples/pyash/fizzbuzz.pya`.
3. Read `03-dispatch-and-signatures.md`, then trigger a signature inconsistency (see `quiz/ceremony_signature_inconsistency.test.mjs`).
4. Read `04-ceremonies-and-this.md`, then run `examples/pyash/ceremony-invoke.pya` and `examples/pyash/ceremony-add-two.pya`.
5. Read `05-control-flow.md`, then run `examples/pyash/insertion-sort.pya`.
6. Read `06-errors.md`, then run `quiz/exists_do.test.mjs` and inspect `err.sentence`.

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
- Official JSON key ordering: `documentation/specifications/30-data-formats.md`

Feature specs (optional, when blessed):
- `07-c-ir.md` (v0.1)
- `09-runtime-primitives.md` (v0.1)
- `01-sentence-and-grammar.md` (merged)
- `11-run-recording-and-artifacts.md` (merged)
- `14-refinery.md` (v0.1)
- `16-mind-and-tools.md` (merged)
- `18-say-and-hear.md` (v0.1)
- `19-speech-artifacts.md` (v0.1)
- `21-vector-at-all.md` (v0.1)
- `30-data-formats.md` (merged)
- `08-vyah-and-aspect.md` (merged)
- `50-modules.md` (v0.1)
