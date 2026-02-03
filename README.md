# Pyash

Pyash is a compact, speakable language that can be interpreted or compiled to JavaScript and C, with `be map def` as the configuration baseline and deterministic JSON/CSV/YAML round-trips across backends. Sentences use a subject-object-verb style (e.g., `exists su name counter ob num 7 be number ya`), and verbs like `add`/`subtract`/`multiply`/`divide`/`invert`, `giant`/`tiny`/`equally` (conditionals), `understand` (parse to JSON), `mind`, `read`, and `chip` drive behavior. Typed nouns include numbers, text, filenames, and vectors (`ve/vec num 1 2 3`). The runtime is native ESM, uses the built-in `node:test` runner, and the specs live under `documentation/specifications/`.

## Requirements
- Node 20+ (ESM + built-in test runner)
- Optional: reachable Ollama HTTP server for `mind` (`OLLAMA_HOST`, default `http://localhost:11434`).
- Environment variables are documented in `configure/env.example`.

## Container quick start
```bash
./introductory
```
See `documentation/docker.md` for full container workflows (build, compose, VNC/noVNC, GPU).

## Install & Quizzes
```bash
npm test          # runs the full quiz suite via node --test
npm run quiz      # same as above, explicitly scoped to quiz/
node --test quiz  # direct invoke
```

## Quick Run (Interpreter / JS / C)
```bash
./run examples/pyash/mind-tool-call.pya --newspaper --run-id demo
./command/pyash.mjs examples/pyash/mind-tool-call.pya --newspaper --run-id demo-npx
./runjs examples/pyash/mind-tool-call.pya --newspaper --run-id demo-js
./runc examples/pyash/mind-tool-call.pya --newspaper --run-id demo-c
```
Outputs:
- Newspaper: `newspaper/<run-id>.pya`
- Artifacts: `artifacts/sha256/<first2>/<next2>/<hex><ext>`

## Running the REPL
```bash
node program/main.mjs
```
Commands: `mem` (dump memory), `reset` (clear), `quit` (exit), `paste` (multi-line). Enter Pyash sentences to evaluate them; verbs/ceremony names stay speakable (e.g., `be plus two do`). Ceremonies run in a sandpit. Conditionals use inline `then` with `giant`/`tiny`/`equally`, e.g., `obj num 3 be tiny from num 5 then obj num 1 to name counter be plus do`.
Dispatch is signature-first: if a call’s cases/types do not match a registered signature, you’ll see `Unknown verb/signature: ...`.

## Stability Notes
Stable enough for iteration:
- Core parsing + compositional cases (`fromstate` -> `become`, `fromtext` -> `accordingto`, `totext`, etc.)
- Signature derivation/dispatch for built-in verbs and ceremony signatures
- Sandpit execution and `ret` merge for simple ceremonies
- Vectors (literals, `write`, element updates), loops, and doors in interpreter + JS/C
- `be map def` + JSON/CSV/YAML parity with golden round-trips across interpreter/JS/C
- Run newspaper + exchange/artifacts + tool events across interpreter/JS/C

Still evolving / fragile:
- Text-typed flows inside ceremonies (especially when mixed with numeric ops)
- Genitive + `this` resolution in compiled code
- Compiler conditionals with text comparisons

## Rules of the Road
- Ceremony bodies are stored once; avoid repeating the same `subj name` in a body, because later lines overwrite earlier ones.
- Definition signatures must match invocation signatures (cases + types). Prefer explicit types in `def` headers.
- For empty text literals, use `quoted.text..text.quoted` (plain `""` is ignored by the parser).
- When you need loop/register values inside a ceremony, use `this` + genitives (`obj num of fromindex of this` or `obj this by`).
- JSON output defaults to official form via `to state json`; use `to state beautiful json` for pretty output.
- `be write` is used for screen/file output and mind calls; `be say` is reserved for TTS flows.
- Internal sentence objects use `su`/`ob` (legacy `subj`/`obj` are parsed but normalized).

## Example Sentences
- Declarative: `exists su name counter ob num 7 be number ya`
- Imperative (add): `obj num 3 to num 4 be plus do` → stores command + result fact (`num 7`)
- Query: `su collector obj what que`
- Read file: `su file be read from filename "quiz/sandpit/compile.txt" do`
- Ceremony `ret`: see `examples/pyash/evoke-ret.pya`.
- Loops: seed `fromindex` (and optional `toindex`) on the evoking sentence to repeat a ceremony; the supervisor moves `fromindex` toward `toindex` and stops on equality.

## Key Files
- `program/main.mjs` — REPL wiring understand/bridge/memory
- `program/understand/` — tokenization, quoting, compositional keyword mapping (`fromtext/during/become/totext/as`, etc.)
- `program/bridge/` — signature-first dispatch (registry in `program/bridge/signature.mjs`), mood handling, sandpits
- `program/bridge/exchange.mjs` — artifact + exchange recorder
- `program/verbs/exchange/compile.mjs` — JS/C compiler wiring (see `program/verbs/exchange/compile/` for handlers + runtime helpers)
- `program/verbs/exchange/helpers_c.mjs` — C runtime helpers (exchange, mind, CSV/YAML)
- `program/verbs/mind/mind.mjs` — mind invocation + tool adapter
- `program/library/grammar/keywords.mjs` — canonical keyword lists
- `quiz/` — node:test quizzes (core, parser, compositional, mind, understand/read, beautiful, motor)
- `program/command/read_pya_trace.mjs` — interpret a `.pya` file and dump `{ memory, sandpits }` for inspection (beautiful by default; `--gross` for JSON).
- `program/command/run_pya_program.mjs` — run a `.pya` program and print `Outputs` (from `que`) and final `result` (`--full` to show program; `--gross` for JSON).

See `documentation/handoff.md` for the Fresh Codex Primer, and `documentation/roadmap.md` for the living plan. Examples live in `examples/`.
