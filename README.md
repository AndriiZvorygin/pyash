# Pyash

Pyash is a compact, speakable language that can be interpreted or compiled to JavaScript and C. Sentences use a subject–object–verb style (e.g., `su collector obj num 7 be number ya`), and verbs like `add`/`subtract`/`multiply`/`divide`/`invert`/`exponential`, `produce` (dot product), `neuron`, `giant`/`tiny`/`equally` (conditionals), `understand` (parse to JSON), `mind`, `read`, and `chip` drive behavior. Typed nouns include numbers, text, filenames, and vectors (`ve/vec num 1 2 3`). The runtime is native ESM, uses the built-in `node:test` runner, and implements a quiz-driven slice of the broader language in `documentation/pyac.txt`.

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
Commands: `mem` (dump memory), `reset` (clear), `quit` (exit), `paste` (multi-line). Enter Pyash sentences to evaluate them; verbs/ceremony names stay speakable (e.g., `be add two do`). Ceremonies run in a sandpit. Conditionals use inline `then` with `giant`/`tiny`/`equally`, e.g., `obj num 3 be tiny from num 5 then obj num 1 to name counter be add do`.
Dispatch is signature-first: if a call’s cases/types do not match a registered signature, you’ll see `Unknown verb/signature: ...`.

## Stability Notes
Stable enough for iteration:
- Core parsing + compositional cases (`fromstate` -> `become`, `fromtext` -> `accordingto`, `totext`, etc.)
- Signature derivation/dispatch for built-in numeric verbs
- Sandpit execution and `ret` merge for simple ceremonies
- Vector basics (literals, `say`, element updates), loops, and 10/100 doors in interpreter + JS/C

Still evolving / fragile:
- Text-typed flows inside ceremonies (especially when mixed with numeric ops)
- Genitive + `this` resolution in compiled code
- Compiler conditionals with text comparisons
- Map/loop interop in compiled backends

## Rules of the Road
- Ceremony bodies are stored once; avoid repeating the same `subj name` in a body, because later lines overwrite earlier ones.
- Definition signatures must match invocation signatures (cases + types). Prefer explicit types in `def` headers.
- For empty text literals, use `quoted.text..text.quoted` (plain `""` is ignored by the parser).
- When you need loop/register values inside a ceremony, use `this` + genitives (`obj num of fromindex of this` or `obj this by`).
- JSON output defaults to RFC 8785 canonical form via `to state json`; use `to state beautiful json` for pretty output.

## Example Sentences
- Declarative: `su collector obj num 7 be number ya`
- Imperative (add): `obj num 3 to num 4 be add do` → stores command + result fact (`num 7`)
- Query: `su collector obj what que`
- Read file: `su file be read from filename "quiz/sandpit/compile.txt" do`
- Parse text → JSON program: see `documentation/reference.md` end-to-end example
- Ceremony `ret`: see `examples/core/evoke-ret.md` and `examples/pyash/evoke-ret.pya`.
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

Recent compile-focused examples (JS is the reference backend; C is catching up):
- `examples/pyash/compile-say.pya` → JS logging output at `examples/out/compile-say-output.js`
- `examples/pyash/compile-math-say.pya` → JS arithmetic + ceremony + logging (`examples/out/compile-math-say-output.js`)
- `examples/pyash/compile-loop.pya` → JS `fromindex`/`toindex` loop using the runtime `runLoop` helper
- `examples/pyash/compile-vector-produce.pya` → JS dot product for vectors (inline/named) at `examples/out/compile-vector-produce.js`
- `examples/pyash/compile-fizzbuzz.pya` → JS fizzbuzz via compiled conditionals/loops at `examples/out/compile-fizzbuzz-output.js`
- `examples/pyash/compile-mind.pya` → JS mind invocation (sync curl to Ollama) at `examples/out/compile-mind.js`
- Doors (map): `examples/pyash/doors-map-100.pya` (100 doors), `examples/pyash/doors-map-10.pya` (10 doors), `examples/pyash/doors-loop-10.pya` (nested loops only), `examples/pyash/doors-loop-100.pya` (nested loops only)

Compile-to-C status (tested with `gcc` via quizzes):
- Scalars: `be number ya` (`double`), `be say do` (`printf`), `be add do`, `be remains do` (`fmod`), `be equally ... then ...` (`if`)
- Vectors: literals (num/text/bool), `say`, element updates, and fill-by-count (literal `by num N`)
- Loops: fromindex/toindex loops in ceremonies (nested loops supported with saved registers)
- Pending: ceremony ABI parity, `at all` map, and full program parity with JS

Generated outputs live under `examples/out/` (ignored by git).
