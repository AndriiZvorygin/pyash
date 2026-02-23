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

This profile defines a module verb (`better compare`) that compares two generated candidates (`A`, `B`) using a judge prompt.

Module status:
- `better compare` is a Pyash module export (not a built-in verb).
- programs MUST import it before invocation.

Canonical invocation shape:

```pyash
su name winner stage
  from la
    ob text of name manuscript source
  be brief manuscript do ko
  ob text "choose the better manuscript by hook, clarity, and source faithfulness"
  to name text manuscript winner
  atmost num 6
be better compare do
```

Inputs:
- `from la <generator invocation clause> ko`: required. callable sentence template whose embedded verb is manuscript generation (for example `be brief manuscript do`).
- `ob text <judge prompt>`: required. comparison rubric used by the judge model.
- `to name text <winner output>`: required. winning candidate output slot.
- `atmost num <round cap>`: required. round cap; canonical value for this profile is `6`.
- generator arguments: passed inside the embedded clause (for example `fromtext`, `fromfilename`, `ob`, or source facts).
- generator output routing: module MUST execute the clause through clause-mode `evoke` and set explicit per-run destinations (`A`, `B`) via `to ...` override.

State:
- `A`: incumbent candidate.
- `B`: challenger candidate.
- `num a streak`: consecutive wins by `A`.

Normative flow:
1. Generate initial `A` by invoking clause-mode `be evoke do` against the embedded clause with `to name text <A target>`.
2. Generate `B` by invoking clause-mode `be evoke do` against the same clause with `to name text <B target>`.
3. Judge compares `A` and `B` using `ob text <judge prompt>` and returns winner `A` or `B`.
4. If winner is `B`: set `A <- B`, reset `num a streak <- 0`, generate a new `B` via clause-mode `evoke`, continue.
5. If winner is `A`: increment `num a streak`.
6. If `num a streak` reaches `2`, return current `A` as final output.
7. If `round cap` is reached first (canonical `6`), return current `A` as final output.

Judge contract:
- judge output MUST be normalized to a strict binary decision (`A` or `B`).
- ambiguous judge outputs MUST be treated as a deterministic failure path (or mapped by a declared fallback policy).

Observability:
- each generation and each judge decision MUST be recorded as refinery stages.
- winner transitions (`A <- B`) and streak count updates MUST be traceable in run artifacts/newspaper.

## 7. Conformance

Implementation conforms when refinery execution + retry/stop logic are deterministic and observable.

For the pairwise profile, conformance additionally requires:
- required `from la ... ko` embedded manuscript invocation input shape,
- required clause-mode `evoke` generation with explicit `to` override for `A`/`B`,
- deterministic winner normalization,
- bounded termination via required `atmost` (canonical `atmost num 6`),
- exact `A`-wins-twice stop behavior.

## 8. References

- Full details: `documentation/recipes/spec-archive/10-pipelines.full.md`
- LLM generation recipe: `documentation/recipes/refinery-planning-llm.md`
