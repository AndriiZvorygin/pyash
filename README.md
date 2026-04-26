# Pyash

Pyash is a sentence-based programming language and runtime for automation, tooling, and agent workflows. It treats grammar as the API surface: programs are made of typed sentences, the runtime dispatches them by signature, and the same program can be interpreted directly or compiled to JavaScript and C.

In practice, this repo is both:

- a language implementation, with parser, interpreter, compiler, memory model, and specs;
- an execution platform for model/tool orchestration, artifact-producing pipelines, channels, and operational agent workflows.

Pyash sentences use a speakable subject-object-verb style such as `exists su name counter ob num 7 be number ya`. Verbs like `plus`, `subtract`, `multiply`, `divide`, `invert`, `giant`, `tiny`, `equally`, `understand`, `read`, `mind`, and `chip` route to concrete implementations based on case and type signatures rather than positional arguments.

The runtime is native ESM Node.js, uses the built-in `node:test` runner, and keeps normative specs under `documentation/specifications/`.

## What This Project Is

Pyash is not just a parser or a small DSL. The repo currently spans:

- interpretation of `.pya` sentence programs;
- compilation to JavaScript and C with parity-focused quizzes;
- deterministic JSON/CSV/YAML round-trips across interpreter and compiler paths;
- configuration and module wiring using `be map def` as a core baseline;
- mind/tool/MCP integration and run recording;
- refinery-style pipelines that produce artifacts, newspapers, and stage outputs;
- agent, channel, and operational command surfaces for longer-running workflows.

If you want the conceptual framing, read `documentation/pyash.md`. If you want the normative behavior contract, start at `documentation/specifications/00-index.md`.

## Core Model

The main unit of computation is the sentence.

- A sentence is a flat object with a `mood`, a `be` verb, and zero or more case roles like `su`, `ob`, `fromtext`, `during`, `accordingto`, `fromindex`, or `toindex`.
- Dispatch is signature-first: the runtime chooses behavior from the verb plus the sentence’s case/type shape.
- Facts, definitions, command results, and ceremony bodies all use the same sentence model.
- Memory is last-write-wins by subject name for ordinary facts, while definitions and traces are preserved.
- Ceremonies (`def ...` / `prah`) run in sandpits, where `this` refers to the evoking sentence and `ret` merges back into the caller-visible result.

Typed nouns already used heavily in this repo include numbers, text, filenames, vectors, maps, series, and backend/config objects.

## Quick Example

A minimal fact:

```text
exists su name counter ob num 7 be number ya
```

An imperative:

```text
obj num 3 to num 4 be plus do
```

That command records the command sentence and a result fact (`num 7`).

A conditional:

```text
obj num 3 be tiny from num 5 then obj num 1 to name counter be plus do
```

A file read:

```text
su file be read from filename "quiz/sandpit/compile.txt" do
```

## Why The Repo Is Broad

The codebase combines language implementation and production workflows because Pyash is being developed as an interlanguage for both humans and machines.

- `program/` contains the parser, bridge, memory model, runtime surfaces, motors, and agent internals.
- `command/` contains user-facing CLIs, operational helpers, runners, and configuration flows.
- `module/` contains reusable Pyash modules and refineries.
- `examples/` contains runnable programs that act as onboarding material and regression anchors.
- `quiz/` contains the behavior suite that keeps interpreter/compiler/runtime changes pinned down.

This is why the repo includes both small arithmetic examples and larger channels, Android, media, and model/tool workflows.

## Requirements

- Node 20+ (ESM + built-in test runner)
- Optional: reachable Ollama HTTP server for `mind` (`OLLAMA_HOST`, default `http://localhost:11434`)
- Environment variables are documented in `configure/env.example`

## Install And Quizzes

```bash
npm test
npm run quiz
node --test quiz
```

`npm test` runs the full quiz suite via `node --test`.

## Quick Start

Run the REPL:

```bash
node program/main.mjs
```

REPL commands:

- `mem` dumps remembered sentences
- `reset` clears memory
- `quit` exits
- `paste` enters multi-line mode

