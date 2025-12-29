# Specifications Index

Purpose: provide the normative specs for Pyash. Each module follows the same template and links to existing examples and quizzes.

Reading order (core):
1. `01-sentence-model.md`
2. `02-moods-and-memory.md`
3. `03-dispatch-and-signatures.md`
4. `04-ceremonies-and-this.md`
5. `05-control-flow.md`
6. `06-errors.md`

Recommended practice loop
1. Read `01-sentence-model.md`, then run `examples/pyash/compile-add-to-js-text.pya`.
2. Read `02-moods-and-memory.md`, then run `examples/pyash/fizzbuzz.pya`.
3. Read `03-dispatch-and-signatures.md`, then trigger a signature mismatch (see `quiz/ceremony_signature_mismatch.test.mjs`).
4. Read `04-ceremonies-and-this.md`, then run `examples/pyash/ceremony-invoke.pya` and `examples/pyash/ceremony-add-two.pya`.
5. Read `05-control-flow.md`, then run `examples/pyash/insertion-sort.pya`.
6. Read `06-errors.md`, then run `quiz/exists_do.test.mjs` and inspect `err.sentence`.

Feature specs (optional, when blessed):
- `20-arithmetic.md`
- `21-vectors.md`
- `22-understand.md`
- `23-compile.md`
- `24-mind.md`
- `30-maps.md` (once map semantics are locked)
- `50-modules.md` (v0.1)
- `40-aspect.md` (v0.6 target; add when Week 1 freezes)
