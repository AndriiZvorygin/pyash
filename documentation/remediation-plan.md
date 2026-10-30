# Pyash Remediation Plan

Status: in progress
Date: 2026-10-30

## Progress

| Phase | Status | Result |
|---|---|---|
| 0 — Baseline | done | `command/audit_examples.mjs` added; baseline recorded below |
| 1 — Documentation integrity | done | 3 corrupted passages repaired, `command/check_doc_prose.mjs` guard added, `AGENTS.md` points at the spec index |
| 2 — Example correctness | in progress | `until-loop.pya` fix verified; module manuscript score fix landed; remaining failures need owner decisions |
| 3 — CI coverage | done | Every quiz file is tiered by resource need; `test:ci` now gates 748 of 752 files instead of 28 |
| 4 — Core/periphery balance | open | — |
| 5 — Repo hygiene | partly done | `push_all.sh` remote check relaxed and guarded; orphaned searxng settings and file ownership still open |

## Test baseline movement

| State | Root tests | Pass | Fail |
|---|---|---|---|
| Before WordNet provisioning | 3016 | 2950 | 66 |
| After WordNet provisioning | 3016 | 2997 | 6 |
| After module manuscript fix | see Phase 2 | — | — |

The WordNet dataset is the single largest blocker: provisioning it removed 60 of
66 failures at once. The remaining failures are an ffmpeg `drawtext` gap in a
custom local ffmpeg build (the system ffmpeg has the filter, and those two
tests pass with it on `PATH`), whisper.cpp sample audio, one load-sensitive GPU
test, and one house-checkout test.

## WordNet provisioning (resolved)

The open question "should CI fetch WordNet or use a committed fixture?" is
answered: **fetch from the pinned upstream**.

- Upstream: `https://en-word.net/static/english-wordnet-2025-json.zip`
  (Open English WordNet 2025 JSON, derived from Princeton WordNet, CC-BY 4.0
  plus the Princeton WordNet license). Confirmed live and listed at
  `https://en-word.net/downloads`.
- The repository already recorded the source URL, license, and expected content
  hash in `program/library/translation/english_wordnet.pya`.
- The loader's pinned hash
  `4c07194f363e9c870dc925b8cab26f9af93899f6bd91a29b9a1422c1f66d95ba`
  was independently recomputed from the downloaded archive and matches exactly.
- The dataset is 70MB unpacked, so it must not be committed. It is gitignored
  under `know/**`.
- `command/bootstrap_caterer.mjs` now provisions it alongside wasmtime, using
  the same pinned-URL + checksum pattern, and the CI workflow already runs
  `npm run bootstrap`, so CI gains the dataset with no extra step.

Local development can also fetch it from the `zvorygin` host, where the
dataset is currently being developed:
`/home/htaf/pyash/know/wordnet/open-english-wordnet-2025-json/`.

## Phase 2 findings that need an owner decision

**`ob name num <fact>` is not resolved to a value.** The numeric path in
`program/verbs/mathematics/plus.mjs` reads `toNumber(sentence.ob)`, which only
understands a literal `{ num: N }`. A typed name reference (`ob name num X`)
therefore contributes **0**. The text path in the same handler *does* resolve
its typed reference (`resolveTextPiece` looks up `fact.ob.text`), so the two
paths disagree.

This was verified directly: with a fact holding `num 0.9`, adding it into a
slot yields `1` via `ob name num X` and `1.9` via `ob num of X`.

Two fixes are possible:

- **Fix the call sites** (chosen). The `plus` verb already resolves genitive
  operands through the bridge, so `ob num of <fact>` works today. The two
  affected modules used `ob name num` where their sibling lines used the
  genitive form; converting them keeps the modules internally consistent and
  touches no core semantics.
