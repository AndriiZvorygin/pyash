# Repository Guidelines

This guide keeps contributions consistent for the Pyash codebase.

## Project Structure & Module Organization
- `program/main.mjs` runs the REPL and wires the parser (`program/understand/`), bridge (`program/bridge/`), and memory helpers (`program/remember/`).
- Interpreter behaviors live in `program/bridge/`, `program/program.mjs`, and `program/verbs/` (one verb per file, small and composable).
- Dispatch is signature-first: built-in verb signatures register via `program/verbs/index.mjs`, ceremonies register their signatures on `def`, and `program/bridge/signature.mjs` hosts the registry/lookups.
- Output formatting sits in `program/beautiful.mjs`; Ollama network I/O is in `program/motor/ollama.mjs`.
- Quizzes are under `quiz/*.test.mjs`; keep helpers near the code they cover.
- Docs: `documentation/pyac.txt` (broader spec), `documentation/pyash.md` (design goals), `documentation/compositional-cases.md` (case grid). `program/configure/workplace.json` is example data/config; keep secrets out of the repo.
- Ceremonies (`def...prah`) have speakable, multi-word names; bodies run in sandpits during invocation, and `this`/`ret` flow updates the caller’s evoke/targets and records sandpit traces.

## Build, Quiz, and Development Commands
- `npm test` (or `node --test quiz`) runs the full suite; run it before pushing.
- `npm test` is pre-approved; no extra confirmation is needed to run it.
- `node --test quiz/core.test.mjs` runs a targeted file while iterating.
- `node program/main.mjs` starts the REPL to exercise new verbs interactively.
- `node program/command/read_pya_trace.mjs path/to/file.pya` interprets Pyash text and dumps `{ memory, sandpits }` for inspection.
- Use a Node version with native ESM and the built-in test runner; no extra deps.

## Coding Style & Naming Conventions
- ESM modules, 2-space indentation, trailing semicolons, and double quotes for strings.
- Functions/vars use `camelCase`; files and verb modules use short, descriptive snake/dash names (e.g., `add_obj_num_to_num.mjs`).
- Favor small, pure functions; reset shared state explicitly (e.g., `forget`) and keep side effects localized.
- Add brief, targeted comments only where behavior is non-obvious.
- Keywordized compositional roles: use axis/context keywords (e.g., `fromtext`, `during`, `as`, `become`, `totext`) rather than storing raw contexts.

## Quiz Guidelines
- Add quizzes for every new code path; mirror real REPL usage strings where possible.
- Follow `node:test` with `assert/strict` (see `quiz/core.test.mjs`).
- Name quizzes with readable sentences; reset memory between cases to avoid coupling.
- Cover at least one happy path and one edge/guard path for each new verb or interpreter change.
- Work red→green: write a failing quiz first, then implement the smallest change to make it pass, and keep runs fast.
- Keep imperatives recording both the command and a result fact; update quizzes when adding verbs that should emit structured outputs.

## Commit & Pull Request Guidelines
- Commits are short, imperative, and lower case (e.g., `added pretty printing tests`). Group related changes and avoid noise commits.
- Make a git commit after every major change so history stays reviewable.
- PRs should describe behavior changes, list new verbs/grammar, and link issues. Include proof (screenshots/logs/transcripts) for REPL-facing changes.
- Mention added tests and any known gaps. Call out external needs (e.g., Ollama server availability) so reviewers can reproduce.
- When adding runnable examples, keep outputs in git-ignored locations (e.g., `examples/out/`) and commit the sources plus tests/docs together.

## Scope Discipline
- Only do the work explicitly requested by the user; avoid expanding scope or tackling adjacent tasks unless asked.
- If a needed prerequisite is discovered, pause and confirm before proceeding beyond the requested scope.
- Keep changes tightly focused to what was asked; defer opportunistic refactors/cleanup unless explicitly approved.

## Security & Configuration Tips
- `motor/ollama.mjs` calls an Ollama HTTP server (configured via `OLLAMA_HOST`, default `http://localhost:11434`); ensure the server is reachable.
- Never commit secrets or personal data; prefer env vars or local, git-ignored config.
