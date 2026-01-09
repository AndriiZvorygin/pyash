# Examples List

These are the canonical, runnable examples. When updating specs or docs, prefer referencing these paths instead of duplicating full scripts.

| Concept | Example(s) |
| --- | --- |
| Sentence basics | `examples/pyash/add-basic.pya` |
| Ceremonies | `examples/pyash/ceremony-add-two.pya`, `examples/pyash/ceremony-invoke.pya` |
| Conditionals | `examples/pyash/fizzbuzz.pya`, `examples/pyash/tiny-conditional.pya` |
| Loops | `examples/pyash/doors-loop-10.pya`, `examples/pyash/insertion-sort.pya` |
| Vectors | `examples/pyash/vector-write-index.pya`, `examples/pyash/vector-invert-boolean.pya` |
| Sieve | `examples/pyash/sieve-10.pya`, `examples/pyash/sieve-100.pya` |
| Maps (Pyash) | `examples/pyash/map-def-golden.pya`, `examples/pyash/word-frequency.pya` |
| JSON maps | `examples/pyash/json-map-canonical.pya`, `examples/pyash/pyash-to-json-canonical.pya`, `examples/pyash/json-to-pyash-golden.pya` |
| CSV maps | `examples/pyash/csv-roundtrip.pya`, `examples/pyash/bank-transaction-roundtrip.pya`, `examples/pyash/payment-entry-roundtrip.pya` |
| YAML maps | `examples/pyash/pyash-yaml-pyash-roundtrip.pya` |
| Compile JS/C | `examples/pyash/compile-fizzbuzz.txt`, `examples/pyash/compile-text-to-js-text.pya` |
| Parse/understand | `examples/pyash/understand-to-file.pya` |
| Modules | `examples/pyash/module-import-full.pya`, `examples/pyash/module-import-full-paths.pya` |
| Mind | `examples/pyash/mind-tool-call.pya`, `examples/pyash/mind-parity.pya` |
| Tool envelope / again | `examples/pyash/again-demo.pya`, `examples/pyash/again-newspaper.pya` |
| Refinery | `examples/pyash/refinery-basic.pya`, `examples/pyash/refinery-mind-say-hear.pya`, `examples/pyash/refinery-mind-say-hear-fixture.pya` |
| Subordinate clauses | `examples/pyash/subordinate-clause-golden.pya` |
| Command / say | `examples/pyash/command-espeak.pya`, `examples/pyash/say-espeak.pya`, `examples/pyash/say-piper.pya` |
| Hear / keyboard stream | `examples/pyash/hear-stream-keyboard.pya` |

Notes:
- Mind examples expect an Ollama server; say/command examples may require `piper`, `espeak-ng`, or other local tools.
- Some examples write outputs under `examples/out/` or `quiz/sandpit/`.
