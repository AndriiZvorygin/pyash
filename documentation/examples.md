# Examples

This folder collects runnable/walkthrough examples to help future assistants and contributors find reference scenarios quickly.

Notes:
- Some examples rely on external services or binaries (for example, mind examples need an Ollama server; say/command examples may require `espeak-ng`).
- Several examples write outputs under `examples/out/` or `quiz/sandpit/`; keep those locations writable and git-ignored.
- To run the example suite with optional skips, use `command/run_examples.sh` (see flags in the script header).

- `examples/core/` — minimal, happy-path interactions that show the baseline language flow (parsing, moods, verbs like plus/read) and can double as smoke checks.
- `examples/features/` — focused samples for specific capabilities or new verbs (mind, understand, compositional roles), kept small and self-contained.
- `examples/pyash/understand-to-file.pya` — minimal script that parses stored text and writes JSON to `quiz/sandpit/understand-output.json` via `be understand do`.
- `examples/pyash/understand-file-to-file.pya` — parses Pyash text directly from `quiz/sandpit/compile.txt` and writes JSON to `quiz/sandpit/understand-output.json`.
- `examples/pyash/compile-file-to-js.pya` — compiles Pyash text from `quiz/sandpit/compile.txt` to JavaScript in `quiz/sandpit/compile-output.js`.
- `examples/pyash/compile-text-to-js-text.pya` — compiles inline Pyash text to JavaScript (with `const` for `permanent` facts) and stores the JS in a text target.
- `examples/pyash/compile-text-to-c-text.pya` — compiles inline Pyash text to C declarations and stores the C code as text.
- `examples/pyash/translate-text-to-english.pya` — translates inline Pyash text to simple English sentences and stores the result as text.
- `examples/pyash/compile-plus-to-js-text.pya` — compiles an inline plus program to JavaScript, emitting the expected assignment for `collector = collector + 2;`.
- `examples/pyash/compile-plus-to-c-text.pya` — compiles an inline plus program to C, emitting a `double` declaration and an updated assignment.
- `examples/pyash/translate-plus-to-english.pya` — translates an inline plus program to English text (`collector is number 0`, `collector is plus do`, etc.).
- `examples/pyash/compile-subtract-to-js-text.pya` — compiles an inline subtract program to JavaScript.
- `examples/pyash/compile-subtract-to-c-text.pya` — compiles an inline subtract program to C.
- `examples/pyash/translate-subtract-to-english.pya` — translates an inline subtract program to English.
- `examples/pyash/compile-multiply-divide-to-js-text.pya` — compiles inline multiply/divide to JavaScript.
- `examples/pyash/compile-multiply-divide-to-c-text.pya` — compiles inline multiply/divide to C.
- `examples/pyash/translate-multiply-divide-to-english.pya` — translates inline multiply/divide to English.
- `examples/pyash/translate-english-to-pyash.pya` — translates controlled English lines back into Pyash sentences.
- `examples/pyash/translate-javascript-to-pyash.pya` — translates simple JavaScript assignments/arithmetic back into Pyash sentences.
- `examples/pyash/compile-conditional-to-js-text.pya` / `compile-conditional-to-c-text.pya` — compile a tiny/then plus into JS/C.
- `examples/pyash/compile-mixed-to-js-text.pya` — shows `exists` declaration, reassignment, and conditional plus compiled to JS.
- `examples/pyash/vector-write-index.pya` — writes a vector element by index and prints the updated vector.
- `examples/pyash/word-frequency.pya` — word-frequency via ceremony + map update (word-agnostic).
- `examples/pyash/translate-conditional-to-english.pya` / `translate-conditional-from-english.pya` — translate conditionals between Pyash and English.
- `examples/pyash/fizzbuzz.pya` — interpreter fizzbuzz (1..15) using loop + inline `then`.
- `examples/pyash/fizzbuzz-100.pya` — interpreter fizzbuzz (1..100) using the same loop ceremony.
- `examples/pyash/fizzbuzz-return-line.pya` — build a fizzbuzz line as text, return it, and `write` outside the line builder.
- `examples/pyash/fizzbuzz-one-write.pya` — build all fizzbuzz lines into one output string, then `write` once at the end.
- `examples/pyash/sieve-10.pya` — sieve-style composite marking with nested loops and vector writes (shared interpreter/JS/C).
- `examples/pyash/sieve-100.pya` — sieve-style composite marking for 1..99 with primes list output (shared interpreter/JS/C).
- `examples/pyash/insertion-sort.pya` — insertion sort with nested loops and vector swaps (shared interpreter/JS/C).
- `examples/pyash/compile-fizzbuzz-100.txt` — compile-ready fizzbuzz (1..100) text for JS/C targets.
- `examples/pyash/compile-fizzbuzz-return-line.txt` — compile-ready return-line fizzbuzz for JS.
- `examples/pyash/fizzbuzz-one-write.pya` — compile-ready single-write fizzbuzz output for JS.
- `examples/bugs/` — reproductions of known or fixed issues; use to verify regressions and document tricky edge cases.
- `examples/docs/` — documentation-oriented snippets or transcripts (e.g., REPL walkthroughs) that illustrate concepts for readers without running code.
