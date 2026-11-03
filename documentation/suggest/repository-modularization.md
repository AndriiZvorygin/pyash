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
because the two can disagree sharply. The measurements are taken at commit
`4e31f9f8d` and every one of them carries the command that reproduces it.
Where a claim is a judgment rather than a measurement, it says so.

The short answer, stated up front so a reviewer can stop early if it is
wrong:

- **The interpreter is not monolithic.** It is 6,421 lines across 25 modules,
  3.1% of the measured code surface, with three clear hubs.
- **The repository is monolithic as an operating system.** One tree holds the
  language, an agent runtime, a work scheduler, Matrix chat, a translation
  and WordNet refinery, video and subtitle pipelines, a web server, an
  Android bridge, a C backend, and a GPU house — with no area boundaries
  between them.
- **The test suite is not too big. It is badly laid out.** 781 quiz files,
  96,221 lines, 3,401 test cases. 744 of them — 95% — sit flat in one
  directory with no mapping to the source tree, no shared harness, and no
  per-area run command.
- **Part of the "monolith" feeling is a measurement artifact.** The
  repository's own `command/measure_code_balance.mjs` counts generated Pyash
  *data* files as source. 64,617 lines of the applications bucket are `.pya`
  data, including one generated 41,745-line WordNet map. Code-only, the
  core-to-applications ratio is 1:26.5 rather than the 1:36.6 the tool
  reports.

---

## Part 1 — The measured surface

### 1.1 Code shape

Counting `.mjs` only, across `program/`, `command/`, and `module/`:

| Bucket | Lines | Files | What it is |
|---|---|---|---|
| interpreter core | 6,421 | 25 | `program/bridge`, `program/understand`, `program/remember` |
| verb layer | 29,868 | 174 | `program/verbs` |
| applications | 170,080 | 607 | `program/library`, `program/agent`, `program/runtime`, `command`, `module` |

Code-only ratio: **core : applications = 1 : 26.49**, core share **3.1%**.

The repository's own tool reports a different figure because it counts `.pya`
files as source:

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

The 64,617-line difference is generated Pyash data, not logic:

| Bucket | `.mjs` lines | `.mjs` files | `.pya` lines | `.pya` files |
|---|---|---|---|---|
| core | 6,421 | 25 | 0 | 0 |
| verbs | 29,868 | 174 | 0 | 0 |
| applications | 170,080 | 607 | 64,617 | 113 |

**27.5% of the applications bucket is data.** The single largest source file
in the repository is one of them:

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
10,000 entries of three or four map sentences each. It is not a program. It
is 41,745 lines and it is 6.5 times the size of the entire interpreter core.
It sits inside `program/library/translation/` as though it were source code,
and it is what makes the applications bucket look enormous.

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

Seven edges run the wrong way, and they are the ones worth naming:

| Edge | Count | Why it matters |
|---|---|---|
| `program/library` → `program/runtime` | 15 | a library module depends on the runtime that should sit above it |
| `program/library` → `program/verbs` | 7 | the library reaches up into the dispatch surface |
| `program/agent` → `program/verbs` | 7 | the agent runtime depends on verbs |
| `program/motor` → `program/verbs` | 6 | motor reaches up into verbs |
| `program/runtime` → `program/agent` | 6 | the runtime depends on the agent layer |
| `program/bridge` → `program/verbs` | 2 | the dispatch core reaches up into the dispatch surface |
| `program/configure` → `program/verbs` | 2 | configuration reaches up into verbs |

There are exactly **two import cycles** in `program/`:

```
program/motor/mcp/snapshot.mjs -> program/motor/mcp/config.mjs -> program/motor/mcp.mjs
  -> program/bridge/modules.mjs -> program/bridge/refinery.mjs -> program/bridge/signature/derive.mjs
  -> program/bridge/signature.mjs -> program/remember/index.mjs

program/library/vliw/database.mjs -> program/library/vliw/index.mjs
```

The second one matters more than its size suggests: `program/library/vliw/` is
the intermediate representation that the Rust interpreter is meant to consume,
and it currently has a cycle in its own entry point.

### 1.4 The test suite's shape

```
git ls-files quiz | grep '\.test\.mjs$' | wc -l          # 781 files
git ls-files quiz | grep '\.test\.mjs$' | xargs cat | wc -l   # 96,221 lines
git ls-files quiz | grep '\.test\.mjs$' | xargs grep -ho 'test(' | wc -l   # 3,401 tests
```

Nesting depth:

```
git ls-files quiz | grep '\.test\.mjs$' | awk -F/ '{print NF-1}' | sort | uniq -c
```

