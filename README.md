# Pyash

Pyash is a tiny experimental language built as an interlanguage between humans and machines. Sentences use a compact subject–object–verb style (e.g., `su collector obj num 7 be number ya`), and verbs like `add`, `giant`, `compile`, `mind`, and `read` drive behavior. The runtime is native ESM, uses the built-in `node:test` runner, and implements a small, test-driven slice of the broader language in `documentation/pyac.txt`.

## Requirements
- Node 20+ (ESM + built-in test runner)
- Optional: reachable Ollama HTTP server for `mind` (`OLLAMA_HOST`, default `http://localhost:11434`).

## Install & Test
```bash
npm test      # runs the full suite via node --test
node --test   # equivalent direct invoke
```

## Running the REPL
```bash
node main.mjs
```
Commands: `mem` (dump memory), `reset` (clear), `quit` (exit), `paste` (multi-line). Enter Pyash sentences to evaluate them; verbs/ceremony names stay speakable (e.g., `be add two do`).

## Example Sentences
- Declarative: `su collector obj num 7 be number ya`
- Imperative (add): `obj num 3 to num 4 be add do` → stores command + result fact (`num 7`)
- Query: `su collector obj what que`
- Read file: `su file be read from filename "test/sandpit/compile.txt" do`
- Compile text → JSON: see `USAGE.md` end-to-end example
- Ceremony with return: see `examples/core/evoke-ret.md` for `this` binding + `ret` back to the evoke sentence.
- Loops: seed `tloh` (and optional `until`) to repeat a ceremony; supervisor moves `tloh` toward `until` and stops on equality.

## Key Files
- `main.mjs` — REPL wiring parser/dispatcher/memory
- `parser.mjs` — tokenization, quoting, compositional keyword mapping (`fromtext/during/become/totext/as`, etc.)
- `dispatcher.mjs` — verb dispatch, mood handling (`ya/def/do/que/then/ret`), stores commands + result facts; executes ceremonies in a sandpit context and merges returned evoke/target updates.
- `verbs/` — verb implementations (`add`, `giant`, `compile`, `mind`, `read`, etc.) and dynamic handlers
- `program.mjs` — build a program from text
- `library/compositionalCases.mjs` — axis/context grid and keyword table
- `test/` — node:test suites (core, parser, compositional, mind, compile/read, pretty, motor)
- `test/sandpit/` — sample input (e.g., `compile.txt`)
- `scripts/read_pya_trace.mjs` — interpret a `.pya` file and dump `{ memory, sandpits }` for inspection.

See `ARCHITECTURE.md`, `STATE_OF_PROJECT.md`, `USAGE.md`, `TEST_PLAN.md`, and `GLOSSARY.md` for deeper guidance.
