# Sysh and Pyash sentence-pattern integration

This directory imports the primary Sysh 0.3 alpha source as the assembly
precursor. Generated binaries, the Darcs database, and the duplicate release
archive are intentionally omitted. The import fixes two small blockers in the
old runner: the build now links ELF32 explicitly and fails on build errors, and
input reads from stdin with EOF terminating the interpreter instead of
overrunning its line buffer.

## Dispatch model

Sysh's original `src/search.asm` performs textual dictionary lookup: it finds
one token by name and returns that word's code address. That remains useful as
historical interpreter behavior, but it is not the dispatch contract for
Pyash sentences.

The Pyash-facing operation lookup is a sentence pattern, matching the existing
signature-first interpreter in `program/bridge/signature/`:

```text
verb + canonical case keywords + value types -> operation handler
```

For example, a numeric addition pattern is distinguished by its `plus` verb,
the `from` and `to` cases, and their numeric value types. Runtime values are
inputs to the selected operation; they are not part of its dispatch identity.
The same verb with a different case or value type resolves to a different
pattern.

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

## Integration boundary

The existing Pyash signature registry is the authority for sentence-pattern
lookup. A future Sysh execution backend should consume or generate dispatch
entries from those signatures rather than maintain a parallel word dictionary
for operation selection. Sysh's stack and register conventions can inform the
backend calling convention, but they do not redefine Pyash cases, signatures,
HNUCs, or the VLIW codelet layout.
