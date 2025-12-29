# Control Flow

## 1. Purpose
Define official conditionals and loop semantics.

## 2. Terms
- conditional: `tiny`/`giant`/`equally` with an inline `then` consequence.
- loop: invocation with `fromindex` (and optional `toindex`).

## 3. Rules (normative)
- Conditional form is `ob … be tiny/giant/equally from … then <sentence>` and executes the inline consequence immediately when true.
- Loop semantics:
  - `fromindex <start> [toindex <bound>] be <ceremony> do` runs the body and stops when `fromindex === toindex` (or `fromindex === 0` if `toindex` is absent).
  - When `toindex` is present, the supervisor steps `fromindex` toward `toindex` by +/- 1 each iteration.
  - Indexing is 0-based.

## 4. Error contracts
- Invalid conditionals or unknown verbs raise `be error do`.

## 5. Examples (existing files only)
- Run: `examples/pyash/fizzbuzz.pya`
- Run: `examples/pyash/insertion-sort.pya`

## 6. Tests that define truth
- `quiz/conditional_inline.test.mjs`
- `quiz/loop.test.mjs`
- `quiz/compile_loop_js.test.mjs`