```
    744 1      # flat in quiz/
     26 2      # quiz/runtime/
     11 3      # quiz/runtime/gpu/
```

**744 of 781 quiz files — 95% — sit flat in one directory.** Only
`quiz/runtime/` is organized, and it is organized by runtime subsystem, not
by anything that mirrors `program/`.

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

| File | Lines | Tests | Lines per test |
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

So the suite is not "awefully long" across the board. One domain —
translation and vocabulary, which is also where the 41,745-line generated
data file lives — carries a third of the cost.

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
and mostly a good one — it tests the machinery rather than the surface — but
it means **the internal file layout is the contract the tests hold.** Moving
a module is a breaking change to 298 quizzes, not just to the importers of
one file.

**There is almost no shared test infrastructure.** `quiz/helpers/` is 161 lines
across two files, and only 8 of 781 quizzes import it. Meanwhile 428 quizzes
each carry their own copy of the memory-reset discipline. The isolation rule
exists as a convention repeated 428 times rather than as one function.

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
separate git repositories. This is the Fuchsia "area" pattern already half
built, and it is where the answer to the repository-as-OS question probably
lives.

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

The job took 4m59s wall clock. The single failure is
`existential phrase-list decisions survive English-to-Pyac and Pyash projection`
in `quiz/translation_pipeline.test.mjs`; it reproduces in isolation and is in
the other agent's in-flight translation work, not in the areas this document
touches.

A local run without the tier gate produced six failures on one run and four on
another. The stable ones are missing local resources — this machine's ffmpeg
has no `drawtext` filter and the GPU housekeeper is not running — which is
exactly what the tier policy exists to skip. The fourth stable failure is
the same translation phrase-list assertion. Two more, in
`quiz/saddle_tools_signatures.test.mjs` and `quiz/sandpit.test.mjs`, appeared
on one run only: **both pass in isolation, and both failed only under
full-suite concurrency.** They are intermittent concurrency flakes, and they
are a side-effect of running 781 files in one undifferentiated pool.

---

## Part 2 — How comparable projects are organized

Four mechanisms appear in every comparable project examined. They are listed
with their sources so a reviewer can check the claim rather than trust it.

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

### 2.2 Linux — subsystems, tests beside the code, and a naming rule

The kernel tree is a set of subsystems — `drivers/`, `fs/`, `net/`, `mm/`,
`arch/` — each with its own maintainer in `MAINTAINERS`.

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

### 2.6 The four mechanisms, summarized

| Mechanism | Rust | Linux | CPython | Fuchsia | This repository today |
|---|---|---|---|---|---|
| Named areas with an owner | crate `OWNERS`-style review | `MAINTAINERS` per subsystem | `Lib/` packages | `OWNERS` per area | partial — 29 houses, 5 with own repos |
| Tests mirror the source tree | `tests/` per crate | `tests/` beside the code | `Lib/test/test_<module>.py` | area-local `tests/` | **no** — 95% flat |
| Boundary enforced by tooling | cargo visibility | Kconfig + Kbuild | — | `BUILD.gn` | `check_imports.mjs` checks resolution only, **not direction** |
| Tests runnable per area | `./x test library/std` | `kunit.py` per subsystem | `python -m test -j0` | per-area targets | **no** — one pool of 781 |

---

## Part 3 — The assessment

This section is judgment, built on the measurements above. It is the part a
reviewer should attack.

### 3.1 What is not monolithic

**The interpreter.** 6,421 lines, 25 modules, three hubs with obvious names
(`remember`, `understand`, `bridge`), and a clean outward direction. It is
the healthiest part of the repository. It does not need modularizing.

**The verb layer.** 174 modules in 11 family directories; the largest is 872
lines and only 15 exceed 400. It was split once already this season
(`itinerary_media`, `loop_control`, `command`, `qwen_say`).

**The library layer.** Four named sub-areas carry 94.5% of it.

**The specification set.** 23 files, a stated size rule, a core order and a
feature order.

**The test suite's coverage.** 95.6% transitive reach, 3,401 test cases,
resource-tiered so that a missing local dependency is reported rather than
failing.

**The CI shape.** A `test` job, a `rust` job, an examples audit, a smoke
lane, and a tier policy that reports environment gaps honestly.

### 3.2 What is genuinely monolithic

**The repository as an operating system.** One tree holds roughly 700
application modules across at least eight unrelated domains: language
tooling, Matrix chat and channels, translation and WordNet, video and
subtitle pipelines, a web server and browser automation, print audit, an
Android bridge, a GPU house, and a C compiler backend. Nothing in the tree
marks where one domain ends and the next begins. The comparable projects all
mark it — Linux with `MAINTAINERS`, Fuchsia with `OWNERS` plus a build-system
dependency rule, Rust with crates that publish independently.

