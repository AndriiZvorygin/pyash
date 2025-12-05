# Usage

## Install & Quiz
- Requirements: Node 20+ (native ESM, built-in `node:test`).
- Run quizzes: `npm test`, `npm run quiz`, or `node --test quiz`

## Run the REPL
```bash
node program/main.mjs
```
Commands: `mem` (dump memory), `reset`, `quit`, `paste` (multi-line). Enter Pyash sentences to execute; ceremonies/verbs are speakable (multi-word) and run in sandpits with `this`/`ret` support. Conditionals use `then` with `giant` (greater-than), `tiny` (less-than), or `equally` (equal-to), and can compare inline values or stored subjects (`subj name lhs be tiny from name rhs then`).

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

## Environment
- `OLLAMA_HOST` (default `http://localhost:11434`) — used by the `mind` verb to reach an Ollama HTTP server.

## Example Sentences
- Declarative: `su collector obj num 7 be number ya`
- Imperative (add): `obj num 3 to num 4 be add do` → stores command + `result` with `num 7`
- Query: `su collector obj what que`
- Text read: `su file be read from filename "quiz/sandpit/compile.txt" do` → stores text content
- Parse text to JSON: see end-to-end example below
- Conditionals: `obj num 3 be tiny from num 5 then ...`; `subj name lhs be giant from name rhs then ...`; `subj name x be equally from num 10 then ...`

## End-to-End Example (text understand)
```bash
# Provide a program as text
su input obj text "subj name alpha obj num 1 be number ya\nsubj name beta obj num 2 be number ya" be text ya
su output be text ya

# Parse from state pyash to JSON
su artifact obj name input from state pyash to state JSON name output be understand do
```
This stores parsed sentences and JSON under `output`; memory keeps the command, result, and prior facts for inspection. To persist the JSON to disk instead, point `to filename "quiz/sandpit/understand-output.json"` when invoking `understand`. This “understand” step is parse-only; it does not emit JavaScript.

### Compiling Pyash to code
- JavaScript: `from filename "quiz/sandpit/compile.txt" to state javascript to filename "quiz/sandpit/compile-output.js" be compile do`
- Inline to JS text: see `examples/pyash/compile-text-to-js-text.pya`
- Inline to C text: see `examples/pyash/compile-text-to-c-text.pya`
- Translate Pyash text to English text: see `examples/pyash/translate-text-to-english.pya`
