# Usage

## Install & Quiz
- Requirements: Node 20+ (native ESM, built-in `node:test`).
- Run quizzes: `npm test`, `npm run quiz`, or `node --test quiz`

## Run the REPL
```bash
node program/main.mjs
```
Commands: `mem` (dump memory), `reset`, `quit`, `paste` (multi-line). Enter Pyash sentences to execute; ceremonies/verbs are speakable (multi-word) and run in sandpits with `this`/`ret` support. Conditionals use `then` with `giant` (greater-than), `tiny` (less-than), or `equally` (equal-to), and can compare inline values or stored subjects (`su name lhs be tiny from name rhs then`).

## Trace a .pya file to memory
```bash
node program/command/read_pya_trace.mjs path/to/file.pya
```
Reads Pyash text, interprets each sentence, and prints `{ memory, sandpits }` as JSON.
Use `--gross` for raw JSON; without it, beautiful trace output is printed.

Run a program and see outputs:
```bash
node program/command/run_pya_program.mjs [--full] [--gross] path/to/file.pya
```
Beautiful mode shows `Outputs` (from `que`) and final `Result`; `--gross` returns `{ outputs, result }` JSON; `--full` also prints the program.

To emit a newspaper, add `--newspaper` and optionally `--run-id <name>`:

```bash
./run --newspaper --run-id say-stream examples/pyash/say-stream-piper.pya --full
```

This writes `newspaper/say-stream.pya`.

## Environment
- `OLLAMA_HOST` (default `http://localhost:11434`) — used by the `mind` verb to reach an Ollama HTTP server.
- All supported environment variables are listed in `configure/env.example`.
  - Env values are imported into memory as defaults (`su name ... be default ya`).
  - `configure/default.pya` (or any in-program sentence) overrides env defaults.
  - `PYA_KEYBOARD_BIN` overrides the keyboard injection binary for `to name keyboard` (default: `xdotool`).
  - `PYA_SAY_STREAM_DELAY_MS` controls the debounce delay (ms) for streaming `say`.
  - `PYA_ESPEAK_BIN` overrides the espeak binary used by `espeak say` (default: `espeak-ng`).

## Whisper streaming helper

Run the streaming whisper helper and print incremental lines as they arrive:

```bash
node command/whisper_stream.mjs -c 0 -m caterer/hear/template/whisper/ggml-base.bin
```

If you only have the English model, use `ggml-base.en.bin` instead.

For interactive runs, incremental `hear` transcripts print as they arrive when
stdout is a TTY. Use `PYA_STREAM_STDOUT=0` to disable or `PYA_STREAM_STDOUT=1` to
force on, or set `su name stream stdout ob bool lie be default ya` in config/examples.
The command still returns a final transcript value when the stream ends
(finish/cancel, timebox expiry, or a `[BLANK_AUDIO]` end marker from whisper-stream).

## Hear stream → keyboard

Stream mic transcription into the active window (requires `xdotool`):

```bash
./run examples/pyash/hear-stream-keyboard.pya --full
```

Set `PYA_KEYBOARD_BIN` to override the keyboard injection binary.
If you need to disable stream stdout globally, set `su name stream stdout ob bool lie be default ya`
in `configure/default.pya` or in a specific example.

## Example Sentences
- Declarative: `su collector ob num 7 be number ya`
- Imperative (add): `ob num 3 to num 4 be add do` → stores command + `result` with `num 7`
- Query: `su collector ob what que`
- Text read: `su file be read from filename "quiz/sandpit/compile.txt" do` → stores text content
- Parse text to JSON: see end-to-end example below
- Conditionals: `ob num 3 be tiny from num 5 then ...`; `su name lhs be giant from name rhs then ...`; `su name x be equally from num 10 then ...`
- Power: `ob num 2 from num 3 be exponential do` → stores `result` with `num 8`
- Constant: `ob name eulers_number from num 2 be exponential do` → stores `result` with `num ~7.389`

## End-to-End Example (text understand)
```bash
# Provide a program as text
su input ob text "su name alpha ob num 1 be number ya\nsubj name beta ob num 2 be number ya" be text ya
su output be text ya

# Parse from state pyash to JSON
su artifact ob name input from state pyash to state JSON name output be understand do
```
This stores parsed sentences and JSON under `output`; memory keeps the command, result, and prior facts for inspection. To persist the JSON to disk instead, point `to filename "quiz/sandpit/understand-output.json"` when invoking `understand`. This “understand” step is parse-only; it does not emit JavaScript.

### Compiling Pyash to code
- JavaScript: `from filename "quiz/sandpit/compile.txt" to state javascript to filename "quiz/sandpit/compile-output.js" be compile do`
- Inline to JS text: see `examples/pyash/compile-text-to-js-text.pya`
- Inline to C text: see `examples/pyash/compile-text-to-c-text.pya`
- Translate Pyash text to English text: see `examples/pyash/translate-text-to-english.pya`
- Translate English text back to Pyash sentences: see `examples/pyash/translate-add-to-english.pya` and related translation examples.
- Translate simple JavaScript assignments/arithmetic back to Pyash sentences: see `examples/pyash/translate-javascript-to-pyash.pya`.
