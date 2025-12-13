# Pyash Core Specification

This document summarizes the current core language model used by the interpreter and compiler.

## Sentence Model
- A program is a sequence of sentences. Each sentence has:
  - `mood`: how to treat the sentence (`ya`, `do`, `def`, `prah`, `then`/conditionals).
  - `be`: the verb (e.g., `number`, `text`, `add`, `subtract`, `multiply`, `divide`, `remains`, `say`, `ceremony`, `compile`, `understand`).
  - Roles (keyworded fields):
    - `subj`: primary subject (`subj name alpha`).
    - `obj`: payload (`obj num 1`, `obj text hello`, or `obj genitive …`).
    - `to`: target (`to name bucket`, or `to genitive this ti obj`).
    - `from`: secondary operand (`from num 3`, `from genitive this ti fromindex`).
    - `fromindex` / `toindex`: loop counter and bound.
    - `consequence`: attached sentence for conditionals (`then` mood).
  - Optional `exists` flag declares a name. Without `exists`, assigning to a new name is an error.
  - `become`/`fromstate`/`tostate` are used by translation/compile verbs to select source/target languages.
  - Genitives (`this ti obj ti num`) traverse fields on the current sentence; `this` refers to the incoming sentence/registers.

## Moods
- `ya`: declarative fact (stores to memory; compiler treats as declarations/assignments).
- `do`: imperative (invokes verbs, ceremonies, arithmetic, logging, compile/understand).
- `def` / `prah`: enclose a ceremony definition body.
- `then`: conditional consequence stored on a `do` sentence with `tiny`/`giant`/`equally`.

## Declaration and Assignment
- `exists subj name alpha obj num 1 be number ya` declares `alpha` as a number sentence.
- Reassigning requires the name to exist (runtime error otherwise).
- Text uses `obj text "hello"`; numbers use `obj num 1`.
- Permanent values use `be permanent number/text` (compiled to `const` in JS).

## Arithmetic Verbs
- `be add/subtract/multiply/divide` operate on `obj num` and `to` target.
- `remains` computes modulus; `from num` sets the divisor. Targets can be names or genitives.
- Text concatenation uses `be add` with `obj text ...`.

## Conditionals
- `obj … be tiny/giant/equally from … then <sentence>` compares left vs right and executes the consequence.
- LHS/RHS can be numbers, names (resolved to sentence.obj fields), or genitives on `this`.

## Logging
- `be say` logs `obj text`, or resolves `obj name`/genitive to a value. JS backend uses `console.log`; C uses `printf`.

## Memory Access
- Interpreter uses `remember(name)` to fetch stored sentences.
- Compiler emits a `remember` helper for JS to resolve names/objects when needed (e.g., ceremony targets or external globals).

## Ceremonies (Functions)
- Defined with `subj name X be ceremony def … subj name X be ceremony prah`.
- Bodies are `do` sentences; `ret`/`return` is implicit if a `return` statement is emitted, otherwise the incoming sentence is returned.
- Invocation uses `be X … do` (signature words derive the function name in compiled code).
- Genitive `this` accesses the incoming sentence registers; `remember` inside a ceremony can load targets from `sentence.to`.

## Loops
- `fromindex <start> [toindex <bound>] be <ceremony> do` runs a loop:
  - JS uses `runLoop(sentence, fn)` helper (inclusive toindex). If `toindex` absent, counts down to 0.
  - C emits a `for` loop with the same semantics.
- Within the ceremony, `this ti fromindex ti num` reads the current counter.

## Translation / Compile Verbs
- `understand`: parse Pyash text to JSON sentences, optionally writing to a name or filename.
- `compile`: transpile Pyash to target (`javascript`, `c`, `pyash`, `english`), supporting `from text/filename` and `to text/filename/name`.
- Inline quoted blocks can use `quoted.<lang>. … .<lang>.quoted`; `\n` is unescaped automatically before parsing.

## Errors and Guards
- Assigning to undeclared names (missing `exists`) raises an error at compile time for `ya` sentences.
- Conditionals or verbs without registered handlers error during interpretation.
- Compilers include TODO comments for unsupported constructs (e.g., C string concat).
- Vector compile: JS supports vector literals (`obj ve/vec num ... be vector`) and `produce` (dot product) for inline and named vectors; C vector codegen is still TODO.
- Vector addressing: use `via space` → `at` for zero-based indexing (`obj name doors via space num 0 be read …`). `ord N` sugar maps 1→0, 2→1, etc. `invert` flips truth/lie text values or boolean vectors in-place.
- Mind compile: JS emits a synchronous call to an Ollama-compatible endpoint using stored mind configs (`be mind ya` with `from`/`as`/`accordingto`) or call-local prompt/model; outputs go to stdout and `globalThis` by subject name.
- Keep example outputs in git-ignored paths (e.g., `examples/out/`).

## Examples
- Declare and add:
  - `exists subj name bucket obj num 0 be number ya`
  - `obj num 2 to name bucket be add do`
- Loop:
  - `to name counter fromindex num 3 be loop body do`
- Ceremony:
  - ```
    subj name add two to name bucket be ceremony def
    obj num 2 to name bucket be add do
    subj name add two be ceremony prah
    ```
- FizzBuzz (compiled to JS): see `examples/pyash/compile-fizzbuzz.txt`.
