# Pyash VLIW Compiler Architecture

**Status:** End-to-end architecture guide. The ISA and pack references linked
below remain authoritative for their respective contracts. This guide separates
implemented behavior from the intended sectioned program and backend design.

## Purpose

Pyash sentences remain the semantic source. VLIW is their compiled form, not a
second language with unrelated instructions. The target is a readable,
sectioned VLIW program whose code consists of full Pyash action sentences
encoded as legacy codelets, and whose named data is also described with Pyash
vocabulary and sentences.

The `.data`, `.symtab`, and `.text` names are useful assembly-format analogies;
they are not directives to add to Pyash source. Pyash atoms and compounds name
the concepts, and compilation derives the machine-oriented symbol index.

## End-to-End Flow

```text
Pyash source (.pya)
  -> parse and normalize to canonical Pyash sentences
  -> resolve vocabulary identities and sentence effects
  -> separate variable-declaration sentences from action sentences
  -> derive a deterministic name/type/location/extent index
  -> lower representable sentences into legacy 16-bit words
  -> group words into 16-word VLIW codelets
  -> persist a PyAC pack (.pyac)
  -> execute in a conforming runtime or lower to a backend
```

The planned logical data section is described in Pyash, not as a raw `.data`
block. The selected `data` sense is WordNet `n:08479331-n` (“a collection of
facts from which conclusions may be drawn”), linked to the Pyash compound
`drut hnuc`. The variable atom is `prif`; the more specific WordNet sense
`n:05866043-n` (“a quantity that can assume any of a set of values”) also has
the accepted compound `hnuc prif` (“number + variable”). Each declaration
sentence supplies the semantic facts needed to identify a named variable; the
compiler derives its symbol/index records. The exact storage layout and
mutability/runtime contract remain future format work.

The code section contains action sentences. Their verbs, moods, cases, value
types, and dependencies must survive VLIW lowering. A codelet may be emitted
only when that sentence has a proven legacy encoding; unsupported sentences
fail explicitly rather than losing fields or being converted to opaque text.

## Vocabulary Is Part of the Compiler Contract

VLIW words and compounds must resolve to the intended sense, not merely to a
matching English spelling. For vocabulary research, use the repo's
[`kwon` lookup reference](kwon-lookup-indexes.md), the
[`pyash-vocab-tooling` skill](../../skills/pyash-vocab-tooling/SKILL.md), and
the source commands:

```bash
node command/vocab_suggest.mjs "data"
node command/vocab_suggest.mjs "variable"
node command/vocab_suggest.mjs n:08479331-n
# After npm link, the same lookup is available globally:
kwon n:08479331-n
```

The current starting points are the `data -> drut hnuc` compound and the
`prif` variable atom; keep the specific `variable quantity -> hnuc prif`
compound distinct when choosing the intended sense. Check any additional
section, declaration, or action terms against their POS-qualified WordNet
senses and the canonical Pyash vocabulary before assigning them VLIW meaning.

## Artifacts and Boundaries

| Surface | Role | Current status |
| --- | --- | --- |
| Pyash `.pya` source | Canonical sentence and paragraph semantics | Implemented language/interpreter surface |
| Searchable `.pya` VLIW catalog | Semantic identity, provenance, and query/replay view | Separate from a program's source file and from its packed bytes |
| `.pyac` pack | Header plus deterministic fixed-width codelet bytes | Version 1 is a flat codelet sequence; no data/code sections or mutable variable store |
| JavaScript VLIW facade | Reference lowering, decoding, effects, and supported execution | Partial semantic coverage, with explicit rejection for unsupported forms |
| C output from `.pyac` | Compile supported codelets to C, then use the host C compiler | Verified arithmetic and invert subset; not a general Pyash-to-C replacement |
| Rust and RISC-V | Decode/execute supported PyAC semantics; direct RISC-V instruction/ELF prototype | Narrow subset; the generated RISC-V image is not emulator-executed |

The general Pyash-to-JavaScript/C compiler is a distinct route. Its existence
does not mean arbitrary Pyash programs already pass through VLIW. Likewise,
the searchable `.pya` catalog is a semantic/provenance projection; `.pyac` is
the executable byte projection.

## Backend Direction

Backend outputs should be generated from decoded PyAC semantics, preserving
the interpreter's behavior:

```text
PyAC -> C source -> host C compiler -> native executable       (implemented subset)
PyAC -> NASM source -> NASM/linker -> native executable         (target)
PyAC -> RISC-V assembly -> RISC-V assembler/linker -> ELF       (target)
PyAC -> direct RISC-V instruction encoding -> ELF               (narrow prototype)
PyAC -> LLVM IR or other backends                               (later targets)
```

NASM and RISC-V assembly are intended readable compiler outputs, not new
source-language syntax. The direct RISC-V encoder remains a useful independent
backend/prototype; it does not replace the planned RISC-V assembly emitter. Each
backend needs an explicit target ABI, data layout, calling convention, and
conformance path before it can claim native execution support.

## Evolutionary Function Workloads

**Status:** design contract; no GPU evolutionary-function runtime is implied.

The useful unit for evolutionary programming is a small, typed function, not
the whole Pyash interpreter or the host-side evolution loop. Pyash sentences
remain the function's semantic source; its VLIW body is the candidate evaluated
by a reference executor or a target backend.

### Lwonprom Evidence

The current Lwonprom C implementation is a source of patterns and seed
functions, not an existing GPU evaluator:

- In `Lwonprom/program/lwonprom.c`, an individual is a `Paragraph` of Pyash
  lines. `TrainingSequence`
  holds input and expected-output phrases. `program_quiz` applies a candidate
  to each training input through `knowledge_interpret`, and `health_assess`
  combines output deviation with a program-length economy term.
