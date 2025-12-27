
# Roadmap (parity-driven, spec drops, hardening gates, modules early, media IO)

## Invariants

* Parity-first: interpreter + JS + C ship together by default
* Feature gates allowed when a backend lags; quizzes declare the gate
* Specs freeze truth: promote to `@core` only when spec is frozen
* Golden corpus grows continuously; snapshots must match across backends
* `write` is canonical for screen/file output and mind calls; `say` reserved for TTS flows


## Timeline summary (from the commits you pasted)

## One-paragraph “progress so far” (copy-paste friendly)

Work started **Nov 12, 2025** with a sentence-based core, unified memory, and an async verb dispatcher. By mid-November the interpreter existed and tests plus packaging were in place. Late November rapidly expanded the language surface: compositional cases, `def`, file IO, conditionals, sandpit execution, and early compile support, followed by vectors and core math verbs. On Dec 1 the signature system and strict mode became the backbone, enabling reliable dispatch and compilation. Early Dec added translation flows (English↔Pyash), genitives, and stronger compilation to JS/C, then mid-Dec hardened loops, registers, `remains`, and introduced `say`. From Dec 20 onward, algorithm examples (FizzBuzz, 100 doors, sieve, insertion sort) drove parity and regression coverage. By Dec 22–23, maps and JSON maps became full infrastructure with import, JSON→Pyash compile, deterministic `write` output (including file output), and JS/C parity, capped with a word-frequency example and updated specifications.


### Nov 12, 2025: Project bootstrapped

* **Initial sentence model + core runtime skeleton** (initial commit).
* **Unified memory layer + async verb dispatcher** landed right away, so the execution model was “verbs over sentences” from day one.

### Nov 13, 2025: Interpreter exists

* Interpreter layer added, missing files filled in.
* This is the point where it becomes a real language runtime, not just data structures.

### Nov 14, 2025: Testing and packaging foundation

* NPM/package metadata, a testing framework, and early pretty-print tests.
* History logging for sentences appears early, signalling traceability as a core constraint.

### Nov 21–23, 2025: Language surface area and core ergonomics expand fast

* **Parser upgrades**, new quoting style, compositional cases supported and made to work.
* **`def` and function definitions** introduced.
* `compile` appears, plus file read support and helper scripts for testing.
* Conditionals evolve rapidly (`tiny`, `giant`, `equally`), examples grow, docs iterate.
* Major architectural tightening: **evoke sentences as ground truth**, plus **sandpit execution** and `until` support.

### Nov 24–29, 2025: Reorg + math + vectors

* Big reorganization and terminology changes (memory → remember, etc.).
* Quantity/context axis work (`tloh/by/per`), then math verbs (multiply/divide/exponent/negate), dot product, and vector support.
* This is where “can do nontrivial computation” becomes a stated property.

### Dec 1, 2025: Signature system consolidation

* **Legacy map removed**, verbs migrated to signature dispatch.
* Strict mode enabled.
* Ceremony style updated; signatures stored as metadata.
* Net effect: the runtime gets stricter, more deterministic, and easier to compile.

### Dec 4–6, 2025: Compile and translation pipeline matures

* `understand` file-to-file; `compile` text-to-text.
* **Translation to/from English** and Pyash introduced, plus conditional compilation to JS and C.
* `exists` added and documented.
* Genitives added (key for later map + JSON work).

### Dec 7–10, 2025: Compiler hardening + mind integration

* Compile moves to sentence objects; conditional tests fixed; ceremony codegen improved.
* Helpers and npm scripts for repl/run/trace/compile.
* **`mind` plumbing added** (model default, compile payload details, history windows, per-mind buckets).
* Error messages improved (unknown verb, derived signature diagnostics).

### Dec 13, 2025: Loops + vectors + at-all / remains

* Big vector and indexing work (ord sugar, at-case examples, translation/roundtrip tests).
* Compile wrapper shortcuts; signature coverage broadened.
* **`remains` verb** and simplification of **`at all`**.
* Sequence register work begins (`tloh` renamed to `times`, sequence context added).
* Map/at-all doc + decisions refreshed.

### Dec 16–18, 2025: Genitives stabilised, say introduced, C compiler brought up

* Genitive tests restored, parity stabilised, signature checks hardened.
* `say` verb added and broadened; vector toggle/invert examples land.
* C compiler smoke tests expand: add/remains/equally/loops/conditionals; text concatenation lands.
* FizzBuzz parity + regressions land; doors begins to harden.

### Dec 20–21, 2025: Algorithms as parity drivers

* FizzBuzz parity across interpreter/JS/C with compile quizzes.
* 100 doors examples + quizzes; nested C loops; vector fill by count; run helpers.
* Sieve updated to output a primes vector.
* Insertion sort example + JS/C parity tests.

### Dec 22–23, 2025: Maps and JSON maps become real infrastructure

* Core semantics v0.1 drafted and clarified; error sentence contract formalized.
* `write` introduced and migrated as canonical output (console output migration, write-to-file).
* **JSON maps added end-to-end**: literals (`bool`, `hollow`), JSON import, JSON→Pyash compile, JS/C parity tests, default write for JSON maps, and docs updates.
* Word frequency built as a map-driven exemplar with compile parity tests.
* Final doc updates to map/JSON spec and roadmap.


