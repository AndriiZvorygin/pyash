# Changelog

### Feb 2, 2026: Command streaming clarified

* **Command streaming documented** (`vyah stream` + cancel semantics) in `07-io-and-scripts.md`.
* **Agent CWD sandbox**: `at filename` on mind calls sets `agent cwd`, enforcing write/download/delete/copy/touch under that directory.

### Jan 30, 2026: Verifier loop + deterministic reporting

* **Inline refinery still writes to the newspaper**, so verifier loops stay deterministic without flags.
* **Report extraction added**: `extract_report.mjs` CLI and `be reporter do` verb emit a stable report from the newspaper.
* **Reviewer loop example updated** to use inline report extraction, plus a standalone `reporter-inline.pya` example.
* **Report extraction quiz** locks output determinism and covers inline reporter usage.
* **Reports spec v0.1** finalized (fields, ordering, paths).
* **Mind event schema v0.1** documented (request/response fields + naming).
* **Error sieve verb** added with a minimal inline example and quiz.
* **Web search v0.1 spec + MVP**: `be search` with `fromstate wo web`, fixture-backed quiz, and example.
* **Vision-language `see` module** wires `module/see_vl.pya` to `command/see_vl_runner.mjs`, posts Ollama chat completions with data-URL images, and ships a fixture-backed quiz plus updated spec notes.

### Jan 24–31, 2026: Agent harness research path complete

* **Tool-calling mind adapter** in place with interpreter/JS/C parity (Jan 24).
* **Download verb + yt-dlp backend** for web/file/media retrieval (Jan 24).
* **Web search v0.1** wired to default searxng (Jan 30).
* **Read-to-markdown pipeline** for HTML/PDF (GFM default) with examples (Jan 31).

### Jan 29, 2026: Spec consolidation into numbered chapters

* **Merged specification files** into chaptered docs under `documentation/specifications/` to stay under model file limits.
* **Updated references** across docs to point at the new chapter files.
* **Normalized merged spec headers** to label legacy source sections without dangling filenames.

### Jan 29, 2026: Mind backend fixes + container dev ergonomics

* **Mind backend request handling hardened**: avoid hash inconsistency by piping payloads over stdin instead of reusing a fixed request file.
* **Env defaults no longer leak into ceremony bodies**, fixing mind backend resolution inside sandpits.
* **Debug toggles added**: `PYA_MIND_DEBUG` and `PYA_COMMAND_DEBUG` for request/response tracing.
* **Ollama runner fallback**: handles streamed NDJSON and falls back to curl when Node networking fails.
* **Container config improvements**: `configure/container.pya` auto-loads in run/REPL; `container/command/begin.sh` mounts host git config via `container/tools/update_compose.mjs`.
* **Re-entry cycle fixture** updated: inlined flow, Pyash-valid tokens, and reviewer uses explicit dialogue history.
* **Agent guidance** clarified: `vocab_suggest` applies to Pyash tokens, not quoted content.

### Jan 29, 2026: Reviewer loop reliability

* **Conditional resolution improved** so `ob name <text>` comparisons dereference stored values in `then` checks.
* **Ceremony conditionals no longer abort** execution on false; they now behave like single-line skips.
* **Reviewer circle module simplified** with explicit reviewer input assembly and text-only outputs.
* **Example run now returns text**, and a quiz covers `ob name` conditionals.

### Jan 29, 2026: Series + mind history updates

* **Added `be series def`** for ordered sentence lists and documented it near maps.
* **Mind prompts now come from `from discourse`**, while `accordingto` points to a session series.
* **Series-backed history** can be shared across minds and is appended on each call.
* **Docs + examples refreshed**, and new quizzes cover series storage and mind series history.

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
* Spec drop: `06-data-formats.md` status bumped to v0.2
* Hardening: JSON → Pyash → JSON round-trip snapshots (byte-stable)
* Hardening: cross-backend error parity audit for JSON map structural errors

---
### Dec 26, 2025: Modules/imports/namespacing v0.1 complete (pulled forward)

* Module file as a unit of execution/compilation
* `import` supports logical names and filesystem paths (relative + absolute)
* Memoized parsing; multi-alias initialization supported
* Qualified names via alias prefix (ceremonies + facts) with namespace map binding
* Cycle detection and alias-shadowing errors
* Spec drop: `11-modules.md` v0.1 (identity, resolution, cycles, visibility)