- **Fix the core.** Making the numeric path resolve typed name references
  would change the meaning of `ob name num X` everywhere. It was tried and it
  broke `module_manuscript_scored.pya`'s promote ceremony, whose attempt
  arithmetic is written against the current (unresolved) behaviour and
  produces the correct `attempt 2` only because the reference contributes 0.
  Making that change correctly requires revisiting the promote ceremony's
  arithmetic as well, which is a language-semantics decision, not a bug fix.

## Phase 3 findings

The per-file sweep (`command/sweep_quiz_files.mjs`, 752 files run one at a
time) found exactly **three** files that do not pass in this environment:

| File | Cause | CI verdict |
|---|---|---|
| `quiz/cover_overlay_stage.test.mjs` | the local `/usr/local/bin/ffmpeg` build has no `drawtext` filter | CI's distro ffmpeg has it, so this gates there |
| `quiz/music_say.test.mjs` | needs `caterer/whisper.cpp/samples/jfk.wav` | CI provisions it with `--with-whisper`, so this gates there |
| `quiz/reporter_gpu_housekeeper.test.mjs` | reads an untracked house checkout | advisory: house content is per-clone and not in the repository |

That changed the shape of Phase 3. The suite does not need four hand-maintained
tiers with a curated file list; it needs a **policy about which tiers gate**,
plus a way to tell when a quiz's resource is simply absent from the machine
running it.

`command/quiz_tiers.mjs` classifies a quiz by what it actually needs:

| Tier | Meaning |
|---|---|
| `t1` | needs nothing beyond the repository |
| `t2` | needs a provisioned resource: wordnet, whisper sample audio, or ffmpeg with `drawtext` |
| `t3` | needs a house checkout the repository does not track |

`configure/test_tiers.pya` holds the gating policy (`ci_gating_tiers`,
`ci_advisory_tiers`) so it is Pyash configuration rather than a command-line
switch. `command/run_test_tiers.mjs` reads the policy, checks each required
resource against the machine, and runs the gating files. A quiz whose resource
is missing is **reported with the reason rather than failed** — the
environment is missing something, the code is not broken. In CI the resources
are provisioned, so those quizzes gate there.

The rules are pinned by `quiz/quiz_tiers.test.mjs`.



The repo's spec-first discipline is genuinely strong, but the enforcement
mechanisms around it are much weaker than the discipline itself. The specs
promise truth; CI checks 3.8% of the tests that define it, examples drift
silently, and a bulk vocabulary migration corrupted documentation prose
without anything noticing.

This plan fixes the enforcement gaps rather than the design. The language design
is sound; what is missing is the machinery that keeps the repo honest as it
grows.

## Findings this plan is based on

| # | Finding | Evidence |
|---|---|---|
| F1 | CI gates 28 of 739 quiz files (254 tests) | `package.json` `test:ci`; `.github/workflows/ci.yml` runs `npm run test:ci` |
| F2 | 66 distinct test failures locally, all environmental | root-only `node --test` run; every failure is `ENOENT` for a missing dataset/binary, or ffmpeg `drawtext` |
| F3 | Documentation prose corrupted by bulk keyword replacement | `documentation/design.md` lines 15, 44, 314 |
| F4 | Examples drift from runtime with no verification | `examples/pyash/until-loop.pya` yields `counter = undefined`; `examples/core/until-loop.md` documents a different invocation and expects `counter ob num 2` |
| F5 | `AGENTS.md` omits the normative spec set | `grep -c specifications AGENTS.md` → 0. (`README.md` and `documentation/handoff.md` do point at it, so the gap is AGENTS.md alone.) |
| F6 | Clean clone cannot run the suite | `know/**` and `caterer/whisper.cpp/` are gitignored; only wasmtime is bootstrapped by default |
| F7 | Peripheral code outweighs the interpreter | core ~70k lines vs library/agent/runtime/command ~135k lines |
| F8 | Some tests are load-sensitive, not logic-sensitive | `quiz/runtime/gpu/worker.test.mjs` "bounded GPU worker batch" passes alone, fails at full-suite concurrency (`5 !== 10`) |
| F9 | 121 of 362 examples fail, but only ~12 are genuine defects | `node command/audit_examples.mjs` → 232 passed, 121 failed, 9 skipped. 69 fail on missing required input (parameterized templates), 16 time out, 24 need a live backend or container path, 12 are real |
| F10 | Two examples call signatures that were never implemented | `pyac-corpus.pya` uses `be subtract ob num from num`; `read-image-auto.pya` uses `be read become wo text from filename`. Neither signature exists in git history — these examples were committed ahead of the verbs |
| F11 | A green exit code does not mean a correct result | `until-loop.pya` exits 0 while producing `counter = undefined`. Exit-code auditing cannot catch wrong-but-successful runs |

