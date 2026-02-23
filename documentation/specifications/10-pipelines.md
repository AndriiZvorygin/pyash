# 10. Pipelines

Purpose: define refinery declarations, stage execution semantics, and deterministic re-entry loops.

## 1. Pipeline keyword table

| Keyword | Meaning | Application |
| --- | --- | --- |
| `be refinery def ... prah` | refinery declaration block | define staged workflow |
| `su name <stage>` | stage identifier | unique stage node |
| `from name ...` | single dependency link | explicit prior-stage requirement |
| `from ve name ...` | multi-dependency link | explicit prior-stage requirements |
| `be refinery do` | execute refinery | run declared pipeline |
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

## 6. Conformance

Implementation conforms when refinery execution + retry/stop logic are deterministic and observable.

## 7. References

- Full details: `documentation/recipes/spec-archive/10-pipelines.full.md`
- LLM generation recipe: `documentation/recipes/refinery-planning-llm.md`
