# Repository Guidelines

This guide keeps contributions consistent for the Pyash codebase.

## Project Structure & Module Organization
- `main.mjs` runs the REPL and wires the parser (`parser.mjs`), dispatcher (`dispatcher.mjs`), and memory helpers (`memory.mjs`).
- Interpreter behaviors live in `dispatcher.mjs`, `program.mjs`, and `verbs/` (one verb per file, small and composable).
- Output formatting sits in `pretty.mjs`; Ollama network I/O is in `motor/ollama.mjs`.
- Tests are under `test/*.test.mjs`; keep helpers near the code they cover.
- Docs: `documentation/pyac.txt` (broader spec), `documentation/pyash.md` (design goals), `documentation/compositional-cases.md` (case grid). `workplace.json` is example data/config; keep secrets out of the repo.
- Ceremonies (`def...prah`) have speakable, multi-word names; bodies run in sandpits during invocation, and `this`/`ret` flow updates the caller’s evoke/targets and records sandpit traces.

## Build, Test, and Development Commands
- `npm test` (or `node --test`) runs the full suite; run it before pushing.
- `node test/core.test.mjs` runs a targeted file while iterating.
- `node main.mjs` starts the REPL to exercise new verbs interactively.
- `node scripts/read_pya_trace.mjs path/to/file.pya` interprets Pyash text and dumps `{ memory, sandpits }` for inspection.
- Use a Node version with native ESM and the built-in test runner; no extra deps.

## Coding Style & Naming Conventions
- ESM modules, 2-space indentation, trailing semicolons, and double quotes for strings.
- Functions/vars use `camelCase`; files and verb modules use short, descriptive snake/dash names (e.g., `add_obj_num_to_num.mjs`).
- Favor small, pure functions; reset shared state explicitly (e.g., `resetMemory`) and keep side effects localized.
- Add brief, targeted comments only where behavior is non-obvious.
- Keywordized compositional roles: use axis/context keywords (e.g., `fromtext`, `during`, `as`, `become`, `totext`) rather than storing raw contexts.

## Testing Guidelines
- Add tests for every new code path; mirror real REPL usage strings where possible.
- Follow `node:test` with `assert/strict` (see `test/core.test.mjs`).
- Name tests with readable sentences; reset memory between cases to avoid coupling.
- Cover at least one happy path and one edge/guard path for each new verb or interpreter change.
- Work red→green: write a failing test first, then implement the smallest change to make it pass, and keep tests fast.
- Keep imperatives recording both the command and a result fact; update tests when adding verbs that should emit structured outputs.

## Commit & Pull Request Guidelines
- Commits are short, imperative, and lower case (e.g., `added pretty printing tests`). Group related changes and avoid noise commits.
- PRs should describe behavior changes, list new verbs/grammar, and link issues. Include proof (screenshots/logs/transcripts) for REPL-facing changes.
- Mention added tests and any known gaps. Call out external needs (e.g., Ollama server availability) so reviewers can reproduce.

## Security & Configuration Tips
- `motor/ollama.mjs` calls an Ollama HTTP server (configured via `OLLAMA_HOST`, default `http://localhost:11434`); ensure the server is reachable.
- Never commit secrets or personal data; prefer env vars or local, git-ignored config.