## Principles

1. Spec-first. Every fix restores truth to a declared contract rather than
   adding a fallback.
2. No new CLI flags as a product destination. New checks are wired into
   existing entry points (`npm test`, `npm run test:ci`) and Pyash-native
   config where behaviour is configurable.
3. Red→green. Each tranche writes the failing check first.
4. Keep the language core legible. Remediation tooling must not become a second
   large subsystem.

---

## Phase 0 — Baseline (no behaviour change)

Goal: make the current state measurable so later tranches can prove progress.

**0.1 Add an example audit command.**

`command/audit_examples.mjs` (already drafted) executes every
`examples/pyash/*.pya` **through the real runner** (`command/run_pya_program.mjs`)
in a child process, so the audit observes exactly what a user sees.

An earlier in-process implementation was discarded: replicating the runner's
state (module dir, registered signatures, config defaults) is easy to get
subtly wrong, and it produced ~110 false failures that the real runner did not.
The subprocess design has no such fidelity gap.

- Skips examples that need a live backend (MCP `uvx`, live model routes) or
  live network, and reports them as `skipped` rather than failing.
- Emits a per-file status and exits non-zero on failure.
- `--json` for machine reads, `--timeout-ms` to bound slow examples.

**0.1.1 Classify failure kinds in the audit output.**

The audit must distinguish four outcomes, because they need different owners:

| Outcome | Meaning | Action |
|---|---|---|
| `passed` | ran and exited 0 | none |
| `needs input` | failed with `input binding defective: missing required input "<name>"` | example is parameterized and correct; not a defect |
| `needs backend` | requires live MCP/model/network | gate to an advisory tier |
| `failed` | genuine runtime defect | fix in Phase 2 |

Without this split, ~1/3 of examples look broken when most are simply
parameterized templates awaiting a `source`/`manuscript`/`video` input.

Acceptance: `node command/audit_examples.mjs` completes without crashing and
prints a per-outcome tally for all 362 examples.

**0.2 Record the baseline.**

Capture and commit the audit tally and the root-only test tally to
`documentation/state.md` so later tranches have a before/after reference.

---

## Phase 1 — Documentation integrity (cheap, high visibility)

Goal: the specs and design docs say what they mean.

**1.1 Repair the corrupted prose.**

Three known instances in `documentation/design.md`, with verified originals
recoverable from git history:

| Line | Current | Intended |
|---|---|---|
| 15 | `history toindex garbage collection` | `history until garbage collection` |
| 15 | `The subject (\`su\` / \`su\`)` | `The subject (\`su\` / \`subj\`)` |
| 44 | `\`su\` (or \`su\`)` | `\`subj\` (or \`su\`)` |
| 314 | `paragraph toindex the condition` | `paragraph until the condition` |

Origin: `28b392eb` ("migrate loops to sequence registers") replaced `until` →
`toindex` across 44 files; `9a665afe` ("normalize su ob and update signatures")
replaced `subj`/`obj` → `su`/`ob`.

**1.2 Add a prose-corruption guard.**

A check that fails when a Pyash keyword appears inside an English sentence,
i.e. a lowercase word on both sides. Wire it into the audit command and CI.

