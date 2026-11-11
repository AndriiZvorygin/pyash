# Is This Repository Too Monolithic?

**Status:** proposal awaiting review. It measures the current module layout and
test organization, compares them with how comparable language and operating
system projects are organized, and proposes six changes with acceptance
criteria. It changes no behavior and schedules no work.

## Purpose

The question that started this document: *is this project too monolithic and
does it need to be modularized? The test suites are awfully long and cover a
lot of stuff. How are comparable programming language and operating system
projects organized?*

This document answers that question with measurements rather than impressions,
because the two can disagree sharply. The inventory is pinned to commit
`4e31f9f8d`. Commands and scripts are included for the measurements; the
comparisons and architectural conclusions are judgments, not measurements.

The short answer, stated up front so a reviewer can stop early if it is
wrong:

- **This is a monorepo with unevenly enforced boundaries, not an undivided
  codebase.** The interpreter, verb families, library areas, specifications,
  and houses already have recognizable structure. Ownership and dependency
  rules are less consistently explicit or enforced.
- **The code-balance ratio is a selected-bucket metric, not a whole-repository
  measure.** Within the paths counted by `command/measure_code_balance.mjs`,
  `.mjs`-only core-to-applications is 1:26.50. Several `program/` paths are
  outside those buckets, so the ratio should not be read as the interpreter's
  share of all repository code.
- **The quiz tree is mostly flat.** At the measured commit, 744 of 781 test
  files were directly under `quiz/`. Resource tiers and a full-suite runner
  already exist; what is missing is a consistent source-area map and a
  standard area-targeted workflow.
- **`.pya` is a mixed format.** The selected application buckets contain
  64,504 lines of `.pya`, including a generated WordNet map, executable
  Pyash, and other map/configuration files. The extension alone cannot tell
  code from data, so a code-only ratio requires a file-level classification.

---

## Part 1 — The measured surface

### 1.1 Code shape

An extension-specific inventory of `.mjs` files in the tool's selected
buckets gives:

| Bucket | Lines | Files | What it is |
|---|---|---|---|
| interpreter core | 6,396 | 25 | `program/bridge`, `program/understand`, `program/remember` |
| verb layer | 29,694 | 174 | `program/verbs` |
| applications | 169,473 | 607 | `program/library`, `program/agent`, `program/runtime`, `command`, `module` |

Selected-bucket ratio: **core : applications = 1 : 26.50**, core share
**3.1% of those buckets**.

These counts use logical lines (a final unterminated line counts). The
extension-split inventory is reproduced in the appendix. Shell commands using
`wc -l` count newline characters and can differ slightly; do not compare those
totals as if they used the same line-count convention.

This is not a complete inventory of `program/`, `command/`, and `module/`.
The script defines its buckets explicitly; for example, `program/motor/`,
`program/configure/`, `program/verify/`, and root-level `program/` modules
are not counted. Use this ratio to compare the defined buckets over time,
not to estimate the interpreter's share of all repository code.

The repository's own tool reports the combined `.mjs` and `.pya` figure for
these selected buckets:

```
node command/measure_code_balance.mjs
```

```
  interpreter core     6396 lines   25 files
  verb layer           29694 lines  174 files
  applications        233977 lines  720 files

  core:applications = 1:36.58
  core share of measured = 2.4%
```

The tool counts `.pya` alongside `.mjs`. Its 64,504 `.pya` lines in the
selected application buckets are not all classified by the tool as data:

| Bucket | `.mjs` lines | `.mjs` files | `.pya` lines | `.pya` files |
|---|---|---|---|---|
| core | 6,396 | 25 | 0 | 0 |
| verbs | 29,694 | 174 | 0 | 0 |
| applications | 169,473 | 607 | 64,504 | 113 |

**27.6% of the selected applications bucket is `.pya` by extension.** That is
not the same as 27.6% data. The largest file is the generated WordNet bridge
map:

```
find program command module -type f \( -name '*.mjs' -o -name '*.pya' \) -exec wc -l {} + | sort -rn | head
```

```
  41745 program/library/translation/english_wordnet_bridges.pya
   6675 program/library/reporter_shared/agenda-stage3-summary-renderer.mjs
   3969 program/library/reporter_shared/agenda-llm-segmentation.mjs
   3229 program/library/translation/english_wordnet_compound_decisions.pya
   2700 program/library/translation/english_sentence.mjs
   2440 program/library/translation/compound_coverage_wordnet_verified.pya
   2178 program/agent/channels/index.mjs
   1917 program/library/reporter_shared/whole-meeting-synthesis.mjs
```

`english_wordnet_bridges.pya` is a generated sense-to-lemma map, roughly
10,000 entries of three or four map sentences each. It is runtime-loaded by
the translation library. It is 41,745 lines and 6.5 times the measured
interpreter core. This one file is data; other `.pya` files include executable
Pyash and configuration, so classify them individually rather than infer
their role from their extension.

### 1.2 The layers are already there

The applications layer is not a pile. `program/library` alone is 277 `.mjs`
modules and 71,674 lines, and four named sub-areas carry 94.5% of it:

```
for d in program/library/*/; do n=$(find "$d" -name '*.mjs' | wc -l); l=$(find "$d" -name '*.mjs' -exec cat {} + | wc -l); echo "$l $n $d"; done | sort -rn
```

```
  25267  62 program/library/translation/
  22165  39 program/library/reporter_shared/
  15735 132 program/library/compile/
   3346  13 program/library/vliw/
   1205   6 program/library/print_audit/
    201   2 program/library/grammar/
```

`program/verbs` holds 174 modules in 11 family directories plus 81 top-level
verb modules. Fifteen verb modules exceed 400 lines; the largest is
`program/verbs/mind/mind.mjs` at 872.

