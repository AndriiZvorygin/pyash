# Chirp Refinery Profile

Status: reference profile for module-level `be chirp do` behavior.

## 1. Purpose

`be chirp do` produces a short, reply-ready social post in three staged parts:
- hook,
- value,
- question.

The profile is optimized for concise high-engagement replies with deterministic verification and retries.

## 2. Canonical invocation

```pyash
su name chirp stage
  ob text "original tweet text"
  to name text chirp out
be chirp do
```

Source input modes:
- `ob text <tweet source>` (literal input),
- `from name text <tweet source>` (remembered text),
- `from filename <tweet source file>` (file text source).

Exactly one source mode should be present per run.

## 3. Section targets

| Section | Word target | Character target (including spaces) | Goal |
| --- | --- | --- | --- |
| Hook (line 1) | 4-8 words | 15-45 chars | stop-scroll opening in <2 seconds |
| Value (line 2, or 1-2 short lines) | 12-35 words | 60-110 chars | one punchy insight |
| Question (last line) | 5-12 words | 25-55 chars | force a reply |
| Final total | 21-55 words | 100-180 chars | engagement sweet spot |

## 4. Stage prompts (starter wording)

Hook stage:
- write one bold opening line (max 8 words) as a reply to source tweet,
- choose one angle: strong agreement, contrarian twist, or direct question,
- output only hook line.

Value stage:
- add one value line tied to `hook + source`,
- include fresh insight, data, personal example, or missing angle,
- output only value line.

Question stage:
- add one targeted open-ended question tied to full draft,
- output only question line.

## 5. Normative flow

1. resolve source tweet text from selected source mode.
2. generate hook line.
3. verify hook bounds, then retry only hook stage if needed.
4. generate value line from `hook + source`.
5. verify value bounds, then retry only value stage if needed.
6. generate question line from `hook + value + source`.
7. verify question bounds, then retry only question stage if needed.
8. assemble final output with hook/value/question line order.
9. verify final total bounds; on repeated failure, return deterministic error.

## 6. Verification and retries

Word-count checks:
- use `be verify as wo word count ...`,
- record result maps through `to name map ...`.

Character-count checks:
- enforce deterministic per-section char bounds in-module (or helper stage),
- record pass/fail flags used by retry conditions.

Retry scope:
- retries are stage-local (`hook`, `value`, `question`),
- do not rerun full refinery for a single section failure,
- recommended cap: `atmost num 3` per section unless caller sets stricter cap.

## 7. Output contract

- `to name text <chirp out>` is required.
- output is plain text only:
  - no markdown,
  - no bullets,
  - no labels,
  - no surrounding quotes.

## 8. Runtime surface note

- Runtime supports `be verify as wo word count` for literal text, remembered text, and filename-backed text.
- If a first-class character-count verifier is unavailable, module helper logic can enforce chars while keeping recorded pass/fail facts deterministic.
