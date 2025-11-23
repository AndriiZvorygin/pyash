````md
# Architecture

## Overview
Pyash is a small ESM Node app that parses Pyash sentences, dispatches verbs, and records every top-level sentence (ya/def/do) in memory. The system is intentionally lightweight: no database, direct module imports, dynamic verb dispatch for extensibility, sandpit execution for ceremonies, and speakable multi-word verbs. It implements a thin slice of the broader language described in `documentation/pyac.txt`.

At the core of the design, **sentences are first-class datatypes**. Every piece of information that moves between functions in the implementation and within the interpreter is represented as a **Pyash sentence** (a JS object) or a **paragraph** (an ordered list of sentences). Architecturally, all functions are expected to receive and emit sentences or paragraphs; no other datatypes are needed for inter-function communication. This is deliberate: Pyash sentences can be compiled into regular JavaScript, which means Pyash itself can be used to extend the main implementation using the same sentence/paragraph data model.

Pyash also introduces the idea of an **evoking sentence**: the original sentence that triggers a ceremony or other sandpit execution. When a sandpit starts, this evoking sentence is copied into the sandpit as sentence `0` (including any control cases such as `tloh` and `until`) and is available throughout execution via `this`. Any sentence in the definition/body (ya/def/do/ret) can read from `this`. A `ret` mood inside the sandpit does not call a verb; instead it describes how to update that evoking sentence, which is then returned to main memory as a `ya` fact.

## Modules

- `main.mjs`: CLI REPL.
  - Reads lines from stdin.
  - Hands them to `parse`, then `interpret`.
  - Prints results.
  - Supports `mem`, `reset`, `quit` commands.
  - At the boundary, it converts raw input strings into sentence objects and receives sentence/paragraph-shaped results.

- `parser.mjs`: Tokenizes input and produces sentence objects.
  - Supports quoted blocks, short role aliases (`su/ob`), and compositional keyword mapping.
  - Context+axis pairs become keyword roles (`fromtext`, `during`, `become`, `totext`, `as`, `tloh`, `until`, etc.).
  - Emits plain JS objects which are the canonical **sentence datatype**, e.g.:
    ```js
    {
      mood,
      subj,
      obj,
      fromtext,
      tloh,
      until,
      // …other roles…
    }
    ```
  - The parser’s output is the only “wire format” between text and the rest of the system.

- `dispatcher.mjs`: Routes by `mood` and `be`, always taking and returning sentences or paragraphs.
  - `ya` / `def`:
    - treated as facts/definitions,
    - stored via `setMemory` as-is.
  - `do`:
    - finds verb, resolves targets from sentences in memory,
    - invokes verb modules that accept sentence(s) and return sentence(s),
    - stores updated targets,
    - always stores a `result` fact (a sentence),
    - stores the command sentence itself for history.
  - `ret` (special **mood** for sandpits):
    - does **not** dispatch a verb module,
    - reads the current evoking sentence from the active sandpit frame (accessible as `this` to any sentence in the body),
    - merges any cases present on the `ret` sentence into that evoker (e.g. new `subj`, `obj`, `as`, `tloh`, etc.),
    - produces a final **result sentence** with `mood: "ya"` and the merged fields,
    - attaches this `ya` result to the sandpit frame and signals that sandpit execution is complete.
  - `que`:
    - looks up a stored fact (sentence),
    - renders it via `pretty.mjs` into a human-readable Pyash string.

  Ceremonies (`def...prah`) and other sandpit executions run in a temporary memory frame that starts with the evoking sentence at index `0`. All internal sentences in the body (including any `ret` moods) are traced in the sandpit; only the final merged `ya` result sentence is written back to main memory.