```bash
git grep -nE '\b[a-z]+ (until|toindex|fromindex|atindex|subj|obj) [a-z]+' -- '*.md' '*.txt'
```

**1.3 Update `AGENTS.md` doc pointers.**

Point contributors at `documentation/specifications/00-index.md` as the
normative entry point, keeping the existing `pyac.txt` / `pyash.md` /
`compositional-cases.md` pointers. Add the new skill to `skills/README.md`.

**1.4 Record the reusable workflow.**

The `pyash-doc-integrity` skill (drafted) captures the detection greps, the
`git log -L` tracing method, and the "use the official runner, not naive line
splitting" lesson.

Acceptance: corruption grep returns clean; `AGENTS.md` names the spec index;
skill is listed in `skills/README.md`.

---

## Phase 2 — Example correctness

Goal: every documented example runs and produces its documented result.

**2.1 Fix `examples/pyash/until-loop.pya`.**

The `def` line parses as `fromindex: { num: "be" }` — the `num` keyword
consumes the following token — and the final `counter` is `undefined`. The
paired `examples/core/until-loop.md` documents an invocation that does not
match its own file and expects `counter ob num 2`.

The fix has been determined and verified. The `def` line must not carry
`fromindex`/`toindex` roles, because the body never reads them through `this`:

```text
exists su name counter ob num 0 be number ya
su name climb to name counter be ceremony def
ob num 1 to name counter be plus do
su name climb be ceremony prah
to name counter fromindex num 1 toindex num 3 be climb do
```

This produces exactly the documented expectation — final `counter` is
`ob num 2`, and the invoke carries `fromindex: 3`, `toindex: 3` with
`ob num 2`. Verified against both `run_pya_program.mjs` and
`read_pya_trace.mjs`.

Note the document's `REPL input` block omits `exists` on the first sentence
(`su name counter ob num 0 be number ya`), which raises
`variable as not exists`. The document needs that correction too, and its
"Expected output" block should be updated to the verified shape rather than
left aspirational.

**2.2 Add a quiz that pins example behavior.**

A test that runs representative examples and asserts the documented outcome —
starting with the loop family. This turns example drift from something a human
must notice into something CI catches.

Exit-code auditing is not sufficient on its own. `examples/pyash/until-loop.pya`
exits 0 while producing `counter = undefined`; only an assertion on the final
memory catches it. The example quiz must assert on resulting facts, not on exit
status.

**2.3 Add an example corpus check to CI.**

Run `node command/audit_examples.mjs` in CI and fail on regressions. Examples
needing live backends stay skipped, not failed. Because the audit spawns one
process per example it takes several minutes; run it on a schedule or a
dedicated CI job rather than blocking every push.

**2.4 Decide the fate of unimplemented-example signatures.**

Two examples call signatures that have never existed:

- `examples/pyash/pyac-corpus.pya` calls `be subtract ob num from num`.
- `examples/pyash/read-image-auto.pya` calls `be read become wo text from filename`.

Neither was ever registered (verified against git history), so both were
committed ahead of the verbs they need. Each needs one of:

- **implement the signature** (adding it to the verb's `signatures` list plus
  a quiz), or
- **remove or gate the example** until the capability exists.

`read-image-auto.pya` already declares `su name required ob ve text
"PYA_SEE_VL_FIXTURE"`, and `command/see_vl_runner.mjs` plus `module/see_vl.pya`
exist — the image-description path exists, but is not wired to `be read` with
`become wo text`. That is the cheaper of the two to complete.

Acceptance: audit is clean for the loop family; a quiz pins the documented
result; CI runs the audit; every failing example is either fixed or explicitly
classified.

---

## Phase 3 — CI coverage (the main lever)

Goal: CI enforces the specs it claims to enforce.

**3.1 Classify the 739 quiz files by resource need.**

Produce a manifest mapping each quiz file to its external requirements:
none / wordnet dataset / whisper.cpp / ffmpeg-drawtext / GPU / live model /
gitignored house checkout.

