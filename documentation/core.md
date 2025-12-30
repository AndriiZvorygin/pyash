# Pyash Core Specification

This document summarizes the current core language model used by the interpreter and compiler.

## Sentence Model
- A program is a sequence of sentences. Each sentence has:
  - `mood`: how to treat the sentence (`ya`, `do`, `def`, `prah`, `then`/conditionals).
  - `be`: the verb (e.g., `number`, `text`, `add`, `subtract`, `multiply`, `divide`, `remains`, `write`, `say`, `ceremony`, `compile`, `understand`).
  - Roles (keyworded fields):
    - `su`: primary subject (`su name alpha`).
    - `ob`: payload (`ob num 1`, `ob text hello`, or `ob genitive …`).
    - `to`: target (`to name bucket`, or `to genitive this ti ob`).
    - `from`: secondary operand (`from num 3`, `from genitive this ti fromindex`).
    - `fromindex` / `toindex`: loop counter and bound.
    - `consequence`: attached sentence for conditionals (`then` mood).
  - Optional `exists` flag declares a name on `ya` sentences only. Without `exists`, assigning to a new name is an error.
  - `become`/`fromstate`/`tostate` are used by translation/compile verbs to select source/target languages.
  - Genitives traverse fields on a sentence:
    - Possessive: `this ti ob ti num` resolves like `this.ob.num`.
    - Genitive: `num of ob of this` resolves to the same chain as above.
    - `this` refers to the evoking sentence/registers inside a ceremony.

## Moods
- `ya`: declarative fact (stores to memory; compiler treats as declarations/assignments).
- `do`: imperative (invokes verbs, ceremonies, arithmetic, logging, compile/understand).
- `def` / `prah`: enclose a ceremony definition body.
- `then`: conditional consequence stored on a `do` sentence with `tiny`/`giant`/`equally`.

## Signature Resolution
- Dispatch is signature-first:
  - Build signature words from the call sentence (cases are sorted by case name).
  - If a built-in verb handler matches, invoke it.
  - Otherwise, if a ceremony signature matches, invoke the ceremony.
- Sequence registers (`fromindex`, `toindex`, `atindex`) are ignored for the purpose of matching ceremony signatures.
- If no match exists, interpretation fails with an “unknown verb/signature” error that includes the derived signature.

## Declaration and Assignment
- `exists su name alpha ob num 1 be number ya` declares `alpha` as a number sentence.
- Reassigning requires the name to exist (runtime error otherwise).
- Text uses `ob text "hello"`; numbers use `ob num 1`.
- Permanent values use `be permanent number/text` (compiled to `const` in JS).

## Arithmetic Verbs
- `be add/subtract/multiply/divide` operate on `ob num` and `to` target.
- `remains` computes modulus; `from num` sets the divisor. Targets can be names or genitives.
- Text concatenation uses `be add` with `ob text ...`.

## Conditionals
- **Single official form**: `ob … be tiny/giant/equally from … then <sentence>` computes a truth value and, when true, immediately interprets the attached consequence sentence.
- LHS/RHS can be numbers, names (resolved to sentence.ob fields), or genitives on `this`.

## Logging
- `be write` logs `ob text`, or resolves `ob name`/genitive to a value. JS backend uses `console.log`; C uses `printf`.
- JSON output defaults to RFC 8785 official form with `to state json`; use `to state beautiful json` for human-readable pretty JSON.
- `be write` is used for screen/file output and mind calls; `be say` is reserved for TTS flows.

## Memory Access
- Interpreter uses `remember(name)` to fetch stored sentences.
- Compiler emits a `remember` helper for JS to resolve names/objects when needed (e.g., ceremony targets or external globals).

## Ceremonies (Functions)
- Defined with `su name X be ceremony def … su name X be ceremony prah`.
- Bodies are `do` sentences; `ret`/`return` is implicit if a `return` statement is emitted, otherwise the incoming sentence is returned.
- Invocation uses `be X … do` (signature words derive the function name in compiled code).
- Genitive `this` accesses the incoming sentence registers; `remember` inside a ceremony can load targets from `sentence.to`.
- Signature compatibility is enforced at invocation time:
  - The evoker’s signature must match the ceremony’s signature.