- `memory.mjs`: In-memory store for sentences and paragraphs.
  - Provides `setMemory`, `getMemory`, `dumpMemory`, `resetMemory`.
  - Maintains a definition index and sandpit traces.
  - Supports nested contexts for sandpit execution.
  - A sandpit frame tracks:
    - its own temporary sentence list (a paragraph),
    - the **evoking sentence** at index `0`,
    - an optional `retResult` (a single `ya` sentence) produced when a `ret` mood fires,
    - trace metadata used for introspection.
  - All stored items are sentence objects; history is conceptually a paragraph.

- `pretty.mjs`: Rendering layer.
  - Takes sentence objects and returns Pyash strings.
  - Used by `que` mood and for debugging.
  - Input: sentence. Output: string. From the rest of the system’s perspective, it’s a leaf that sits at the edge of the “all-sentences” world.

- `verbs/`: Implement behaviours for `do` sentences.
  - Verb modules accept sentence(s) and return sentence(s); they don’t define new ad hoc data structures for communication.
  - Patterns:
    - `add.mjs` / `read.mjs`: dynamic dispatch to type-specific handlers (`read_from_filename.mjs`, `add_obj_num_to_num.mjs`, etc.).
    - `giant.mjs`: conditional control (operates over input sentences and outputs sentences according to conditions).
    - `compile.mjs`: builds programs via `program.mjs` and writes JSON/text results to memory, wrapping them in result sentences.
    - `mind.mjs`: resolves model/prompt from stored mind config (sentences with keywords `as`, `accordingto`) and calls Ollama HTTP via `motor/ollama.mjs`, then packages responses back into result sentences.

- `program.mjs`: Program builder.
  - Builds a **paragraph** (sentences + labels) from plain text.
  - Used by `compile` and by sandpit / ceremony runners as loop or body definitions.
  - The “program” is itself just a structured paragraph of sentences.

- `library/compositionalCases.mjs`: Compositional roles table.
  - Axis/context grid and keyword table, e.g.:
    - state → `as` / `become`,
    - discourse → `fromtext` / `totext`,
    - temporal → `during` / `until`,
    - loop/control → `tloh`.
  - Full case/hnuc usage from the spec is not surfaced yet; only the keyword layer is wired into the parser.
  - Its output is used to decorate sentences with consistent role names.

## Data Flow

### Normal execution

1. **Input as text → sentence**
   - REPL/input line (string) → `parser.mjs` → a **sentence object** with keyworded roles.
   - The parser is the only place text is converted into sentences; after that, all modules speak in sentences/paragraphs.

2. **Dispatch**
   - `dispatcher.mjs` receives a sentence and selects behaviour by `mood` (and `be` for `do`):
     - For `ya`/`def`: passes the sentence straight to memory.
     - For `do`: passes the sentence to a verb module, which returns updated sentence(s).

3. **Persistence**
   - Verbs return `{ obj, be? }` wrapped in one or more sentences.
   - Dispatcher normalizes and writes:
     - the original command sentence to memory,
     - any updated target sentences,
     - a `result` fact, also a sentence.

4. **Query**
   - `que` mood looks up a fact (sentence) and uses `pretty.mjs` to render it back into Pyash.
   - The user sees a string; internally, the system continues to operate on sentences.

### Sandpits, ceremonies, and control flow

Some sentences (e.g. ceremony definitions and similar constructs) are executed in a **sandpit** rather than directly in main memory. Sandpits work entirely in terms of sentences and paragraphs.

1. **Evoker capture**
   - The top-level sentence that triggers the ceremony/sandpit is treated as the **evoking sentence**.
   - The sandpit engine:
     - creates a new sandpit frame,
     - copies the evoking sentence into the sandpit as sentence `0`,
     - preserves all its cases, including control cases like:
       - `tloh`: loop description,
       - `until`: termination condition.

2. **`this` binding**
   - Inside the sandpit, **every sentence in the definition/body** (regardless of mood) can access the evoking sentence via `this` (or an equivalent context handle).
   - This lets `do` / `ya` / `def` / `ret` sentences read or respect `tloh`, `until`, and other evoker cases without re-passing them manually.
   - Any internal communication still happens via sentences/paragraphs, not arbitrary objects.

