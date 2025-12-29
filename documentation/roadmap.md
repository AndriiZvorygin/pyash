
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


---

# TODO

## Week 1: Pipeline + replay + logging + runtime contracts v0.6

**Dec 29, 2025 → Jan 4, 2026**

### Ship

* Pipeline runner (stages)

  * Explicit stage graph (linear acceptable first; stage metadata DAG-ready)
  * Stage contract: inputs, outputs, artefacts, error sentence, deterministic hash inputs
  * Stage ids are stable strings (used everywhere: paths, journal, logs)
* Queue + worker pool

  * Single-worker acceptable first, with stable scheduling order
  * Stage execution isolation: per-stage working dir under artefacts (`stages/<stageId>/...`)
* Retries with backoff, checkpoints

  * Retry policy stored in journal (attempt count, delays, final outcome)
  * Checkpoints keyed by `(stageId, inputHash, configHash)`
* Artefacts directory contract (stable layout)

  * Stable run root with `manifest`, `journal`, `logs`, `stages/<stageId>/...`
  * Content-addressed blob store for large objects (audio, video, downloads)
* Structured logs (machine-readable)

  * Event stream with stable ordering rules
  * Log events carry correlation ids and link to journal ids + artefact paths
* Run journal per run (manifest as JSON map value, persisted via existing JSON write)

  * In-memory: json map value
  * On disk: `write … to state json to filename …` for byte-stable output 
  * Per-stage start/end records
  * Per-attempt records for retries
  * Hashes for inputs, outputs, artefacts
* Replay mode

  * Re-executes from journal
  * Verifies hashes and byte-stability for golden runs
* Runtime primitives (real, first-class)

  * **Value** (finished result or structured error)
  * **TaskHandle** (running job with lifecycle)
  * **Stream** (ordered chunk sequence with lifecycle)
* Aspect-driven evaluation contract (implemented end-to-end)

  * `fa` returns Value
  * `pfih` returns TaskHandle
  * `me` returns Stream
  * lifecycle/control aspects usable by plumbing: `tyih`, `mweh`, `qa`, `dweh`
* Tool call envelope (generic, for MCP + any external tool)

  * Journal records `tool.call` and `tool.result`
  * Hashes stable and replay-verifiable

### Spec drops (freeze v0.6)

* Run journal spec v0.1

  * fields, ordering, hashing rules
  * per-stage record schema: `stageId`, `aspect`, `primitiveKind`, `attempt`, `startTs`, `endTs`, `deadlineMs`, `cancelPolicy`
  * tool records: `toolName`, `argsHash`, `resultHash`, `backendId`, `durationMs`, `ok`
* Error model spec v0.1

  * stage failure error sentences, using global error shape (`su name`, `ob text`, `from name`) 
  * stable kinds for: IO failure, timeout, cancellation, backend lost, hash mismatch
* IO model spec v0.1

  * inputs, outputs, artefacts rules
  * canonical path rules and canonical ordering rules (reuse existing “official key order” concept from map write rules) 
* Log schema spec v0.1

  * event names, required fields, ordering, correlation ids (`traceId`, `stageEventId`)
* Aspect spec v0.1 (`40-aspect.md`)

  * aspect inventory
  * return typing rule (Value/TaskHandle/Stream)
  * lifecycle semantics for `mweh` and `qa`
* Runtime primitives spec v0.1

  * Value shape
  * TaskHandle fields + lifecycle states
  * Stream chunk envelope + lifecycle operations

### Hardening

* Replays match byte-stable artefacts for golden runs
* Cross-backend parity for journal writing and stage failure errors
* Torture tests

  * retries with backoff
  * checkpoints hit and miss
  * partial stage failure
  * replay verification and hash mismatch reporting
* Primitive parity tests

  * same stage + same aspect yields same `primitiveKind`
  * `qa` and `mweh` produce terminal outcomes within declared deadlines
* Tool event parity tests

  * stable hashing and ordering for tool records
  * replay detects altered tool outputs

---

## Week 2: Concurrency v0.7

**Jan 5 → Jan 11, 2026**

### Ship

* DAG scheduler for pipeline stages

  * Explicit dependency edges, ready-queue semantics
  * Stable ordering rules when multiple nodes are ready
* Cancellation and timeouts (real)

  * Deadline propagation to stages and tool calls
  * `qa` cancellation semantics: terminal state guaranteed or explicit timeout failure
  * Cancellation scopes: stage, subtree, entire run
* Backpressure rules for Stream (real)

  * Bounded queues between producers and consumers
  * Overflow policy per stream type (block, drop, coalesce)
  * Consumer pull model (`next`) with predictable chunk ordering