Run a program:

```bash
./run examples/pyash/add-basic.pya
```

Run a richer end-to-end example through multiple backends:

```bash
./run examples/pyash/mind-tool-call.pya --newspaper --run-id demo
./command/pyash.mjs examples/pyash/mind-tool-call.pya --newspaper --run-id demo-npx
./runjs examples/pyash/mind-tool-call.pya --newspaper --run-id demo-js
./runc examples/pyash/mind-tool-call.pya --newspaper --run-id demo-c
```

Outputs:

- Newspaper: `newspaper/<run-id>.pya`
- Artifacts: `artifacts/sha256/<first2>/<next2>/<hex><ext>`

## Global `pyash` CLI

Install globally from the repo root:

```bash
npm link
```

Then use from anywhere:

```bash
pyash run examples/pyash/mind-tool-call.pya --newspaper --run-id demo
pyash repl
pyash configure
pyash configure matrix
```

The CLI surface is broader than just `run` and `repl`; see `command/README.md` for the command map and `documentation/reference/pyash-cli-modules.md` for the CLI ownership layout.

## Config Boundaries

Keep host and container config separated:

- `configure/default.pya`: portable defaults that should work on host and container
- `configure/container.pya`: container-only routing overrides such as `host.docker.internal`, `searxng`, and `whisperx` service hosts
- `configure/secret.pya`: personal secrets and host-local values only; do not put container service hostnames here

Safety check command:

```bash
npm run config:safety
# or: node command/check_local_config_safety.mjs --root /path/to/repo
```

## Container Quick Start

```bash
./introductory
```

See `documentation/container.md` for full container workflows including build, compose, VNC/noVNC, and GPU paths.

## Artifact Layout

- `artifacts/<run-id>/` is the run root and should hold the final user-facing outputs for that run
- `artifacts/<run-id>/<stage-name>/...` is for intermediate or stage-local working files only
- When a refinery is checkpointed, later stages should consume canonical outputs from the run root rather than from another stage’s scratch folder
- `know/produce/` is for durable promoted outputs, not intermediates or scratch files

## Stability Notes

Stable enough for iteration:

- core parsing plus compositional cases (`fromstate` -> `become`, `fromtext` -> `accordingto`, `totext`, and related roles)
- signature derivation and dispatch for built-in verbs and ceremony signatures
- sandpit execution and `ret` merge for simple ceremonies
- vectors, loops, and doors across interpreter plus JS/C
- `be map def` plus JSON/CSV/YAML parity with golden round-trips across interpreter, JS, and C
- run newspaper plus exchange/artifacts and tool events across interpreter, JS, and C

Still evolving or fragile:

- text-typed flows inside ceremonies, especially when mixed with numeric operations
- genitive plus `this` resolution in compiled code
- compiler conditionals with text comparisons

## Rules Of The Road

- Ceremony bodies are stored once; avoid repeating the same subject name in a body because later lines overwrite earlier ones.
- Definition signatures must match invocation signatures by cases and types. Prefer explicit types in `def` headers.
- For empty text literals, use `quoted.text..text.quoted`; plain `""` is ignored by the parser.
- When you need loop/register values inside a ceremony, use `this` plus genitives, for example `obj num of fromindex of this` or `obj this by`.
- JSON output defaults to official form via `to state json`; use `to state beautiful json` for pretty output.
- `be write` is used for screen/file output and mind calls; `be say` is reserved for TTS flows.
- Internal sentence objects use `su` and `ob`; legacy `subj` and `obj` are parsed but normalized.

## Key Files