### Dec 25, 2025: v0.2 freeze sprint complete (maps + JSON determinism lock)

* Explicit note: no inline map literal; def/prah is canonical
* Determinism locked (RFC 8785 canonical JSON by default):

  * JSON export key ordering rule (stated + golden)
  * `unspecified` omission rule during JSON export (golden)
  * Self-referential export errors (golden)
* Spec drop: `30-maps.md` status bumped to v0.2
* Hardening: JSON → Pyash → JSON round-trip snapshots (byte-stable)
* Hardening: cross-backend error parity audit for JSON map structural errors

---
### Dec 26, 2025: Modules/imports/namespacing v0.1 complete (pulled forward)

* Module file as a unit of execution/compilation
* `import` supports logical names and filesystem paths (relative + absolute)
* Memoized parsing; multi-alias initialization supported
* Qualified names via alias prefix (ceremonies + facts) with namespace map binding
* Cycle detection and alias-shadowing errors
* Spec drop: `50-modules.md` v0.1 (identity, resolution, cycles, visibility)
* Hardening: multi-file golden tests across interpreter/JS/C
* Backend parity gate enforced by compile tests

---

## Feb 3 → Mar 1, 2026: Real-world inputs tranche (CSV + YAML + config), now module-aware

Now that modules exist, config and formats can live in a proper stdlib namespace.

### Ship

* CSV parse into vectors/maps
* Group-by + aggregates: count, sum
* YAML ↔ Pyash translation:

  * YAML → `be json map def … prah` chain (canonical)
  * JSON maps → YAML emission (supported subset)
* Configuration loading:

  * support JSON and YAML config files
  * merge/override precedence (CLI > env > config > defaults)
  * stable error sentences for missing/invalid config

### Spec drops (freeze v0.35)

* CSV spec v0.1
* YAML spec v0.1 (subset explicitly stated)
* Config spec v0.1 (formats, precedence, error rules)

### Hardening

* Deterministic parsing/emission tests (CSV + YAML)
* Golden demos:

  * `csv_group_by.pya`
  * `yaml_roundtrip.pya`
  * `config_precedence.pya`

---

## Mar 2 → Apr 5, 2026: Media IO v0.1 (TTS via `say`, STT via `hear`)

Implemented as library verbs, configured via the config system, backed by external tools.

### Ship

* `say` (TTS interface):

  * `ob text "..." be say do`
  * default backend “none” with clear error sentence
* `hear` (STT interface):

  * `from filename <audio> to name <out> be hear do`
  * minimal output: text; optional future: segments + timestamps
* External tool backends via config:

  * TTS: eSpeak NG, Piper, system TTS
  * STT: Whisper, whisper.cpp, or external service (explicitly gated)

### Spec drops (freeze v0.4)

* Speech spec v0.1:

  * signatures
  * required config keys
  * error rules
  * deterministic test mode requirements

### Hardening

* Deterministic test mode:

  * `say` writes an artefact log or wav to artefacts dir in tests
  * `hear` uses pinned fixture audio and pinned model/version recorded in artefacts
* Artefact schema: backend, model, version, input hash

---

## Apr 6 → May 10, 2026: Minimal agent loop v0.1 (tests decide)

### Ship

* Verifier loop: run quizzes, emit structured reports + artefacts dir
* Reducer loop: store minimal repro `.pya`
* Propose, run, report

### Spec drops (freeze v0.45)

* Reports spec v0.1 (stable fields, ordering, paths)

### Hardening

* Diff-friendly deterministic reports

---

## May 11 → Jun 30, 2026: Genetic programming harness v0.1

### Ship

* Genome: Pyash sentence lists
* Mutations + crossover
* Fitness: quiz pass/fail + optional penalties

### Spec drops (freeze v0.5)

* Evolution artefacts spec v0.1 (genomes, logs, fitness, reproducibility)

### Hardening

* Fixed seeds, time/step limits, sandboxed IO (artefacts only)

---

## Jul → Aug 2026: Pipeline skeleton (systems slice)

### Ship

* Pipeline runner (stages), queue + worker pool
* Retries/backoff, checkpoints
* Structured logs

### Spec drops (freeze v0.6)

* Error model spec v0.1
* IO model spec v0.1
* Log schema spec v0.1

### Hardening

* Reproducible runs, backpressure rules

---

## Sep 2026 onward: Concurrency + packaging + “usable by other humans”

### Concurrency

* DAG scheduler, cancellation, timeouts, torture tests
* Deterministic simulation mode where possible
* Concurrency spec v0.1 + runtime lifecycle spec v0.1

### Packaging/tooling

* Package layout conventions, versioned stdlib
* Formatter + linter, dependency/compat checks
* GP production mode: PR-ready diffs + proof artefacts
* Package system spec v0.1, stdlib stability policy, evolution policy spec v0.1

---

## Parity tags

* `@core`: interpreter + JS + C
* `@js`: JS may lead temporarily
* `@c`: C may lag temporarily
* Promote to `@core` only with frozen spec + golden coverage + error parity

---

If you later decide “config before modules” for pragmatic reasons, you can still do it, but early modules will pay off immediately: it forces a clean boundary where `say/hear/csv/yaml/config` live, and prevents core from turning into a junk drawer.
