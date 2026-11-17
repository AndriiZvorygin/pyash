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
compiler derives its symbol/index records. The hosted programlet currently
implements only invocation-local unsigned 16-bit numeric slots; indexed
storage and broader runtime support remain future format work.

### Hosted PyashForth Memory Direction

The first PyashForth runtime is hosted on Linux; MCU platform support follows
after the language and image contracts stabilize. The first implemented
memory slice is local to each ceremony invocation, adapting Lwonprom's
per-recipe variable pile rather than adding program-wide mutable state:

```text
exists su name count ob num 0 as name variable be number ya
ob num 1 to name num count be plus do
su name count ret
```

`as name variable` declares a mutable numeric local, and
`as name permanently number` declares a read-only constant quantity. The
declaration value initializes the slot. Locals are limited to unsigned
16-bit numbers, must be declared before actions, and are available only in
that ceremony invocation. A typed `to name num <slot>` action updates the
slot in place; the slot disappears on return. The implementation reuses the
existing `as` sentence field and vocabulary compounds, so the v1 codelet
layout remains unchanged. See
[`vliw-programlet-local-slots.pya`](../../examples/pyash/vliw-programlet-local-slots.pya)
and `quiz/vliw_programlet_local_slots.test.mjs`.

The intended broader memory profile is:

| Memory item | Hosted runtime contract |
| --- | --- |
| Named constant quantities | Read-only numeric slots initialized by declarations in one invocation |
| Named variables | Unsigned 16-bit numeric slots initialized by declarations and updated in place during one invocation |
| Local bulk memory | Named pages reserved by a separate Pyash allocation sentence; zero-filled or initialized from a quoted payload |
| Lifetime | Slots and writable pages are discarded when the invocation returns |
| Logical page | 16 VLIW codelets, or 512 bytes; independent of Linux's physical VM page size |

`quoted.<kind> ... .<kind>.quoted` carries a long payload. Its kind is retained
as metadata external to the payload, and the payload itself remains exact. A
quote does not allocate or imply mutability. In a future indexed `.pyac`
image, a quote descriptor can associate its kind, encoding, and extent with
the named payload. A writable page initialized from a quote belongs to the
invocation frame; runtime writes do not rewrite the source declaration or
packed image. Debug/replay history is separate from the live slot value.

The quote parser currently extracts the payload but drops the block kind, the
VLIW sentence encoder currently emits text as a paragraph-letter quote, and
the assembly runtime remains a named-text-and-write proof. General quote-kind,
mutable-page, and non-numeric slot behavior remain target contracts, not
current runtime capabilities. Vocabulary lookup found the existing variable
and constant-quantity concepts. `initialize` has the relevant WordNet sense
`v:00700896` (“assign an initial value to a computer program”), linked to
Open English WordNet 2025 `v:00702662-v`, but `pyash dict initialize` still
reports no direct Pyash suggestion. The allocation term also needs a reviewed
Pyash spelling. Select and validate source sentence vocabulary before
implementing those forms rather than inventing a word or HNUC here.

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
| `.pyac` pack | Header plus deterministic fixed-width codelet bytes | Version 1 is a flat codelet sequence; no embedded data/code sections or mutable variable store; the interpreter allocates implemented numeric locals per invocation |
| JavaScript VLIW facade | Reference lowering, decoding, effects, and supported execution | Partial semantic coverage, including the canonical Pyash programlet v1 slice below |
| C output from `.pyac` | Compile supported codelets to C, then use the host C compiler | Verified arithmetic and invert subset; not a general Pyash-to-C replacement |
| Shared VLIW semantics runtime | `rust/pyac-vliw-core/src/semantics_runtime.rs`, compiled as a `no_std` Rust library and called by the CPU pack interpreter and GPU kernels | Canonical codelet families plus one bounded local-number programlet path on CPU and GPU; not yet full Pyash interpreter parity |
| Rust-GPU native | Rust-GPU compiles that same semantics runtime to Vulkan SPIR-V for the native Housekeeper worker | Requires an NVIDIA discrete GPU and Vulkan; execution is explicitly bounded to the supported operations |
| Rust and RISC-V | Decode/execute supported PyAC semantics; direct RISC-V instruction/ELF prototype | Narrow subset; the generated RISC-V image is not emulator-executed |

