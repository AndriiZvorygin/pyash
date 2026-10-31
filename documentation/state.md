# State of Project

Last measured: 2026-10-31. Reproduce the numbers with
`node command/measure_code_balance.mjs` and `npm run test:ci`.

## What the project is

Pyash is a sentence-based language with a Node/ESM REPL, parser, interpreter,
and memory. A sentence is the unit of both meaning and value: case roles are
compositional (axis + context mapped to keyword roles like `fromtext`, `as`,
`become`), every sentence is stored as history, and the grammar itself is the
API surface. Dispatch is signature-first — a verb registers signatures, a
sentence selects one by its shape, and ceremonies (`def...prah`) register their
signatures when they are defined.

Ceremonies run in sandpits; the evoking sentence is the source of truth
(including control cases like `fromindex`/`toindex`), and returned state is
carried by the updated evoker rather than by separate register facts.

The repository is no longer a small experiment. It carries a normative
specification set, a large application layer built on top of the language, and
a test suite that is meant to enforce the specifications rather than merely
illustrate them.

## Current scale

| Measure | Value |
|---|---|
| Commits | 4,675 |
| Verb modules (top level) | 83 |
| Modules under `program/verbs/` | 151 |
| Normative specifications | 24 |
| Quiz files | 793 tracked (759 gate the CI run) |
| Quiz tests | 3,051, zero failures |
| Examples under `examples/pyash/` | 357 |
| Skills | 24 |

## Line distribution

Three buckets, because they answer different questions.

| Bucket | Lines | Files | What it means |
|---|---|---|---|
| Interpreter core | 6,393 | 25 | The language machinery: parser, bridge, memory, program |
| Verb layer | 29,571 | 151 | The dispatch surface users write against |
| Applications | 173,147 | 690 | Library, agent, runtime, command, module |

The core-to-applications ratio is **1:27.08**, and the core is 3.1% of the
measured lines.

Two caveats on reading that ratio. First, an earlier version of this file
counted the whole verb layer as "core" and reported 1:1.88; that number was
inflated by domain logic that has since moved to `program/library/`. Second,
the ratio is not a target in itself — the language is small *because* it is a
language, and the applications are the reason the language exists. The gauge
that matters for `documentation/pyash.md`'s "keep verbs thin" requirement is
the verb-layer gauge below.

### Verb surface

`program/verbs/` holds 151 modules; **15** exceed 400 lines. The largest:

| Lines | Module |
|---|---|
| 2,098 | `program/verbs/itinerary_media.mjs` |
| 1,622 | `program/verbs/qwen_say.mjs` |
| 1,072 | `program/verbs/command.mjs` |
| 874 | `program/verbs/mind/mind.mjs` |
| 775 | `program/verbs/wise_chip.mjs` |

The translation domain (85 modules, 20,344 lines) was moved out of
`program/verbs/` into `program/library/translation/` so that `program/verbs/`
holds verbs rather than language data. The compile verb's implementation
folder (132 modules, 15,728 lines) moved the same way, into
`program/library/compile/`; the verb itself stays a thin file at
`program/verbs/exchange/compile.mjs`.

## Architecture at a glance

- `program/main.mjs`: REPL wiring understand → bridge → memory.
- `program/understand/index.mjs`: tokenization, quoted blocks, keywordized
  compositional roles (`fromtext`/`during`/`become`/`totext`), short role
  aliases (`su`/`ob`).
- `program/bridge/index.mjs`: mood routing, verb dispatch, memory writes for
  `ya`/`def`/`do`/`ret`, result facts for imperatives, sandpit execution for
  ceremonies with multi-word names.
- `program/bridge/signature.mjs`: the signature registry and its lookups.
- `program/verbs/`: verb dispatchers, one verb per file, kept thin.
- `program/library/`: domain logic and data — the translation adapters, the
  reporter pipeline, the VLIW database.
- `program/remember/index.mjs`: in-memory store with get/set/dump/reset,
  definition index, sandpit traces.
- `program/beautiful.mjs`: output formatting.
- `program/motor/ollama.mjs`: Ollama network I/O.

## What works now

- The full quiz suite passes: `npm run test:ci` gates 748 of 753 quiz files
  with zero failures. The four files it does not gate are reported with the
  reason (a missing local resource), not silently skipped.