### Dec 27, 2025: CSV parity and roundtrip hardening complete

* CSV spec v0.1 implemented (parser + emitter) with deterministic write output.
* Fixture-backed roundtrip parity (interpreter/JS/C), including ERPNext Payment Entry template.
* Hardening: multi-file golden tests across interpreter/JS/C
* Backend parity gate enforced by compile tests


### Dec 28, 2025: YAML parity + CSV/Pyash roundtrip complete (maps done)

* YAML spec v0.1 implemented (`06-data-formats.md`) with deterministic official ordering.
* Parity goldens for interpreter/JS/C (YAML → Pyash, Pyash → YAML → Pyash).
* YAML inline compile precompute for JS/C (no runtime YAML dependency when inline).
* CSV → Pyash and Pyash → CSV → Pyash parity in interpreter/JS/C.
* `be map def` now locked as the configuration format baseline.
* Maps/JSON/YAML/CSV parity + determinism now considered done.


### Dec 29, 2025: Pre-week hygiene gates complete

* `11-modules.md` promoted to v0.1.
* Aspect spec moved to `03-vyah-and-aspect.md` and referenced from the spec index.
* Import rules locked in quizzes (entry allows top-level `do`; imported modules declarations-only).
* `03-vyah-and-aspect.md` shipped (official ordering; `vyah … sloh` success marker).
* Subordinate clauses (`la … ko`) shipped at parity (supports embedded mood when present).
* Runtime contracts shipped in code (duty / stream / chip + lifecycle acks; chip exhaustion errors).
* Error surfacing shipped in code: thrown errors are `be error do`, surfaced runtime results are `be error ya`.

### Dec 30, 2025: Refinery scaffolding + compiled run newspapers

* Refinery spec drafted (`10-pipelines-and-translation.md`, refinery/platform/activity vocabulary) and indexed.
* Interpreter captures refinery/platform definitions into a normalized registry (no execution at definition time).
* Refinery runner shipped (deterministic scheduling + fail-fast) for interpreter/JS/C.
* Run newspaper implemented as opt-in (`--newspaper`) and locked with parity tests across interpreter / JS / C.
* Compiled JS/C runs emit the same newspaper format (via shared runner) when flagged.
* `05-run-recording-and-artifacts.md` shipped so JS/C can emit comparable newspapers.
* `runjs`/`runc` use unique temp outputs to avoid collisions.
* Exchange filesystem rules locked: locator reuse, hash consistency, newline normalization, JS/C parity tests.

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

* Again-mode strict subset documented in `05-run-recording-and-artifacts.md`.
* Fresh Codex Primer written in `documentation/handoff.md`.
* Spec conformance pointers added, plus `90-implementation-map.md`.
* Roadmap/changelog cleanup and guidance aligned to new doc structure.

### Jan 4, 2026: Streaming mind + ISO dates + vendoring draft

* Mind streaming outputs now stream chunks to stdout (`PYA_STREAM_STDOUT=1`) and keep final results for newspapers.
* Added ISO 8601 `date` payloads to parsing and rendering; run start timestamps honor configured timezone with offsets.
* New timezone quiz and date/timezone golden example.

### Jan 23, 2026: Interpret verb + MCP tool capability snapshotting

* `interpret` verb shipped with sandboxed QuickJS execution and compile parity fixes for C genitive plus.
* MCP tool capability snapshots recorded in deterministic form; stray MCP swap removed.

### Jan 24, 2026: Mind tool parity hardening + download MVP

* Mind tool calling parity tightened: tool_call_id propagation, interpret tool output handling, fallback to tool result, and prompt/example updates.
* Compiled JS/C tool handling aligned, with C tool capture helpers and warning silencing in generated C.
* Download spec and verb added with URL-scheme normalization, curl-backed http(s) web/file support, and initial quizzes.
* yt-dlp backend added for video/audio downloads with a runnable example.
* Docs refreshed to reflect mind interpret tool parity and new download example.

### Jan 25, 2026: Download windows + month durations

* Added month duration support across parser/signatures, date math, and JS/C compile helpers.
* `download` now supports `ob wo all` plus `during months <n>` for yt-dlp windowed pulls.
* Download output defaults to CWD when `to filename` is omitted, with extra args sourced from defaults.

