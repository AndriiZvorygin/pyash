
# Roadmap (parity-driven, spec drops, hardening gates, modules early, media IO)

## Invariants

* Parity-first: interpreter + JS + C ship together by default
* Feature gates allowed when a backend lags; quizzes declare the gate
* Specs freeze truth: promote to `@core` only when spec is frozen
* Golden corpus grows continuously; snapshots must match across backends
* `write` is official for screen/file output and mind calls; `say` reserved for TTS flows


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
* Spec drop: `30-data-formats.md` status bumped to v0.2
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

### Dec 28, 2025: YAML parity + CSV/Pyash roundtrip complete (maps done)

* YAML spec v0.1 implemented (`30-data-formats.md`) with deterministic official ordering.
* Parity goldens for interpreter/JS/C (YAML → Pyash, Pyash → YAML → Pyash).
* YAML inline compile precompute for JS/C (no runtime YAML dependency when inline).
* CSV → Pyash and Pyash → CSV → Pyash parity in interpreter/JS/C.
* `be map def` now locked as the configuration format baseline.
* Maps/JSON/YAML/CSV parity + determinism now considered done.


### Dec 29, 2025: Pre-week hygiene gates complete

* `50-modules.md` promoted to v0.1.
* Aspect spec moved to `08-vyah-and-aspect.md` and referenced from the spec index.
* Import rules locked in quizzes (entry allows top-level `do`; imported modules declarations-only).
* `08-vyah-and-aspect.md` shipped (official ordering; `vyah … sloh` success marker).
* Subordinate clauses (`la … ko`) shipped at parity (supports embedded mood when present).
* Runtime contracts shipped in code (duty / stream / chip + lifecycle acks; chip exhaustion errors).
* Error surfacing shipped in code: thrown errors are `be error do`, surfaced runtime results are `be error ya`.

### Dec 30, 2025: Refinery scaffolding + compiled run newspapers

* Refinery spec drafted (`14-refinery.md`, refinery/platform/activity vocabulary) and indexed.
* Interpreter captures refinery/platform definitions into a normalized registry (no execution at definition time).
* Refinery runner shipped (deterministic scheduling + fail-fast) for interpreter/JS/C.
* Run newspaper implemented as opt-in (`--newspaper`) and locked with parity tests across interpreter / JS / C.
* Compiled JS/C runs emit the same newspaper format (via shared runner) when flagged.
* `11-run-recording-and-artifacts.md` shipped so JS/C can emit comparable newspapers.
* `runjs`/`runc` use unique temp outputs to avoid collisions.
* Exchange filesystem rules locked: locator reuse, hash consistency, newline normalization, JS/C parity tests.
* Refinery retries + checkpoints shipped (policy config + newspaper records + parity tests).
* Tool calling parity (interpreter/JS/C) with mind tool call newspaper logging.

### Dec 31, 2025: Mind tooling + again terminology alignment

* Mind spec and tooling aligned (tool capabilities, answer facts, dialogue facts).
* Tool envelope/again terminology aligned; tool envelope spec removed.
* Sentence model updated to mention subordinate clauses.
* `caterer/curl` vendored (git subtree) for runtime HTTP parity.
* C mind runtime added and wired for parity.

### Jan 1, 2026: Command, say, and mind tool hardening

* Command errors now surface full error sentences (CLI prints surfaced error sentence).
* `add` supports text-from-genitive concatenation and `ob text → to text`.
* Espeak module signature tightened to require `to name text`, and payloads are quoted to preserve spaces.
* New noop/plain say modules and examples added for non-shell parity testing.
* Default say mapping now lives in `configure/default.pya` and autoloads in run + REPL.
* Espeak say module moved to `module/` and wired through the import map.
* Tool calling payloads now use safe tool names with signature metadata; tool lookup accepts both names.
* Error sentences now include `from filename`, `by num`, and `at la ... ko` source context.
* Quoted token handling normalized across parser + CSV/YAML/JSON roundtrips.
* New golden example for default say (`examples/pyash/say-default.pya`) and added tests for tool payloads + error context.

