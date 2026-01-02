# Changelog

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
* `write` introduced and migrated as official output (console output migration, write-to-file).
* **JSON maps added end-to-end**: literals (`bool`, `hollow`), JSON import, JSON→Pyash compile, JS/C parity tests, default write for JSON maps, and docs updates.
* Word frequency built as a map-driven exemplar with compile parity tests.
* Final doc updates to map/JSON spec and roadmap.


### Dec 25, 2025: v0.2 freeze sprint complete (maps + JSON determinism lock)

* Explicit note: no inline map literal; def/prah is official
* `be map def` confirmed as the configuration format baseline
* Determinism locked (RFC 8785 official JSON by default):

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


### Dec 27, 2025: CSV parity and roundtrip hardening complete

* CSV spec v0.1 implemented (parser + emitter) with deterministic write output.
* Fixture-backed roundtrip parity (interpreter/JS/C), including ERPNext Payment Entry template.
* Hardening: multi-file golden tests across interpreter/JS/C
* Backend parity gate enforced by compile tests


### Jan 1, 2026: Mind tools + default say + error context hardening

* Default say mapping now lives in `configure/default.pya` and autoloads in run + REPL.
* Espeak say module moved to `module/` and wired through the import map.
* Tool calling payloads now use safe tool names with signature metadata; tool lookup accepts both names.
* Error sentences now include `from filename`, `by num`, and `at la ... ko` source context.
* Quoted token handling normalized across parser + CSV/YAML/JSON roundtrips.
* New golden example for default say (`examples/pyash/say-default.pya`) and added tests for tool payloads + error context.

### Dec 28, 2025: YAML parity + CSV/Pyash roundtrip complete (maps done)

* YAML spec v0.1 implemented (`32-yaml.md`) with deterministic official ordering.
* Parity goldens for interpreter/JS/C (YAML → Pyash, Pyash → YAML → Pyash).
* YAML inline compile precompute for JS/C (no runtime YAML dependency when inline).
* CSV → Pyash and Pyash → CSV → Pyash parity in interpreter/JS/C.
* `be map def` now locked as the configuration format baseline.
* Maps/JSON/YAML/CSV parity + determinism now considered done.


### Dec 29, 2025: Pre-week hygiene gates complete

* `50-modules.md` promoted to v0.1.
* Aspect spec moved to `40-aspect.md` and referenced from the spec index.
* Import rules locked in quizzes (entry allows top-level `do`; imported modules declarations-only).
* `08-vyah.md` shipped (official ordering; `vyah … sloh` success marker).
* Subordinate clauses (`la … ko`) shipped at parity (supports embedded mood when present).
* Runtime contracts shipped in code (duty / stream / chip + lifecycle acks; chip exhaustion errors).
* Error surfacing shipped in code: thrown errors are `be error do`, surfaced runtime results are `be error ya`.

### Dec 30, 2025: Refinery scaffolding + compiled run newspapers

* Refinery spec drafted (`14-refinery.md`, refinery/platform/activity vocabulary) and indexed.
* Interpreter captures refinery/platform definitions into a normalized registry (no execution at definition time).
* Refinery runner shipped (deterministic scheduling + fail-fast) for interpreter/JS/C.
* Run newspaper implemented as opt-in (`--newspaper`) and locked with parity tests across interpreter / JS / C.
* Compiled JS/C runs emit the same newspaper format (via shared runner) when flagged.
* `12-source-maps.md` shipped so JS/C can emit comparable newspapers.
* `runjs`/`runc` use unique temp outputs to avoid collisions.
* Exchange filesystem rules locked: locator reuse, hash consistency, newline normalization, JS/C parity tests.

### Dec 31, 2025: Mind tooling + again terminology alignment

* Mind spec and tooling aligned (tool capabilities, answer facts, dialogue facts).
* Tool envelope/again terminology aligned; tool envelope spec removed.
* Sentence model updated to mention subordinate clauses.
* `caterer/curl` vendored (git subtree) for runtime HTTP parity.
* C mind runtime added and wired for parity.

### Jan 1, 2026: Command + say module hardening

* Command errors now surface full error sentences (CLI prints surfaced error sentence).
* `add` supports text-from-genitive concatenation and `ob text → to text`.
* Espeak module signature tightened to require `to name text`, and payloads are quoted to preserve spaces.
* New noop/plain say modules and examples added for non-shell parity testing.