### Jan 26, 2026: Download example + yt-dlp logs

* Added `examples/pyash/download-youtube-month.pya` for last-month audio pulls.
* yt-dlp stdout/stderr now stream through the runner for live progress logs.
* Default config now includes yt-dlp cookies args (`download extra`).

### Jan 6, 2026: Mind invocation form update + refinery alignment

* Mind invocation standardized on `be write ... for name <mind> to name <output>` with legacy `totext` compatibility.
* `be mind do` deprecated (reserved for future use) and removed from interpreter signature support.
* Compiler/JS/C mind paths updated to resolve `for` targets and store responses under the requested output name.
* Mind examples, refinery demos, and quizzes updated to use the new invocation form.

### Jan 7, 2026: Compile refactor + example references

* Split `compile` helpers into focused modules (constants/config/tooling/util/mind/runtime) to reduce churn in `compile.mjs`.
* Centralized early compile branching with base `be` handlers for `compile`, `import`, `read`, and `ret`.
* Documented canonical example locations and linked streaming/mind/artifact examples from specs.
* Split C helper exports into focused modules and re-exported them to keep compile imports stable.
* `be speak` verb removed (use `say` modules instead).
* Drafted caterer vendoring spec for `hear`/`say` with pyash map examples.
* Documented caterer build layout and added whisper.cpp linux-x64 build script.
* Piper `say` backend now produces WAV artifacts, records metadata, and can play audio to speakers by default.
* Default `say` mapping now targets `piper say`, with a new piper golden example and fixture quiz.
* Fixture `hear` backend added with a refinery demo (mind → say → hear) and a matching quiz.
* Whisper.cpp-backed `hear` flow added for real audio transcripts, plus a full refinery example.

### Jan 7, 2026: Hear prompt + keyboard streaming

* `hear` accepts `ob text` as an initial prompt for whisper-stream and whisper-cli (with a patch for whisper-stream).
* Streaming STT de-duplicates incremental repeats (including ellipsis-style prefixes).
* `write` supports `to name keyboard` with `xdotool` and can consume `hear` streams in real time.
* New example: `examples/pyash/hear-stream-keyboard.pya`, plus quizzes for prompt and keyboard streaming.
* Week 2 roadmap items completed: streaming `hear`, drop-a-binary streaming STT, and deterministic test hooks.

### Jan 8, 2026: Speech spec freeze + talk loop goldens

* Speech specs frozen as v0.1 (`09-speech-and-hear.md`, `09-speech-and-hear.md`) and index labels updated.
* Added talk loop golden examples (`examples/pyash/talk-loop-smoke.pya`, `examples/pyash/talk-loop-cancel.pya`).

### Jan 9, 2026: Streaming say buffering + fixtures

* Streaming `say` now buffers to punctuation/word boundaries to avoid partial-word speech.
* Added streaming `say` fixtures for piper/espeak, plus tests for buffered output.
* New streaming `say` examples (`examples/pyash/say-stream-espeak.pya`, `examples/pyash/say-stream-piper.pya`).
* Added `PYA_SAY_STREAM_DELAY_MS` and `PYA_ESPEAK_BIN` to env guidance for stream tuning.
* Stream stdout can now be disabled via `su name stream stdout ob bool lie be default ya` (configurable in `configure/default.pya` and examples).

### Jan 10, 2026: Literals, modules, and keyboard streaming

* Added `wo` literal words for strict dispatch and documented their signature behavior.
* Added `be text` and `be filename` casts with quizzes and default verb registration.
* Keyboard streaming now uses `to wo keyboard` with updated signatures, tests, and module helper.
* Added ffmpeg microphone module + examples, and improved hear input path resolution from memory.
* Documented external tool modules and added the runner contract addendum in the module spec.

### Jan 10, 2026: Env defaults promoted to memory

* Environment variables are now imported into memory as `be default` facts.
* `configure/default.pya` (or any in-program sentence) overrides env defaults.
* Runtime lookups now read config from memory first (stream stdout, mind/command fixtures, say/hear backends).

### Jan 17, 2026: Signature dispatch + talk loops + timebox seconds