- `program/main.mjs` — REPL wiring for parser, bridge, and memory
- `program/understand/` — tokenization, quoting, compositional keyword mapping (`fromtext`, `during`, `become`, `totext`, `as`, and related roles)
- `program/bridge/` — signature-first dispatch, mood handling, sandpits, refinery execution
- `program/bridge/signature.mjs` — signature registry and lookup
- `program/bridge/exchange.mjs` — artifact and exchange recorder
- `program/remember/` — memory, definitions, and sandpit trace handling
- `program/verbs/exchange/compile.mjs` — JS/C compiler wiring
- `program/verbs/exchange/helpers_c.mjs` — C runtime helpers for exchange, mind, CSV, and YAML
- `program/verbs/mind/mind.mjs` — mind invocation and tool adapter
- `program/library/grammar/keywords.mjs` — canonical keyword lists
- `command/read_pya_trace.mjs` — interpret a `.pya` file and dump `{ memory, sandpits }`
- `command/run_pya_program.mjs` — run a `.pya` program and print `Outputs` and final `result`
- `quiz/` — node:test behavior suite for parser, bridge, verbs, compiler parity, and runtime workflows

## Documentation Map

- `documentation/pyash.md` — high-level design goals and interlanguage framing
- `documentation/design.md` — architecture overview and module layout
- `documentation/specifications/00-index.md` — normative spec index
- `documentation/compositional-cases.md` — case grid and keyword mapping
- `documentation/index.md` — broader documentation map
- `documentation/handoff.md` — fresh-codex contributor primer
- `documentation/roadmap.md` — living plan
- `documentation/recipes/agent-operations.md` — scheduler, channels, health, ratify policy, and log paths

## Examples

Examples live in `examples/`.

Good first examples:

- `examples/pyash/add-basic.pya`
- `examples/pyash/ceremony-invoke.pya`
- `examples/pyash/evoke-ret.pya`
- `examples/pyash/read-file.pya`
- `examples/pyash/compile-loop.pya`
- `examples/pyash/mind-tool-call.pya`

## Contributor Notes

- The repo prefers small, composable modules and signature-specific behavior over broad fallback logic.
- Spec-first fixes are preferred over ad hoc heuristics.
- New Pyash vocabulary should be checked with `node command/vocab_suggest.mjs`.
- New behavior should be covered by quizzes under `quiz/`.

## Wide Teaching Video Modes (Stable)

Wrapper:

```bash
./run examples/pyash/wide-teaching-video-from-filename.pya know/input/wide-one-sentence.txt
```

Modes are controlled by the optional third positional input (`thumbnail_mode`):

```bash
# default/off: video only
./run examples/pyash/wide-teaching-video-from-filename.pya know/input/wide-one-sentence.txt

# checkpoint: video + thumbnail checkpoint artifacts
./run examples/pyash/wide-teaching-video-from-filename.pya know/input/wide-one-sentence.txt baseline checkpoint

# render: video + checkpoint + thumbnail-render.png
./run examples/pyash/wide-teaching-video-from-filename.pya know/input/wide-one-sentence.txt baseline render
```

Expected outputs:

- Produce outputs:
  - `know/produce/<name>.mp4`
  - `know/produce/<name>.metadata.pya`
- Run artifacts:
  - `artifacts/<run-id>/...`
- Checkpoint mode adds:
  - `artifacts/<run-id>/thumbnail-input-source.txt`
  - `artifacts/<run-id>/thumbnail-checkpoint.pya`
- Render mode adds:
  - `artifacts/<run-id>/thumbnail-render.png`

Failure behavior:

- Video generation failure fails the wrapper in all modes.
- Checkpoint generation/validation failure fails `checkpoint` and `render`.
- Thumbnail render failure fails only `render` mode.

Render failure diagnosis:

- Confirm checkpoint exists and is valid:
  - `artifacts/<run-id>/thumbnail-checkpoint.pya`
- Re-run the render adapter directly to surface command-level errors:
  - `node command/thumbnail_render_from_checkpoint.mjs <source.txt> <thumbnail-render.png>`
- Common root causes:
  - ComfyUI host/workflow unavailable or mismatched
  - prompt compose failure from malformed checkpoint source
  - draw command transport/timeout failures

### Wide Image Cadence

For `teaching video wide`, image prompt/image cadence is phrase-based.

Phrase delimiters:
- comma `,`
- period `.`
- newline

Rules:
- trim whitespace per phrase
- drop empty phrases
- preserve phrase order
- narration/timing text flow remains sentence/audio-driven; only image cadence shifts to phrase units