The general Pyash-to-JavaScript/C compiler is a distinct route. Its existence
does not mean arbitrary Pyash programs already pass through VLIW. Likewise,
the searchable `.pya` catalog is a semantic/provenance projection; `.pyac` is
the executable byte projection.

The JavaScript programlet is the current semantic reference for pure functions.
The Rust inventory and per-feature parity status are maintained in
[`pyac-vliw-semantic-slices.md`](pyac-vliw-semantic-slices.md). The first Rust
program-level slice executes one canonical ceremony with uint16 local
quantities, `plus` writes, `ret`, `prah`, and a direct invocation on CPU and
GPU. It does not claim nested-call, programlet-branch, or loop parity.

## Backend Direction

Backend outputs should be generated from decoded PyAC semantics, preserving
the interpreter's behavior:

```text
PyAC -> C source -> host C compiler -> native executable       (implemented subset)
PyAC -> NASM source -> NASM/linker -> native executable         (target)
PyAC -> RISC-V assembly -> RISC-V assembler/linker -> ELF       (target)
PyAC -> direct RISC-V instruction encoding -> ELF               (narrow prototype)
PyAC -> Rust/WASM interpreter -> browser CPU                    (browser pathway)
eligible parallel work -> WebGPU/WGSL compute kernel             (optional browser target)
PyAC -> LLVM IR or other backends                               (later targets)
```

The GPU implementation has one semantic source:
`rust/pyac-vliw-core/src/semantics_runtime.rs`. The
stable Rust CPU pack interpreter calls it directly; Rust-GPU compiles it to
Vulkan SPIR-V for the native worker and to WGSL for the browser pack path. The
native Housekeeper accepts canonical `pyac-pack-execute` jobs only; its worker
does not accept a second named-slot candidate format.

This is semantic parity for the currently implemented bounded VLIW slice, not
for all Pyash. The Rust CPU pack API retains its compatibility fallback for
families outside the semantics runtime; the GPU worker rejects unsupported
codelet groups explicitly rather than silently substituting another
implementation.
See
[`rust/pyac-gpu/README.md`](../../rust/pyac-gpu/README.md) for builds and the
RTX smoke test.

NASM and RISC-V assembly are intended readable compiler outputs, not new
source-language syntax. The direct RISC-V encoder remains a useful independent
backend/prototype; it does not replace the planned RISC-V assembly emitter. Each
backend needs an explicit target ABI, data layout, calling convention, and
conformance path before it can claim native execution support.

### Browser-Deployed Program Pathway

Browser deployment keeps `.pya`, VLIW sentences, and the `.pyac` pack as the
program contract. A Rust runtime can be compiled to `wasm32-unknown-unknown`
and interpret supported PyAC programs on the browser CPU. Browser-specific
input/output and persistence must be supplied through web APIs or a narrow
host interface; the WASM target does not provide ordinary operating-system
services such as filesystem access.

For an explicitly requested pack that passes semantic eligibility, the WASM
host dispatches the generated WGSL kernel through Rust's `wgpu` API. That WGSL
is generated from the same Rust-GPU source and shared semantics runtime as the
native Vulkan shader; it is not a hand-maintained parallel implementation.
The host still validates and groups codelets, manages buffers, and reconstructs
typed results. This does not automatically choose WebGPU by profitability or
execute arbitrary Pyash on the GPU.

```text
browser program (.pyac)
  -> Rust/WASM runtime on CPU
  -> explicit WebGPU request + eligibility validation
  -> WebGPU compute kernel (WGSL) for supported numeric work and bounded selection
  -> VLIW sentence values returned to the runtime
```

