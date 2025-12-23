# Handoff / Pending Work

## Open tasks
- Finish 100-doors: add a guardable map/loop combo so only every Nth door toggles per pass, and wire a ceremony that reads indices via the evoker registers (`this ti atindex ti num`) and pass counters via `by` (`this ti by ti num`). Add a passing quiz and example.
- Map writeback: per-element ceremonies in `at all` still need to persist mutations (see TODO in `quiz/map.test.mjs`).
- Mind: keep per-bucket history (fromtext) working; streaming mind path still TODO.

## Status notes
- Map “at all” now exercised by multiple passing quizzes (invert, parity-based toggle, atindex exposure). Compiler prelude includes clone + remember; interpreter map helper reset conditions per element.
- Genitive tests (interpret/compile) are in place; signature enforcement active for ceremony calls.
- `write` verb provides console output; fizzbuzz compile fixed with genitive registers.

## Quick next steps
1) Implement per-element writeback for ceremonies used via `at all` and re-enable the increment test.
2) Build the 100-doors quiz/example on top of the stabilized map semantics.
3) Revisit mind streaming/history after core map/loop work is green.