### Jan 2, 2026: Content-addressed artifacts + evoke ids

* Artifact bytes are now written to content-addressed paths with run-root links (`artifacts/<run-id>/<artifact-name>`).
* Artifact sentences now link to the evoking sentence via `ob name evoke-<n>` and keep `to filename` as the original locator.
* Replay prefers content-addressed bytes (derived from sha256 + locator extension), falling back to the original locator.
* Added/updated exchange and again-mode tests to verify CA files and alias links across interpreter/JS/C.
* Tool calling parity achieved across interpreter/JS/C with request/response JSON logging in newspapers.

### Jan 2, 2026: Refinery retries + checkpoints

* Retry policy added (delay/backoff/attempts/cap) via `configure/default.pya`.
* Checkpoints recorded and reused across interpreter/JS/C with `--no-checkpoint` and `PYA_CHECKPOINTS`.
* New parity tests for checkpoints and retries across interpreter/JS/C.

### Jan 3, 2026: Again subset + documentation hardening

* Again-mode strict subset documented in `11-run-recording-and-artifacts.md`.
* Fresh Codex Primer written in `documentation/handoff.md`.
* Spec conformance pointers added, plus `90-implementation-map.md`.
* Roadmap/changelog cleanup and guidance aligned to new doc structure.

### Jan 4, 2026: Streaming mind + ISO dates + vendoring draft

* Mind streaming now supports live chunk output to stdout with `PYA_STREAM_STDOUT=1`.
* ISO 8601 `date` payloads added; run start timestamps honor configured timezone offsets.
* Drafted `caterer` vendoring spec for `hear`/`say` with pyash map examples.
* Documented caterer build layout and added whisper.cpp linux-x64 build script.
* Piper `say` backend now produces WAV artifacts, records metadata, and can play audio to speakers by default.
* Default `say` mapping now targets `piper say`, with a new piper golden example and fixture quiz.
* Fixture `hear` backend added with a refinery demo (mind → say → hear) and a matching quiz.
* Whisper.cpp-backed `hear` flow added for real audio transcripts, plus a full refinery example.

# TODO

## Week 2: Media IO v0.4 + Streaming Talk Loop + Streaming STT Binary

**Jan 5 → Jan 11, 2026**

### Ship

* **Streaming `hear` + streaming `say` (usable, interactive)**

  * partial STT is incremental
  * TTS can begin before the full response is complete (where supported)
  * parity-first; feature gates allowed with quizzes

* **Minimal “talk to LLM” loop (golden demo surface)**

  * listen (`hear`) → LLM → speak (`say`)
  * cancellation (`qa`) and timebox (`dweh`) are exercised as first-class controls

* **Drop-a-binary streaming STT for text entry**

  * distributable executable that emits incremental text (streaming)
  * supports cancellation/timeboxing
  * stable, parseable output suitable for piping into OS/editor workflows

* **Deterministic test mode hooks**

  * fixture-driven speech I/O for repeatable tests
  * recorded metadata/hashes sufficient for `again` verification when applicable
  * mind invocation standardized on `be write ... for name <mind> to name <output>` (legacy `totext` supported)

### Hardening gates

* Golden demos:

  * `talk_loop_smoke.pya`
  * `talk_loop_cancel.pya`
  * `talk_loop_timebox.pya`
* Streaming torture:

  * slow consumer behavior
  * cancel mid-utterance
  * timebox listen and speak
* Parity gate:

  * same surfaced error sentences and stable run records for fixture runs across interpreter/JS/C

### Boundary note

Week 2 streaming is **“usable streaming”**. The **formal bounded-queue / overflow backpressure contract** is frozen in Week 5 as part of Concurrency v0.7, and the Week 2 demos are updated to conform exactly at that point.

---

## Week 3: Minimal agent loop v0.45 + Pipeline Workload Pack

**Jan 12 → Jan 16, 2026**

### Ship

* **Verifier loop**

  * run quizzes and emit a deterministic structured report bundle
