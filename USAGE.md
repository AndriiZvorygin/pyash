# Usage

## Install & Test
- Requirements: Node 20+ (native ESM, built-in `node:test`).
- Run tests: `npm test` or `node --test`

## Run the REPL
```bash
node main.mjs
```
Commands: `mem` (dump memory), `reset`, `quit`. Enter Pyash sentences to execute.

## Trace a .pya file to memory
```bash
node scripts/read_pya_trace.mjs path/to/file.pya
```
Reads Pyash text, interprets each sentence, and prints the resulting memory as JSON.

## Environment
- `OLLAMA_HOST` (default `http://localhost:11434`) — used by the `mind` verb to reach an Ollama HTTP server.

## Example Sentences
- Declarative: `su collector obj num 7 be number ya`
- Imperative (add): `obj num 3 to num 4 be add do` → stores command + `result` with `num 7`
- Query: `su collector obj what que`
- Text read: `su file be read from filename "test/sandpit/compile.txt" do` → stores text content
- Compile text to JSON: see end-to-end example below

## End-to-End Example (text compile)
```bash
# Provide a program as text
su input obj text "subj name alpha obj num 1 be number ya\nsubj name beta obj num 2 be number ya" be text ya
su output be text ya

# Compile from state pyash to JSON
su artifact obj name input from state pyash to state JSON name output be compile do
```
This stores parsed sentences and JSON under `output`; memory keeps the command, result, and prior facts for inspection.
