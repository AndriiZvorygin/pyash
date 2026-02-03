---
name: pyash-quiz-authoring
description: "Add or update Pyash quizzes/tests; use when creating new tests, fixtures, or adjusting test harness helpers."
---

# Pyash Quiz Authoring

Use this skill when adding or updating tests in `quiz/`.

## Patterns

- Use `node:test` + `assert/strict`.
- Reset memory between cases (e.g., `forget()`).
- Mirror REPL usage strings where possible.
- Cover at least one happy path and one edge/guard path per change.

## Harness helpers

- Script runner helper: `quiz/helpers/run_script.mjs`
- Prefer targeted runs: `node --test quiz/<file>.test.mjs`

## Common fixtures

- `examples/pyash/*.pya` for runnable flows.
- `quiz/fixtures/` for static inputs.