WebGPU is an optional, browser-managed device path, not a replacement for the
GPU Housekeeper. A browser runtime must detect WebGPU availability and retain a
correct WASM CPU fallback; WebGPU availability and device limits vary by
browser and machine, and WebGPU requires a secure context such as HTTPS or
localhost. Native Housekeeper jobs remain the path for centrally managed,
durable inference or GPU work. The browser pathway is for work intentionally
deployed to and executed on the user's device. Small workloads should normally
stay on the CPU when dispatch and transfer costs outweigh parallel execution.

The first runnable browser slice is implemented under `rust/pyac-browser/`.
The Rust pack executor and generated WGSL kernel consume the semantics runtime's
supported codelet and bounded numeric-programlet semantics; browser tests verify
the WASM CPU path, WebGPU codelet parity for numeric arithmetic batches and
bounded comparison branches, numeric-programlet CPU/WGSL parity when WebGPU is
available, and CPU fallback when WebGPU is unavailable. The native hardware
smoke exercises the Vulkan counterpart on the RTX 3090. This remains a subset
runtime, not arbitrary Pyash execution.
The WebGPU action is explicit:
the measured arithmetic workload has not established a stable profitable
automatic dispatch threshold on the tested browser, so ordinary pack execution
stays on WASM CPU. WebGL2 may serve graphics fallback needs, but it is not
treated here as an equivalent general compute backend.

#### Current GPU Capability Boundary

The current implementation is one shared VLIW semantics runtime with CPU,
native Vulkan, and browser WGSL targets. Ordinary codelet packs still execute
as sentence groups. A recognized numeric programlet selects a separate
whole-program entrypoint with one invocation-local frame and one typed result.
That initial programlet route is bounded to 64 codelets and 64 local slots; it
is a correctness slice, not yet a batched evolutionary-candidate kernel.

| Capability | Current WebGPU support | Remaining work for broader VLIW coverage |
| --- | --- | --- |
| Numeric scalar operations | Shared-runtime unsigned arithmetic: saturating add/subtract, multiply, nonzero divide/remainder, XOR, exponentiation | Additional operations only where normative Pyash semantics define them |
| Numeric vectors | Shared-runtime elementwise unsigned-16 vectors, widths 2-8 with scalar right operand or widths 2-4 with equal-width vector operand; multiply results widen to unsigned-32 | Vector predicates/masks, wider or dynamic vectors, device-resident inputs/outputs |
| Conditional execution | Canonical `.pyac` path supports flat `equally`, `tiny`, or `giant` numeric predicates with numeric or `truth`/`lie` literal arms | Named operands in predicates, compound/nested branches, ceremony-call arms, conditional side effects |
| Scalar boolean values | `truth`/`lie` literals and bounded comparison branches return typed booleans | Boolean-producing calls and boolean local slots in a shared function frame |
| Program-level numeric locals | Whole-program dispatch supports uint16 variable/constant declarations, `plus` writes, `ret`, and invocation-local frame reset | Other local operators/types, branch state, nested calls, and loop state |
| Loops and calls | Not in the current GPU programlet slice | Bounded loop lowering, function/call frames, explicit control-flow/dependency representation |
| State and memory | Numeric programlets use one isolated local frame per GPU invocation; `.pyac` v1 has no general shared mutable store | General mutable VLIW state, alias rules, host/device residency and lifetime |
| Other value families | Date and supported numeric/bool vector results are interpreted by the semantics runtime; text vectors remain on the Rust CPU fallback | GPU lowering only where parallel execution is useful; otherwise retain explicit CPU operations in mixed plans |
| Coordination | Independent work items in one dispatch | Ordered multi-stage programs, reductions, barriers, atomics, cross-workgroup dependencies |
| Dispatch policy | User-selected GPU action; CPU fallback when unavailable or ineligible | Device checks and a measured model for transfer, launch, occupancy, and data residency costs |