- Imperatives store both the command and a result fact; bare plus
  (`ob num 3 to num 4 be plus do`) or subtract produces `result` with the
  updated value in memory, and `result` chains into subsequent calls.
- Ceremonies run in a sandpit; `this` bindings and `ret` update the
  evoke/target/result in main memory; multi-word ceremony names work
  end-to-end.
- Mind resolves model and prompt from stored config (`as` state,
  `accordingto` discourse) and returns text; compositional parsing emits
  keyword roles without lingering `context` fields.
- Compile emits JS and C code that keeps the sentence ABI: `exists` produces
  sentence objects rather than scalars, vector `at all` lowers to a map helper,
  and the JS remember shim returns `undefined` for a missing name.
- Interpret and compile agree: the same sentence produces the same result
  through either path.

## What is half-finished / open edges

- Result facts use a generic `su result`; they could evolve to track
  per-command identifiers.
- Mind is stubbed against mocked generate in quizzes; real streaming and roles
  for replies are not modelled yet.
- The parser still assumes keyword tables; there is no validation against hnuc
  codes.
- Much of the 2019 spec (phonology, noun classes, tense/aspect) remains
  out of scope here.
- Register facts (e.g. `fromindex`/`toindex`) should ultimately be derived from
  the evoking sentence only; separate register facts are being phased out.
  Mutations to `to` targets inside sandpits are written back when a loop
  invocation completes; general sandpit write-back beyond the evoker and the
  result is still limited.
- `program/verbs/` still has 17 modules over 400 lines; the verb surface is
  not yet uniformly thin.

## House and example caveats

- `world/house/*` is gitignored except `base` and `refinery-watchdog`, so
  house behaviour differs per clone. House-dependent quizzes are excluded from
  the CI gate entirely and are not reported as an environment gap either:
  the house is out of scope for this repository, not missing.
- The reporter houses are separate repositories that import this
  repository's `program/` and `module/` modules by path, so those modules are
  a published library with no importer here. `configure/house_api.pya`
  declares that surface (36 modules) and the house repositories that consume
  it, and `npm run house:api:check` verifies that every declared module
  exists and that every import a house makes resolves and is declared. The
  check clones the published house repositories into `artifacts/house-repos/`,
  so the contract is verified against what the houses actually contain rather
  than against whichever checkout happens to be present.
- Examples are audited by `node command/audit_examples.mjs`, which runs each
  one through the real runner in a child process. A green exit code is not a
  green example: `examples/pyash/until-loop.pya` once exited 0 while producing
  `counter = undefined`, so the example quizzes assert on resulting facts.
- The CI gate runs the whole tiered suite, so CI provisions the resources the
  suite needs: the Open English WordNet dataset and the whisper sample audio
  (through `npm run bootstrap`), the `pyachso2n` checkout next to the
  repository (the translation dictionary and the glyph word lists), and numpy
  for the python speaker worker. A quiz whose resource is missing is reported
  as a gap rather than failed, and the quiz suite creates its own scratch
  directory under `artifacts/` so a fresh checkout can run it.
- The vocabulary checker tells names from words. A token that names something
  anywhere in a program — even where it also stands in the predicate slot, as
  `be android ... do` names the android — needs no dictionary entry, and is
  reported as a name without vocabulary coverage. Only a token that is used
  solely as a predicate word has to be covered, and only those count as
  missing. A word that names a physical thing with a plain-English reading
  (a video processor module) is recorded as a compound instead, which is how
  `gpu` is covered.
- The scheduled example audit provisions the same resources the CI gate does,
  plus the tools the examples shell out to (ffmpeg, espeak-ng, pandoc and
  poppler), so the audit exercises those examples instead of reporting them as
  gaps. A binary that cannot be spawned, a shell tool that is not installed,
  a device that is not attached and a missing sibling dictionary checkout are
  all gaps rather than defects. The examples that fail for the two
  agent-session defects are recorded in `configure/example_audit_baseline.pya`.

## Tried and rejected

- Keeping `context` fields on parsed roles (removed in favour of keyword
  normalization).
- Storing arrays of compositional roles; the last keyword wins per role.
- Fabricating generic result facts without storing the command first; ordering
  now records the `do` before the result fact.
- Counting the verb layer as interpreter core when measuring the repository
  balance; it hid where the mass actually sat.