The specification set is already modularized, and says so: `documentation/specifications/00-index.md`
declares "this folder is intentionally compact: <=24 files, each <=16KB" and
splits 23 specifications into a **core order** (1–6) and a **feature order**
(7–23). Two numbering collisions exist and are harmless but confusing:
`11-modules.md` and `11-translation.md` both carry 11, and
`26-criterion.md` and `26-headquarters-fixture-mail.md` both carry 26.

### 1.3 The dependency graph

Three modules carry almost all of the fan-in. These are the real seams:

| Module | Fan-in |
|---|---|
| `program/remember/index.mjs` | 574 |
| `program/understand/index.mjs` | 511 |
| `program/bridge/index.mjs` | 448 |
| `program/error.mjs` | 132 |
| `program/library/sentenceSplitter.mjs` | 81 |
| `program/beautiful.mjs` | 81 |
| `program/bridge/exchange.mjs` | 71 |

Layer direction mostly holds. `program/verbs` reaches outward (107 edges to
`program/remember`, 91 to `program/error.mjs`, 81 to `program/library`, 63 to
`program/bridge`), and the deeper layers mostly reach down rather than up.

Seven cross-area edge categories have candidate dependencies in the direction
the proposed layering would forbid. Their counts sum to 45 direct import
edges; these are candidates for review, not yet confirmed architectural
violations:

| Candidate edge family | Direct imports | Why it may matter |
|---|---|---|
| `program/library` → `program/runtime` | 15 | a library module depends on the runtime that should sit above it |
| `program/library` → `program/verbs` | 7 | the library reaches up into the dispatch surface |
| `program/agent` → `program/verbs` | 7 | the agent runtime depends on verbs |
| `program/motor` → `program/verbs` | 6 | motor reaches up into verbs |
| `program/runtime` → `program/agent` | 6 | the runtime depends on the agent layer |
| `program/bridge` → `program/verbs` | 2 | the dispatch core reaches up into the dispatch surface |
| `program/configure` → `program/verbs` | 2 | configuration reaches up into verbs |

The graph script found two nontrivial cyclic strongly connected components
(SCCs) in `program/` (its current detector does not report singleton
self-imports):

```
{ program/motor/mcp/snapshot.mjs, program/motor/mcp/config.mjs,
  program/motor/mcp.mjs, program/bridge/modules.mjs, program/bridge/refinery.mjs,
  program/bridge/signature/derive.mjs, program/bridge/signature.mjs,
  program/remember/index.mjs }

{ program/library/vliw/database.mjs, program/library/vliw/index.mjs }
```

These are SCC memberships, not ordered paths: the measurement script reports
members in Tarjan traversal order, which does not prove that each adjacent pair
in the display is an import edge. Before fixing a cycle, report one concrete
closed path of import edges within each SCC. A component can contain more than
one distinct cycle.

The VLIW component may matter more than its size suggests:
`program/library/vliw/` is the intermediate representation that the Rust
interpreter is meant to consume. Confirm its concrete import path and impact
before prioritizing a repair.

### 1.4 The test suite's shape

```
git ls-files quiz | grep '\.test\.mjs$' | wc -l          # 781 files
git ls-files quiz | grep '\.test\.mjs$' | xargs cat | wc -l   # 96,221 newline-terminated lines
git ls-files quiz | grep '\.test\.mjs$' | xargs grep -ho 'test(' | wc -l   # 3,401 textual occurrences
```

The `test(` count is a rough source-text proxy, not an authoritative test
case count: aliases, generated tests, and matching comments or strings can
make it differ from the runner's TAP summary. Use the TAP summary when
comparing executed test totals.

Nesting depth:

```
git ls-files quiz | grep '\.test\.mjs$' | awk -F/ '{print NF-1}' | sort | uniq -c
```

```
    744 1      # flat in quiz/
     26 2      # quiz/runtime/
     11 3      # quiz/runtime/gpu/
```

**744 of 781 quiz files — 95% — sit directly under `quiz/`.** The other 37
are under `quiz/runtime/` and `quiz/runtime/gpu/`. This is a discoverability
and ownership mismatch with the source areas; it does not by itself prove that
the runner is serial or that file placement is the cause of suite duration.

Size distribution:

| Lines | Files |
|---|---|
| under 100 | 563 |
| 100–200 | 113 |
| 200–400 | 63 |
| 400–800 | 30 |
| 800+ | 12 |

The suite is a long tail of 563 fast files plus a small number of large
ones. The large ones are dense rather than sloppy, except two:

| File | Lines | `test(` matches | Lines per match |
|---|---|---|---|
| `quiz/agenda_stage3_numeric_repair.test.mjs` | 5,274 | 175 | 30 |
| `quiz/channel_runtime.test.mjs` | 2,450 | 39 | 63 |
| `quiz/pyash_configure_cli.test.mjs` | 1,966 | 5 | **393** |
| `quiz/agenda_llm_segmentation_shared_boundary.test.mjs` | 1,716 | 68 | 25 |
| `quiz/qwen_say.test.mjs` | 1,154 | 44 | 26 |

`pyash_configure_cli.test.mjs` is the outlier: 393 lines per test case,
because the file carries its own in-process mock Matrix server (an HTTP
server with a login/register/join endpoint) inline. That fixture belongs in a
helper.

`channel_runtime.test.mjs` is a different shape of problem: 39 genuinely
distinct behaviours, one per test, at 63 lines each. The file is not padded —
it is holding 39 separate contracts that happen to live in one place.

### 1.5 Where the test time goes

Running the suite with the spec reporter gives per-test durations:

```
node --test --test-reporter=spec $(git ls-files quiz | grep '\.test\.mjs$')
```

The distribution is not uniform. Summing durations by area:

| Area | Files | Share of summed test time |
|---|---|---|
| `translation_*` | 55 | 28.9% |
| `vocab_suggest_*` | 6 | 4.8% |
| translation and vocabulary together | 61 | **33.7%** |
| `compile_*` | 96 | 2.1% |
| `work_*` | 18 | 1.3% |
| `headquarters_*` | 6 | 1.4% |

The top 10 quiz files account for **43.2%** of the summed test time and the
top 25 for **64.2%**. The three slowest quiz files are
`quiz/translation_english_sentence.test.mjs` (63.4s),
`quiz/module_manuscript_scored_refinery.test.mjs` (62.5s), and
`quiz/translation_pipeline.test.mjs` (60.2s). The slowest single test is
`module manuscript scored fixture refinery run avoids unknown-verb wiring
failures` at 59.9 seconds.

These are shares of **summed per-test durations**, not shares of wall-clock
time. They identify expensive tests, but do not predict how quickly CI shards
would finish: process startup, parallelism, resource contention, and the
critical path also matter. Translation and vocabulary account for about a
third of the measured summed time and are good candidates for a shard
experiment.

### 1.6 How the suite is coupled to the code

| Measure | Count |
|---|---|
| quizzes importing only barrel or top-level `program/` modules | 483 |
| quizzes importing a deep path such as `program/verbs/say.mjs` | 298 |
| quizzes importing `program/bridge` directly | 445 |
| quizzes importing `program/understand` directly | 457 |
| quizzes importing `program/remember` directly | 429 |
| quizzes importing `program/library` directly | 124 |
| quizzes importing `program/verbs` directly | 70 |
| quizzes importing a shared helper from `quiz/helpers/` | 8 |
| quizzes that reset memory explicitly between cases | 428 |
| `program/` modules reached transitively by some quiz | 590 of 617 (**95.6%**) |

Three things follow.

**The coverage is good.** 95.6% of the program tree is reachable from the
suite, transitively. Only 27 modules are unreached, 17 of them in
`program/library`. This is not a suite with holes in it.

**The suite is white-box against interpreter internals.** More than half the
quizzes reach straight past the public surface into `program/bridge`,
`program/understand`, and `program/remember`. That is a deliberate choice
and mostly a good one — it tests the machinery rather than the surface. The
count of 298 means those quizzes import at least one deep path; it does not
mean moving any single module affects all 298. Per-module importer counts are
the better estimate of a particular move's blast radius.

Shared test-helper usage is low: `quiz/helpers/` is 161 lines across two
files, and only 8 of 781 quizzes import it. The 428 count is a search for
memory-reset calls, not proof of 428 copies of identical boilerplate. Inspect
the repeated patterns before deciding which helper contracts are genuinely
common.

### 1.7 What already works

Three mechanisms in this repository already answer the problem this document
is about, and any proposal should build on them rather than replace them.

**Resource tiering.** `configure/test_tiers.pya` and `command/quiz_tiers.mjs`
classify a quiz by *what it needs from the machine*, not by where it sits:

```
node -e 'import("./command/quiz_tiers.mjs").then(async (m) => {
  const fs = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const files = execFileSync("git", ["ls-files", "quiz"], { encoding: "utf8" }).trim().split("\n").filter((f) => f.endsWith(".test.mjs"));
  const t = { t1: 0, t2: 0, t3: 0 };
  for (const f of files) t[m.classifyQuizFile(fs.readFileSync(f, "utf8"), { fileName: f.split("/").pop() }).tier] += 1;
  console.log(t);
});'
```

```
{ t1: 705, t2: 76, t3: 0 }
```

`t1` needs only the repository. `t2` needs a provisioned resource — the
WordNet checkout, the whisper sample, an ffmpeg with the drawtext filter, the
`pyachso2n` sibling checkout, a python speaker worker. `t3` belongs to a house
checkout that this repository does not track. CI provisions the resources; a
local machine that lacks one reports the gap instead of failing the run. This
is the same design as CPython's `libregrtest` resource gating.

**A smoke lane.** `npm run test:ci:smoke` runs a small named subset, which is
how the CI workflow gets a fast signal.

**Houses.** `world/house/` holds 29 house directories, each with its own
`program/`, `identity/`, `memory/`, and `conduct/` subtrees. Five are already
separate git repositories. Houses show that independently organized units
can coexist in the larger tree; they are one useful precedent, not a complete
ownership or dependency policy for all of `program/`.

### 1.8 The current state of the suite

