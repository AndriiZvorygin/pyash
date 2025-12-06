# Examples

This folder collects runnable/walkthrough examples to help future assistants and contributors find reference scenarios quickly.

- `examples/core/` — minimal, happy-path interactions that show the baseline language flow (parsing, moods, verbs like add/read) and can double as smoke checks.
- `examples/features/` — focused samples for specific capabilities or new verbs (mind, understand, compositional roles), kept small and self-contained.
- `examples/pyash/understand-to-file.pya` — minimal script that parses stored text and writes JSON to `quiz/sandpit/understand-output.json` via `be understand do`.
- `examples/pyash/understand-file-to-file.pya` — parses Pyash text directly from `quiz/sandpit/compile.txt` and writes JSON to `quiz/sandpit/understand-output.json`.
- `examples/pyash/compile-file-to-js.pya` — compiles Pyash text from `quiz/sandpit/compile.txt` to JavaScript in `quiz/sandpit/compile-output.js`.
- `examples/pyash/compile-text-to-js-text.pya` — compiles inline Pyash text to JavaScript (with `const` for `permanent` facts) and stores the JS in a text target.
- `examples/pyash/compile-text-to-c-text.pya` — compiles inline Pyash text to C declarations and stores the C code as text.
- `examples/pyash/translate-text-to-english.pya` — translates inline Pyash text to simple English sentences and stores the result as text.
- `examples/pyash/compile-add-to-js-text.pya` — compiles an inline add program to JavaScript, emitting the expected assignment for `collector = collector + 2;`.
- `examples/pyash/compile-add-to-c-text.pya` — compiles an inline add program to C, emitting a `double` declaration and an updated assignment.
- `examples/pyash/translate-add-to-english.pya` — translates an inline add program to English text (`collector is number 0`, `collector is add do`, etc.).
- `examples/pyash/compile-subtract-to-js-text.pya` — compiles an inline subtract program to JavaScript.
- `examples/pyash/compile-subtract-to-c-text.pya` — compiles an inline subtract program to C.
- `examples/pyash/translate-subtract-to-english.pya` — translates an inline subtract program to English.
- `examples/pyash/compile-multiply-divide-to-js-text.pya` — compiles inline multiply/divide to JavaScript.
- `examples/pyash/compile-multiply-divide-to-c-text.pya` — compiles inline multiply/divide to C.
- `examples/pyash/translate-multiply-divide-to-english.pya` — translates inline multiply/divide to English.
- `examples/pyash/translate-english-to-pyash.pya` — translates controlled English lines back into Pyash sentences.
- `examples/bugs/` — reproductions of known or fixed issues; use to verify regressions and document tricky edge cases.
- `examples/docs/` — documentation-oriented snippets or transcripts (e.g., REPL walkthroughs) that illustrate concepts for readers without running code.
