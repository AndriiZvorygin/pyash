# Handoff / Pending Work

## Open tasks
- Finish 100-doors: add a guardable map/loop combo so only every Nth door toggles per pass, and wire a ceremony with correct genitive order (`this ti at ti num`, `this ti pass ti num`). Add a passing quiz and example.
- Add dedicated genitive quizzes (added): `quiz/genitive_interpret.test.mjs`, `quiz/genitive_compile.test.mjs`. Keep enforcing root-first genitives.
- Ensure mind per-bucket history covers fromtext/from and defaults; streaming mind path still TODO.

## Status notes
- Map “at all” works for primitive verbs in interpreter and compiler; compile prelude includes clone + remember. Vector at-index invert works and is tested (interpret + compile).
- `say` verb added for simple console output.
- Genitive guidance added to usage.md; handed-off tests cover genitive in interpreter and compile.

## Quick next steps
1) Implement the guarded toggle for 100 doors (use `atindex`+`pass` in map/loop).
2) Add an example for 100 doors once green.
3) Keep mind streaming and window/bucket refinements on deck.
