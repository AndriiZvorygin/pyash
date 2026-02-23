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
| `be chirp do` | short-reply refinery loop | hook/value/question tweet composition |
| `be reiterate ya` | retry marker | bounded retry reporting |
| `be checkpoint ya` | checkpoint marker | deterministic reuse/trace |

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

Dependency encoding rule:
- use `from name <dep>` when exactly one dependency is referenced,
- use `from ve name <dep1> name <dep2> ...` when multiple dependencies are referenced.

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
- staged generation order (`hook -> value -> question`) with dependency-correct prompts,
- mandatory per-stage word-count verification plus recorded char-bound checks,
- stage-local bounded retries (no full-refinery retry for single-stage failures),
- final assembled output within total word/char target bounds or deterministic failure.

## 8. References

- Better compare refinery profile (reference): `documentation/reference/better-compare-refinery.md`
- Chirp refinery profile (reference): `documentation/reference/chirp-refinery.md`
- Brief manuscript refinery profile (reference): `documentation/reference/brief-manuscript-refinery.md`
- Full details: `documentation/recipes/spec-archive/10-pipelines.full.md`
- LLM generation recipe: `documentation/recipes/refinery-planning-llm.md`
