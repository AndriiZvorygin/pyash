# Signature module contract

- normalize.mjs: canonicalize signature words and case/type inputs.
- registry.mjs: store and look up signature -> ceremony/handler mappings.
- derive.mjs: derive signature words from ceremony definitions and calls.

Expected behavior
- `joinSignatureWords` must return a stable, space-joined key.
- Registry lookups are pure map reads; clearing resets all state.
- Derivation throws on missing type words; call sites should surface errors.
