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

## VLIW execution flow

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

## First NASM slice

The initial executable backend is deliberately small: it accepts anonymous
text-literal codelets (`be text`, with an `ob text` value), embeds their
original 16-word vectors, and emits a signature-derived dispatch table plus a
Sysh-style handler call. The handler renders each text result to standard
output. This is a result-display convention for the bootstrap example; it does
not add or claim support for a VLIW `write` operation. Other VLIW semantics
fail compilation until they have an explicit NASM handler.

`examples/pyash/nasm-hello-world.pya` is the first source fixture. Its message
is split across two text codelets to fit the existing fixed-width VLIW layout.
The integration quiz lowers that source to a `.pyac` pack, compiles it with
`fromstate pyac tostate nasm`, assembles with `nasm -f elf`, links with
`ld -m elf_i386`, and verifies the executable prints `Hello, world!`.

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
