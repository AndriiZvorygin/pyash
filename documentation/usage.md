Pyash CLI helpers
=================

Three convenience scripts live at the repo root:

- `./interpret` starts the interactive REPL, or interprets one complete sentence when given one.
- `./run` executes a Pyash program file through the existing runner.
- `./compile` validates and runs the filename-to-filename compile case through the existing compiler.

These wrappers are caller-cwd commands. The wrapper resolves its internal adapter and
runner paths from the wrapper directory; user paths are resolved from the directory in
which the command is invoked. Quote one argv value when a path contains spaces.

Global CLI (recommended):

- `pyash run <file.pya>` — same runtime as `./run`.
- `pyash repl` — same as `./interpret`.
- `pyash configure` — interactive setup menu.
- `pyash configure intro` — onboarding launcher with recommended setup order.
- `pyash configure orchestrator` — orchestrator endpoint and service behavior setup.
- `pyash configure channel` — interactive channel setup menu.
- `pyash configure channel list` — list available channel caterers.
- `pyash configure channel matrix` — matrix channel wizard.
- `pyash configure channel matrix test` — run matrix connectivity/auth checks.
- `pyash configure channel matrix doctor` — diagnose stored matrix setup.
- `pyash configure mind` — multi-relay mind setup with one selected default relay.
- `pyash configure agent` — agent management menu (`list`, `establish`, `improve`, `delete`).
- `pyash calendar health|begin|stop|restart|list` — scheduler controls and health surface.
- `pyash channel poll` — run one channel poll cycle now for debugging.
- `pyash channel log` — tail latest channel telemetry log for an agent/channel.

Install globally:

```bash
npm link
```

`./compile` usage
-----------------

The canonical case form is:

```text
./compile from filename <source> [fromstate <source-state>] \
  to filename <destination> [tostate|become <target-state>] [be compile do]
```

`fromstate pyash` is the default source state and `tostate javascript` is the
default target state. `become <target-state>` is the destination-state spelling
accepted by the parser; `tostate <target-state>` is accepted as its alias. The
`be compile do` suffix is optional and the wrapper supplies it when omitted. If
it is present, it must be exactly `be compile do`.

For example, these forms are equivalent:

```bash
./compile from filename examples/pyash/compile-fizzbuzz.txt \
  to filename examples/out/compile-fizzbuzz-output.js
./compile from filename examples/pyash/compile-fizzbuzz.txt fromstate pyash \
  to filename examples/out/compile-fizzbuzz-output.js tostate javascript be compile do
```

The established positional form remains available:

```text
./compile <source> <destination> [target-state]
```

It uses `pyash` as the source state and `javascript` when the target state is
omitted. Other case shapes, verbs, and incomplete cases are rejected with the
compile usage contract and exit status `1`.

Notes:
- Successful compilation writes the destination file. The wrapper emits no
  compiled-artifact body on stdout; runner operational hints may appear on stderr.
- Compile runtime failures retain the runner's Pyash error sentence on stderr and
  exit `1`; wrapper contract failures print concise usage on stderr and exit `1`.

`./run` usage
-------------

The canonical case form is:

```text
./run from filename <program> [runtime input binding words]
```

The existing positional form `./run <program> [runtime input binding words]`
continues to work. The binding tail is passed to the established runner without
changing its contract, including explicit bindings such as:

```bash
./run from filename examples/pyash/summarize-from-filename.pya \
  ob filename ./notes.txt to name source
```

Missing or unavailable program files are wrapper errors. Malformed or rejected
binding tails remain runner errors such as `input binding defective`. All such
errors use exit status `1`; successful runs use exit status `0`. Program output
is emitted on stdout. Relative program and binding paths retain caller-cwd
semantics.

`./interpret` usage
-------------------

With one argument, the wrapper parses and interprets one complete Pyash sentence:

```bash
./interpret 'ob text "hello from one shot" be write do'
```

The sentence must contain a parser-recognized mood and verb. It is serialized
with the canonical Pyash sentence renderer before being handed to the existing
REPL entry point. Semantic program output and the REPL result are on stdout;
contract/runtime errors are on stderr with exit status `1`. With no arguments,
`./interpret` retains the interactive `program/main.mjs` REPL. This root wrapper
is distinct from the Pyash foreign-script verb `be interpret do`, which executes
an embedded language/script sentence inside a Pyash program.

For all three wrappers, argv boundaries are preserved by the JavaScript adapter:
quote a path or sentence value containing spaces as one shell argument. No
timestamps, run IDs, duration hints, or temporary paths are part of the stable
semantic output contract.

FizzBuzz quick checks
- Run: `./run examples/pyash/fizzbuzz.pya`
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