This table defines the implementation boundary, not a requirement that every
Pyash operation run on a GPU. A practical complete runtime needs semantic
parity and an explicit mixed CPU/GPU plan; text handling, filesystem access,
and other serial or host-bound work should remain on the host when that is the
right execution target. Each new GPU slice should match the Rust CPU reference
for values and errors, then be benchmarked end to end before automatic
dispatch is considered.

The shared Rust core covers the scalar pure-operation vocabulary used by
programlets (`plus`, `subtract`, `multiply`, `divide`, `exponential`,
`invert`, `xor`, and `remains`), all three numeric comparison predicates, and
typed `truth`/`lie` results for canonical literal and flat conditional forms.
The CPU pack executor and GPU targets also execute the bounded numeric
programlet slice described above: local uint16 declarations, `plus` writes,
`ret`, and a direct invocation, with frame isolation. GPU dispatch is capped at
64 codelets and 64 local slots. This is still a subset of Pyash execution;
nested calls, local comparisons/branches, and loops remain available only in
the JavaScript reference interpreter. Rust continues to interpret the same
canonical Pyash sentence/codelet encoding rather than a private slot format.

### Browser Pathway Implementation Roadmap

The first deliverable is browser execution for the Rust crate's explicitly
supported PyAC subset, not arbitrary Pyash programs. Completion means a browser
can load a `.pyac` pack, execute supported codelets through WASM, return
deterministic results or explicit unsupported-operation errors, and optionally
execute an eligible batch through WebGPU without changing pack or sentence
semantics. Whether that batch is faster is measured separately before any
automatic dispatch policy is enabled.

| Stage | Work | Exit evidence | Status |
| --- | --- | --- | --- |
| 1. WASM portability | Build the existing `rust/pyac` crate for `wasm32-unknown-unknown`; keep OS and browser APIs outside the semantic core | Native Rust tests pass and the WASM target checks in CI | Complete |
| 2. Pack execution contract | Add one deterministic pack dispatcher for Rust-supported codelet families; preserve per-codelet errors and typed results | Mixed supported packs match individual codelet results; unsupported codelets fail at their exact index | Complete |
| 3. Browser CPU slice | Add a browser host that loads a pack through a user-selected file or fixture and invokes the WASM executor | Chromium smoke checks the result/error path without filesystem permission assumptions | Complete |
| 4. WebGPU batch path | Add optional `wgpu` compute for independent numeric arithmetic and bounded comparison-selection groups; pack decoding and unsupported work remain on CPU | Chromium smoke checks exact CPU/GPU parity for arithmetic, vectors, equality outcomes, and no-WebGPU fallback; native Vulkan smoke covers all comparison operators and typed boolean results | Prototype complete; no auto-dispatch threshold is enabled because a stable crossover has not been established |
| 5. Deployment and maintenance | Document secure-context, browser/device, build, and smoke-test requirements; keep hardware checks separate from ordinary CI | CPU and WASM checks run in CI; local smoke reports adapter availability and measurements | Complete |

Keep the browser host thin and the Rust semantic core reusable by native
targets. Do not add a browser-specific Pyash grammar, change the `.pyac` v1
format, or claim full-language support as part of this roadmap. The `wgpu`
dependency is target-specific to WASM and runtime use remains optional; do not
automatically dispatch until a representative workload demonstrates a stable
win over the CPU path.

## Parallel Execution and CPU/GPU Dispatch

GPU execution is a target choice for work that is both safe to parallelize and
predicted to benefit from the device. "Compute-heavy" alone is not the rule:
large, regular memory-bandwidth workloads can benefit too, while a short,
serial or irregular workload may remain faster on the CPU.

The compiler and runtime make different parts of the decision:

