Pyash CLI helpers
=================

Three convenience scripts live at the repo root:

- `./interpret` starts the interactive REPL (backs `node program/main.mjs`).
- `./run <file.pya>` executes a Pyash program file through the interpreter (same as `node command/run_pya_program.mjs file.pya`).
- `./compile` wraps common compile flows.

Global CLI (recommended):

- `pyash run <file.pya>` — same runtime as `./run`.
- `pyash repl` — same as `./interpret`.
- `pyash configure` — interactive setup menu.
- `pyash configure channel` — interactive channel setup menu.
- `pyash configure channel list` — list available channel caterers.
- `pyash configure channel matrix` — matrix channel wizard.
- `pyash configure channel matrix test` — run matrix connectivity/auth checks.
- `pyash configure channel matrix doctor` — diagnose stored matrix setup.

Install globally:

```bash
npm link
```

`./compile` usage
-----------------

Two modes:

1) File → file (explicit paths):  
   `./compile <input.pya/txt> <output.js|output.c|output.txt> [target-state]`  
   Example: `./compile examples/pyash/compile-fizzbuzz.txt examples/out/compile-fizzbuzz-output.js javascript`

2) Inline Pyash sentence (any cases/prepositions):  
   `./compile from filename "examples/pyash/compile-fizzbuzz.txt" from state pyash to filename "examples/out/compile-fizzbuzz-output.js" to state javascript`  
   If you omit a mood, `./compile` appends `be compile do` for you.
   You can also use `become <state>` sugar, e.g.  
   `./compile from filename examples/pyash/compile-vector-produce.txt become javascript`

Notes:
- `./run` and `./compile` accept `--full` to echo the program before the result.
- `./compile` prints the compiled artifact (e.g., JS/C text) to stdout when the result carries a `text` payload; the output file you provided is still written. Pass `--gross` if you want the JSON envelope instead.

FizzBuzz quick checks
- Interpret: `./run examples/pyash/fizzbuzz.pya`
- Compile to JS: `./compile examples/pyash/compile-fizzbuzz.txt examples/out/compile-fizzbuzz-output.js javascript`
- Compile to C: `./compile examples/pyash/compile-fizzbuzz.txt examples/out/compile-fizzbuzz-output.c c`
- Full-length compile (1..100): `./compile examples/pyash/compile-fizzbuzz-100.txt examples/out/compile-fizzbuzz-100-output.js javascript`
- Inline sentences are accepted when the provided path does not exist.
- Genitive order is root-first: `this ti ob ti num` means `this.ob.num` (avoid reversed chains like `num ti this ti ob`).

Compile-to-C status (quick reality check):
- Verified by gcc+run quizzes: scalars (`number`/`text`), `write`, `plus`/`subtract`/`remains` (`fmod`), `equally`/`tiny`/`giant` with `then`, loops (`fromindex`/`toindex`), vectors (read/write + print), maps/JSON maps, JSON import/export, CSV read/write, and YAML read/write (when libyaml is available).
- Mind tool calling now matches interpreter/JS for the `interpret` tool (requires libcurl and a running mind backend).
- Still incomplete: higher-level translation paths (JS/interpreter only; C parity deferred).

Stability notes and workflow guardrails live in `README.md` under "Stability Notes" and "Rules of the Road".