* **Reducer loop**

  * produce minimal repro `.pya` deterministically
* **Resolution chain for lost signatures**

  * search project modules + stdlib namespaces
  * policy-driven fallback (including mind, where enabled) with deterministic journaling
* **Mind call caching via artefacts**

  * content-hash keys
  * deterministic cache-hit records and stable outputs

### Add: Pipeline Workload Pack (golden scenario)

Introduce and grow a real pipeline pack used to prove verifier/reducer/report determinism:

* downloads recent videos from a source
* transcribes
* produces meeting minutes
* partitions minutes into sections
* summarizes sections
* writes an article
* generates an image
* posts/publishes

(Week 3 focuses on: **reports, repros, caching, determinism**, not concurrency scheduling pressure.)

### Spec drops (freeze v0.45)

* **Reports spec v0.1** (fields, ordering, paths)
* **Mind event schema v0.1** (ids, hashes, provenance)
* **Patch bundle schema v0.1** (diff layout, tests, provenance)

### Hardening gates

* Reports are diff-friendly and deterministic
* Cache-hit runs produce identical outputs + identical run record entries
* Pipeline pack has:

  * smoke run
  * stress run (more items)
  * replay run (`again` verification)

---

## Week 4: Tool bridge (MCP) v0.3

**Jan 17 → Jan 23, 2026**

### Ship

* MCP client in runtime (stdio first)

  * launch/supervise tool servers
  * connect/disconnect journaled deterministically
* Tool discovery pinned per run

  * tool list snapshot stored in artefacts and referenced from run record
  * tool identity includes stable schema identity
* Schema mapping to Pyash-callable signatures

  * generated façade modules with stable naming rules
* Deadline + cancellation propagation

  * deadlines and `qa` behavior propagate to tool calls
  * best-effort cancel recorded deterministically when transport limitations apply
* Permission gating

  * allowlist + argument constraints; denials recorded deterministically

### Spec drops (freeze v0.3)

* **Tool ABI spec v0.1**

  * canonical envelopes, hashing/canonicalization, deadlines/cancel, error surfacing
* **MCP integration spec v0.1**

  * discovery pinning, schema mapping, transport rules, failure policy

### Hardening gates

* Replay verifies tool list snapshot + tool call hashes
* Torture: tool unavailable, tool timeout, server crash/restart rules, schema mismatch mid-run
* Pipeline pack runs with MCP-backed tools **without changing the pipeline shape**

---

## Week 5: Concurrency v0.7 (ready queue, cancellation, backpressure, simulation)

**Jan 24 → Jan 30, 2026**

### Anchor workloads

* **Primary concurrency anchor:** the **pipeline workload pack** (wide DAG → many “ready at once” situations)
* **Secondary concurrency anchor:** the **talk loop** (stream lifecycles + cancel/timebox + slow-consumer)

### Ship

* **Ready-queue scheduling upgrade**

  * deterministic ordering for scheduling ties
  * optional parallelism only when ordering remains deterministic
* **Cancellation and timeouts (real)**

  * deadline propagation to platforms and tool calls
  * stable `qa` semantics across scopes (platform / depend subtree / run)
* **Stream backpressure (spec-locked)**

  * bounded buffering
  * overflow policy is defined and stable
  * deterministic chip consumption ordering
* **Deterministic simulation mode**

  * fixed seed + simulated clock
  * deterministic scheduling outcomes and deterministic run record ordering
* **Schedule trace in newspaper (gated)**

  * queue/stream/cancel decision events when enabled

### Spec drops (freeze v0.7)

* **Concurrency spec v0.1**

  * ready-queue semantics + deterministic ordering
  * cancellation semantics (`qa`) + timeout semantics (`dweh`)
  * stream backpressure rules
* **Simulation mode spec v0.1**

  * determinism rules for simulated clock + scheduling ties

### Hardening gates

* Deterministic replay of concurrent runs in simulation mode across interpreter/JS/C
* Torture tests (seeded):

  * cancellation storms
  * timeout races
  * bounded queues under load
  * slow-consumer backpressure
