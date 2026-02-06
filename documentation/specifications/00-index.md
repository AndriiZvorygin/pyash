# Specifications Index

Purpose: provide the normative specs for Pyash. Each module follows the same template and links to existing examples and quizzes.

Reading order (core):
1. `01-sentence-and-grammar.md` — sentence shape, cases, quoting, official ordering.
2. `02-core-execution.md` — dispatch/signatures, ceremonies + `this`, control flow, error sentences, dynamic defaults.
3. `03-vyah-and-aspect.md` — `vyah` modifiers and aspect inventory.
4. `04-runtime-primitives.md` — C IR + duty/stream/chip primitives.
5. `05-run-recording-and-artifacts.md` — newspaper/exchange/artifacts + again-mode determinism.
6. `06-data-formats.md` — maps/JSON/YAML/CSV and canonical ordering.

Reading order (feature chapters):
7. `07-io-and-scripts.md` — directory verbs, date/time, interpret-script, download.
8. `08-tools-and-mcp.md` — mind + tool calling + MCP.
9. `09-speech-and-hear.md` — say/hear, speech artifacts, whisper input, vendoring.
10. `10-pipelines.md` — refinery, re-entry cycle.
11. `11-translation.md` — translation pipeline.
11. `11-modules.md` — module system and tool runner contract.
12. `12-web-search.md` — web search spec (draft).
13. `13-cheat-sheet.md` — compact coding-only reference (for small models).
14. `14-index-map.md` — quick lookup map into the full specs.
15. `18-pyash-agent.md` — agent loop, prompt context, and memory.

Recommended practice loop
1. Read `01-sentence-and-grammar.md`, then run `examples/pyash/compile-subtract-to-js-text.pya`.
2. Read `02-core-execution.md`, then run `examples/pyash/ceremony-invoke.pya` and `examples/pyash/ceremony-plus-two.pya`.
3. Read `02-core-execution.md`, then trigger a signature inconsistency (see `quiz/ceremony_signature_inconsistency.test.mjs`).
4. Read `03-vyah-and-aspect.md`, then run `examples/pyash/fizzbuzz.pya`.
5. Read `04-runtime-primitives.md`, then run `quiz/runtime_primitives_lifecycle.test.mjs`.
6. Read `05-run-recording-and-artifacts.md`, then run `quiz/run_newspaper_basic.test.mjs`.
7. Read `06-data-formats.md`, then run `quiz/json_map_roundtrip_canonical.test.mjs`.
8. Read `10-pipelines.md`, then run `examples/pyash/re-entry-cycle-fixture.pya`.

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
- `07-io-and-scripts.md`
- `08-tools-and-mcp.md`
- `09-speech-and-hear.md`
- `10-pipelines.md`
- `11-translation.md`
- `11-modules.md` (v0.1)
- `18-pyash-agent.md`
- `documentation/whisper_initial_prompt.md` (draft)
