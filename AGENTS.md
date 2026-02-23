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
- `node command/read_pya_trace.mjs path/to/file.pya` interprets Pyash text and dumps `{ memory, sandpits }` for inspection.
- `node command/vocab_suggest.mjs examples/pyash` checks files for non-Pyash vocabulary and suggests replacements; `node command/vocab_suggest.mjs "word"` checks a proposed token without scanning files.
- Use a Node version with native ESM and the built-in test runner; no extra deps.

## Coding Style & Naming Conventions
- ESM modules, 2-space indentation, trailing semicolons, and double quotes for strings.
- Functions/vars use `camelCase`; files and verb modules use short, descriptive snake/dash names (e.g., `add_obj_num_to_num.mjs`).
- Favor small, pure functions; reset shared state explicitly (e.g., `forget`) and keep side effects localized.
- Keep things DRY: prefer composing or reusing helpers over copy-paste variants.
- Add brief, targeted comments only where behavior is non-obvious.
- Keywordized compositional roles: use axis/context keywords (e.g., `fromtext`, `during`, `as`, `become`, `totext`) rather than storing raw contexts.
- Run `vocab_suggest` for new Pyash sentence words (names, error names, verbs); quoted prompt text does not need Pyash vocabulary.
- `vocab_suggest` applies to Pyash tokens (verbs/names/signatures/error names) and **not** to content inside quoted text.
- Always run new or modified examples (in `examples/`) to confirm they work before asking the user to run them.

## Quiz Guidelines
- Add quizzes for every new code path; mirror real REPL usage strings where possible.
- Follow `node:test` with `assert/strict` (see `quiz/core.test.mjs`).
- Name quizzes with readable sentences; reset memory between cases to avoid coupling.
- Cover at least one happy path and one edge/guard path for each new verb or interpreter change.
- Work red→green: write a failing quiz first, then implement the smallest change to make it pass, and keep runs fast.
- Keep imperatives recording both the command and a result fact; update quizzes when adding verbs that should emit structured outputs.
- Do not consider a change complete until it has run at least one real test without fixtures (no `PYA_MIND_RESPONSE`, no test-only backends).
- For end-to-end debugging and examples, explicitly unset fixture env vars (`PYA_MIND_RESPONSE`, `PYA_HEAR_FIXTURE`, `PYA_PIPER_FIXTURE`, etc.) and verify real backend outputs/metadata.

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
- When the user points to a proven example/refinery as the source of truth, port that flow directly first and only apply explicit deltas; do not re-implement from scratch unless the user asks for redesign.
- Prefer lean modular designs over compatibility layers: remove obsolete paths instead of stacking legacy flags, aliases, or fallback branches unless the user explicitly asks for backward compatibility.
- Keep defaults scoped by stability: put universal, environment-level defaults in `configure/default.pya`; keep example/run-specific filenames, prefixes, and paths in the example `.pya` files.
- If intent, spec mapping, or expected behavior is unclear, stop and ask a targeted clarification question before coding; do not assume and proceed on uncertain interpretations.

## Spec Discipline
- Implement behavior from specification first; do not ship ad hoc heuristics as permanent fixes.
- If runtime behavior diverges from spec, fix the source contract (signatures/defaults/data flow) instead of adding wildcard matching or hidden fallback paths.
- Keep one canonical default per behavior (for example shared prefixes or output handles) so producer/consumer stages stay deterministic.
- When a quick mitigation is used during debugging, replace it with a spec-aligned implementation before considering the task complete.

## Skills Discipline
- Check the `skills/` folder for relevant skills before starting a task.
- If a skill applies, follow it and update the skill when you learn new, reusable information while working.
- Create a new skill (under `skills/`) when a task required more than one attempt or uncovered a repeatable workflow.

## Security & Configuration Tips
- `motor/ollama.mjs` calls an Ollama HTTP server (configured via `OLLAMA_HOST`, default `http://localhost:11434`); ensure the server is reachable.
- Never commit secrets or personal data; prefer env vars or local, git-ignored config.
- Do not introduce ad hoc `.json` state/config files. Prefer Pyash sentence files (`.pya`) unless a task explicitly requires JSON output.