* Parity gate:

  * identical surfaced error sentences for timeout/cancel across backends
  * deterministic ordering of run record events for the same seed

---

## Week 6: Genetic programming harness v0.5

**Jan 31 → Feb 6, 2026**

### Ship

* Genome: Pyash sentence lists
* Mutations + crossover
* Fitness: quiz pass/fail + penalties
* Signature crystallization workflow

  * promote repeated successes into deterministic signatures
  * retire fallback paths for promoted behaviors (policy-driven)

### Spec drops (freeze v0.5)

* Evolution artefacts spec v0.1 (genomes/logs/fitness/reproducibility)
* Crystallization policy spec v0.1 (promotion rules, required tests/docs)

### Hardening gates

* Fixed seeds, time and step limits
* Sandboxed IO, artefacts only
* Golden demos: evolve small suite + crystallize signature

---

## Week 7: Packaging + human usability v0.8

**Feb 7 → Feb 13, 2026**

### Ship

* Package layout conventions, versioned stdlib
* Formatter + linter
* Dependency and compatibility checks
* Report bundle as first-class output
* Optional local read-only serving of report bundles
* Tool packaging (MCP servers)

  * version pinning + permissions + compatibility checks

### Spec drops (freeze v0.8)

* Package system spec v0.1
* Stdlib stability policy spec v0.1
* Tool packaging spec v0.1
* Evolution policy spec v0.1 (public surface changes from crystallization)

### Hardening gates

* Fresh clone → install → run → reproduce bundle via `again`
* Multi-platform smoke (Linux first; others gated)
* Golden demos: package smoke + bundle replay + package with tools

---

## Week 8: Intent compiler v0.85

**Feb 14 → Feb 20, 2026**

### Ship

* Prompt → candidate Pyash call set (top K)
* Candidate ranking via signature matching

  * stdlib + project modules + MCP façade signatures
* Optional mind assistance for candidate generation (gated + deterministic)
* Artefacts

  * candidates, scores, chosen call, matching trail

### Spec drops (freeze v0.85)

* Intent compiler spec v0.1 (inputs/outputs/ranking/artefacts)
* Candidate format spec v0.1 (sentence shape, confidence, aspect)

### Hardening gates

* Deterministic ranking given fixed inputs + seed
* Golden demos: match + fallback + aspect variants

## Week 9: Knowledge core v0.9 (claim identity, evidence shell, KB layout)

**Feb 21 → Feb 27, 2026**

### Ship

* **Claim key derivation (redundancy + conflict detection)**

  * canonical “same-claim” key (by `su`, `be`, `as`, time window bucket)
  * canonical case ordering for formatting, hashing, indexing
  * golden fixtures that prove equality and inequality cases

* **Evidential shell integration (sentence-native)**

  * `nwah` payload conventions, evidential type placement, provenance fields
  * confidence via `by num`
  * source anchoring via `fromtext <src> <anchor>` and stable anchor ids

* **KB storage layout v0.1**

  * entity-page format (one file per `su`)
  * registry files: lexicon, ontology, sources
  * held and rejected directories keyed by `su case …`

* **Query views (built on `su` index)**

  * “current view” resolver for a claim key
  * “contested view” resolver when conflicts exist
  * “provenance view” listing evidence payloads

### Spec drops (freeze v0.9)

* **Knowledge core spec v0.1**

  * claim key rules
  * canonical ordering rules
  * evidential shell schema
  * source and anchor identity rules
* **KB layout spec v0.1**

  * entity pages
  * registries
  * held and rejected stores

### Hardening gates

* Golden corpus:

  * claim key equality suite (aliases, scope, time windows)
  * evidential payload suite (reported, direct, inferential)
  * resolver suite (current vs contested)

* Parity gate:

  * identical canonical formatting across interpreter / JS / C
  * identical resolver outputs across backends for the same KB snapshot

---

## Week 10: Document digestion v0.92 (policy ingest to sentences, segmentation, draft extraction)

**Feb 28 → Mar 6, 2026**

### Ship