- `population_quiz` evaluates candidates serially. `evolve_generation` ranks
  them, then refreshes the population by retaining champions, mutating copies,
  and introducing new individuals. This host orchestration is separable from
  the embarrassingly parallel candidate-by-example evaluation workload.
- `Lwonprom/program/math.c` provides small seed operations: saturating 16-bit
  addition, saturating 64-bit subtraction, 64-bit multiply/divide/XOR/complement,
  and repeated-multiply exponentiation. Their current edge semantics are not
  all safe to inherit: division by zero has no guard, unsigned overflow behavior
  is implicit in the C types, and exponentiation has no work bound. The
  candidate contract below requires those cases to be made explicit first.
- The current `Lwonprom/program/lwonprom.cl` kernels are experimental stubs,
  not a parallel port of the population/evaluation loop. Do not use their
  existence as evidence that GPU evolution is implemented.

### Candidate Contract

An accepted candidate has a closed, versioned function contract:

| Property | Required contract |
| --- | --- |
| Signature | Explicit parameter names, value types/widths, return shape, and calling convention. |
| Semantics | Defined integer overflow, saturation/wrapping, signedness, division-by-zero, and comparison behavior; identical in the reference executor and every backend. |
| Effects | Deterministic and side-effect-free during evaluation. Random mutation is seeded and performed by the host evolution process, not by the candidate. No I/O, network, clock, model call, or undeclared memory access. |
| State | Locals and writable state are declared with fixed extents. Until the named-data/symbol contract is implemented, candidate functions must stay within the currently supported stateless subset. |
| Control flow | A finite control-flow graph with cyclomatic complexity at most 9. No recursion or unbounded loops. Loops are accepted only with a statically verifiable iteration bound. |
| Work bound | A profile-supplied instruction/step budget and fixed input extent. Statically reject candidates whose worst-case work exceeds the budget; enforce a runtime step counter in the reference evaluator. |
| VLIW representation | A function body may span multiple codelets. The 16-word codelet is an encoding unit, not a function-size limit or a register file. Grammatical cases describe operand roles; the target ABI maps values to virtual/physical registers or memory. |

Define cyclomatic complexity from the candidate CFG itself as `M = E - N + 2P`
(edges, nodes, and connected components), and require `M <= 9`. Do not rely on
a source-language complexity tool's displayed score unless its exact metric is
known to match this definition. Complexity is a hard admission gate; fitness
must not reward a semantically incorrect function for being small.

### Evaluation and GPU Boundary

The evaluation input is a deterministic set of `(arguments, expected result)`
examples, analogous to Lwonprom's `TrainingSequence`. Each candidate/example
pair is independent and can be executed in parallel. A first evaluator should:

1. Reject malformed signatures, unsupported effects, unbounded control flow,
   and budget violations before dispatch.
2. Execute each valid candidate against every example with the reference
   semantics and record output, exact-match status, and consumed steps.
3. Reduce per-example results into a fitness record. Correctness is primary;
   code size and measured work may break ties among correct candidates.
4. Keep mutation, champion selection, durable job control, and artifact
   persistence in the host/Pyash layer. A GPU backend batches candidate/example
   execution and returns bounded results; it does not own session state or
   replace the Pyash scheduler.

The initial GPU-eligible subset should be pure integer functions over fixed
input/output buffers. Use one logical work item per candidate/example pair,
then reduce results per candidate. Keep candidate code and test vectors
resident across a batch where the backend allows it. Any target-specific
optimization remains behind the same semantic conformance tests, with a
correct fallback for devices lacking that feature.

The function instruction budget and maximum input extent are profile values
that still need calibration against the actual VLIW executor and target
hardware; they are deliberately not guessed here. Before enabling GPU
evaluation, the project still needs a VLIW representation for function
signatures and bounded control flow, plus the typed named-data/symbol contract
for locals. The first implementation slice should be a CPU reference evaluator
for bounded candidate semantics, using existing VLIW operations where
representable and explicit tests for the arithmetic operations above.

## Implementation Milestones

1. **Vocabulary and declarations:** confirm the data/variable senses and
   select any missing atoms or compounds through Kwon/vocabulary tooling.
2. **Section and symbol contract:** define how declaration sentences and action
   sentences are distinguished, how the symbol index is derived, and how a
   versioned PyAC representation preserves v1 compatibility.
3. **Mutable execution:** implement typed named storage, initialization,
   reads/writes, and dependency effects; prove parity with interpreted Pyash.
4. **Assembly backends:** emit NASM and RISC-V assembly from decoded PyAC,
   assemble/link them, and compare native results with the reference executor.
5. **Broader coverage:** expand supported sentence families and add LLVM or
   other destinations only behind the same semantic conformance tests.

## Current Reproducible Slice

The verified source-to-executable example lowers three constant arithmetic
sentences from Pyash to `.pyac`, emits C, compiles it with `cc`, and prints
`42`, `40`, and `42`:

```bash
./run examples/pyash/compile-vliw-constant-arithmetic.pya
cc -std=c11 -Wall -Werror -o examples/out/vliw-constant-arithmetic examples/out/vliw-constant-arithmetic.c
./examples/out/vliw-constant-arithmetic
```

The relevant contracts and implementation evidence are in
[`27-pyash-vliw-isa.md`](../specifications/27-pyash-vliw-isa.md),
[`pyac-vliw-database.md`](pyac-vliw-database.md),
[`pyac-vliw-semantic-slices.md`](pyac-vliw-semantic-slices.md), and the
[RISC-V prototype note](../suggest/riscv-vliw-backend.md).