**3.2 Tier the suite.**

| Tier | Contents | Requirement | Gate |
|---|---|---|---|
| T0 | current 28 CI files | none | blocking, unchanged |
| T1 | resource-free root quizzes | none | blocking |
| T2 | resource-dependent quizzes | provisioned in CI | blocking |
| T3 | live-backend / house quizzes | external | advisory, reported not gating |

**3.3 Provision Tier 2 resources in CI.**

- **WordNet.** `know/wordnet/open-english-wordnet-2025-json/` has no
  provisioning script today. Either fetch it in CI from a pinned source with a
  recorded hash, or commit a minimal fixture resource that satisfies the
  tests. The tests assert `sourceHash`, so whichever route is chosen must pin
  the hash — see `english_wordnet.mjs` and `english_wordnet.pya`.
- **whisper.cpp.** CI already runs `npm run bootstrap`; add `--with-whisper`
  for the tier that needs it, or gate that file to Tier 3.
- **ffmpeg `drawtext`.** Install an ffmpeg build with `libfreetype` and
  `libfontconfig`, or gate the two `cover_overlay_stage` failures to Tier 3.

**3.4 Fix load-sensitive tests.**

`quiz/runtime/gpu/worker.test.mjs` "bounded GPU worker batch" asserts that 10
jobs overlap concurrently but observed 5 under full-suite load. A concurrency
assertion that depends on machine load is a flaky test, not a correctness
signal. Options: assert on a lower bound, drive the fake adapter with
deterministic gates instead of sleeps, or move the file to a serial CI lane.

**3.5 Widen `test:ci` tier by tier.**

Change `test:ci` to run T0 + T1 first. Add T2 once its resources are
provisioned. Keep `--test-concurrency=1` for lanes that need it.

Acceptance: `npm run test:ci` covers every quiz file that can run without
external state; the failure list from T2 is empty; no test is
load-sensitive.

---

## Phase 4 — Core/periphery balance

Goal: the language stays the centre of the repo.

**4.1 Measure and record the ratio.**

Track interpreter-core lines versus peripheral lines in `documentation/state.md`
so drift is visible over time.

**4.2 Bound the verb surface.**

`program/verbs/english_sentence.mjs` (2,095 lines) and
`program/library/reporter_shared/agenda-stage3-summary-renderer.mjs`
(6,675 lines) are domain logic living in the language layer. Extract domain
logic out of `program/verbs/` into `program/library/` or a house module, so
verbs stay thin dispatchers — which is what `documentation/pyash.md` already
requires ("Keep verbs thin and focused").

**4.3 Re-evaluate the largest peripheral file.**

Decide whether `agenda-stage3-summary-renderer.mjs` should be split on a
domain boundary. It is one file, one concern, and 6,675 lines.

Acceptance: no verb module exceeds a few hundred lines; the domain logic that
was in `program/verbs/` has moved to `program/library/` with tests intact.

---

## Phase 5 — Repo hygiene

Goal: no stale or misleading artefacts.

**5.1 Remove or fix the orphaned searxng settings file.**

`container/searxng/configure/settings.yml` (2,826 lines) is not the mounted
config. Compose mounts `container/searxng/configure/searxng/`, whose
`settings.yml` already had `json` in `formats` before commit `59db00b1`.
Decide: `git rm` the orphan, or keep it and make the relationship explicit.

**5.2 Relax the `push_all.sh` remote check.** *(done)*

`command/push_all.sh` required the literal
`git@github.com:AndriiZvorygin/pyash.git` and exited 1 when the remote used the
`github-andriizvorygin` SSH alias — a legitimate `~/.ssh/config` entry with its
own key. The check now lives in `command/push_all_check.mjs`: it accepts the
canonical URL or an alias that `ssh -G` resolves to `github.com`, and rejects
any other host or repository path before pushing. Pinned by
`quiz/push_all_remote_guard.test.mjs`.

