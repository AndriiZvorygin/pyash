# Pyash

Pyash is a tiny experimental language built as an interlanguage between humans and machines. Sentences use a compact subject–object–verb style (e.g., `su collector obj num 7 be number ya`), and verbs like `add`/`subtract`/`multiply`/`divide`/`invert`/`exponential`, `produce` (dot product), `neuron`, `giant`/`tiny`/`equally` (conditionals), `understand` (parse to JSON), `mind`, `read`, and `chip` drive behavior. Typed nouns include numbers, text, filenames, and vectors (`ve/vec num 1 2 3`). The runtime is native ESM, uses the built-in `node:test` runner, and implements a small, quiz-driven slice of the broader language in `documentation/pyac.txt`.

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
Dispatch is signature-only: if a call’s cases/types do not match a registered signature, you’ll see `Unknown verb: <name>`.

## Example Sentences
- Declarative: `su collector obj num 7 be number ya`
- Imperative (add): `obj num 3 to num 4 be add do` → stores command + result fact (`num 7`)
- Query: `su collector obj what que`
- Read file: `su file be read from filename "quiz/sandpit/compile.txt" do`
- Parse text → JSON program: see `documentation/reference.md` end-to-end example
- Ceremony with return: see `examples/core/evoke-ret.md` for `this` binding + `ret` back to the evoke sentence.
- Loops: seed `fromindex` (and optional `toindex`) on the evoking sentence to repeat a ceremony; the supervisor moves `fromindex` toward `toindex` and stops on equality (no standalone register facts are written).

## Key Files
- `program/main.mjs` — REPL wiring understand/bridge/memory
- `program/understand/` — tokenization, quoting, compositional keyword mapping (`fromtext/during/become/totext/as`, etc.)
- `program/bridge/` — signature-first dispatch (registry in `program/bridge/signature.mjs`), mood handling (`ya/def/do/que/then/ret`), stores commands + result facts; executes ceremonies in a sandpit context and merges returned evoke/target updates (speakable multi-word verbs).
- `program/beautiful.mjs` — output formatting
- `program/verbs/` — verb implementations grouped by domain: `mathematics/` (add/subtract), `exchange/` (read/understand), `regulation/` (giant/tiny/equally), `mind/` (mind); `program/verbs/index.mjs` re-exports the set.
- `program/library/compositionalCases.mjs` — axis/context grid and keyword table
- `quiz/` — node:test quizzes (core, parser, compositional, mind, understand/read, beautiful, motor)
- `program/command/read_pya_trace.mjs` — interpret a `.pya` file and dump `{ memory, sandpits }` for inspection (beautiful by default; `--gross` for JSON).
- `program/command/run_pya_program.mjs` — run a `.pya` program and print `Outputs` (from `que`) and final `result` (`--full` to show program; `--gross` for JSON).

See `documentation/index.md` for deeper guidance and links to design, state, and glossary notes. Examples live in `examples/` (conditionals, subtract, chaining, registers).

Recent compile-focused examples:
- `examples/pyash/compile-say.pya` → JS logging output at `examples/out/compile-say-output.js`
- `examples/pyash/compile-math-say.pya` → JS arithmetic + ceremony + logging (`examples/out/compile-math-say-output.js`)
- `examples/pyash/compile-loop.pya` → JS `fromindex`/`toindex` loop using the runtime `runLoop` helper
- `examples/pyash/compile-loop-c.pya` → C countdown loop (`examples/out/compile-loop-output.c`), build with `gcc -std=c11 -o /tmp/loop examples/out/compile-loop-output.c && /tmp/loop`
- `examples/pyash/compile-vector-produce.pya` → JS dot product for vectors (inline/named) at `examples/out/compile-vector-produce.js`
- `examples/pyash/compile-fizzbuzz.pya` → JS fizzbuzz via compiled conditionals/loops at `examples/out/compile-fizzbuzz-output.js`
- `examples/pyash/compile-mind.pya` → JS mind invocation (sync curl to Ollama) at `examples/out/compile-mind.js`

Generated outputs live under `examples/out/` (ignored by git).