This is the thing the question is really about, and it is a real finding. The
counter-argument deserves a hearing: a general intelligence operating system
is *supposed* to be one coherent system, and splitting it into separate
repositories would multiply cross-repository change cost and split the
specification. That argument is right. The answer is therefore **not** to
fragment the repository, but to mark the areas inside it and enforce the
boundaries — which is what Fuchsia does inside one repository.

**The quiz tree.** 744 of 781 files flat, no mapping to the source tree, no
shared harness, no per-area run command, no per-area CI shard, and 781 files
in one pool with two known concurrency flakes. This is the concrete, fixable
form of "the test suites are awfully long and cover a lot of stuff".

**Seven backward layer edges and two import cycles.** The layering exists in
the directory names but is not held by anything. `check_imports.mjs` verifies
that every relative specifier *resolves* — 4,332 of them across 1,610
modules — and stops there.

### 3.3 Part of the impression is a measurement artifact

This deserves its own section because it would otherwise be repeated.

`command/measure_code_balance.mjs` counts `.pya` files as source. The
applications bucket therefore includes 64,617 lines of generated translation
data, of which one file is 41,745 lines. Read directly, that says "the
applications layer is 36 times the core". Read correctly, it says the
applications layer is 26 times the core in *code*, and the repository's
largest file is a data file, not a program.

The distinction matters for the decision: **a 41,745-line generated data file
is a storage and loading question, not a modularization question.** Splitting
it, or moving it, would not make the code more modular — it would only make
the measurement honest.

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

- A fast inner loop: `node --test quiz/library/vliw/` instead of a 4m59s
  suite.
- CI shards. Translation is 33.7% of the test time; sharded, it runs
  *beside* the rest rather than behind it. The 4m59s job could become three
  jobs of roughly two minutes.
- A natural home for per-area helpers, which today have nowhere to live.
- The naming discipline Rust, CPython, and KUnit all use.

**Risk.** 298 quizzes import deep paths, so every moved file needs its
relative specifiers rewritten from `../program/...` to `../../program/...`.
This is mechanical, it is scriptable, and the suite is its own proof: the
moved area must pass before and after. It must be done one area at a time,
never as one sweep.

**Acceptance criterion.** `node --test quiz/<area>/` runs an area's quizzes
and nothing else; the full suite still reports the same pass count; and
`command/check_imports.mjs` stays clean.

### 4.2 Enforce the dependency direction

**Change.** Extend `command/check_imports.mjs`, which already runs in CI and
already resolves every relative specifier, with a layering rule set:

- `program/library` must not import `program/verbs` or `program/runtime`
- `program/bridge` must not import `program/verbs`
- `program/runtime` must not import `program/agent`
- `program/agent` and `program/motor` must not import `program/verbs`
- `program/verify` (or an equivalent check) must find no import cycle in
  `program/`

**Payoff.** Turns "we have layers" into "the layers are held". Seven
backward edges and two cycles is a small, closable list. The two cycles in
particular would stop being able to grow.

**Risk.** The rules as written above are the *target* state. Landing them
requires fixing seven edges and two cycles, which is real work and needs a
decision per edge. A softer first step is to report violations without
failing, so the list can be worked down deliberately.

**Acceptance criterion.** The check exists, runs in CI, and the violation
count is zero or explicitly waived with a written reason per edge.

### 4.3 Give the suite a shared harness

**Change.** One `quiz/helpers/memory.mjs` exporting a `withFreshMemory()`
wrapper, and one `quiz/helpers/assert_sentence.mjs` for the sentence-shape
assertions that currently appear inline. Move the mock Matrix server out of
`quiz/pyash_configure_cli.test.mjs` into `quiz/helpers/matrix_server.mjs`.

**Payoff.** 428 quizzes currently carry their own copy of the isolation
discipline. One helper turns the rule from a convention into a mechanism, and
removes the copy-paste drift that makes a shared rule hard to keep.

**Risk.** Low, but it touches many files. It should land *after* 4.1, because
4.1 changes the relative path of every helper import anyway — doing both at
once would make the diff unreviewable.

**Acceptance criterion.** `quiz/helpers/` is imported by a majority of
quizzes; the number of quizzes containing their own memory-reset boilerplate
falls below 50.

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

**Risk.** Low, and the suite verifies each split immediately.

**Acceptance criterion.** No quiz file exceeds 1,000 lines; the count of
tests is unchanged.

### 4.5 Name the areas, and give each one an owner

