# Ceremonies and `this`

## 1. Purpose
Define ceremony definition/invocation, `this` access, and return behavior.

## 2. Terms
- ceremony: a `def`/`prah` block that defines a verb.
- evoker: the `do` sentence that calls a ceremony.
- register: loop/map fields on the evoker (`fromindex`, `toindex`, `atindex`, `by`).

## 3. Rules (normative)
- A ceremony is defined by `su name X be ceremony def` and closed by `su name X be ceremony prah`.
- The evoker’s signature must match the ceremony’s signature (sequence registers are allowed on the evoker even if omitted in the definition).
- `this` refers to the evoker sentence inside the ceremony body.
- If a ceremony is defined more than once, the later definition takes priority (emit a compile-time warning).

## 4. Error contracts
- Signature inconsistency raises `be error do`.

## 5. Examples (existing files only)
- Run: `examples/pyash/ceremony-invoke.pya`
- Run: `examples/pyash/ceremony-plus-two.pya`

## 6. Tests that define truth
- `quiz/ceremony_signature_inconsistency.test.mjs`
- `quiz/ceremony_overwrite_warning.test.mjs`
- `quiz/compile_ceremony_overwrite_warning.test.mjs`
