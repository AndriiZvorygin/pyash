# Dispatch and Signatures

## 1. Purpose
Define how signature words are derived and used for dispatch.

## 2. Terms
- signature: official word list `be <verb> <case> <type> ...`.
- handler: built-in verb implementation.
- ceremony: user-defined verb with a registered signature.

## 3. Rules (normative)
- Dispatch is signature-first: derive signature words, then resolve to a handler or ceremony.
- Case order is normalized (sorted by case name).
- Sequence registers (`fromindex`, `toindex`, `atindex`) are ignored when matching ceremony signatures.
- If a ceremony body reads sequence registers via `this`, include those cases in the definition to make the dependency explicit.
- If no handler or ceremony matches, raise `be error do` with the derived signature.

## 4. Error contracts
- Unknown verb/signature raises `be error do` (see `quiz/ceremony_signature_mismatch.test.mjs`).
- Signature derivation failures raise `be error do` (see `quiz/derive_signature` references below).

## 5. Examples (existing files only)
- Run: `examples/pyash/ceremony-add-two.pya`

## 6. Tests that define truth
- `quiz/ceremony_signature_mismatch.test.mjs`
- `quiz/ceremony_sequence_signature.test.mjs`
- `quiz/map_signature.test.mjs`
