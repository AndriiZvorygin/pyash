# Chirp Refinery Profile

Status: reference profile for chirp refinery/example behavior and future module-level `be chirp do` behavior.

## 1. Purpose

`be chirp do` produces a short, source-grounded social post in three staged parts:
- hook,
- value,
- question.

The profile is optimized for concise high-engagement posts with deterministic verification and retries.

## 2. Canonical invocation

```pyash
su name chirp stage
  ob text "original source text"
  to name text chirp out
be chirp do
```

Source input modes:
- `ob text <source text>` (literal input),
- `from name text <source text>` (remembered text),
- `from filename <source text file>` (file text source).

Exactly one source mode should be present per run.

## 3. Section targets

| Section | Word target | Character target (including spaces) | Goal |
| --- | --- | --- | --- |
| Hook (line 1) | 4-9 words | 18-55 chars | stop-scroll opening in <2 seconds |
| Value (line 2) | 8-28 words | 45-150 chars | one punchy source-grounded insight |
| Question (last line) | 5-16 words | 25-95 chars | force a reply |
| Final total | 16-48 words | 100-280 chars | short-form engagement sweet spot |

## 4. Stage prompts (starter wording)

Hook stage:
- write one bold opening line grounded in the source,
- favor a twist, warning, or surprising framing,
- output only hook line.

Value stage:
- add one value line tied to `hook + source`,
- include one punchy insight or compression from the source,
- avoid unsupported concrete facts or downstream mechanisms,
- output only value line.

Question stage:
- add one targeted open-ended question tied to the full draft,
- keep the wording visibly anchored to the source theme or core stake,
- output only question line.

## 5. Normative flow

1. resolve source text from selected source mode.
2. generate hook line.
3. verify hook bounds, then retry only hook stage if needed.
4. generate value line from `hook + source`.
5. verify value bounds, then retry only value stage if needed.
6. generate question line from `hook + value + source`.
7. verify question bounds, then retry only question stage if needed.
8. assemble final output with hook/value/question line order.
9. verify final total bounds.
10. run one full-draft source-thrust verification against the assembled chirp.
11. write the final result to `artifacts/<run id>/produce.txt`.
12. when the source filename comes from `know/input/...`, runner also mirrors the final text to `know/produce/...` with the same stem.

## 6. Verification and retries

Word-count checks:
- use `be verify as wo word count ...`,
- record result maps through `to name map ...`.

Character-count checks:
- use `be verify as wo letter count ...`,
- record result maps through `to name map ...`.

Retry scope:
- retries are stage-local (`hook`, `value`, `question`),
- do not rerun full refinery for a single section failure,
- full-draft source-thrust verification happens after section generation,
- recommended cap: `atmost num 3` per section unless caller sets stricter cap.

## 7. Output contract

- `to name text <chirp out>` is required.
- output is plain text only:
  - no markdown,
  - no bullets,
  - no labels,
  - no surrounding quotes.
- example runs also write `produce.txt` into the per-run artifact directory.
- when invoked with a `know/input/...` source filename, runner additionally writes a mirrored text file under `know/produce/...` and adds `-02`, `-03`, ... on collisions.

## 8. Runtime surface note

- Runtime supports both `be verify as wo word count` and `be verify as wo letter count` for literal text, remembered text, and filename-backed text.
- `letter count` includes spaces and line breaks (code-point count).