- Sequence registers (`fromindex`, `toindex`, `atindex`) are allowed on the evoker even if the ceremony definition omits them (so generic ceremonies can be looped).
- If a ceremony body reads a sequence register via `this`, include that case in the ceremony definition to declare the dependency.
- If a ceremony name is defined more than once, the later definition takes priority (a compile-time warning may be emitted).

## Loops
- `fromindex <start> [toindex <bound>] be <ceremony> do` runs a loop:
  - JS uses `runLoop(sentence, fn)` helper (stop-when-equal): after each body run, the supervisor stops when `fromindex === toindex` (or when `fromindex === 0` if `toindex` is absent). In the common forward form, `fromindex num 0 toindex num 3` runs indices `0, 1, 2` and stops before `3`.
  - C emits a `for` loop with the same semantics.
- Within the ceremony, `this ti fromindex ti num` reads the current counter.

## `at all` (Map/Foreach over vectors)
- `at name all` runs the target verb/ceremony once per element of the vector in `ob name ...`.
- `atindex` is injected into the evoker as a register (0-based index).
- With `to name <dest>`, the result is written to a new vector.
- Without `to`, the source vector is updated in place.
- For primitive verbs (e.g., `invert`, `add`, `subtract`) the element index is 0-based and passed as `at num <index>` per element.

## Translation / Compile Verbs
- `understand`: parse Pyash text to JSON sentences, optionally writing to a name or filename.
- `compile`: transpile Pyash to target (`javascript`, `c`, `pyash`, `english`), supporting `from text/filename` and `to text/filename/name`.
- Inline quoted blocks can use `quoted.<lang>. … .<lang>.quoted`; `\n` is unescaped automatically before parsing.

## Errors and Guards
- Assigning to undeclared names (missing `exists`) raises an error at compile time for `ya` sentences.
- Conditionals or verbs without registered handlers error during interpretation.

## Error Sentence Contract (current)
Errors are thrown as exceptions whose `.sentence` is a **`be error do`** sentence:

- `su name <error-name>` — short error identifier (e.g., `unknown verb`, `signature inconsistency`).
- `ob text <message>` — human-readable detail.
- `from name <source>` — component that raised the error (e.g., `interpret`, `compile`, `signature`).
- Optional context fields on `ob`:
  - `ob.pyash` — pretty-printed Pyash sentence where applicable.
  - `ob.raw` — raw sentence or debug payload.

The thrown exception message mirrors `ob.text` when present.
- Compilers include TODO comments for unsupported constructs (e.g., C string concat).
- Vector compile: JS supports vector literals (`ob ve/vec num ... be vector`) and `produce` (dot product) for inline and named vectors; C vector codegen is still TODO.
- Vector addressing: use `via space` → `at` for 0-based indexing (`ob name doors via space num 0 be read …`). `ord N` sugar maps 1→0, 2→1, etc. `invert` flips truth/lie text values or boolean vectors in-place.
- Mind compile: JS emits a synchronous call to an Ollama-compatible endpoint using stored mind configs (`be mind ya` with `from`/`as`/`accordingto`) or call-local prompt/model; outputs go to stdout and `globalThis` by subject name.
- Keep example outputs in git-ignored paths (e.g., `examples/out/`).

## Examples
- Declare and add:
  - `exists su name bucket ob num 0 be number ya`
  - `ob num 2 to name bucket be add do`
- Loop:
  - `to name counter fromindex num 3 be loop body do`
- Ceremony:
  - ```
    su name add two to name bucket be ceremony def
    ob num 2 to name bucket be add do
    su name add two be ceremony prah
    ```
- FizzBuzz (compiled to JS): see `examples/pyash/compile-fizzbuzz.txt`.
