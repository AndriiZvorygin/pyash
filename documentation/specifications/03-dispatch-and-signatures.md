# Dispatch and Signatures

## 1. Purpose
Define how signature words are derived and used for dispatch.

## 2. Terms
- signature: official word list `be <verb> <case> <type> ...`.
- handler: built-in verb implementation.
- ceremony: user-defined verb with a registered signature.

## 3. Rules (normative)
- Dispatch is **signature-based**, not verb-based: each distinct case/type shape is its own dispatch target.
- Dispatch is signature-first: derive signature words, then resolve to a ceremony (if registered) or a handler.
- If multiple ceremonies register the same signature, the most recent registration wins and a warning is emitted.
- Case order is normalized using the official compositional keyword order (`01-sentence-and-grammar.md`).
- Sequence registers (`fromindex`, `toindex`, `atindex`) are ignored when matching ceremony signatures.
- Literal `wo` values contribute their literal word to the signature words (e.g., `from wo microphone` derives `from wo microphone`), enabling strict literal dispatch.
- If a ceremony body reads sequence registers via `this`, include those cases in the definition to make the dependency explicit.
- If no handler or ceremony matches, raise `be error do` with the derived signature.

## 4. Error contracts
- Unknown verb/signature raises `be error do` (see `quiz/ceremony_signature_inconsistency.test.mjs`).
- Signature derivation failures raise `be error do` (see `quiz/derive_signature` references below).
- Surfaced errors MUST follow `06-errors.md`, including `from filename`, `by num`, and `at la … ko` when available.

## 5. Examples (existing files only)
- Run: `examples/pyash/ceremony-plus-two.pya`

## 6. Tests that define truth
- `quiz/ceremony_signature_inconsistency.test.mjs`
- `quiz/ceremony_sequence_signature.test.mjs`
- `quiz/map_signature.test.mjs`
