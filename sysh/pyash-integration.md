# Sysh and Pyash sentence-pattern integration

This directory imports the primary Sysh 0.3 alpha source as the assembly
precursor. Generated binaries, the Darcs database, and the duplicate release
archive are intentionally omitted. The import fixes two small blockers in the
old runner: the build now links ELF32 explicitly and fails on build errors, and
input reads from stdin with EOF terminating the interpreter instead of
overrunning its line buffer.

## Dispatch model

Sysh's original `src/search.asm` performs dictionary lookup over textual word
names and returns a code address. Its lookup-and-call structure is a useful
assembly-runtime skeleton for VLIW execution. The generated backend should
adapt that dictionary to canonical Pyash sentence representations rather than
look up English spellings or a single source token. Canonical vocabulary and
case identities provide the lookup terms.

The operation lookup is a sentence pattern, matching the existing
signature-first interpreter in `program/bridge/signature/`:

```text
verb + canonical case keywords + value types -> operation handler
```

For example, a numeric addition pattern is distinguished by its `plus` verb,
the `from` and `to` cases, and their numeric value types. Runtime values are
inputs to the selected operation; they are not part of its dispatch identity.
The same verb with a different case or value type resolves to a different
pattern. A generated assembly dictionary may encode these patterns in the
canonical VLIW vocabulary representation, but its entries must be derived from
the existing Pyash signature contract rather than define a parallel dispatch
meaning.

## Two VLIW execution paths

PyAC has two deliberately separate consumers. Both use the same `.pyac`
sentence encoding, but they execute it at different times:

| Path | When sentence patterns resolve | What runs | Entry point |
| --- | --- | --- | --- |
| Runtime interpreter | While the program runs | Sysh-style VLIW decode and pattern dispatch | `./run program.pyac` or `pyash run program.pyac` |
| Ahead-of-time compiler | While compiling | Target-native instructions selected during compilation | `./compile from filename program.pyac fromstate pyac to filename program.asm tostate nasm be compile do` |

The runtime interpreter reads its `.pyac` file from disk; it does not embed
the program in the executable. Build the 32-bit Linux NASM interpreter with:

```sh
bash sysh/build-vliw-interpreter.sh
```

This produces the ignored binary `sysh/bin/pyac-run`. The regular `run`
command dispatches `.pyac` files to that binary. Its initial supported slice
is a named ASCII text declaration followed by one or more `write` sentences.
Malformed packs and unsupported sentence patterns fail visibly. Runtime input
bindings, mutable variables, and general-purpose operations are not part of
this initial interpreter slice.

To lower the shared Pyash hello-world source into the runtime format, use
`./compile from filename examples/pyash/nasm-hello-world.pya fromstate pyash
to filename examples/out/nasm-hello-world.pyac tostate pyac be compile do`.

## Runtime interpreter dispatch model

The program instruction pointer addresses the current 16-word VLIW codelet.
The execution loop decodes its canonical sentence fields into the verb, mood,
and active case/value registers. It then looks up the handler code address for
the sentence pattern and calls that handler using the target's calling
convention. The handler interprets the register state as the Pyash sentence,
executes it, and returns; the loop advances the program instruction pointer to
the next codelet. The program instruction pointer and the handler address are
distinct: one locates the VLIW instruction, while the other selects its
implementation.

This follows Sysh's existing lookup-then-indirect-call shape (`codeGet`, then
`call eax`) while replacing its single-word textual match with canonical
sentence-pattern dispatch. It does not require a hardware interrupt; dispatch
is a normal software execution step.

The interpreter's VLIW instruction pointer addresses the current 16-word
codelet. It gathers continuation vectors until the completion bit closes a
sentence, decodes the canonical verb, mood, and case/value registers, then
dispatches the recognized sentence pattern to its operation handler. This
runtime loop is the Sysh/Forth-inspired interpreter path.

## Ahead-of-time compilation

The NASM AOT backend decodes supported `.pyac` sentence patterns at compile
time and emits direct target instructions. Its output contains static text
constants and direct calls to the output helper; it does not embed the VLIW
stream, interpreter loop, `codeGet` lookup, or a runtime dispatch table. The
declaration is resolved as static data, while each `write` becomes native
output instructions. Unsupported semantics fail compilation until the
backend has an explicit lowering for them. The existing C backend is a
separate AOT target and remains unchanged by the runtime interpreter.

`examples/pyash/nasm-hello-world.pya` is the shared source fixture. Its message
is declared as a named text value and then explicitly written. It can be
compiled to `.pyac`, interpreted by `./run`, or compiled to the existing C and
NASM AOT targets. The integration quizzes verify that the runtime interpreter
and each compiled executable print exactly `Hello, world!` followed by a
newline. The NASM AOT output is assembled with `nasm -f elf` and linked with
`ld -m elf_i386`.

## Case registers

Each of the 36 canonical cells in the compositional case grid has a distinct
virtual case-register slot. Pyash's core nominative (`su`) and accusative
(`ob`) roles occupy two additional slots, using their existing `na` and `ka`
case identities. The deterministic mapping is exposed by
`program/library/compile/sysh_case_registers.mjs` and tested in
`quiz/sysh_case_registers.test.mjs`.

The slot is selected by the canonical case keyword, which retains its
context/axis meaning. It must not be selected by case HNUC alone: several grid
cells intentionally reuse a HNUC, such as `from`, `fromperson`, `fromgroup`,
and `fromtext`, while remaining distinct sentence cases and registers.

These 38 slots are virtual registers, not physical x86 registers and not
positions in a 16-word VLIW codelet. A target backend is responsible for
allocating active slots to physical registers and spilling the rest to its
frame or working storage. The codelet continues to carry the encoded sentence;
the case-register layout describes where a decoded case value is made
available to the selected operation.

Verb and mood have a separate two-slot control bank. The verb participates in
the dispatch key; mood is carried as execution control and is not added to the
existing signature key.

Each VLIW word is 16 bits. Therefore a 32-bit target register can carry a
two-word compound inline, while a 64-bit register can carry four words. The
capacity helper `syshCompoundWordCapacity` expresses this target-width rule;
it does not change the codelet's fixed 16-word size or imply that larger
compounds cannot be represented across multiple registers or memory.

The eight grid cells whose vocabulary identities are still unassigned reserve
their deterministic virtual slots but are marked non-encodable. The mapping
does not allocate HNUCs or weaken the VLIW encoder's rejection of those cells.
The verb and mood remain dispatch/control fields rather than argument
registers.

`prepareSyshSentencePattern` adapts a parsed sentence without changing the
Pyash signature contract. Its `patternKey` is the exact existing multi-dispatch
key (verb + case keywords + value types); its `caseRegisters` carry the values
for the active case slots, and its `controlRegisters` carry verb and mood.
Equal patterns with different runtime values share a dispatch key, while a
changed case or type selects a different pattern.

`lookupSyshSentencePattern` resolves that key through Pyash's existing
signature-handler and ceremony registries. An assembly backend can emit a
dictionary of corresponding handler addresses, with entries generated from
those same signatures.

## Integration boundary

The existing Pyash signature registry is the authority for sentence-pattern
lookup. A Sysh-based execution backend uses its assembly structure and
lookup/call conventions, while deriving its canonical pattern dictionary from
those signatures. Sysh's stack and register conventions can inform the backend
calling convention, but they do not redefine Pyash cases, signatures, HNUCs,
or the VLIW codelet layout.
