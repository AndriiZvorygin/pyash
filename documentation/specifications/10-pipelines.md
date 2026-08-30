# 10. Pipelines

Purpose: define refinery declarations, stage execution semantics, and deterministic re-entry loops.

## 1. Pipeline keyword table

| Keyword | Meaning | Application |
| --- | --- | --- |
| `be refinery def ... prah` | refinery declaration block | define staged workflow |
| `su name <stage>` | stage identifier | unique stage node |
| `from name ...` | single dependency link | explicit prior-stage requirement |
| `from la ... ko` | embedded invocation clause | pass callable sentence template |
| `from ve name ...` | multi-dependency link | explicit prior-stage requirements |
| `be evoke do` (clause mode) | execute embedded clause template | deterministic per-call output override |
| `be refinery do` | execute refinery | run declared pipeline |
| `be better compare do` | pairwise comparison loop | module-driven candidate selection |
| `be chirp do` | chirp manuscript refinery | source-grounded problem/cause/insight compression |
| `be reiterate ya` | retry marker | bounded retry reporting |
| `be checkpoint ya` | checkpoint marker | deterministic reuse/trace |
| `under name <conduct>` | refinery conduct association | select a source-local run contract |

## 2. Canonical refinery pattern

```pyash
su name plan loop be refinery def
su name plan stage ob name input for name planner to name text plan out be write do
su name execute stage ob name plan out for name worker to name text draft out be write do
su name verify stage ob name draft out for name checker to name text verdict out be write do
prah

ob text "task" from name plan loop to name text result be refinery do
```

## 3. Determinism rules

- stage ordering deterministic,
- explicit fail/success path,
- bounded retry behavior,
- replay visibility through run recording.

Native sub-refinery invocation rule:
- a refinery call may target either a registered refinery name or a refinery-backed `.pya` program file,
- canonical file-backed call shape is `from filename "<program>.pya" ob name <bindings map> to name map <result> be refinery do`,
- the bindings map keys must match the target program's `be input ya` handles,
- the result map should expose the child `produce`, child `kind`, child `run id`, child `artifacts folder`, and child `result file`,
- checkpoint replay must preserve the typed result payload for refinery results, including `map` and `series` outputs,
- child artifacts should nest under the parent run id when a parent run id exists.

Dependency encoding rule:
- use `from name <dep>` when exactly one dependency is referenced,
- use `from ve name <dep1> name <dep2> ...` when multiple dependencies are referenced.
- an explicit empty `from ve name` is a root with no dependencies,
- when `from` is omitted, the platform retains the implicit dependency on the preceding platform.

## 3.1 Deterministic concurrency simulation v0.1

Simulation is activated only by an existing refinery invocation with a conduct
association:

```pyash
from name <refinery> to name text <result> under name <conduct> be refinery do
```

The conduct is a source-local Pyash map. Its bounded contract is:

```pyash
su name <conduct> be map def
su name artificial ob bool truth ya
su name seed ob num <0..4294967295> ya
su name start tick ob num <nonnegative integer> ya
su name parallel capacity ob num <positive integer> ya
su name waiting capacity ob num <nonnegative integer> ya
su name schedule newspaper ob bool <truth|lie> ya
prah
```

`artificial`, `seed`, `start tick`, `parallel capacity`, and `waiting capacity`
are required when artificial mode is truth. `schedule newspaper` is optional and
defaults to lie. Any missing, non-boolean, non-integer, negative, out-of-range,
or zero parallel capacity value is one canonical
`artificial conduct defective` error; values are never coerced.

On a platform, `during num N` is its positive unsigned-32-bit simulated duration
in ticks. Optional `atmost num N` is a positive unsigned-32-bit platform-relative
simulated timebox. A completion at exactly
the deadline succeeds; only a completion after the deadline times out.

Artificial platform bodies are never invoked. Real refinery execution remains
sequential and simulation metadata does not alter real platform semantics.

The simulation uses unsigned 32-bit FNV-1a over the UTF-8 platform name, XORs
the result with the unsigned seed, and applies one xorshift32 round (`13`, `17`,
`5`). Scheduling ties sort by that rank and then by UTF-8 platform name. At each
virtual tick the kernel processes successful completions, expirations, dependent
cancellation, waiting promotion, new admission, and starts, in that order. It
jumps directly to the next completion or deadline and never sleeps. Idle active
slots are filled before the bounded waiting queue. Excess eligible platforms
remain pending and receive one denied-admission record.

The exact ordered concurrency records are:

```pyash
su name <platform> from name <refinery> during num <tick> by num <ordinal> be schedule admission ya
su name <platform> from name <refinery> during num <tick> by num <ordinal> be schedule start ya
su name <platform> from name <refinery> during num <tick> by num <ordinal> be schedule finish ya
su name <platform> ob text "schedule crowded" from name <refinery> during num <tick> by num <ordinal> be schedule crowded ya
su name <platform> ob text "platform timebox" from name <refinery> during num <tick> by num <ordinal> be error ya
su name <platform> ob text "platform cancel" from name <refinery> during num <tick> by num <ordinal> be error ya
```

The `during` field is the virtual tick, and `by num` is a monotonically
increasing decision ordinal. Schedule records (admission, start, finish, and
crowded) are emitted only when `schedule newspaper` is truth. Timebox and
dependent-cancellation fault sentences are always surfaced. Cancellation faults
at one tick are ordered by UTF-8 platform name. Zero-capacity and no-progress
states use the same canonical `artificial conduct defective` error instead of
looping.

## 4. Re-entry loop requirements

Review/coding loops must declare:
- explicit stop condition,
- bounded attempt count,
- recorded pass/fail decision.

## 5. Scheduling integration

Refineries may be triggered by calendar/scheduler services; scheduler control lives in agent/world specs.

## 6. Comparison refinery module profile (normative)

`be better compare do` is a pairwise comparison loop profile for module-driven candidate selection.
Use the dedicated reference profile for full input/flow/judge/observability contract.

## 7. Conformance

Implementation conforms when refinery execution + retry/stop logic are deterministic and observable.

For the pairwise profile (see reference), conformance additionally requires:
- required `from la ... ko` embedded manuscript invocation input shape,
- required clause-mode `evoke` generation with explicit `to` override for `A`/`B`,
- deterministic winner normalization,
- bounded termination via required `atmost` (canonical `atmost num 6`),
- exact `A`-wins-twice stop behavior.

For the chirp profile (see reference), conformance additionally requires:
- exactly one valid source mode (`ob text`, `from name text`, or `from filename`),
- staged atom and draft order (`problem -> hidden cause -> insight`, plus optional `proof hook` and `boundary`) with dependency-correct prompts,
- mandatory per-stage word-count + letter-count verification,
- stage-local bounded retries (no full-refinery retry for single-stage failures),
- final assembled output within total word/char target bounds or deterministic failure.

## 8. References

- Better compare refinery profile (reference): `documentation/reference/better-compare-refinery.md`
- Chirp refinery profile (reference): `documentation/reference/chirp-refinery.md`
- Brief manuscript refinery profile (reference): `documentation/reference/brief-manuscript-refinery.md`
- Verify count modes profile (reference): `documentation/reference/verify-count-modes.md`
- Full details: `documentation/recipes/spec-archive/10-pipelines.full.md`
- LLM generation recipe: `documentation/recipes/refinery-planning-llm.md`
