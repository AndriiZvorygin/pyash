## Folder plan (using “specification” everywhere)

### `documentation/specifications/`

Small, normative modules. Consolidated into numbered chapters to keep file count low.

* `00-index.md`
  Reading order, what is “core”, what is “feature”, and links to examples that demonstrate each concept.

* `01-sentence-and-grammar.md`
  Fields, cases, typed terms, genitives, quoting, and official ordering.

* `02-core-execution.md`
  Dispatch/signature rules, ceremonies + `this`, control flow, and error sentence contracts.

* `03-vyah-and-aspect.md`
  `vyah` modifiers and the aspect inventory.

* `04-runtime-primitives.md`
  C IR, duty/stream/chip primitives, and vector `at all`.

* `05-run-recording-and-artifacts.md`
  Run newspaper, exchanges, artifacts, and again-mode determinism.

* `06-data-formats.md`
  Map/JSON/YAML/CSV formats, canonical ordering, and determinism rules.

* `07-io-and-scripts.md`
  Directory verbs, date/time, interpret-script, and download.

* `08-tools-and-mcp.md`
  Mind + tool calling, tool ABI, tool envelope, and MCP integration.

* `09-speech-and-hear.md`
  Say/hear verbs, speech artifacts, whisper input, and caterer vendoring.

* `10-pipelines-and-translation.md`
  Refinery, re-entry cycle, and translation.

* `11-modules.md`
  Module system and tool runner contract.

* `90-implementation-map.md`
  Code pointers for implementers.

### `documentation/guideline/`

Non-normative, user-facing.

* `getting-started.md`
  “Run REPL, run a .pya, run tests, read outputs.”

* `cookbook.md`
  Links into your existing examples by intent: arithmetic, conditionals, loops, vectors, compile, understand, mind.

* `debugging.md`
  How to interpret “unknown signature”, how to inspect memory, how to run trace.

### `documentation/examples/`

Make it easy for a naive model to navigate.

* `examples-list.md`
  A table: concept → best example(s). Use your existing pairs:

  * `examples/core/*.md` as explanation
  * `examples/pyash/*.pya` as runnable source
  * optionally `examples/out/*` as expected outputs for compiled artifacts

* `specifications-to-quizzes.md`
  Rule → quiz file(s) that enforce it.

* `glossary.md`
  “sentence”, “case”, “mood”, “signature”, “register”, “sandpit”, “evoker”, “consequence”.

## Template for each specification module

Keep it rigid so GPT-5.2 stops improvising.

1. Purpose
2. Terms
3. Rules (MUST/MAY style, bullet form)
4. Error contracts (names and when raised)
5. Examples (links to *existing* files only)
6. Tests that define truth (quiz file links)

## How to leverage your existing examples cleanly

You already have a nice pairing pattern:

* `examples/core/<topic>.md` is the narrative
* `examples/pyash/<topic>.pya` is the runnable truth

So the specifications should **link to both**, but only treat the `.pya` as normative behaviour, and the `.md` as explanation.

Example linking pattern inside a specification:

* “See: `examples/core/tiny-conditional.md` (explanation)”
* “Run: `examples/pyash/tiny-conditional.pya` (behaviour)”

## The “naive GPT-5.2” onboarding pathway

In `documentation/specifications/00-index.md`, include a short recommended reading and practice loop:

1. Read `01-sentence-and-grammar.md` then run `examples/pyash/plus-basic.pya`
2. Read `01-sentence-and-grammar.md` then run `examples/pyash/result-chaining.pya`
3. Read `03-dispatch-and-signatures.md` then intentionally trigger a signature error example
4. Read `04-ceremonies-and-this.md` then run `examples/pyash/ceremony-invoke.pya` and `this-registers.pya`
5. Read `05-control-flow.md` then run `tloh-loop.pya`, `until-loop.pya`, and a conditional example
6. Read `02-core-execution.md` then run a trace (`program/command/read_pya_trace.mjs`) and inspect the error sentence shape

That gives the model a tight, reproducible mental model.

## Minimal work sequence to build this without churn

1. Create `documentation/specifications/00-index.md` plus the six core modules as stubs with headings.
2. Fill each module by **linking to the best existing examples** first, then write the rules.
3. Add `documentation/indexes/examples-index.md` with a table mapping your current examples.
4. Only after that, plus feature specifications (compile, understand, mind).

If you want, paste your current `core.md` into `documentation/specifications/` as `99-core-monolith.md` and treat it as a transitional source, then progressively split it into the modules above.
