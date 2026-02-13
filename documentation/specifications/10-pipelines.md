# 10. Pipelines

Purpose: define refinery/pipeline declaration, scheduling hooks, and deterministic re-entry loops.

## 1. Core abstractions

- refinery declaration
- stage series
- retry/reiterate policy
- checkpoints
- report extraction

## 2. Global invariants

- deterministic stage ordering
- explicit failure/success paths
- sentence-shaped stage IO
- replay visibility through run records

## 3. Refinery declaration

Refinery definitions must declare stage list and target behavior explicitly.

Execution must not depend on hidden implicit stage injection.

## 4. Error and success handling

Pipelines should support explicit failure sieve and success sieve patterns.

Retry behavior must be bounded and deterministic.

## 5. Re-entry loop profile

Re-entry/coding-review loops are allowed when:
- stop conditions are explicit
- attempt counts are bounded
- pass/fail decision is recorded

## 6. Scheduling integration

Pipelines may be invoked by scheduler/calendar entries; scheduler semantics are specified in agent chapter.

## 7. Conformance

Implementation conforms when refinery execution, retry rules, and loop stop conditions are deterministic and observable.

## 8. Full draft reference

Detailed stage examples and loop prompts are preserved at:
`documentation/recipes/spec-archive/10-pipelines.full.md`