| Stage | Evidence used | Decision |
| --- | --- | --- |
| Semantic eligibility | VLIW read/write effects, dependencies, side effects, control-flow bounds, and target operation support | Whether parallel execution preserves the program's meaning and can be executed safely |
| Profitability estimate | Work-item count, estimated operations per item, bytes read/written, access regularity, branch divergence, per-item state/register pressure, and whether data is already device-resident | Whether CPU or GPU is expected to finish sooner |
| Runtime dispatch | Actual input sizes, available devices, measured per-device costs, and current availability | Select the eligible backend for this invocation, with a correct CPU fallback where supported |

The runtime cost estimate should account for:

```text
CPU: scheduling + execution + memory cost
GPU: launch/dispatch + required host/device transfers
     + device execution + synchronization/result transfer
```

Transfers already avoided by keeping data resident are not charged again.
Profitability should use measured target profiles and a margin that avoids
dispatching marginal workloads to the GPU. If CPU and GPU are both correct,
choose the measured faster path; if the estimate is uncertain, use the
characterized baseline rather than assume the GPU wins. Input cardinality and
residency are runtime facts, so compile-time analysis alone cannot make the
final choice.

VLIW remains the semantic program and value representation: grammatical
cases and quote payloads express arguments, paragraph/ceremony structure
delimits multi-sentence programs, and results are returned as VLIW sentence
values. No second language-level argument or result stream is required.
Device buffers and their layout are implementation details of a backend; they
do not change the Pyash call contract or the frozen flat `.pyac` v1 format.

Natural data-parallel workload families include image/frame transforms,
audio-window processing, bulk table transforms and statistics, large-scale
matching/ranking, particle or cellular simulations, parameter sweeps, and
candidate-program fitness evaluation. These are candidates, not automatic GPU
wins: each must meet the semantic and measured-cost checks above. Small
FizzBuzz runs are useful for correctness and control-flow conformance, not as
a representative GPU throughput benchmark.

## Evolutionary Function Workloads

**Status:** the contract remains normative. A bounded numeric-function
evaluator now runs through Housekeeper, but it is not yet a general Pyash
sentence/codelet executor.

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
| State | Locals and writable state are declared with fixed extents. Invocation-local unsigned 16-bit numeric slots are implemented in the Pyash programlet; target evaluators must account for their per-work-item state and preserve frame isolation. Other types and bulk pages remain future work. |
| Control flow | Finite branches, bounded `fromindex`/`toindex` loops, and acyclic ceremony calls. Recursion is rejected. Complexity at most 9 is a seed-quality target, not a language ceiling. |
| Work bound | A per-invocation step budget, default 65,536 and configurable up to 10,000,000. The reference interpreter enforces it at runtime; straight-line candidates are also checked against the declared budget before dispatch. |
| VLIW representation | A function body may span multiple codelets. The 16-word codelet is an encoding unit, not a function-size limit or a register file. Grammatical cases describe operand roles; the target ABI maps values to virtual/physical registers or memory. |

Define cyclomatic complexity from the candidate CFG itself as `M = E - N + 2P`
(edges, nodes, and connected components), and require `M <= 9`. Do not rely on
a source-language complexity tool's displayed score unless its exact metric is
known to match this definition. Complexity is a hard admission gate; fitness
must not reward a semantically incorrect function for being small.

### Canonical Pyash Programlet Slice

The first ordinary-Pyash programlet proof uses `equally number` (the accepted
Pyash compound for “even”) from
[`vliw-is-even.pya`](../../examples/pyash/vliw-is-even.pya). The source defines
small `truth` and `lie` ceremonies and an `equally number` ceremony. Bare
`prah` sentences close those definitions; the active definition supplies the
association. It uses the existing `remains` and `equally` verbs, a Pyash
conditional with both branches, typed named output, and `ret` mood. It is not
translated into a private instruction-map language.

`program/library/vliw/programlet.mjs` provides the bounded v1 host surface:

- Compile ordinary `.pya` ceremony sentences, plus an optional final invocation,
  into the existing headered `.pyac` pack of 16-word codelets.