CI run `41551328723` (commit `e94958459`, "preserve satellite sense
identities"):

```
# tests 3280
# pass 3249
# fail 1
# skipped 25
# duration_ms 270331.939667
```

The job took 4m59s wall clock. The single recorded failure is
`existential phrase-list decisions survive English-to-Pyac and Pyash projection`
in `quiz/translation_pipeline.test.mjs`; it reproduced in isolation at that
time. Treat it as a known baseline failure for comparisons, without inferring
ownership or cause from this modularization inventory.

A local run without the tier gate produced six failures on one run and four on
another. The stable ones are missing local resources — this machine's ffmpeg
has no `drawtext` filter and the GPU housekeeper is not running — which is
exactly what the tier policy exists to skip. The fourth stable failure is
the same translation phrase-list assertion. Two more, in
`quiz/saddle_tools_signatures.test.mjs` and `quiz/sandpit.test.mjs`, appeared
on one run only: both pass in isolation and failed during a full-suite run.
That is evidence of an order- or concurrency-sensitive interaction, not proof
that the test count or runner pool caused it. Identify shared state, ports,
fixtures, and resource contention before increasing parallelism.

---

## Part 2 — How comparable projects are organized

The projects below use overlapping but different mechanisms. They are
examples to compare, not a claim that every project uses the same layout or
enforcement model. Sources are included so a reviewer can check each claim.

### 2.1 Rust — crates, and two kinds of test

`rust-lang/rust` is a single cargo workspace with three top-level
directories: `compiler/` (about fifty `rustc_*` crates), `library/`
(`core`, `alloc`, `std`, `proc_macro`, `test`), and `tests/`, plus `src/` for
rustdoc, clippy, cargo and the build system.

The dependency direction is explicit: `rustc` (the binary) calls
`rustc_driver`, which depends on `rustc_interface`, which depends on most
other compiler crates; most of those depend on `rustc_middle`, which holds
the central data structures; and `rustc_middle` depends on the early-stage
crates such as `rustc_span`, `rustc_data_structures`, and `rustc_errors`.

The test suite is organized by *suite*, each suite its own subdirectory of
`tests/`: `ui`, `ui-fulldeps`, `debuginfo`, `codegen-*`, `codegen-units`,
`coverage`, `pretty`, `run-make`, `run-make-cargo`, `crashes`. Each test in
each suite lives in its own directory.

Two details matter for this repository:

1. **Unit tests are kept out of the source file.** The Rust project's own
   guidance is that "all standard library and compiler unit tests are placed
   in separate `tests` file (which is enforced in tidy). This ensures that
   when the test file is changed, the crate does not need to be recompiled."
   So there are two distinct kinds: unit tests, which are glass-box and live
   next to the code, and integration tests, which are black-box, live in
   `tests/`, and may only use the crate's public API.
2. **One area can be tested alone.** `./x test library/std` runs the standard
   library only. `./x test compiler/rustc_data_structures` runs one crate.

Sources: [rustc-dev-guide compiler source](https://rustc-dev-guide.rust-lang.org/compiler-src.html),
[rustc-dev-guide tests intro](https://github.com/rust-lang/rustc-dev-guide/blob/master/src/tests/intro.md),
[rustc-dev-guide compiletest](https://rustc-dev-guide.rust-lang.org/tests/compiletest.html),
[The Rust book, test organization](https://doc.rust-lang.org/book/ch11-03-test-organization.html).

### 2.2 Linux — subsystems, maintainership, and multiple test models

The kernel tree is a set of subsystems — `drivers/`, `fs/`, `net/`, `mm/`,
`arch/` — with maintainership recorded in `MAINTAINERS`. KUnit tests can sit
near the code they test, while broader userspace self-tests have their own
testing structure. Linux is an example of in-tree subsystem ownership, not a
universal rule that every test mirrors its source path.

Test placement is prescribed: "The `tests` directory should be placed at the
same level as the code under test. For example, tests for `lib/string.c` live
in `lib/tests/string_kunit.c`."

KUnit adds a naming rule that is stricter than "put it somewhere sensible":

> To make tests easy to find, they are grouped into suites and subsystems. A
> test suite is a group of tests which test a related area of the kernel. A
> subsystem is a set of test suites which test different parts of a kernel
> subsystem or a driver. Every test suite must belong to a subsystem. A test
> subsystem should match a single kernel module. If the code being tested
> cannot be compiled as a module, in many cases the subsystem should
> correspond to a directory in the source tree or an entry in the `MAINTAINERS`
> file.

The kernel also separates two frameworks by *what they can reach*: KUnit runs
in kernel space and is white-box, which makes it fast ("KUnit can run around
100 tests in less than 10 seconds"), while kselftest runs in userspace and can
only test what a syscall or ABI exposes.

Sources: [KUnit test style and nomenclature](https://www.kernel.org/doc/html/next//dev-tools/kunit/style.html),
[KUnit](https://docs.kernel.org//dev-tools/kunit/index.html),
[Kernel testing guide](https://docs.kernel.org/dev-tools/testing-overview.html).

### 2.3 CPython — a mechanical naming rule and a nested test tree

CPython's layout rule is exact: for a Python module, the source is
`Lib/<module>.py`, the C accelerator is `Modules/_<module>.c`, the test is
`Lib/test/test_<module>.py`, and the documentation is
`Doc/library/<module>.rst`. Extension modules follow the same pattern with
`Modules/<module>module.c`.

`Lib/test` is **not** flat. It contains 67 nested test packages and over 700
test modules — around 1,154 test files in total.

The runner, `libregrtest`, is the closest analogue to this repository's
tier runner: it discovers tests by the `test_` prefix, runs them in parallel
worker processes (`./python -m test -j0`), provides isolation support through
`test.support`, and gates tests on the resources they need.

Sources: [CPython source layout](https://github.com/python/cpython/blob/main/InternalDocs/structure.md),
[Running and writing tests](https://devguide.python.org/testing/run-write-tests/),
[The `test` package](https://docs.python.org/3/library/test.html),
[CPython by the numbers](https://factory.com/open-source-wikis/cpython?page=by-the-numbers.md).

### 2.4 Fuchsia — the closest model for "one repository that is an OS"

Fuchsia organizes its code into a recursive tree of **areas**:

> Most code in this repository is organized into a recursive tree of *areas*.
> Areas have a regular internal and dependency structure. [...] Each area is
> required to have an OWNERS file as well as documentation and tests. Areas
> can also include binaries, libraries, drivers, and other source code. In
> addition, areas can have subareas, which repeat the pattern.

Test placement inside an area is explicit:

> Unit tests that cover a single binary or library are better placed alongside
> the code they test. [...] Integration tests that span multiple source code
> directories within the area [...] One exception is the `//src/tests`
> directory where tests from different areas that cover multiple aspects of
> the system (not just a particular area) are expected to live.

And the boundary is **enforced by the build system**, not merely documented:

> In addition to depending on itself, an area can depend only on the top-level
> `build`, `sdk`, and `third_party` directories, as well as the `lib`
> directory from anywhere in the tree.

Source: [Fuchsia source code layout](https://fuchsia.dev/fuchsia-src/development/source_code/layout).

### 2.5 seL4 — a small verified core, with the rest named as unverified

seL4's repository is `include/`, `src/`, `libsel4/` (the ABI bindings),
`tools/`, and `manual/`. Its formal proof covers the kernel's object
management code; everything else — drivers, filesystems, the rest of the
system — is explicitly outside the verified set.

The lesson is not that seL4 is small. It is that the unverified surface is
*named*, so a reader always knows which part carries the guarantee.

Source: [seL4 repository](https://github.com/seL4/seL4),
[seL4 FAQ](https://sel4.systems/About/FAQ.html).

### 2.6 The mechanisms, summarized

| Dimension | Rust | Linux | CPython | Fuchsia | Pyash today |
|---|---|---|---|---|---|
| Area structure | Cargo crates/workspaces | subsystem directories | `Lib/` packages | recursive areas | interpreter packages, verb families, libraries, houses |
| Ownership | crate/review conventions | `MAINTAINERS` | package maintainers | required `OWNERS` | partial; houses are the clearest ownership units |
| Dependency boundaries | crate/API graph | Kconfig/Kbuild and subsystem conventions | mostly package conventions | `BUILD.gn` | `check_imports.mjs` verifies resolution, not direction |
| Test organization | unit and suite-oriented tests | KUnit plus userspace self-tests | nested `Lib/test` tree | area tests plus cross-area suites | 95% of quiz files are at the quiz root |
| Targeted execution | `./x test <crate>` | KUnit/subsystem targets | `python -m test` selectors | per-area build targets | resource-tier runner exists; no standard source-area selector |

These projects are not interchangeable templates. Fuchsia is the closest
analogue for a single repository spanning OS-like areas because it combines
area ownership with build-enforced dependencies. Linux demonstrates that a
large monorepo can use subsystem maintainers and multiple testing models.
Rust demonstrates stronger package boundaries and targeted builds; CPython
demonstrates discoverable package-mapped tests and a resource-aware runner.
seL4 is a different comparison: its useful lesson is to name the trusted and
verified surface, not to copy its repository scale or layout.

---

## Part 3 — The assessment

This section is judgment, built on the measurements above. It is the part a
reviewer should attack.

### 3.1 What is already modularized

**The interpreter.** 6,396 logical lines, 25 modules, three hubs with obvious names
(`remember`, `understand`, `bridge`), and a clean outward direction. It is
the healthiest part of the repository. It does not need modularizing.

**The verb layer.** 174 modules in 11 family directories; the largest is 872
lines and only 15 exceed 400. It was split once already this season
(`itinerary_media`, `loop_control`, `command`, `qwen_say`).

**The library layer.** Four named sub-areas carry 94.5% of it.

**The specification set.** 23 files, a stated size rule, a core order and a
feature order.

**The test suite's coverage.** 95.6% transitive reach, resource-tiered so
that a missing local dependency is reported rather than failing. The source
inventory finds 3,401 `test(` text matches; use runner output for executed
test-case totals.

**The CI shape.** A `test` job, a `rust` job, an examples audit, a smoke
lane, and a tier policy that reports environment gaps honestly.

### 3.2 Where boundaries are less complete

**The repository as an operating-system-style monorepo.** One tree holds
more than 600 `.mjs` application modules in the measured buckets, plus Pyash
programs and data, across several domains: language tooling,
Matrix chat and channels, translation and WordNet, video and subtitle
pipelines, a web server and browser automation, print audit, an Android
bridge, a C backend, and GPU houses. These domains are not unmarked: they have
directories, some have family or library sub-areas, and `world/house/`
contains independently organized houses. The gap is that ownership,
dependency direction, and area-level test workflows are not consistently
explicit or enforced.

That is an improvement opportunity, not proof that a single repository is
inherently too monolithic. For an operating-system-like project, one coherent
tree can be an advantage: cross-area changes and the specification stay
together. The relevant comparison is not “one repo versus many,” but how
clearly each repo makes area ownership and allowed dependencies visible and
enforceable.

**The quiz tree.** 744 of 781 files are directly under `quiz/`, so area
discovery is weak. However, resource tiers and a full-suite runner already
exist. The evidence supports improving area selection and ownership; it does
not establish that flat layout caused the observed wall time or flakes.

**Dependency policy.** `check_imports.mjs` verifies that relative specifiers
resolve — 4,332 across 1,610 modules in the measured inventory — but does
not enforce a reviewed area-dependency policy. The 45 direct imports in seven
candidate edge families and two cyclic SCCs are a starting inventory, not a
pre-approved list of architectural mistakes.

### 3.3 Candidate GI-OS area model

The GIOS analysis in
[`pyash-as-gios-foundation.md`](pyash-as-gios-foundation.md) asks which
capabilities Pyash can provide and what evidence supports them. This section
adds a complementary repository view: which platform areas provide those
capabilities, how their contracts meet, and where their implementations and
tests currently live.

The following is a **proposed logical map**. It distinguishes implemented
boundaries from proposed ones and records shared source seams explicitly.

| Area | Responsibility | Pyash / Pyac contract surface | Current code anchors | Governing docs and representative quizzes |
|---|---|---|---|---|
| Language and execution | Parse sentences, derive signatures, dispatch, preserve memory semantics, and lower supported programs. | Canonical Pyash sentences and paragraphs; `.pyac` represents supported compiled execution while preserving Pyash semantics. | `program/understand/`, `program/bridge/`, `program/remember/`, `program/library/compile/`, `rust/pyac/` | Specs `01`-`06`, `11-modules`, `27-pyash-vliw-isa`; `quiz/core.test.mjs`, `quiz/compile_*`, `quiz/vliw_*` |
| Capabilities and domain services | Expose composable actions such as command execution, exchange, translation, speech, drawing, and media workflows. | Pyash verb signatures, `.pya` modules, maps, and series; Pyac lowering applies where the operation is supported. | `program/verbs/`, `program/library/`, `program/motor/`, `module/`, `examples/pyash/` | Specs `07`-`12`, `17-content-ingest`, `25-teaching-video`; focused `quiz/*` verb, module, and workflow tests |
| Agents and work coordination | Manage agent identity, sessions, channels, durable duties, scheduling, recovery, and collaboration. | Pyash sentences and maps for agent, session, channel, and work operations; compiled forms follow the same semantic contract where supported. | `program/agent/`, `program/runtime/work/`, `world/house/` | Specs `18-pyash-agent`, `19-ops-safety`, `24-channel-contract`; `quiz/agent_*`, `quiz/channel_*`, `quiz/runtime/work_*` |
| Minds and compute resources | Select mind providers and models, allocate local or remote inference capacity, and observe queue and host health. | Pyash mind/configuration/work requests; provider and worker transports are adapters behind those contracts. Pyac applies when mind operations have a supported compiled form. | `program/verbs/mind/`, `program/motor/`, `program/runtime/gpu/`, `configure/`, `world/house/` | Specs `08-tools-and-mcp`, `23-configure`, `26-criterion`; `documentation/reference/gpu-housekeeper-architecture.md`; `quiz/mind_*`, `quiz/runtime/gpu/` |
| State, knowledge, and provenance | Preserve session and knowledge state, claims and evidence, run records, artifacts, and replay information. | Sentence-native facts, maps, series, and newspaper/artifact sentences; `.pyac` carries supported compiled state effects. | `program/remember/`, `program/library/knowledge_core.mjs`, `program/bridge/exchange.mjs`, `command/run_pya_program.mjs`, `world/newspaper/` | Specs `05-run-recording-and-artifacts`, `06-data-formats`, `18-pyash-agent`; `quiz/remember_persistent.test.mjs`, `quiz/knowledge_core.test.mjs`, `quiz/run_newspaper_*` |
| Human and agent surfaces | Provide entry points and reusable workflows over platform capabilities. | Pyash statements and `.pya` programs define canonical behavior; CLI and saddle surfaces bind user input to those contracts. `.pyac` carries supported compiled programs. | `program/main.mjs`, `command/`, `module/`, `examples/pyash/`, coding saddle under `program/agent/` | Specs `07-io-and-scripts`, `10-pipelines`, `11-modules`, `19-ops-safety`; `quiz/run_args.test.mjs`, `quiz/module_import_*`, `quiz/coding_saddle*.test.mjs` |

#### Proposed interface rule

1. Public Pyash-facing behavior is specified as Pyash sentences, module
   declarations, maps, or series. These forms are the canonical service and
   workflow contracts.
2. Pyac is the compiled representation for capabilities with a defined Pyac
   lowering and execution contract. Each supported lowering preserves the
   source sentence's meaning and observable effects.
3. JavaScript, C, Rust, HTTP, and provider-specific request shapes describe
   implementation or transport details. The area map links each to the
   corresponding Pyash/Pyac contract that agents and workflows compose.
4. The map marks missing Pyash/Pyac surfaces and compiled coverage as explicit
   gaps, with supporting evidence and status. It records parity for each
   lowering that its contract and tests establish.

This rule follows the existing sentence/paragraph ABI and the Pyac lowering
specification. The Pyac specification limits compiled support to representable,
proven cases, so the area map preserves that boundary.

### 3.4 Part of the impression is a measurement artifact

This deserves its own section because it would otherwise be repeated.

`command/measure_code_balance.mjs` counts both `.mjs` and `.pya` in its
selected buckets. The `.pya` extension includes executable Pyash, maps,
configuration, and generated artifacts. One generated artifact,
`english_wordnet_bridges.pya`, contributes 41,745 lines at the measured
commit; that does not justify classifying every `.pya` line as data. The
reported 1:36.58 and `.mjs`-only 1:26.50 ratios also cover only
the script's selected buckets, not the whole repository.

The distinction matters: the generated map is a data-size and runtime-loading
question, while executable `.pya` belongs in a code inventory. A mixed
extension count should not drive a source-tree move. Classify files and report
the split before using the ratio to guide structure.

---

## Part 4 — What would pay

Six changes, ordered by payoff per unit of risk. Each carries an acceptance
criterion, because a proposal that cannot say what "done" means is not ready
to be accepted.

### 4.1 Shard the quiz tree by area

**Change.** Mirror the source tree in `quiz/`:

```
quiz/bridge/       quiz/understand/    quiz/remember/
quiz/verbs/        quiz/library/translation/  quiz/library/reporter_shared/
quiz/library/compile/  quiz/library/vliw/  quiz/agent/  quiz/runtime/
quiz/tools/        quiz/commands/      quiz/spec/
```

Existing `quiz/runtime/` moves to match. `quiz/helpers/`, `quiz/fixtures/`,
and `quiz/sandpit/` stay at the top level, because they are shared.

**Payoff.**

- A focused inner loop, for example `node --test quiz/library/vliw/`.
- An explicit area-to-test mapping that can support CI sharding if a small
  experiment demonstrates a wall-clock benefit.
- A natural home for area-specific helpers and fixtures, alongside the
  existing shared helpers.
- The naming discipline Rust, CPython, and KUnit all use.

**Risk.** Moving test files out of `quiz/` changes the base for relative
imports in those files, whether they import a deep module or a public barrel.
The 298 count describes quizzes with at least one deep import; it does not
measure all path rewrites or the impact of moving an individual module. Move
one area at a time and check the runner, tier classification, examples, and CI
discovery as well as relative paths.

**Acceptance criterion.** `node --test quiz/<area>/` runs an area's quizzes
and nothing else; all moved tests remain discoverable by `npm test` and
`npm run test:ci`; and TAP pass/fail/skip results match the recorded baseline,
with pre-existing failures tracked separately. Measure wall-clock time before
claiming a CI speedup.

### 4.2 Enforce the dependency direction

**Change.** First produce a reviewable file-to-file dependency inventory and
agree on the intended area interfaces. Then extend `command/check_imports.mjs`,
which already runs in CI and resolves relative specifiers, with those reviewed
rules:

- `program/library` must not import `program/verbs` or `program/runtime`
- `program/bridge` must not import `program/verbs`
- `program/runtime` must not import `program/agent`
- `program/agent` and `program/motor` must not import `program/verbs`
- `program/verify` (or an equivalent check) must find no import cycle in
  `program/`

**Payoff.** Turns the intended dependency direction into a checkable contract.
The current graph is a starting inventory: seven candidate area-edge
categories (45 direct imports) and two cyclic SCCs. It is not yet a verified
list of 45 defects or two simple cycle paths.

**Risk.** The area rules below are hypotheses until each concrete dependency
is reviewed. Some edges may be legitimate and better expressed through an
interface. Begin in report-only mode, record each accepted exception with a
reason, and only then make new violations fail CI. For cycles, report an
actual closed path in addition to SCC membership.

**Acceptance criterion.** The approved policy and baseline inventory are
checked in; CI rejects new unapproved edges; existing exceptions have an
owner and reason; and the cycle report contains concrete import paths.

### 4.3 Give the suite a shared harness

**Change.** Extract helpers only where inspection finds repeated behavior
with the same contract. The inline Matrix mock in
`quiz/pyash_configure_cli.test.mjs` is a concrete candidate. A memory-isolation
helper and sentence-shape helper should follow only if their current call
patterns and semantics are genuinely shared.

**Payoff.** A shared helper can reduce duplicated setup and make its behavior
easier to maintain. The current search finds 428 files with memory-reset
calls, but does not establish 428 copies of the same isolation boilerplate.

**Risk.** Low, but it touches many files. It should land *after* 4.1, because
4.1 changes the relative path of every helper import anyway — doing both at
once would make the diff unreviewable.

**Acceptance criterion.** Each extracted helper has focused tests and is
adopted by the tests that share its contract. Track duplicate setup patterns
before and after; do not require unrelated quizzes to import a helper merely
to meet a majority-use target.

### 4.4 Split the three outliers

**Change.**

- `quiz/channel_runtime.test.mjs` (2,450 lines, 39 behaviours) becomes
  `quiz/agent/channel_runtime/` with one file per behaviour group.
- `quiz/agenda_stage3_numeric_repair.test.mjs` (5,274 lines, 175 tests)
  splits by stage.
- `quiz/pyash_configure_cli.test.mjs` (1,966 lines, 5 tests) loses its inline
  mock server to a helper.

**Payoff.** Each of these is a file a reviewer has to open in full to
understand. After the split, each file can be read in a sitting, and a failure
names its area without a search.

**Risk.** Splitting can make fixtures, setup, and test order less obvious.
Keep related cases together and verify behavior rather than relying only on a
textual count of `test(` calls.

**Acceptance criterion.** The split has clear behavior-group boundaries; all
existing cases and assertions are accounted for; focused and full TAP results
preserve pass/fail/skip behavior. A line-count target is a review aid, not a
quality criterion.

### 4.5 Name the areas, and map their contracts

**Change.** Publish an area map — `documentation/reference/repository-areas.md`
— that lists each area's responsibility, Pyash/Pyac contract surface, current
code anchors, governing specification, representative quizzes, and allowed
dependency direction. Reuse the existing
`documentation/reference/spec-implementation-map.md` for contract-to-code
pointers rather than building a competing implementation map. The proposed
GI-OS area model above is the review starting point for this inventory.

**Payoff.** This adapts Fuchsia's explicit area-boundary discipline to this
repository. It can make translation, chat, video, web, agent, and GPU areas
legible while keeping Pyash/Pyac contracts as the public interface. With one
maintainer, the map records the project maintainer as accountable reviewer;
dependency rules and focused tests provide the enforceable structure.

**Risk.** Documentation only. It can be wrong without breaking anything,
which is also its weakness — an area map that nothing enforces will drift.
It is worth doing *after* 4.2, which makes at least some of the boundaries
enforceable. Contract rows must distinguish implemented Pyash/Pyac behavior
from proposed seams and implementation-specific transports.

**Acceptance criterion.** Every named area has an explicit responsibility,
Pyash/Pyac contract (or a clearly recorded contract gap), current code
anchors, test targets, applicable specification (or a recorded gap), and
allowed dependency direction. The current maintainer is accountable for the
map; area ownership remains a future option rather than a prerequisite.
Avoid implying every leaf directory has a standalone specification.

### 4.6 Separate code and data in the inventory

**Change.** Classify `.pya` files by role and update
`command/measure_code_balance.mjs` to report executable code, configuration,
and generated/runtime data separately. Keep the WordNet map at its current
path initially: it is runtime-loaded, and a separate inventory change can
correct the metric without relocating the artifact.

**Payoff.** The size report becomes more meaningful without conflating file
format with program role. A later storage move can be considered if it solves
a real loading, packaging, or review problem.

**Risk.** Classification needs an explicit, reviewable rule or manifest.
Moving the map would affect runtime URLs, generators, tests, and tooling.
A `source-hash` field alone does not prove deterministic regeneration or that
the source inputs are available.

**Acceptance criterion.** The report documents included paths and line-count
semantics, separates `.mjs` and `.pya` by reviewed role, and verifies the
generated map's source hash. If it is ever moved, runtime consumers and
generation are tested from a clean checkout. Do not use a maximum-file-size
threshold as a proxy for modularity.

### 4.7 What is deliberately not proposed

- **Splitting the repository into separate repositories as the first move.**
  Keep the shared tree unless an area has independent build, release, and
  ownership needs that outweigh cross-area change cost. Fuchsia and Linux
  demonstrate that strong in-tree boundaries are viable; Rust and CPython
  provide other useful mechanisms, not a single required layout.
- **A rewrite of the test suite.** The strongest size outliers are a small
  subset of the 781 files, while transitive code reach is high. This does not
  remove the need to investigate the observed order/concurrency-sensitive
  failures.
- **A big-bang tree move.** Move one area at a time, with importer and test
  discovery checks; the 298 deep-importing quizzes are a suite-wide count, not
  the impact count for moving any one module.
- **New command-line flags.** Nothing here needs configuration. Per
  AGENTS.md, configurability belongs in Pyash-native defaults or configuration
  sentences, not in switches.

---

## Review questions

1. **What code inventory should be measured?** The existing tool reports
   selected buckets and combines `.mjs` and `.pya`; should it gain reviewed
   path and file-role categories before ratios are used for decisions?
2. **What is the smallest useful test-area pilot?** Try targeted execution
   and one measured CI shard before moving the whole quiz tree. Compare actual
   wall time and TAP outcomes, not summed per-test duration alone.
3. **Which candidate dependencies violate an agreed boundary?** The
   `program/library` → `program/runtime` family is largest at 15 direct
   imports; inspect those concrete imports before setting a rule.
4. **Should dependency checks begin report-only?** Existing imports need
   explicit review and waivers before new rules become CI blockers.
5. **Are the proposed area names useful?** Include `command/`, `program/agent/`,
   and `program/runtime/` in the discussion instead of implying a single
   one-to-one mirror is already known to be right.
6. **Does the generated map need to move at all?** First separate its role in
   the size report; consider a storage move only if runtime packaging or
   loading provides a concrete reason.
7. **Which verb families should be completed next?** 81 verb modules still
   sit at the top level beside 11 family directories; choose moves by
   ownership and cohesion, not a quota.
8. **Which concrete cycle path should be fixed first?** The VLIW SCC is a
   candidate because of its Rust-consumer role, but print and inspect a real
   import path before prioritizing a repair.

---

## Reproducing the measurements

The inventories above were taken at commit `4e31f9f8d`. To reproduce them,
check out that commit first; later edits can change counts. Logical line
counts from the Node tool include a final unterminated line, while the shell
`wc -l` commands below count newline characters. The latter are useful for
rough size checks, not exact reproduction of logical-line totals.

```bash
# combined `.mjs` + `.pya` counts for the tool's selected buckets
node command/measure_code_balance.mjs

# the largest files in the tree
find program command module -type f \( -name '*.mjs' -o -name '*.pya' \) \
  -exec wc -l {} + | sort -rn | head -18

# the library sub-areas
for d in program/library/*/; do
  n=$(find "$d" -name '*.mjs' | wc -l)
  l=$(find "$d" -name '*.mjs' -exec cat {} + | wc -l)
  echo "$l $n $d"
done | sort -rn

# the quiz suite's shape
git ls-files quiz | grep '\.test\.mjs$' | wc -l                 # 781 files
git ls-files quiz | grep '\.test\.mjs$' | xargs cat | wc -l      # 96,221 lines
git ls-files quiz | grep '\.test\.mjs$' | xargs grep -ho 'test(' | wc -l
git ls-files quiz | grep '\.test\.mjs$' | awk -F/ '{print NF-1}' | sort | uniq -c

# the three density outliers (test-count column is a textual approximation)
for f in $(git ls-files quiz | grep '\.test\.mjs$'); do
  echo "$(wc -l < "$f") $(grep -c 'test(' "$f") $f"
done | sort -rn | head -15

# shared helper usage, and the copied isolation discipline
grep -rl 'helpers/' $(git ls-files quiz | grep '\.test\.mjs$') | wc -l   # 8
grep -rl 'forget\|resetMemory\|reset_memory' \
  $(git ls-files quiz | grep '\.test\.mjs$') | wc -l                    # 428

# the resource tiers
node command/run_test_tiers.mjs 2>&1 | head -8

# historical CI evidence quoted in section 1.8; requires gh auth and the run
# to remain available
gh run view 41551328723 --log-failed 2>&1 \
  | grep -E '^test.*# (tests|pass|fail|skipped|duration_ms) '

# per-test durations, and the area attribution in section 1.5
node --test --test-reporter=spec $(git ls-files quiz | grep '\.test\.mjs$')
```

Two measurements need a short script rather than a shell one-liner: the
dependency graph in sections 1.3 and 1.6, and the area attribution in
section 1.5. Both are reproduced in full in
`documentation/suggest/repository-modularization-appendix.md`, which also
carries the graph and attribution output as committed evidence. That
appendix is evidence for this proposal, not a second proposal; it can be
promoted to `command/measure_module_graph.mjs` and
`command/measure_test_suite.mjs` if the proposal is accepted.
