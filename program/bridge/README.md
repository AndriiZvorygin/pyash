# Bridge helpers

Bridge routes Pyash sentences by mood and verb:

- `index.mjs` — main entry; delegates to helpers and exports `interpret` + `allRemember`.
- `state.mjs` — shared execution state (last condition, evoker refs, definition stack).
- `conditions.mjs` — handles `then` mood using verb-specific comparisons.
- `returns.mjs` — manages `this` bindings and `ret` merges inside sandpits.
- `imperative.mjs` — handles `do` mood (verbs and ceremony invocation).
- `sandpit.mjs` — loop/ceremony runners that isolate sandpit execution and merge results.

Memory/verbs/logging are injected into helpers to keep cross-module dependencies explicit.