- Decode the pack back into the canonical Pyash sentence structures, preserving
  verb, mood, grammatical cases, typed names, values, and conditional branches.
- Execute the decoded pack through the existing Pyash interpreter in an empty,
  isolated memory scope. The invocation's typed `to name` fact is initialized
  as the output slot, then the ordinary ceremony call updates it.
- Deterministically mutate numeric case literals in the original source and
  rank candidates by exact training correctness, then codelet count and
  complexity. A separate held-out set is required for a candidate to be
  reported as validated.

This source-level gate accepts named ceremony definitions, `fromindex`/
`toindex` loops, acyclic ceremony calls, `ret`, numeric locals, scalar
`num`/`bool` results, arithmetic verbs `remains`, `plus`, `subtract`,
`multiply`, `divide`, `exponential`, `invert`, and `xor`, and scalar
`equally`/`tiny`/`giant` comparisons. It rejects recursion, effects/unknown
verbs, and unsupported sentence forms. It has no sentence-count or
cyclomatic-complexity ceiling; the runtime step budget is the execution bound.
Candidate evaluation is sequential because the current Pyash reference
interpreter has process-global memory. It uses deterministic seeded host
mutation and CPU reference execution; this does **not** yet dispatch ordinary
Pyash programlets to Housekeeper or execute their control-flow graphs on a
GPU. The Housekeeper VLIW runtime currently accepts canonical `.pyac` packs
only.

The source-to-pack-to-decoded-interpreter proof and deterministic evolution
checks are covered by:

```bash
node --test quiz/vliw_sentence_program.test.mjs
```

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

The native GPU worker executes supported canonical `.pyac` codelet packs and
the bounded numeric programlet slice through the semantics runtime, failing
explicitly for unsupported shapes. The browser WGSL target is generated from
the same Rust-GPU source and its host selects the same programlet entrypoint.
Neither GPU runtime accepts the removed named-slot candidate batch format.

## Implementation Milestones

1. **Vocabulary and declarations:** complete for the implemented numeric
   scalar slice: existing variable and constant-quantity compounds are used;
   page-allocation terms remain deferred.
2. **Invocation-local memory:** numeric initialization, typed writes,
   constant rejection, per-invocation isolation, and cleanup on return are
   implemented for unsigned 16-bit slots. Page allocation, other value types,
   and quote-kind preservation remain future work.
3. **Section and symbol contract:** define how declarations and actions are
   indexed in a future versioned PyAC image while preserving v1 compatibility.
4. **Broader mutable execution:** extend storage beyond numeric scalars and
   prove parity for each newly supported type and dependency effect.
5. **Assembly backends:** emit NASM and RISC-V assembly from decoded PyAC,
   assemble/link them, and compare native results with the reference executor.
6. **Broader coverage:** expand supported sentence families and add LLVM or
   other destinations only behind the same semantic conformance tests.

## Current Reproducible Slice

The verified source-to-executable example lowers three constant arithmetic
sentences from Pyash to `.pyac`, emits C, compiles it with `cc`, and prints
`42`, `40`, and `42`:

```bash
./run examples/pyash/compile-vliw-constant-arithmetic.pya
cc -std=c11 -Wall -Werror -o examples/out/vliw-constant-arithmetic examples/out/vliw-constant-arithmetic.c
./examples/out/vliw-constant-arithmetic
./run examples/pyash/vliw-programlet-local-slots.pya
```

The local-slot example prints `1`; its focused regression coverage verifies
fresh values across invocations, in-place writes, typed destinations, and
read-only constant quantities.

The relevant contracts and implementation evidence are in
[`27-pyash-vliw-isa.md`](../specifications/27-pyash-vliw-isa.md),
[`pyac-vliw-database.md`](pyac-vliw-database.md),
[`pyac-vliw-semantic-slices.md`](pyac-vliw-semantic-slices.md), and the
[RISC-V prototype note](../suggest/riscv-vliw-backend.md).
