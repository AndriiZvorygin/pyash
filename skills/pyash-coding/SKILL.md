---
name: pyash-coding
description: Write, read, and refactor Pyash code in the pyash repo. Use when editing Pyash sentences, adding quizzes/examples, or updating the interpreter/compiler; follow local grammar/casing rules and run the interpreter or tests.
---

## Workflow

1) Scan local guidance and examples
- Read `AGENTS.md` first.
- Skim `documentation/pyash.md`, `documentation/pyac.txt`, `documentation/compositional-cases.md`, `documentation/map.md`, `documentation/usage.md`.
- Review relevant examples under `examples/pyash/`.

2) Follow Pyash grammar and casing
- Use ESM, 2-space indent, double quotes, trailing semicolons in JS.
- Keep Pyash sentences lowercase keywords; keep existing naming/casing for user-defined names.
- Respect compositional cases and genitive rules (of/ti).

3) Validate behavior
- Prefer `node --test quiz/...` for targeted changes.
- If needed, use `./interpret` or `./run` to exercise examples.
- When unsure, add a small runnable `.pya` example and a minimal quiz in `quiz/`.

4) Keep diffs small and focused
- Limit changes to the specific behavior requested.
- Use `apply_patch` for single-file edits when possible.

5) Explain changes briefly
- Summarize the behavior change and point to the exact files.

## Commands

- Run all tests: `npm test`
- Run a single quiz: `node --test quiz/<file>.test.mjs`
- Run REPL: `./interpret`
- Run a program: `./run <path/to/file.pya>`
- Compile a file: `./compile from filename <path> become javascript`

## When uncertain

- Create a minimal example under `examples/pyash/` and a matching quiz under `quiz/`.
- Keep the example runnable via `./run` or `./compile` (as appropriate).