* Deterministic simulation mode for scheduling (tests)

  * Fixed seed and simulated clock
  * Simulated execution produces deterministic journal + stream ordering
* Journal records scheduling decisions and outcomes

  * queue events: enqueued, dequeued, blocked, unblocked
  * stream events: chunk produced, chunk consumed, close, cancel
  * cancellation events: requested, acknowledged, finalized

### Spec drops (freeze v0.7)

* Concurrency spec v0.1

  * DAG semantics and readiness
  * cancellation semantics (`qa`)
  * timeout semantics (`dweh` timebox wrapper rules)
  * backpressure rules for Stream
* Runtime lifecycle spec v0.1

  * start, stop, cleanup
  * failure modes: dead worker, lost stage output, partial stream
* Simulation mode spec v0.1

  * determinism rules
  * stable ordering rules for equal-priority scheduling

### Hardening

* Deterministic replay of a concurrent run in simulation mode
* Torture tests

  * cancellation storms
  * timeout races
  * bounded queues under load
  * slow-consumer stream backpressure
* Parity

  * identical error sentences for timeout and cancellation across backends
  * deterministic ordering of journal events for the same simulation seed

---

## Week 3: Tool bridge (MCP) v0.3

**Jan 12 → Jan 16, 2026**

### Ship

* MCP client in runtime (stdio first)

  * Launch and supervise tool servers
  * Connect/disconnect behaviour journaled
* Tool discovery pinned per run

  * `tools/list` snapshot stored in artefacts and referenced from journal
  * Tool identity includes name, version, schema hash
* Schema mapping to Pyash-callable signatures

  * Generated façade module(s) exposing tools as deterministic signatures
  * Stable name mapping rules (tool names → module + verb)
* Deadline and cancellation propagation

  * `deadlineMs` passed through to tool calls
  * `qa` cancels tool calls when transport supports it, else records best-effort cancel with explicit status
* Streaming support policy (real, where supported)

  * If MCP tool supports streaming, map to Stream
  * One-shot-only tools map to `fa` only
* Permission gating

  * Allowlist + argument constraints in config
  * Every deny journaled with reason + requested args hash
* Reference MCP servers (initial set)

  * `web.fetch` (HTTP fetch with caching hooks)
  * `web.crawl` (crawler adapter)
  * `media.download` (yt-dlp adapter)
  * `store.kv` (SQLite or filesystem)
  * `store.vector` optional (stub acceptable if deferred)

### Spec drops (freeze v0.3)

* Tool ABI spec v0.1

  * request/response envelopes
  * hashing + canonical ordering
  * deadlines, cancellation, retries
  * stable error sentences for tool failures (using global error sentence shape) 
* MCP integration spec v0.1

  * discovery, pinning, schema mapping
  * transport rules (stdio first)
  * failure policy (server crash, tool lost, schema mismatch)

### Hardening

* Replay includes tool list snapshot and verifies tool call hashes
* Torture tests

  * tool unavailable
  * tool timeout
  * tool server crash and restart rules
  * schema change detected mid-run
* Golden demos

  * `mcp_list_tools.pya`
  * `mcp_web_fetch_smoke.pya`
  * `mcp_media_download_smoke.pya`

---

## Week 4: Media IO v0.4

**Jan 17 → Jan 23, 2026**

### Ship

* `say` (TTS interface) as a library verb backed by pipeline stages
* `hear` (STT interface) as a library verb backed by pipeline stages
* Aspect-shaped speech API (real streaming)

  * `say fa` → Value (bytes or file path)
  * `say me` → Stream (audio frames) with real backpressure
  * `say pfih` → TaskHandle (background synth)
  * `hear fa` → Value (final transcript)
  * `hear me` → Stream (partial transcripts) with real backpressure
  * `hear pfih` → TaskHandle (capture session)
  * `tyih` waits, `mweh` closes/flushes, `qa` cancels
* Config-driven backends

  * TTS: eSpeak NG, Piper, system TTS
  * STT: whisper.cpp, Whisper, or external service via explicit gate
  * Optional: MCP backend for speech (adapter)
* Deterministic test mode hooks

  * fixtures
  * pinned model metadata in artefacts
  * output hashes verified in replay

### Spec drops (freeze v0.4)

* Speech spec v0.1

  * signatures per aspect form
  * required config keys
  * error sentences
  * deterministic test mode requirements
  * stream chunk envelope rules for partial transcripts and audio frames
* Speech artefact schema v0.1

  * backend, model, version
  * input hash, output hash
  * chunking rules for streaming outputs

### Hardening