The script's exit code always reflected failure (`set -euo pipefail` plus an
explicit `exit 1`); an earlier report of "exits 0 despite failing" was an
artifact of measuring the exit status of a `| tail` pipe rather than the
script.

The script also used to refuse to run at all on a dirty worktree, which made
it unusable whenever another agent had work in progress. Since `git push` only
publishes committed history, a dirty worktree is now reported and the push
proceeds.

**5.3 Fix container-config file ownership.**

`container/searxng/configure/settings.yml` is owned by uid 977, not the
developer's uid. Git can commit it but it cannot be edited in place, which
broke a `git revert` during this review. Align ownership on the repo's normal
uid.

**5.4 Refresh stale status docs.**

`documentation/state.md` still describes the project as "a small experimental
language with a handful of verbs", which no longer matches the repo. Bring it
in line with the current scope.

---

## Sequencing

Phases 1 and 2 are independent and can run in parallel. Phase 3 depends on
Phase 2.2 (the example quiz) and Phase 0.1 (the audit command). Phase 4 is
independent but should not compete with Phase 3 for the same files. Phase 5 is
independent throughout.

```
Phase 0 ──┬──> Phase 1 (docs)          [independent]
          └──> Phase 2 (examples) ──> Phase 3 (CI coverage)

Phase 4 (core balance)   [independent, own files]
Phase 5 (hygiene)        [independent]
```

## Verification

Per `AGENTS.md`:

- `npm test` before pushing each tranche.
- Red→green: each tranche's check fails before the fix.
- Every new or modified example is run before asking the user to run it.
- Commit per tranche, lowercase imperative messages, pushed to both remotes
  via the dual-remote helper once `push_all.sh` is fixed.

## Open questions for the owner

1. **WordNet provenance.** Should CI fetch the real Open English WordNet
   dataset from a pinned upstream, or should the repo carry a committed
   fixture? This decides whether Tier 2 is reproducible offline or needs
   network access in CI. There is currently no provisioning script at all, and
   the tests assert a `sourceHash`, so whichever route is chosen must pin it.
2. **CI budget.** The root-only suite takes ~85s of test time. Widening to
   T1+T2 should stay under a few minutes. The example audit is far slower
   (one process per example, ~15 min for 362) and should probably be a
   scheduled or dedicated job rather than a blocking gate.
3. **House checkouts.** `world/house/*` is gitignored except two houses, so
   house tests behave differently per clone — a house test passed locally and
   was skipped in a fresh worktree during this review. Decide whether house
   tests belong in CI at all, or stay advisory.
4. **Core/periphery target.** Is there an intended ratio for interpreter core
   versus applications, or is the goal simply that verbs stay thin?
5. **The 12 genuine example failures.** Several are behavioral questions, not
   typos: `coding-loop-guarantee.pya` reports `session replay defective:
   conflicting request for turn-exchange-evolve-10`, and `talk-loop-stream.pya`
   reports `series history missing`. These may be real runtime defects rather
   than doc drift, and each needs a decision about which side is correct.
6. **Container-path examples.** 24 failures reference `/workplace/...` paths
   that only exist inside the container image. Should the audit run the
   container variant of these examples, or should they be excluded from host
   auditing by an explicit manifest?

## Baseline measurements

Recorded 2026-10-30 on the `master` branch at `59db00b1`.

| Measurement | Value |
|---|---|
| Quiz files | 739 total; 28 run in CI (254 tests) |
| Root-only quiz failures | 66 distinct, all environmental |
| `npm run test:ci` | 254 tests, 0 failures |
| Examples audited | 362 total → 232 passed, 121 failed, 9 skipped |
| Example failures needing input | 69 (parameterized templates) |
| Example failures timing out | 16 |
| Example failures needing live backend/container | 24 |
| Genuine example failures | 12 |
| Examples silently wrong despite exit 0 | at least 1 (`until-loop.pya`) |
| Interpreter core size | ~70k lines |
| Peripheral size | ~135k lines |
