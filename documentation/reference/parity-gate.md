# Parity gate and semantic authority

Status: reference contract for the declared result-level parity gate. The
normative behavior remains the numbered specifications; this document records
which implementation is authoritative for each surface and how drift is caught.

## Authority map

| Surface | Normative implementation | Conformance targets |
| --- | --- | --- |
| Pure codelets and programlets | Rust CPU (`rust/pyac`) | CUDA, WebGPU, RISC-V; JavaScript lowering is a producer, not an authority |
| Full Pyash with host effects | JavaScript interpreter (`program/`) | compiled JavaScript and compiled C |
| Run recording, newspaper, artifacts | JavaScript interpreter | compiled backends must match the declared record shape |
| VLIW catalogue and packs | spec 27 and the shared Rust runtime | `command/vliw_gpu_conformance.mjs` |

When two implementations disagree, the normative column wins. A target that
disagrees is a defect, not a second definition.

## Parity classes

Every verb family and signature declares one class:

- `core` — interpreter, compiled JavaScript, and compiled C must agree.
- `pure` — Rust CPU and the GPU targets, gated by the VLIW conformance matrix.
- `host` — interpreter only, behind a named gate and a stated reason.
- `experimental` — no parity obligation yet, stated explicitly.

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

The first declared families are green:

- text fact write
- boolean composition over `exists` leaves (`and`, `or`, `not`)
- filename `touch` result

The first four pinned divergences:

| Case | Interpreter | Compiled JS | Compiled C | Reason |
| --- | --- | --- | --- | --- |
| numeric fact write | `7` | `result` | `result` | compiled `write` emits the name, not the resolved value |
| ceremony numeric result | `7` | `undefined` | `0` | compiled backends do not resolve a numeric ceremony result |
| file read result | file contents | filename | filename | compiled `read` result is the locator, not the contents |
| nested comparison leaves | `lie` | exit 1 | exit 1 | compiled backends fail `la ... ko` comparison leaves |

These are work items, not accepted behavior. The pin exists so a fix is visible
and so new drift cannot hide behind a success-only check.

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
