# Better Compare Refinery Profile

Status: reference profile for module-level `be better compare do` behavior.

## 1. Purpose

`be better compare do` compares two generated candidates (`A`, `B`) with a judge prompt and returns the better manuscript candidate under bounded rounds.

## 2. Module status

- `better compare` is a Pyash module export (not a built-in verb).
- programs should import it before invocation.

## 3. Canonical invocation

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

## 4. Inputs

- `from la <generator invocation clause> ko`: required callable sentence template whose embedded verb is manuscript generation (for example `be brief manuscript do`).
- `ob text <judge prompt>`: required comparison rubric for judge decision.
- `to name text <winner output>`: required final winner output slot.
- `atmost num <round cap>`: required round cap (canonical profile value `6`).
- generator arguments are carried inside the embedded invocation clause.
- generator output routing should use clause-mode `be evoke do` with explicit `to` override for each candidate target.

## 5. State model

- `A`: incumbent candidate.
- `B`: challenger candidate.
- `num a streak`: consecutive wins by `A`.

## 6. Normative flow

1. generate initial `A` via clause-mode `be evoke do` with `to name text <A target>`.
2. generate `B` via clause-mode `be evoke do` with `to name text <B target>`.
3. judge compares `A` vs `B` using `ob text <judge prompt>` and returns `A` or `B`.
4. if winner is `B`: set `A <- B`, reset `num a streak <- 0`, generate new `B`, continue.
5. if winner is `A`: increment `num a streak`.
6. stop and return `A` when `num a streak` reaches `2`.
7. if round cap is reached first, return current `A`.

## 7. Judge contract

- judge output must normalize to strict binary decision: `A` or `B`.
- ambiguous judge output should map to deterministic failure behavior (or declared fallback policy).

## 8. Observability

- each generation and each judge decision should be recorded as refinery stages.
- transitions (`A <- B`) and streak updates should be traceable in run artifacts/newspaper.