* Fixture audio pinned, outputs journaled, replays verify hashes
* Streaming torture tests

  * slow consumer backpressure
  * cancellation mid-utterance
  * timebox capture with `dweh`
* Golden demos

  * `say_smoke.pya`
  * `hear_smoke.pya`
  * `speech_config.pya`
  * `walkie_talkie_loop_smoke.pya`

---

## Week 5: Minimal agent loop v0.45

**Jan 24 → Jan 30, 2026**

### Ship

* Verifier loop: run quizzes, emit structured report bundle
* Reducer loop: store minimal repro `.pya`
* Resolution chain for lost signatures

  * signature search (project modules, stdlib namespaces)
  * MCP tool fallback (generated façade modules from Week 3 discovery)
  * local mind fallback policy (config-driven)
  * patch bundle output (diff, new signatures, tests, docs stubs)
* Mind call caching via artefacts (content-hash keys)

  * cached mind calls journaled as cache hits with stable hashes

### Spec drops (freeze v0.45)

* Reports spec v0.1 (stable fields, ordering, paths)
* Mind event schema v0.1 (model id, params, prompt hash, context hash, output hash)
* Patch bundle schema v0.1 (diff layout, test expectations, provenance fields)

### Hardening

* Diff-friendly deterministic reports
* Cache hits produce identical outputs and journal entries
* Golden demos

  * `verify_and_report.pya`
  * `lost_signature_propose_patch.pya`
  * `lost_signature_resolve_via_mcp_tool.pya`

---

## Week 6: Genetic programming harness v0.5

**Jan 31 → Feb 6, 2026**

### Ship

* Genome: Pyash sentence lists
* Mutations + crossover
* Fitness: quiz pass/fail plus penalties
* Signature crystallization workflow

  * promote repeated successful patches into deterministic signatures
  * retire mind fallback path for promoted behaviours
  * required tests and replay bundles for promoted behaviours

### Spec drops (freeze v0.5)

* Evolution artefacts spec v0.1 (genomes, logs, fitness, reproducibility)
* Crystallization policy spec v0.1 (promotion rules, required tests, docs updates)

### Hardening

* Fixed seeds, time and step limits
* Sandboxed IO, artefacts only
* Golden demos

  * `evolve_small_suite.pya`
  * `crystallize_signature.pya`

---

## Week 7: Packaging + human usability v0.8

**Feb 7 → Feb 13, 2026**

### Ship

* Package layout conventions, versioned stdlib
* Formatter + linter
* Dependency and compatibility checks
* Report bundle as a first-class output for Results-as-a-Service style runs
* Optional read-only serving of report bundles (local)
* Tool packaging (MCP servers)

  * package metadata for tool servers (launch command, version pinning, permissions)
  * bundles include tool server versions and tool list snapshot
  * compatibility checks include tool schema hash changes

### Spec drops (freeze v0.8)

* Package system spec v0.1
* Stdlib stability policy spec v0.1
* Evolution policy spec v0.1 (how crystallization changes public surfaces)
* Tool packaging spec v0.1 (declaring, pinning, launching MCP servers)

### Hardening

* Fresh clone → install → run → reproduce bundle via replay
* Multi-platform smoke (Linux first, others gated)
* Golden demos

  * `package_smoke.pya`
  * `bundle_replay_smoke.pya`
  * `package_with_tools_smoke.pya`

---

## Week 8: Intent compiler v0.85

**Feb 14 → Feb 20, 2026**

### Ship

* Prompt → candidate Pyash call set (top K)
* Candidate ranking via signature matching

  * stdlib + project modules
  * generated MCP façade signatures (tool-discovered)
* Optional local mind assistance for candidate generation
* Artefacts

  * candidates
  * scores
  * chosen call
  * matching trail + explanation fields
* Aspect-aware candidates

  * generate `fa/me/pfih` variants when supported by the matched signature
  * ranking prefers aspect consistent with interaction pattern (batch vs interactive)

### Spec drops (freeze v0.85)

* Intent compiler spec v0.1 (inputs, outputs, ranking rules, artefacts)
* Candidate format spec v0.1 (sentence shape, confidence fields, aspect field)

### Hardening

* Deterministic ranking given fixed inputs and seed
* Golden demos

  * `intent_compile_match.pya`
  * `intent_compile_fallback.pya`
  * `intent_compile_aspect_variants.pya`

---

Side note on your earlier “grammar words” point: `all su of <map>` / `all ob of <map>` / `all of <map>` are **map-enumeration surface forms**, and the spec even allows explicit `su name all` / `ob name all` variants when disambiguation is useful . So those belong in “map syntax” buckets more than “verb phrase” buckets.
