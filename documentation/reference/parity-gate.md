# Parity gate and semantic authority

Status: reference contract for the declared result-level parity gate. The
normative behavior remains the numbered specifications; this document records
which implementation is authoritative for each surface and how drift is caught.

## Authority map

| Surface | Normative implementation | Conformance targets |
| --- | --- | --- |
| Pure codelets and programlets | Rust CPU (`rust/pyac`) and spec 27 | CUDA, WebGPU, RISC-V; JavaScript lowering is a producer, not an authority |
| Legacy Pyash interpreter | none — historical, flawed, out of scope on the VLIW branch | not a conformance target |
| Compiled JavaScript and C | must match the declared spec semantics | compared against the spec, not against the legacy interpreter |
| VLIW catalogue and packs | spec 27 and the shared Rust runtime | `command/vliw_gpu_conformance.mjs` |

When two implementations disagree, the normative column wins. A target that
disagrees is a defect, not a second definition.

The JavaScript interpreter (`program/`) is a **historical implementation**. It is
not the authority for anything, and its behavior is not a target. On this
branch it is out of scope except where a spec sentence has no Rust
implementation yet. Where the legacy interpreter diverges from spec 27 or the
declared signature tables, the legacy behavior is the defect. Do not encode
interpreter quirks into compiled backends to make them "match".

## Parity classes

Every verb family and signature declares one class:

- `core` — compiled JavaScript and compiled C agree with the declared spec semantics.
- `pure` — Rust CPU and the GPU targets, gated by the VLIW conformance matrix.
- `host` — explicitly out of parity scope, with a stated reason.
- `legacy` — behavior only the historical JavaScript interpreter implements;
  recorded, never used as an expectation.

A new verb or a changed signature declares its class in the review that adds it.
`core` changes must pass the gate.

## What the gate checks

`npm run parity:gate` runs the declared corpus in
`program/library/parity/cases.mjs`. Each case runs in its own temporary
directory on every declared backend, and stdout is normalized by replacing the
temporary path with `<tmp>`.

Two case forms:

- `expected: "same"` — every backend must exit zero and print identical lines.
- per-backend `expected` plus `known` — a pinned divergence. The gate fails if
  any backend changes, whether it regresses or is fixed; update the pin
  deliberately with the change that causes it.

The declared corpus is green:

- text fact write
- boolean composition over `exists` leaves (`and`, `or`, `not`)
- filename `touch` result
- literal arithmetic writing `result` (`plus`, `subtract`, `multiply`, `divide`, `remains`, `exponential`, `xor`)
- division-by-zero rejection with exit 1, no stdout, and the same `divide: by cannot be zero` message
- ceremony numeric result
- file read contents
- nested comparison leaves

The earlier pinned divergences were fixed in the compiler: literal arithmetic
now writes the `result` fact, `read` exposes the contents as `result`, a
ceremony's default return propagates its mutated destination, and
`boolExprForClause` handles `equally`/`tiny`/`giant` leaves.

Literal arithmetic accepts the second operand in any operand case (`to`,
`from`, `with`, `by`). Per the VLIW ISA the phrase's case is just its actual
case, so one role is not privileged over another. An earlier revision of this
file restricted the roles per verb because the historical interpreter did; that
encoded interpreter quirks into the compiler and was wrong.

Recorded legacy-only behavior, not a target:

- the historical interpreter returns nothing for `ob … to … be subtract`,
  `ob … to … be multiply`, and `ob … from … be xor`, although the declared
  signature tables accept those shapes.

When the gate runs a case where the legacy interpreter disagrees with the spec,
mark the case `legacy` and pin only the compiled backends; do not pin the
interpreter as an expectation.

The pinned-case mechanism remains available for future disagreements. A pin may
also declare `stderrMatch`, so an error case is proven equivalent rather than
only matching its exit code.

## Adding a case

1. Add an entry to `program/library/parity/cases.mjs` with `family`, `name`,
   `backends`, and `lines`.
2. Use `expected: "same"` only when all declared backends already agree.
3. If they do not, pin the exact per-backend `{ code, lines }` and add a
   `known` reason.
4. Run `node command/parity_gate.mjs` and `node --test quiz/parity_gate.test.mjs`.

Cases must be deterministic and free of host effects (mind, say, command,
network, wall-clock time). Those belong to the `host` class and are excluded.

## Relationship to other checks

- `command/run_parity_examples.mjs` runs every example through the three
  backends and checks success only. It remains useful as a smoke sweep.
- `command/vliw_gpu_conformance.mjs` is the `pure` gate for the Rust CPU and
  GPU runtimes. It is not duplicated here.
- `documentation/parity-checklist.md` tracks the broader gates; gate 8 refers to
  this corpus.