3. **Body execution**
   - The ceremony body / program (often built by `program.mjs`) is a **paragraph of sentences**.
   - The sandpit engine iterates that paragraph and dispatches each sentence via `dispatcher.mjs`.
   - Internal `ya`/`def`/`do` sentences live only in the sandpit’s temporary memory but are recorded in its trace paragraph.

4. **Looping with `tloh` / `until` (control cases)**
   - If the evoking sentence carries a `tloh` case, the sandpit engine treats it as “describe how to loop this body”.
   - An `until` case on the same evoker describes when to stop.
   - Architecturally:
     - `tloh` and `until` are **cases on the evoker sentence**, not separate verbs.
     - The sandpit loop runner reads these fields from `this` each iteration (as sentences / roles on a sentence) to decide whether to continue or terminate.

5. **Return with `ret` (mood)**
   - When a `ret` mood sentence is encountered inside the sandpit:
     - The dispatcher does not run a verb module.
     - Instead it:
       - takes the current evoking sentence from the frame (the same `this` that any body sentence can read),
       - overlays / merges the cases present on the `ret` sentence onto that evoker (e.g. new `subj`, `obj`, `as`, other roles),
       - forces `mood: "ya"` on the merged sentence,
       - stores this merged sentence as `retResult` on the sandpit frame,
       - signals completion of the sandpit.
   - The `ret` sentence itself is kept in the sandpit trace paragraph but is not normally stored as a top-level fact in main memory.

6. **Merge back**
   - After the sandpit finishes:
     - If a `retResult` exists, it is written to main memory via `setMemory` like any other `ya` fact (a single sentence).
     - If no `ret` occurred, the sandpit may terminate with no result (implementation choice).
     - The sandpit trace (including the initial evoker, body sentences, and any `ret` mood) is kept in `memory.mjs` as a paragraph for debugging/inspection.

7. **History**
   - Memory (`memory.mjs`) accumulates a top-level history of `ya`/`def`/`do` sentences and their `result` sentences.
   - Sandpit execution adds separate trace paragraphs that reference the evoking sentence and the returned `ya` result.

## Conventions & Patterns

- **Sentences as first-class datatypes**
  - All semantic communication between modules is via **sentence objects** or **paragraphs** (arrays of sentences).
  - Helper functions may use primitive JS types internally, but the public/architectural interfaces of modules are sentence/paragraph-based.
  - This keeps the runtime model aligned with the eventual compiler model, where Pyash sentences compile to JavaScript that still speaks in sentences.

- Always add tests first (red→green); every verb or control-flow change gets coverage.
- Keywordized compositional roles: contexts are mapped to keywords (`as`, `fromtext`, `tloh`, `until`, etc.), not stored as `{context: ...}` objects.
- Imperatives are historical: commands and results are stored; moods `ya`, `def`, `do` all persist as facts. `ret` is a control mood used inside sandpits and appears in sandpit traces rather than main memory.
- Dynamic verb dispatch: new typed handlers follow `verb_from_<type>.mjs` or `verb_obj_<type>_to_<type>.mjs` naming.
- Mind config is declarative (`be mind` with `from`/`as`/`accordingto`) and reused on calls to `be mind do`.
- Evoking sentence pattern:
  - top-level command → evoker in a sandpit (`this`),
  - `tloh` / `until` live as cases on this evoker,
  - any body sentence can read `this`,
  - `ret` merges its cases into the evoker and returns a `ya` fact to main memory.
- Files: prefer `test/sandpit` for fixtures; keep dependencies minimal (built-in modules + optional Ollama HTTP).
- Larger language features in `pyac.txt` (phonology, noun classes, control constructs beyond `tloh`/`until`, GPU/compiler path) are acknowledged but currently out of scope, but the sentence/paragraph data model is designed so those features can be added without changing the fundamental “everything is a sentence” interface.
````
