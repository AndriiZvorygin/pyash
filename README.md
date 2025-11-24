# Pyash

Pyash is a tiny experimental language built as an interlanguage between humans and machines. Sentences use a compact subject–object–verb style (e.g., `su collector obj num 7 be number ya`), and verbs like `add`, `giant`/`tiny`/`equally` (conditionals), `compile`, `mind`, and `read` drive behavior. The runtime is native ESM, uses the built-in `node:test` runner, and implements a small, quiz-driven slice of the broader language in `documentation/pyac.txt`.

## Requirements
- Node 20+ (ESM + built-in test runner)
- Optional: reachable Ollama HTTP server for `mind` (`OLLAMA_HOST`, default `http://localhost:11434`).

## Install & Quizzes
```bash
npm test          # runs the full quiz suite via node --test
npm run quiz      # same as above, explicitly scoped to quiz/
node --test quiz  # direct invoke
```

## Running the REPL
```bash
node program/main.mjs
```
Commands: `mem` (dump memory), `reset` (clear), `quit` (exit), `paste` (multi-line). Enter Pyash sentences to evaluate them; verbs/ceremony names stay speakable (e.g., `be add two do`). Ceremonies run in a sandpit and return an updated evoke (optionally via `ret`). Conditionals use `then` with `giant`/`tiny`/`equally`, e.g., `obj num 3 be tiny from num 5 then`.

## Example Sentences
- Declarative: `su collector obj num 7 be number ya`
- Imperative (add): `obj num 3 to num 4 be add do` → stores command + result fact (`num 7`)
- Query: `su collector obj what que`
- Read file: `su file be read from filename "quiz/sandpit/compile.txt" do`
- Compile text → JSON: see `documentation/reference.md` end-to-end example
- Ceremony with return: see `examples/core/evoke-ret.md` for `this` binding + `ret` back to the evoke sentence.
- Loops: seed `tloh` (and optional `until`) on the evoking sentence to repeat a ceremony; supervisor moves `tloh` toward `until` and stops on equality (no standalone register facts are written).

## Key Files
- `program/main.mjs` — REPL wiring parser/dispatcher/memory
- `program/parser/` — tokenization, quoting, compositional keyword mapping (`fromtext/during/become/totext/as`, etc.)
- `program/bridge/` — verb dispatch, mood handling (`ya/def/do/que/then/ret`), stores commands + result facts; executes ceremonies in a sandpit context and merges returned evoke/target updates (speakable multi-word verbs).
- `program/beautiful.mjs` — output formatting
- `program/verbs/` — verb implementations (`add`, `giant`, `tiny`, `equally`, `compile`, `mind`, `read`, etc.) and dynamic handlers
- `program/library/compositionalCases.mjs` — axis/context grid and keyword table
- `quiz/` — node:test quizzes (core, parser, compositional, mind, compile/read, beautiful, motor)
- `program/command/read_pya_trace.mjs` — interpret a `.pya` file and dump `{ memory, sandpits }` for inspection (beautiful by default; `--gross` for JSON).
- `program/command/run_pya_program.mjs` — run a `.pya` program and print `Outputs` (from `que`) and final `result` (`--full` to show program; `--gross` for JSON).

See `documentation/index.md` for deeper guidance and links to design, state, and glossary notes. Examples live in `examples/` (conditionals, subtract, chaining, registers).
