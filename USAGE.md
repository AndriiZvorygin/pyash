# Usage

## Quick Start
- Run REPL: `node main.mjs`
- Run tests: `npm test` or `node --test`
- Sample data: `test/sandpit/compile.txt`

## Writing Sentences
- Declarative: `subj name collector obj num 7 be number ya`
- Imperative: `obj num 2 to name collector be add do`
- Query: `subj name collector obj what que`
- Topic sugar: `ta loop_head be topic ya`

## Quoted Text
- Inline: `subj name prompt with text "hello world" be topic ya`
- Block: `quoted.english.contents ... .english.quoted` or any tag (e.g., `quoted.bash.contents echo "hi" .bash.quoted`).

## Compositional Cases
Use contexts with axes (supports `space`, `time`, `state`, `discourse`, etc.):
- `from state draft` / `to state json`
- `from discourse spec` / `to discourse summary`
Parsed roles include `{ context, name }` for downstream verbs like `compile`.

## Verbs
- `add` — dynamic dispatch per operand types in `verbs/add*.mjs`.
- `giant` — conditional control for the next statement.
- `mind` — calls an Ollama HTTP model (`OLLAMA_HOST` configurable).
- `compile` — convert Pyash text into parsed sentences + JSON; e.g.,
  - `subj name input obj text quoted.pyash.subj ... .pyash.quoted be text ya`
  - `subj name output be text ya`
  - `subj name artifact obj name input from state pyash to state JSON name output be compile do`
- `read` — multi-dispatch; `subj name file be read from filename "test/sandpit/compile.txt" do` stores file contents as text.

## Testing Pattern
Follow red→green: add a failing test first, then implement. Suites live in `test/`; keep new tests close to the behavior they cover.
