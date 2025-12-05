# Handoff Summary

## Changes since last checkpoint
- Signature-first dispatch is back on: `handleImperative`/`handleCondition` derive signatures from calls, look up registered signature handlers first, and definitions register signatures on `def`. The verb map is empty and built-ins register through `program/verbs/index.mjs`.
- `deriveSignatureFromCall` now throws if any case cannot yield type words; name lookups default to `["name","num"]` when the fact is missing, so undefined names can still build a signature key.
- Built-in signature tables tweaked: regulation verbs list `subj num` + `from num`; `produce` now registers `by/obj vec num to name num`; `compile` uses `obj name to name`; `mind` uses `obj text to name text`.
- Docs: README now notes signature-first dispatch and mentions `chip`; `documentation/decisions.md` updated to say signature dispatch restored. (But `documentation/signature.md` still has older caveats at the bottom—see gaps.)
- Tests: `npm test` currently green.

## Current quiz status
- `npm test` → pass.

## Notable behaviors/decisions
- Signature registry exists, but if no handler matches the derived signature, the bridge falls back to the single registered handler for that verb (via `lookupHandlersForVerb`). Because several signatures are mismatched, this fallback is currently how most verbs resolve.
- `deriveSignatureFromCall` now throws on missing type words; this will surface if a call lacks type info that can be inferred.
- Conditionals still resolve `subj`/`from` names to facts before comparison; errors if `subj` is unknown.

## Remaining gaps / follow-ups
- Align built-in `signatureWords` with actual call shapes so dispatch doesn’t rely on the single-handler fallback. Mismatches: `produce` (should include `from name vec num` as used in tests), `compile` (tests use `obj name ... from state ... to state ... to name ...`), `mind` (registration/invocation currently omits `obj`), regulation verbs probably want `name num` cases instead of bare `num`, etc.
- Once signatures align, decide whether to drop/limit the single-handler fallback to make signature dispatch meaningful.
- `documentation/signature.md` still ends with text saying signature dispatch was removed/TODO to reintroduce; update section 9/10 to reflect the restored implementation and remove the stale TODO list.
- Check type inference defaults (`["name","num"]` for unknown names) and whether they match the intended signature scheme (text/vec cases may need better inference).

## Handy commands/examples
- Run all quizzes: `npm test`
- REPL sanity: `node program/main.mjs`

## Files of interest
- `program/bridge/imperative.mjs`, `program/bridge/conditions.mjs`: signature-first dispatch with single-handler fallback.
- `program/bridge/signature.mjs`: signature derivation/registry; stricter type-word enforcement.
- Verb signatures to audit: `program/verbs/mathematics/produce.mjs`, `program/verbs/exchange/compile.mjs`, `program/verbs/mind/mind.mjs`, `program/verbs/regulation/*.mjs`.
- Doc drift: `documentation/signature.md` (section 9/10), `README.md`, `documentation/decisions.md`.