* Dispatch is explicitly signature-based; ceremony definitions override handlers per signature, with conflict warnings including source context.
* `hear` timebox durations now use seconds everywhere (core, runner, specs, examples, quizzes).
* Talk loop examples refreshed: simple timebox loop, new stream loop with “bye” exit, and transcript routed to mind via `ob name`.
* `mind` now resolves `ob name <fact>` to remembered payloads when building prompts.
* Whisper stream dedup refined to suppress repeated lines across outputs.
* Mind/piper runners now write request/input files under `artifacts/` to keep `--newspaper` runs valid.
* Added hear eval timebox examples (inline + module) and ignored `quiz/sandpit` scratch artifacts.

### Jan 20, 2026: MCP tooling + discharge flows

* MCP stdio integration shipped with snapshots, tool hashing, schema validation, allow/deny, replay, and timeouts.
* MCP quickstarts and examples (filesystem + time) added with deterministic quizzes.
* `discharge` verb added for MCP shutdown and run warning when servers linger.
* Mind tooling now emits full json map tool results to the model.
* Ollama discharge unloads models (`keep_alive: 0`) and respects configured `ollama host`.
* Ollama mind module now exposes `begin`/`restart` ceremonies for warmup and cycling.
* MCP servers now support restart policies via `be mcp` configs and `with name` policy maps.
* MCP Streamable HTTP transport (2025-06-18) is supported, with legacy HTTP+SSE fallback.

### Jan 21, 2026: MCP HTTP fixes

* Streamable HTTP SSE parsing fixes for MCP responses.
* Changelog order cleanup for January entries.

### Jan 21, 2026: OS verbs and metadata utilities

* `glance` now returns path-scoped map headers with deterministic hash naming.
* Added `license` verb (ownership + permissions) with examples.
* Added `ecology` verb to read/set environment variables, plus examples.
* Permissions wording standardized to use `command` instead of `interpret`.

### Jan 22, 2026: REPL output + filesystem utilities

* REPL now prints results and memory in Pyash format (no JSON).
* `read` accepts `ob filename` in addition to `from filename`.
* `list` promoted to a builtin verb for REPL use.
* Added boolean composition verbs (`and`, `or`, `not`) with examples.
* `copy` now supports `as wo recursive` with a new quiz.

### Jan 22, 2026: Date math + compile parity

* Added date/time duration units (`second`/`minute`/`hour`/`day`/`week`) and date math for `plus`/`subtract`.
* Added date math compile parity in JS/C with a shared C helper and new quizzes.
* Added a date math example (`examples/pyash/date-plus-30.pya`) plus write support for date outputs.
* Added `07-io-and-scripts.md` spec and indexed it in the spec list.

### Jan 23, 2026: Interpret verb + C genitive fix

* Added `interpret` verb (QuickJS via Wasmtime sandbox) with timeout/output limits and a quiz.
* Added `examples/pyash/interpret-javascript.pya` and vendored WASM runtimes under `caterer/`.
* Fixed C compile for `plus` targeting genitive paths (restoring doors-map C parity).

### Jan 24, 2026: Mind tool bridge hardening

* MCP tool snapshots now record capabilities and emit `json map def` capability sentences.
* `interpret` can resolve `ob name text` scripts for mind/tool usage.
* Mind tool calls now propagate `tool_call_id` and pass raw interpret stdout back to the model.
* Added a mind tool example for JavaScript execution (`examples/pyash/mind-interpret-tool.pya`) with a complex prime task.

### Jan 29, 2026: Mind session map

* Mind history now exposes a read-only `mind session map` with per-dialogue series snapshots.
* Added a shared session store for mind logs across backends.
* Reviewer circle inline example now uses session series instead of string concatenation.

### Jan 30, 2026: Inline refinery execution

* Added `be refinery do` inline execution with task binding from `ob`.
* Reviewer circle example now runs the refinery inline and prints the result without CLI flags.
* Refinery spec updated to describe inline invocation and newspaper/artefact source-of-truth invariants.

### Feb 3, 2026: Tool sandpit agent cwd enforcement

* Tool sandpit now scopes destructive tool writes to the agent CWD when the tool map is `as wo sandpit`.
* Added a tool sandpit example (`examples/pyash/mind-tool-sandpit-agent-cwd.pya`).