**Change.** Publish an area map — `documentation/reference/repository-areas.md`
— that lists each area, the code it owns, the specification that governs it,
the quiz directory that tests it, and its owner. Reuse the existing
`documentation/reference/spec-implementation-map.md`, which already maps
contract to implementation, and extend it rather than building a second map.

**Payoff.** This is the Fuchsia `OWNERS` idea at the scale that fits this
repository. It makes the repository-as-OS legible: a reader can see that
translation, chat, video, web, and the GPU house are separate domains with
separate owners, even though they share a tree.

**Risk.** Documentation only. It can be wrong without breaking anything,
which is also its weakness — an area map that nothing enforces will drift.
It is worth doing *after* 4.2, which makes at least some of the boundaries
enforceable.

**Acceptance criterion.** Every directory under `program/` appears in the map
with an owner and a governing specification.

### 4.6 Move the generated data out of `program/`

**Change.** The 64,617 lines of generated `.pya` data — chiefly
`program/library/translation/english_wordnet_bridges.pya` at 41,745 lines —
move to a data location that is not counted as source, and
`command/measure_code_balance.mjs` gains an explicit data/code split.

**Payoff.** Two things at once. The measurement stops being misleading, and
the generated artifact stops being a thing a reviewer has to open. The file
is regenerable — it carries a `source-hash` field — so it does not need to be
a source file at all.

**Risk.** Low technically, but it touches the import path of every consumer
of the bridge map, and the `know/` directory is already 2.3 GB, so where it
lands needs a decision.

**Acceptance criterion.** `measure_code_balance.mjs` reports code and data
separately, and the largest source file under `program/` is under 7,000
lines.

### 4.7 What is deliberately not proposed

- **Splitting the repository into separate repositories.** This contradicts the
  general intelligence operating system premise, and the comparable projects
  that keep one tree (Fuchsia, Linux, CPython) solve it with in-tree area
  boundaries and enforced dependency rules, not with fragmentation.
- **A rewrite of the test suite.** The density problem is in three files, not
  in 781. The suite's coverage and isolation discipline are good.
- **A big-bang tree move.** The 298 deep-importing quizzes make any
  single-sweep move a wide, hard-to-review diff. Every move is one area, one
  commit, one green run.
- **New command-line flags.** Nothing here needs configuration. Per
  AGENTS.md, configurability belongs in Pyash-native defaults or configuration
  sentences, not in switches.

---

## Review questions

1. **Is the core-to-applications ratio the right thing to watch?** The
   repository's own tool reports 1:36.58; code-only it is 1:26.5. Should
   `measure_code_balance.mjs` report the split, and should the doc that
   quotes it use the code-only figure?
2. **Is the quiz sharding worth 298 files of import rewrites?** The payoff
   is a fast inner loop and parallel CI. Is there a cheaper way to get
   parallel CI — sharding by file hash rather than by directory?
3. **Do the seven backward layer edges represent real mistakes, or
   legitimate coupling that the layer names do not capture?** The
   `program/library` → `program/runtime` edge (15) is the largest.
4. **Should the layering rules be enforced immediately or reported first?**
   A failing check blocks every pull request that touches an offending file.
5. **Are the areas in 4.5 the right areas?** The proposal lists nine
   directories. The repository also has `command/` (212 files, 57,059 lines),
   `program/agent/` (51 files), and `program/runtime/` (68 files), which may
   want different boundaries.
6. **Where should generated translation data live?** `know/` is already 2.3
   GB. `data/` at the repository root? A per-area `data/` directory?
7. **Should `program/verbs/` finish its family split?** 81 verb modules still
   sit at the top level of `program/verbs/` beside 11 family directories.
8. **Is the two-cycle bound the right target?** The
   `program/library/vliw` cycle is in the code the Rust interpreter is meant
   to consume, so it may deserve fixing first regardless of this proposal.

---

## Reproducing the measurements

Every number above was taken at commit `4e31f9f8d`.

```bash
# the code buckets, and the code-versus-data split the repository's tool does
# not make
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

# the three density outliers
for f in $(git ls-files quiz | grep '\.test\.mjs$'); do
  echo "$(wc -l < "$f") $(grep -c 'test(' "$f") $f"
done | sort -rn | head -15

# shared helper usage, and the copied isolation discipline
grep -rl 'helpers/' $(git ls-files quiz | grep '\.test\.mjs$') | wc -l   # 8
grep -rl 'forget\|resetMemory\|reset_memory' \
  $(git ls-files quiz | grep '\.test\.mjs$') | wc -l                    # 428

# the resource tiers
node command/run_test_tiers.mjs 2>&1 | head -8

# the CI run quoted in section 1.8
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
