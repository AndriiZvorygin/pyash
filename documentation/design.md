# Architecture

## Overview

Pyash is a small ESM Node app that parses Pyash sentences, dispatches verbs, and records every top-level sentence (ya/def/do) in memory. The system is intentionally lightweight: no database, direct module imports, dynamic verb dispatch for extensibility, sandpit execution for ceremonies, and speakable multi-word verbs. It implements a thin slice of the broader language described in `documentation/pyac.txt`.

At the core of the design, **sentences are first-class datatypes**. Every piece of information that moves between functions in the implementation and within the interpreter is represented as a **Pyash sentence** (a JS object) or a **paragraph** (an ordered list of sentences). Architecturally:

- All internal functions receive and emit **sentences or paragraphs**.
- There is no separate “AST” or meta-layer: the same sentence shape is used everywhere.
- This is deliberate: Pyash sentences can be compiled into regular JavaScript functions that also consume/produce sentences, so Pyash itself can be used to extend the main implementation with the same data model.

Pyash also introduces the idea of an **evoking sentence**: the original sentence that triggers a ceremony or other sandpit execution. When a sandpit starts, this evoking sentence is copied into the sandpit as sentence `0` (including any control cases such as `fromindex` and `toindex`) and is available throughout execution via `this`. Any sentence in the definition/body (ya/def/do/ret) can read from `this`. A `ret` mood inside the sandpit does not call a verb; instead it describes how to update that evoking sentence, which is then returned to main memory as a `ya` fact.

There are no artificial IDs or metadata fields at sentence level. The **subject (`su` / `su`) functions as the “name” or reference key**: the latest sentence for a given subject has semantic priority. Earlier sentences for that subject remain as history toindex garbage collection chooses to purge them.

---

## Sentence Schema

A **sentence** is a flat JS object with:

- a `mood` field (the sentence mood),
- a `be` field (the verb),
- zero or more **case keywords** (roles), such as `su`, `ob`, `fromtext`, `fromindex`, `toindex`, etc.

Example:

