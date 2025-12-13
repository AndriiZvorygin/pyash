# Handoff / Pending Work

## Open tasks
- Finish JS compilation support for `at all` (vector map/foreach). A simple “increment zeros to ones” case is in `quiz/compile_map_at_all.test.mjs` but currently fails; generated JS needs a `structuredClone` fallback and the ceremony body must mutate/return correctly.
- Extend `runAtAll` prelude emission to include a clone shim and ensure `remember` exists in the sandbox when compiled JS is executed.
- Make the 100-doors flow compile/run by building on the `at all` map path.

## Status notes
- `program/verbs/exchange/compile.mjs` emits `runAtAll(...)` when seeing `at name all` calls to known ceremonies (non-C); map shim is in the JS prelude.
- `remains` and signature inference now accept `thisRef` for registers; map helper carries `by/fromindex/toindex` into `this` per element.
- `quiz/compile_map_at_all.test.mjs` was added to cover “increment every element” via `at all`, but it fails due to missing `structuredClone` shim and sandbox `remember` when running the compiled JS.

## Quick next steps
1) Add `structuredClone` fallback to the JS prelude when `usesMapShim` is set.
2) Ensure the remember shim is emitted/usable in the vm sandbox for compiled tests.
3) Re-run `quiz/compile_map_at_all.test.mjs` and fix ceremony mutation/return so vector ends `[1,1,1]`.
4) Once the simple case is green, extend to the 100-doors example and add docs/examples.
