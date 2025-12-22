# Moods and Memory

## 1. Purpose
Define mood behavior (`ya`, `do`, `def`, `prah`, `then`) and memory rules.

## 2. Terms
- memory: last-write-wins store of sentences keyed by `subj name`.
- sandpit: temporary memory context used while running ceremonies/loops.
- exists: declaration flag on `ya` sentences.

## 3. Rules (normative)
- `ya` stores a fact in memory. `exists` is only valid on `ya` sentences.
- `do` executes a verb or ceremony; it does not store a new fact unless the verb returns one.
- `def` / `prah` wrap ceremony definitions. Bodies are stored for later invocation.
- `then` is used as a consequence sentence attached to conditionals.
- Memory is last-write-wins by subject name for non-definition sentences.
- Sandpits isolate side effects during ceremony/loop execution; merged results return to main memory.

## 4. Error contracts
- `exists` on a `do` sentence raises `be error do` (see `quiz/exists_do.test.mjs`).

## 5. Examples (existing files only)
- Run: `examples/pyash/fizzbuzz.pya`
- Run: `examples/pyash/ceremony-invoke.pya`

## 6. Tests that define truth
- `quiz/exists_do.test.mjs`
- `quiz/loop.test.mjs`