```js
{
  mood: "do",
  be: "mind",
  su: "assistant",
  ob: "answer the question",
  fromtext: "raw user input",
  as: "helpful",
}
````

Key points:

* Only **mood**, **be**, and **case keywords** are allowed as top-level keys.
* There is **no** `id`, `meta`, or nested structure at this time.
* `su` (or `su`) is the closest equivalent to an identifier; it is how other sentences refer to this one in human language terms.

A **paragraph** is just an ordered array of such sentences:

```js
const paragraph = [ sentence1, sentence2, sentence3 ];
```

Ceremonies, programs, traces, and sandpits all work with paragraphs.

---

## ABI: Function Interfaces

To keep the interpreter, verbs, and eventual JS compilation aligned, Pyash uses a simple **ABI**: everything at module boundaries is sentences and paragraphs.

### Types (informal)

```js
// Core types (informal, not enforced at runtime)
type Sentence = { mood: string, be: string, [caseKeyword: string]: any };
type Paragraph = Sentence[];
```

### Verb ABI

A **verb module** implements behaviour for `do` sentences.

```js
// program/verbs/<name>.mjs
export function verb(sentence, context) {
  // sentence: the incoming Pyash sentence
  // context:  implementation-defined, but always sentence/paragraph based
  //
  // Return:
  // - a Sentence,
  // - a Paragraph,
  // - or undefined (no result).
}
```

Conventions:

* **Input**: a single `Sentence` (the `do` sentence).
* **Output**: either:

  * a single `Sentence` (e.g. updated target), or
  * a `Paragraph` (multiple derived sentences), or
  * nothing (pure side-effect, though this is rare).
* Any cross-module communication still uses sentences/paragraphs, not arbitrary JS structures.

The bridge (dispatcher) is responsible for normalizing whatever the verb returns into the standard “command + result fact(s)” pattern in memory.

Compile/translation verbs follow the same ABI: they accept a `Sentence` (often with `from`/`to` cases) and return a `Sentence`/`Paragraph`. Newer helpers (compile, translation) still emit sentence-based results so compiled/translated flows can be swapped with interpreted ones.

### Ceremony / Sandpit ABI

A **ceremony** or **compiled program** is also exposed as a function, operating over sentences and paragraphs.

```js
// A generic compiled ceremony
export function runCeremony(evokerSentence, memoryFrame) {
  // evokerSentence: the top-level Sentence that triggered this ceremony
  // memoryFrame:    object that offers sentence-level access to memory/sandpit
  //
  // Return:
  // - a Sentence (final ya result), or
  // - null/undefined (no result).
}
```

Conventions:

* The ceremony function is responsible for:

  * creating or using a **sandpit frame**,
  * putting `evokerSentence` at index `0` in the sandpit paragraph,
  * executing the body paragraph using the bridge (dispatcher),
  * honouring any `ret` mood sentences,
  * and returning the final `ya` sentence (or nothing).

Compiled ceremonies and the interpreter can therefore be swapped or composed while respecting the same data model.

---

## Modules

* `program/main.mjs`: CLI REPL.

  * Reads lines from stdin.
  * Hands them to `parse`, then `interpret`.
  * Prints results.
  * Supports `mem`, `reset`, `quit` commands.
  * At the boundary, it converts raw input strings into sentence objects and receives sentence/paragraph-shaped results.

* `program/understand/index.mjs`: Tokenizes input and produces sentence objects.

  * Supports quoted blocks, short role aliases (`su/ob`), and compositional keyword mapping.
  * Context+axis pairs become keyword roles (`fromtext`, `during`, `become`, `totext`, `as`, `fromindex`, `toindex`, etc.).
  * Emits plain JS objects which are the canonical **sentence datatype**, e.g.:

    ```js
    { mood, be, su, ob, fromtext, fromindex, toindex, ... }
    ```
  * The parser’s output is the only “wire format” between text and the rest of the system.

* `program/bridge/index.mjs`: Routes by `mood` and `be`, always taking and returning sentences or paragraphs.

  * `ya` / `def`:

    * treated as facts/definitions,
    * stored via `doRemember` as-is.
  * `do`:

    * finds verb, resolves operands/targets based on subject/name and existing sentences in memory,
    * invokes verb modules with the **original sentence** and a small helper `{ remember }` so verbs can pull values on demand,
    * appends updated target sentences to memory,
    * always stores a `result` fact (a sentence),
    * stores the command sentence itself for history.
  * `ret` (special **mood** for sandpits):

    * does **not** dispatch a verb module,
    * reads the current evoking sentence from the active sandpit frame (accessible as `this` to any sentence in the body),
    * merges any cases present on the `ret` sentence into that evoker (e.g. new `su`, `ob`, `as`, `fromindex`, etc.),
    * produces a final **result sentence** with `mood: "ya"` and the merged fields,
    * attaches this `ya` result to the sandpit frame and signals that sandpit execution is complete.
    * Errors are signalled by using `be: "error"` on the `ret` sentence (and thus on the merged result), with `ob` holding the error message and optional extra cases.
  * `que`:

    * looks up a stored fact (sentence) by subject or other cases,
    * renders it via `program/beautiful.mjs` into a human-readable Pyash string.

  Ceremonies (`def...prah`) and other sandpit executions run in a temporary memory frame that starts with the evoking sentence at index `0`. All internal sentences in the body (including any `ret` moods) are traced in the sandpit; only the final merged `ya` result sentence is written back to main memory.

  In the presence of nested ceremonies, the implementation maintains a **stack of sandpit frames**. `this` always refers to the evoking sentence of the **innermost** active sandpit frame.

* `program/remember/index.mjs`: In-memory store for sentences and paragraphs.

  * Provides `doRemember`, `remember`, `allRemember`, `forget`.
  * Maintains a definition index and sandpit traces.
  * Supports nested contexts for sandpit execution via a **stack** of frames.
  * A sandpit frame tracks:

    * its own temporary sentence list (a paragraph),
    * the **evoking sentence** at index `0`,
    * an optional `retResult` (a single `ya` sentence) produced when a `ret` mood fires,
    * trace metadata used for introspection.
  * All stored items are sentence objects; history is conceptually a paragraph.
  * **Mutation model**:

    * Sentences are never edited in place.
    * A “mutation” is expressed by **appending a new sentence** for the same subject.
    * The most recent sentence for a given `su` has semantic priority.
    * Older sentences may be retained as history/log or purged by garbage collection.

* `program/beautiful.mjs`: Rendering layer.

  * Takes sentence objects and returns Pyash strings.
  * Used by `que` mood and for debugging.
  * Input: sentence. Output: string. From the rest of the system’s perspective, it’s a leaf that sits at the edge of the “all-sentences” world.

* `program/verbs/`: Implement behaviours for `do` sentences.

  * Verb modules accept sentence(s) and return sentence(s); they don’t define new ad hoc data structures for communication.
  * Patterns:

    * `add.mjs` / `read.mjs`: dynamic dispatch to type-specific handlers (`read_from_filename.mjs`, `add_obj_num_to_num.mjs`, etc.).
    * `giant.mjs`, `tiny.mjs`, `equally.mjs`: conditional control:
      * `then` mood gates the next statement (skip-next-line),
      * inline `then <sentence>` runs an attached consequence immediately.
    * `understand.mjs`: builds programs via `program/program.mjs` and writes JSON/text results to memory, wrapping them in result sentences.
    * `mind.mjs`: resolves model/prompt from stored mind config (sentences with keywords `as`, `accordingto`) and calls Ollama HTTP via `program/motor/ollama.mjs`, then packages responses back into result sentences.
    * Vector helpers: single-element mutations (`at num`) and “at all” mapping run through a shared helper (`runAtAll`) so primitive verbs (`add`, `subtract`, `invert`) can be mapped without ceremonies.

* `program/program.mjs`: Program builder.

  * Builds a **paragraph** (sentences + labels) from plain text.
  * Used by `understand` and by ceremony runners as body definitions.
  * A ceremony body is always a paragraph; there are no ad-hoc loop constructs *inside* a ceremony. Looping, when needed, is achieved by repeatedly invoking the same ceremony based on control cases on the evoking sentence.

* `program/library/compositionalCases.mjs`: Compositional roles table.

  * Axis/context grid and keyword table, e.g.:

    * state → `as` / `become`,
    * discourse → `fromtext` / `totext`,
    * temporal → `during` / `toindex`,
    * loop/control → `fromindex`.
  * Full case/hnuc usage from the spec is not surfaced yet; only the keyword layer is wired into the parser.
  * Its output is used to decorate sentences with consistent role names.

---

## Data Flow

### Normal execution

1. **Input as text → sentence**

   * REPL/input line (string) → `program/understand/index.mjs` → a **sentence object** with keyworded roles.
   * The parser is the only place text is converted into sentences; after that, all modules speak in sentences/paragraphs.

2. **Dispatch**

   * `program/bridge/index.mjs` receives a sentence and selects behaviour by `mood` (and `be` for `do`):

     * For `ya`/`def`: passes the sentence straight to memory.
     * For `do`: passes the sentence to a verb module, which returns updated sentence(s).

3. **Persistence**

   * Verbs return sentence(s).
   * Dispatcher normalizes and writes:

     * the original command sentence to memory,
     * any updated target sentences (by appending them),
     * a `result` fact, also a sentence.
   * When multiple sentences share the same `su`, the newest one is the current truth; earlier ones serve as history/log, subject to garbage collection.

4. **Query**

   * `que` mood looks up one or more facts (sentences) by subject or other cases and uses `program/beautiful.mjs` to render them back into Pyash.
   * The user sees a string; internally, the system continues to operate on sentences.

### Sandpits, ceremonies, and control flow

Some sentences (e.g. ceremony definitions and similar constructs) are executed in a **sandpit** rather than directly in main memory. Sandpits work entirely in terms of sentences and paragraphs.

1. **Evoker capture**

   * The top-level sentence that triggers the ceremony/sandpit is treated as the **evoking sentence**.
   * The sandpit engine:

     * creates a new sandpit frame and pushes it onto the sandpit stack,
     * copies the evoking sentence into the sandpit as sentence `0`,
     * preserves all its cases, including control cases like:

       * `fromindex`: loop/control description,
       * `toindex`: termination condition.

2. **`this` binding**

   * Inside the sandpit, **every sentence in the definition/body** (regardless of mood) can access the evoking sentence via `this` (or an equivalent context handle).
   * This lets `do` / `ya` / `def` / `ret` sentences read or respect `fromindex`, `toindex`, and other evoker cases without re-passing them manually.
   * In nested ceremonies, `this` always refers to the evoker of the **innermost** active sandpit.

3. **Body execution**

   * The ceremony body is always a **paragraph of sentences**.
   * The sandpit engine iterates that paragraph and dispatches each sentence via `program/bridge/index.mjs`.
   * Internal `ya`/`def`/`do` sentences live only in the sandpit’s temporary memory but are recorded in its trace paragraph.
   * There are **no explicit loop constructs inside** a ceremony body; looping is expressed by how the evoking sentence is interpreted (e.g. repeated invocation based on `fromindex`/`toindex`).

4. **Looping with `fromindex` / `toindex` (control cases)**

   * If the evoking sentence carries a `fromindex` case, a higher-level loop runner can treat it as “describe how to repeatedly call this ceremony/body”.
   * An `toindex` case on the same evoker describes when to stop.
   * Architecturally:

     * `fromindex` and `toindex` are **cases on the evoker sentence**, not separate verbs.
     * A loop runner (interpreter or compiled) reads these fields from `this` and re-invokes the ceremony’s paragraph toindex the condition is met or a `ret` returns an error or final result.

5. **Return with `ret` (mood)**

   * When a `ret` mood sentence is encountered inside the sandpit:

     * The dispatcher does not run a verb module.
     * Instead it:

       * takes the current evoking sentence from the frame (the same `this` that any body sentence can read),
       * overlays / merges the cases present on the `ret` sentence onto that evoker (e.g. new `su`, `ob`, `as`, other roles),
       * forces `mood: "ya"` on the merged sentence,
       * stores this merged sentence as `retResult` on the sandpit frame,
       * signals completion of the sandpit.
     * If the `ret` sentence has `be: "error"`, the merged result also has `be: "error"` and is treated as an error result, with `ob` carrying the error message (and additional cases as needed).

   * The `ret` sentence itself is kept in the sandpit trace paragraph but is not normally stored as a top-level fact in main memory.

6. **Merge back**

   * After the sandpit finishes:

     * If a `retResult` exists, it is written to main memory via `doRemember` like any other `ya` fact (a single sentence) derived from the updated evoker; register lookups (e.g., `fromindex`, `toindex`) should be derived from that evoker rather than separate facts.
     * If no `ret` occurred, the sandpit may terminate with no result (implementation choice).
     * The sandpit frame is popped from the stack.
     * The sandpit trace (including the initial evoker, body sentences, and any `ret` mood) is kept in `program/remember/index.mjs` as a paragraph for debugging/inspection.

7. **History**

   * Memory (`program/remember/index.mjs`) accumulates a top-level history of `ya`/`def`/`do` sentences and their `result` sentences.
  * Sandpit execution adds separate trace paragraphs that reference the evoking sentence and the returned `ya` result; body sentences are not merged into main memory.
   * The **latest sentence per subject** is the authoritative one; older ones are historical and may later be garbage-collected.

---

## Conventions & Patterns

* **Sentences as first-class datatypes**

  * All semantic communication between modules is via **sentence objects** or **paragraphs** (arrays of sentences).
  * Helper functions may use primitive JS types internally, but the public/architectural interfaces of modules are sentence/paragraph-based.
  * This keeps the runtime model aligned with the eventual compiler model, where Pyash sentences compile to JavaScript that still speaks in sentences.
  * `exists … ya` compiles to **sentence objects** (`let name = { su, ob, be, exists, mood }`), not raw scalars, so compiled code matches interpreter expectations and ceremony codegen.
  * The JS remember shim now returns `undefined` for missing names (no implicit fallback objects), making absent facts explicit.

* Always add quizzes first (red→green); every verb or control-flow change gets coverage.

* Keywordized compositional roles: contexts are mapped to keywords (`as`, `fromtext`, `fromindex`, `toindex`, etc.), not stored as nested `{context: ...}` objects.

* Imperatives are historical: commands and results are stored; moods `ya`, `def`, `do` all persist as facts. `ret` is a control mood used inside sandpits and appears in sandpit traces rather than main memory. Errors are expressed as `ret` sentences with `be: "error"`.

* Dynamic verb dispatch: new typed handlers follow `verb_from_<type>.mjs` or `verb_obj_<type>_to_<type>.mjs` naming.

* Mind config is declarative (`be mind` with `from`/`as`/`accordingto`) and reused on calls to `be mind do`.

* Evoking sentence pattern:

  * top-level command → evoker in a sandpit (`this`),
  * `fromindex` / `toindex` live as cases on this evoker,
  * any body sentence can read `this`,
  * `ret` merges its cases into the evoker and returns a `ya` fact (possibly `be: "error"`) to main memory.

* Files: prefer `quiz/sandpit` for fixtures; keep dependencies minimal (built-in modules + optional Ollama HTTP).

* Larger language features in `pyac.txt` (phonology, noun classes, additional control constructs, GPU/compiler path) are acknowledged but currently out of scope, but the sentence/paragraph data model is designed so those features can be added without changing the fundamental “everything is a sentence” interface.
