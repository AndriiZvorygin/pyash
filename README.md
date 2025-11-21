# Pyash

Pyash is a tiny experimental language with a Node-based REPL, parser, and interpreter. Sentences use a compact subject–object–verb style (e.g., `subj name collector obj num 7 be number ya`), and verbs like `add`, `giant`, `compile`, `mind`, and `read` drive behavior. The project is native ESM and uses the built-in `node:test` runner.

## Requirements
- Node 20+ (ESM + built-in test runner)
- Optional: a reachable Ollama HTTP server for `mind` (set `OLLAMA_HOST`, default `http://localhost:11434`).

## Install & Test
```bash
npm test      # runs the full suite via node --test
node --test   # equivalent if you prefer direct Node
```

## Running the REPL
```bash
node main.mjs
```
Commands: `mem` (dump memory), `reset` (clear), `quit` (exit). Enter Pyash sentences to evaluate them.

## Key Files
- `main.mjs` — REPL wiring parser/dispatcher/memory
- `parser.mjs` — tokenization, quoting, compositional cases (`from state …`, etc.)
- `dispatcher.mjs` — verb dispatch and memory updates
- `verbs/` — verb implementations (`add`, `giant`, `compile`, `mind`, `read`, etc.)
- `program.mjs` — build a program from a .pyash-style text
- `test/` — node:test suites (core, parser, compositional, compile/read, pretty, motor)
- `library/compositionalCases.mjs` — case grid definitions
- `test/sandpit/` — sample input (e.g., `compile.txt` for file reads)