* **Source ingest and anchoring**

  * register `su src …` for each document artifact
  * deterministic anchors: section ids, paragraph ids, line ranges, byte spans (per format)

* **Segmentation pipeline**

  * segment markers recorded as sentences
  * stable mapping from document offsets to anchor ids

* **High-recall extraction to draft channel**

  * emit candidates in `swuh` or `pi7`, with `nwah proh …` payloads
  * definitions extracted into `gyih` where clear
  * unit and quantity normalization for candidates

* **Normalization pass**

  * alias registry updates (lexicon layer)
  * scope registry updates (`as` scopes)
  * relation schema checks (ontology layer)

### Spec drops (freeze v0.92)

* **Digestion spec v0.1**

  * source registration
  * anchoring rules
  * segmentation contract
  * extraction output conventions (mood and evidential requirements)

### Hardening gates

* Golden docs:

  * one short policy
  * one technical README-style doc
  * one tabular doc (CSV-derived narrative)

* For each golden doc:

  * stable anchors across backends
  * stable candidate sentence set (byte-stable ordering)
  * replay via `again` produces identical candidates and identical run record entries

---

## Week 11: Conflict cases + adjudication harness v0.95 (proposer, defence, prosecution, judge)

**Mar 7 → Mar 13, 2026**

### Ship

* **Conflict detection**

  * conflict rule: same claim key, different value, overlapping validity
  * emit `su conflict …` summaries for quick inspection
  * case opener for each conflict cluster

* **Case protocol**

  * `su case <id>` lifecycle: open → argued → decided → disposed
  * standard role tagging via `as` (proposer, defence, prosecution, judge)
  * fixed reason code registry as `gyih` sentences

* **Judge scoring and deterministic verdict**

  * sub-scores written as sentences (evidence strength, scope match, compatibility, consensus, novelty)
  * deterministic aggregation rule and thresholds
  * dispositions: promote, hold, reject, request more evidence

* **Promotion and archive actions**

  * promote writes a new `ya` (or `gyih`) sentence for the winning claim
  * hold routes candidates into held store
  * reject routes candidates into rejected store, with explicit reasons and scores

### Spec drops (freeze v0.95)

* **Adjudication spec v0.1**

  * case sentence shapes
  * role sentence shapes
  * reason code registry requirements
  * scoring and verdict thresholds
  * promotion, hold, reject semantics

### Hardening gates

* Golden conflict pack:

  * scope mismatch conflicts (capex vs opex)
  * unit mismatch conflicts
  * time window overlap conflicts
  * alias-induced conflicts

* Parity gate:

  * identical case files and verdict outputs across interpreter / JS / C for the same inputs
  * identical promoted KB snapshot for the same seed and same evidence set

---

## Week 12: Resurrection + encyclopedia seed pack v1.0 (small world KB, revision over time)

**Mar 14 → Mar 20, 2026**

### Ship

* **Resurrection triggers**

  * reopen a rejected claim when independent evidence accumulates past thresholds
  * open a fresh case id, link back to earlier rejected case ids
  * deterministic scheduling and deterministic thresholds

* **Encyclopedia seed pack**

  * a small, curated KB that exercises the whole loop end-to-end
  * includes lexicon, ontology, sources, entity pages, held, rejected, cases

* **Local Llama integration demo**

  * answer flow: query by `su` pages, resolve current view, generate response
  * citations emitted from `nwah` payloads
  * contested view surfaced explicitly when present

### Spec drops (freeze v1.0)

* **Knowledge lifecycle spec v0.1**

  * resurrection rules
  * revision history conventions
  * view conventions (current, contested, provenance)

### Hardening gates

* Time-series update demo:

  * initial ingestion produces held and rejected items
  * later ingestion triggers resurrection and promotion
  * final KB snapshot matches across backends

* Golden end-to-end demos:

  * `digest_policy_to_kb.pya`
  * `conflict_case_judge_promote.pya`
  * `resurrect_rejected_then_promote.pya`
  * `answer_from_kb_with_provenance.pya`
