# Specifications Index

Purpose: provide the normative specs for Pyash. Each module follows the same template and links to existing examples and quizzes.

Reading order (core):
1. `01-sentence-model.md`
2. `07-compositional-cases.md`
3. `08-vyah.md`
4. `02-moods-and-memory.md`
5. `03-dispatch-and-signatures.md`
6. `04-ceremonies-and-this.md`
7. `05-control-flow.md`
8. `06-errors.md`

Recommended practice loop
1. Read `01-sentence-model.md`, then run `examples/pyash/compile-add-to-js-text.pya`.
2. Read `02-moods-and-memory.md`, then run `examples/pyash/fizzbuzz.pya`.
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
- Compiler: `program/verbs/exchange/compile.mjs` (`transpileProgram`, runtime helpers)
- Runtime helpers:
  - JS: `program/verbs/exchange/compile.mjs` (`exchangeRuntimeHelper`, `newspaperRuntimeHelper`)
  - C: `program/verbs/exchange/helpers_c.mjs` (EXCHANGE_HELPER, MIND_RUNTIME_HELPER, CSV/YAML helpers)

2. Primary tests and how to run them
- Full suite: `npm test`
- Targeted: `node --test quiz/<file>.test.mjs`
- Interpreter: `node program/main.mjs` (REPL), `./run <file.pya>`
- Compiled JS/C: `./runjs <file.pya>`, `./runc <file.pya>`

3. Source of truth for keywords and ordering
- Keywords (moods, cases, types, vyah): `program/library/grammar/keywords.mjs`
- Compositional case mapping/order: `program/library/compositionalCases.mjs`
- Official JSON key ordering: `documentation/specifications/33-json.md`

Feature specs (optional, when blessed):
- `07-c-ir.md` (v0.1)
- `09-runtime-primitives.md` (v0.1)
- `10-subordinate-clauses.md` (v0.1)
- `11-run-newspaper.md` (v0.2)
- `12-source-maps.md` (v0.1)
- `13-exchange-and-artifact.md` (v0.2)
- `14-refinery.md` (v0.1)
- `15-tool-envelope.md` (v0.1)
- `16-mind.md` (draft v0.2)
- `17-mind-tool-calling.md` (draft v0.1)
- `21-vector-at-all.md` (v0.1)
- `30-maps.md` (v0.2)
- `31-csv.md` (v0.2)
- `32-yaml.md` (v0.1)
- `33-json.md` (v0.2)
- `40-aspect.md` (v0.6 target; add when Week 1 freezes)
- `50-modules.md` (v0.1)
