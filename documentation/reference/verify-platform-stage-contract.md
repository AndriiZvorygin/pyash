# Verify Platform Stage Contract (Reference)

Status: reusable reference profile for scaling generator+verifier stage wiring across manuscript refineries.

## 1. Purpose

Define one stable stage contract so new refiners do not re-invent retry/verifier plumbing.

This profile is a vocabulary layer over `be verify platform do`, not a new runtime primitive.

## 2. Canonical stage fields

- `professor`: generator platform for candidate text.
- `verifiers`: ordered verifier selector (series or inline names).
- `probes`: deterministic checks series (`word_min`, `word_max`, `sentence_complete`, regex checks, etc.).
- `duty`: first-pass task packet text.
- `repair_duty` (optional): retry rewrite packet text used after a failed attempt.
- `retry_min` / `retry_max`: retry bounds.
- `score_min` / `score_max`: score threshold bounds.

## 3. Field semantics

### 3.1 `duty`

Use for initial generation.
Typical contents:
- role/job statement,
- target band,
- source context,
- required constraints,
- format requirements.

### 3.2 `repair_duty`

Use only on retry attempts.
It should be narrower than `duty` and focus on repair, not full regeneration.

Typical contents:
- preserve: role + core claims,
- adjust: count/shape issues from probes,
- include: verifier feedback summary,
- forbid: unrelated new claims/expansion.

Good pattern:
- if giant: cut repetition/examples first,
- if tiny: add one clarifying line without changing claims,
- preserve sentence voice and stage function.

### 3.3 `probes`

Probes are deterministic and should guard structural constraints before expensive verifier disagreement loops.
Use probes for:
- word bands,
- sentence completeness,
- regex must/must-not constraints,
- deterministic anti-duplication checks.

### 3.4 `verifiers`

Verifiers judge semantic/role fitness.
Keep verifier count minimal and purpose-specific.
Use clear pass conditions and avoid perfectionist fail criteria.

## 4. Canonical execution idiom

First-pass:

```pyash
ob text <duty>
for name <professor>
among name <verifiers>
accordingto name <probes>
atleast num <score_min>
atmost num <score_max>
fromindex num <retry_min>
toindex num <retry_max>
to name text output
be verify platform do
```

Retry pass (when custom wrapper controls retries):
- prefer `repair_duty` once a failed candidate exists,
- keep the same `professor`, `verifiers`, and `probes`,
- keep retry bounds explicit and bounded.

## 5. Manuscript scaling guidance

For manuscript stages (hook/promise/roadmap/segments/recap/cta):
- keep one stage contract shape for all stages,
- vary only `duty`, `repair_duty`, and `probes` per stage,
- avoid stage-specific ad hoc pass flags before platform/verifier checks complete,
- keep deterministic probes aligned with final guarantees to prevent late contradictory failures.

## 6. Conformance checklist

A stage contract implementation is healthy when:
- first pass and retry both route through `verify platform`,
- deterministic probes are active in the loop, not only final gates,
- retries are bounded and observable (`attempts used`, stop reason),
- final accepted candidate is always the latest passing attempt.
