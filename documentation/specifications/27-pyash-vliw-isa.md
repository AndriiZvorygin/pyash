# Pyash VLIW ISA and lowering contract

Status: design specification. This document defines the encoding and execution
boundary for a future Pyash VLIW backend. It does not change the current
interpreter, parser, or sentence ABI.

## 1. Scope and authority

Pyash sentences and paragraphs remain the canonical semantic IR. A source
language front end MUST lower to that IR before it is encoded. VLIW codelets
are a compiled representation of the same sentences, not a second semantic
language. The sentence's mood, verb, cases, values, and dependency effects
remain authoritative after lowering.

This specification revives the encoding and execution model in the
`lwonprom` repository at commit
`b6ef5eefcea4d10b5a0f09680976377ccfb28a35`. The reference material is
`lwonprom/documentation/encoding.tex`,
`lwonprom/documentation/vmOnOpenCL.tex`,
`lwonprom/program/encoding.c`, and
`lwonprom/program/translation.c`. No new word allocation, extension bit, or
sidecar format is defined here. Any implementation that cannot prove
compatibility with that encoding MUST reject the value.

This is an encoding and execution contract. The searchable catalog and
compiled `.pyac` container built on this contract are defined in
`documentation/reference/pyac-vliw-database.md`. This document does not
specify a compiler optimizer, a GPU runtime, a model of host memory, or a new
Pyash command.

## 2. Terms

- **Sentence** is the existing flat Pyash object with `mood`, `be`, and case
  keywords. Its case values are typed semantic values, not display text.
- **Paragraph** is an ordered list of sentences.
- **Semantic instruction** is one sentence together with its normalized read,
  write, control, and effect information.
- **Codelet** is one self-contained independent clause/sentence lowered to a
  sequence of legacy 16-bit words. A paragraph is a sequence of codelets and
  may also contain a multi-clause codelet when the legacy layout permits it.
- **Phrase** is a case/value region in a codelet. Its boundary is represented
  by the legacy index and phrase-marker bits/words, not by a separator string.
- **HNUC** is a current Pyash semantic identity for a word/case. HNUCs are
  validated by the current compositional-case inventory. They are not silently
  interchangeable with the older `lwonprom` phonological word numbers.
- **Canonical bytes** are the little-endian bytes of the exact encoded 16-bit
  words, in codelet order, with no timestamps, addresses, source paths, or
  runtime pointers.

## 3. Lowering pipeline

The required pipeline is:

```text
source language
  -> Pyash sentence/paragraph
  -> canonical sentence normalization
  -> legacy 16-bit word encoding
  -> 256-bit VLIW codelet(s)
  -> dependency-aware execution
```

The source front end is responsible for preserving semantic distinctions while
producing sentences. A human-language gloss, translation pair, or pretty
printed sentence is not execution authority. Existing translation pairs may
provide a presentation or fallback surface, but a backend MUST reject input
whose semantic cases, types, mood, or values cannot be represented in the
canonical sentence and legacy word tables. It MUST NOT drop fields, turn the
whole sentence into an opaque quote, or attach an external executable
sidecar.

Before encoding, normalization MUST:

1. validate the sentence shape and canonical case order;
2. resolve aliases to the current canonical Pyash case/HNUC identity;
3. preserve mood, verb, every case, value type, and paragraph order;
4. derive stable referential identities and read/write effects; and
5. reject an unknown, unassigned, conflicting, or unrepresentable identity.

The lowering result MUST be reproducible: equal canonical sentences and equal
compiler options produce equal words and equal bytes. Timestamps, hash-map
iteration order, memory addresses, worker IDs, and source-language spelling
MUST NOT affect the result.

## 4. Legacy word and codelet encoding

### 4.1 Word classes

Each legacy word is one unsigned 16-bit value. The old encoding packs
phonotactic word classes into the value: `CVT`, `CCVT`, `CVTC`, and `CCVTC`
(with the corresponding grammar/root denotations). The old table reserves
trigger values for short/long grammar and root denotations and for the quote
denote. The word table, including reserved and unused values, is normative;
an implementation MUST import or reproduce that table from the referenced
legacy source rather than assign values from the current Pyash vocabulary.

The quote form uses a five-bit quote-denote field followed by an eleven-bit
quote-sort payload. The payload carries quote region/sequence and scalar or
vector width information in the legacy layout. A zero quote length denotes
raw binary bytes; a non-zero length denotes the number of following 16-bit
fields, with the quote sort describing interpretation. Type compatibility is
checked by the decoder. A quote is therefore a typed value encoding, not a
license to hide an unrepresentable sentence.

The source form `quoted.<kind> ... .<kind>.quoted` is a block delimiter and
payload annotation, distinct from the legacy quote sort. Parsing must retain
the block kind as semantic metadata alongside the payload; it must not fold
the delimiters into the payload or silently discard the kind. The kind is
external to the payload, consistent with the legacy quote model's separation
of value bytes and type information. The flat v1 `.pyac` container has no
general block-kind descriptor, so a v1 pack cannot claim a lossless round-trip
for arbitrary quote kinds. A future indexed container may carry that metadata
in its own quote descriptor, inside the `.pyac` image, without changing the
legacy 16-bit codelet words or allocating new HNUCs.

### 4.2 VLIW shape

The legacy codelet is a vector of sixteen 16-bit words: 256 bits / 32 bytes.
The first word is the head/index word. Its bits mark phrase boundaries and
whether a word is a phrase, case, verb, mood, or continuation according to
the legacy index format. The remaining words hold quote denotations, content,
case/phrase markers, the verb, mood, and zero/unassigned tail words where the
codelet ends early.

The index has two required properties from the legacy VM:

- a completion bit indicates whether the current 16-word vector is the final
  part of a codelet; and
- phrase/mood marker bits identify phrase or mood words relative to that
  completion state.

When a value or clause exceeds one vector, the index marks a partial codelet.
The structural decoder collects the preceding/following vectors in codelet order
until a final index is reached, preserves the vector and index-word evidence,
and validates the flattened word sequence. It MUST reject a missing
continuation, an impossible boundary, a non-zero unassigned tail, or an invalid
quote length. Semantic adapters still require a sentence-specific golden
fixture before execution. The decoder MUST NOT infer missing words from source
text.

The legacy layout is intentionally fixed: one codelet vector is sixteen words, each
word is 16 bits, the head comes first, and byte emission is little-endian per
word. A future physical transport MAY batch codelets, but batching MUST NOT
change codelet bytes or their sentence order.

### 4.3 Compatibility table

An implementation MUST carry an auditable compatibility table with, at
minimum:

| semantic item | required mapping |
| --- | --- |
| current Pyash canonical HNUC/case | exact legacy word identity and word class |
| mood and verb | exact legacy grammar/command identity |
| typed literal | quote sort, length, and field sequence |
| unsupported/unassigned item | explicit rejection reason |

The table is a compatibility artifact, not a place to allocate new IDs. Until
the mapping is proven for an item, that item is unsupported by the VLIW
backend even if it can be printed as readable Pyash.

## 5. Execution contract

Decoding produces semantic instructions with explicit referential inputs and
outputs. Each reference has a stable number, fulfillment state, and value
location in the backend's working memory. Each instruction identifies whether
it reads or writes each reference. There MUST be at most one writer for a
reference in a dependency region; additional uses are readers. A decoder MUST
reject conflicting writers unless the semantic sentence explicitly lowers to
an ordered effect.

An instruction is ready only when all of its required inputs and control
conditions are fulfilled. The executor may place ready independent
instructions in a program queue and execute them out of source order. It MUST
preserve dependency edges, single-writer rules, observable side-effect order,
and paragraph/codelet boundaries. Workers synchronize at evaluation boundaries
before values become visible to dependent codelets.

The execution model has:

- code in immutable/constant codelet storage;
- working/output storage addressed by stable references;
- a program queue for ready work rather than a mandatory program counter;
- worker-local stacks for function-call frames; and
- a completion/history record sufficient to diagnose or replay a codelet.

Branches write a condition/reference and dependent clauses wait on it. A
branch that rejoins MUST use an explicit dependency or function-call boundary.
Static loops are lowered as repeated codelets; dynamic loops require an
explicit continuation/jump reference and a bounded termination rule. A
function call enqueues its body with a local frame and rejoins only after its
declared outputs are fulfilled. Speculative or parallel execution is valid
only for instructions proven independent by these rules.

### Hosted PyashForth memory profile

The hosted JavaScript programlet v1 now implements the first scalar-memory
slice, following Lwonprom's recipe-local variable pile. This profile does not
add program-wide mutable variables. A ceremony body may declare initialized
unsigned 16-bit numeric locals before its actions:

```text
exists su name count ob num 0 as name variable be number ya
exists su name limit ob num 5 as name permanently number be number ya
ob num 1 to name num count be plus do
su name count ret
```

`as name variable` marks a mutable local; `as name permanently number` marks
a read-only constant quantity. The initializer is the declaration's `ob num`
value, so no separate initialization opcode or vocabulary is introduced.
Writes to a mutable slot must use a typed `to name num <slot>` destination.
Declarations follow the containing `ceremony def` and precede its action
sentences. Each invocation gets a fresh slot frame; writes replace the live
slot value while diagnostic history retains the write, and the frame is
discarded when the invocation returns. Constant writes and invalid slot types
fail explicitly.

This implemented slice is intentionally narrow: numeric values in the range
0 through 65535, local to one ceremony invocation. It does not yet implement
logical pages, quoted-payload initialization, other slot types, or an indexed
program image. The v1 pack remains a flat codelet stream; runtime slots are
created by the interpreter rather than stored in a new `.pyac` section.

The broader intended memory profile remains:

- Each ceremony invocation receives its own frame of named typed slots.
  Declarations initialize slots; writes update the slot in place rather than
  appending replacement declaration sentences. Constant quantities are
  read-only. The implemented subset is limited to unsigned 16-bit numbers.
- A frame may reserve zero-initialized logical data pages or initialize pages
  from a quoted payload. A logical page is sixteen 32-byte VLIW codelets, or
  512 bytes. This is a Pyash runtime unit, not a claim about the host or target
  operating system's physical page size.
- Frame slots and writable pages live only for that invocation and are
  discarded on return. Any diagnostic history is separate from runtime state
  and cannot become an unbounded variable store.
- Long `quoted.<kind>` payloads preserve their kind separately from their
  contents. A quote does not allocate writable memory by itself; a separate
  allocation sentence supplies the named extent and initialization behavior.

The page and quote requirements above remain future work. The current slot
surface reuses existing vocabulary compounds and does not assign new HNUCs.
The programlet compiler rejects unsupported declaration and allocation forms
visibly.

The executor MUST expose deterministic failure for malformed codelets,
unfulfilled dependencies, duplicate writers, invalid types, and unsupported
effects. It MUST NOT turn an execution failure into a different successful
sentence.

## 6. Target capabilities and lowering

The portable semantic core is a **minimum target contract, not a ceiling on
performance or expressiveness**. A backend MAY use any instruction, execution
model, memory facility, or accelerator capability exposed by its target. The
compiler MUST preserve the canonical Pyash operation semantics while selecting
the best implementation available for that target.

Each target profile MUST identify its supported capabilities. A capability
implementation may be:

1. **native**, using a target instruction or hardware facility;
2. **lowered**, composed from other supported target operations; or
3. **unavailable**, when the target has no implementation that meets the
   operation's semantic contract.

When multiple implementations are valid, the backend SHOULD prefer the native
or otherwise fastest implementation for the target profile. A compiler or
runtime MAY produce and select multiple variants when the target is known only
at runtime. Capability selection MUST be explicit and reproducible; it MUST NOT
claim support merely because an instruction has a similar name.

An implementation expressed using simpler operations is a valid fallback when
it preserves the operation's specified results, effects, and ordering. If an
operation permits approximate numerical results, its semantic contract MUST
state the permitted tolerance, and every native or fallback implementation
MUST satisfy it. A backend MUST reject an operation when no implementation
satisfies its contract; it MUST NOT silently substitute a merely similar
operation.

This is analogous to importing a library capability: source code depends on a
stable operation contract, and the target backend resolves that contract to a
native implementation or a compatible fallback. It does not require every
target to implement every optional capability natively.

| Operation need | Possible native implementation | Possible fallback |
| --- | --- | --- |
| Integer multiply | Target multiply instruction | Shift/add sequence when the type and cost policy permit it |
| Vector arithmetic | Vector or SIMD instruction | Scalar operations over the elements |
| Matrix multiply | Target matrix/tensor unit | Vectorized or scalar multiply-accumulate |
| Population count | Target bit-count instruction | Shift-and-count sequence or lookup implementation |

These examples describe implementation choices, not new Pyash syntax or
guarantees that every fallback is performant. The common core remains useful
for a first correct implementation; extensions allow optimized lowering on
targets such as x86-64, RISC-V profiles, NVIDIA PTX targets, AMD GFX ISA
targets, and future VLIW ASICs.

Capabilities are target properties, not implicit allocations in the legacy
16-word codelet. This policy does not assign new word identities or reuse
reserved bits. A semantic operation that cannot be represented by the current
legacy mapping remains unsupported by that codelet format until an explicit,
versioned encoding is specified.

## 7. Conceptual interfaces

These signatures describe the semantic boundary. The JavaScript reference
facade below implements the currently proven subset:

```text
lowerSentence(sentence) -> Codelet[] | EncodingError
lowerParagraph(paragraph) -> Codelet[] | EncodingError
decodeCodelet(words) -> SemanticInstruction[] | EncodingError
executeCodelets(codelets, inputs) -> Paragraph | ExecutionError
```

`lowerSentence` and `lowerParagraph` MUST use the canonical sentence ABI and
the compatibility table. `decodeCodelet` MUST validate all index, quote,
continuation, HNUC, type, and dependency metadata. `executeCodelets` MUST
return sentence/paragraph-shaped results and preserve the same semantic
effects as interpreted execution. The current JavaScript reference facade
implements these interfaces for the proven numeric-plus and typed-literal
adapters and rejects other semantic codelets explicitly. The host language,
OpenCL, or another
backend is an implementation choice behind this boundary.

A destination compiles a codelet into machine code that computes the result the
interpreter produces. It MAY use native target capabilities or lower operations
to simpler instructions, but the compiled program MUST preserve interpreted
results, including the saturation the numeric semantics apply, and all
observable effects. An explicitly approximate semantic operation is permitted
only under its declared tolerance. If neither native nor fallback lowering
satisfies the contract, the destination MUST reject the codelet.

## 8. Compatibility examples

The following are golden vectors, not new syntax:

1. The numeric-plus sentence `ob num 1 to num 1 be plus do` MUST encode each
   operand as quote type, value, then its grammatical-case HNUC, producing
   `0149 881D 0001 245E 881D 0001 243E 8A64 295E` and result `2`.
2. The legacy single-codelet form
   `0051 291D E928 28BE 245E E948 295E 0000 0000 0000 0000 0000 0000 0000 0000`
   MUST decode with its head, phrases, verb/mood, and unused tail intact.
3. Typed literals that fit the legacy quote-sort contract MUST round-trip
   byte-for-byte and preserve their semantic type.
4. Two source languages that lower to the same canonical sentence MUST produce
   the same codelet bytes. Different source spellings that carry different
   cases or values MUST NOT be collapsed merely because their glosses look
   alike.
5. A sentence containing an unmapped current HNUC, unsupported nested value,
   conflicting write, or unrepresentable effect MUST return an explicit
   encoding error and no executable codelet.
6. A date literal MUST travel in the uint sort with the 64-bit scalar
   thickness, so `ob date 2025-05-01 be date ya` MUST encode with the
   eight-word body `00C1 981D 9C00 8924 0196 0000 245E 217E`, where the four
   payload words carry the milliseconds since the Unix epoch.
7. A numeric vector literal MUST travel in the uint sort with the vector
   thickness that states its element count, so `ob ve num 1 2 3 be vector
   ya` MUST encode with the seven-word body `0061 8F1D 0001 0002 0003 245E
   217E`, and a width without a fixed legacy thickness MUST use the explicit
   length form.
8. A boolean vector literal MUST travel in the signed integer sort with the
   vector thickness that states its element count, so `ob ve bool truth lie
   truth be vector ya` MUST encode with the seven-word body `0061 AF1D 0001
   0000 0001 245E 217E`, where a truth is the non-zero element and a lie is
   the zero element.
9. A text vector literal MUST travel as one letter-sort region per element,
   because the legacy quote sorts hold fixed-width elements and a text
   element is a string, so `ob ve text Name Age be vector ya` MUST encode
   with the fourteen-word body `3001 0E1D 0004 004E 0061 006D 0065 0E1D
   0003 0041 0067 0065 245E 217E`. Every element MUST keep its exact
   characters and its case.
10. A destination MUST compile a codelet into machine code that computes the
    interpreter's result. The golden codelet `0149 881D 0001 245E 881D 0001
    243E 8A64 295E` MUST compile to a program that leaves the result `2` in
    the first argument register, and an image that holds that program MUST be
    an executable whose entry point runs the program and stops.

Conformance tests should compare sentence round-trips, exact golden bytes,
malformed continuation/quote rejection, compatibility-table coverage,
dependency scheduling, single-writer enforcement, and interpreted versus
decoded result paragraphs. Tests must include at least one source-language
adapter and one unsupported-value rejection.

The hosted PyashForth memory profile additionally requires conformance cases
for quote-kind and payload round-trips, per-invocation slot isolation, constant
write rejection, zero initialization, page-bound checks, and frame cleanup on
return. These cases are acceptance requirements for the future runtime; they
do not imply current implementation coverage.

## 9. Non-goals

This specification does not add HNUCs, alter parser vocabulary, define the
catalog/container database, require a GPU, introduce a model server or queue,
or connect codelet execution to WorkTask/review/integration machinery. The
database contract is defined in
`documentation/reference/pyac-vliw-database.md`. This specification also does
not replace the current sentence/paragraph interpreter. The only
conforming future implementation is one that can prove the sentence result
and the legacy encoding bytes agree.

## 10. Implementation references

The proven numeric-plus, quote, fixed-slot, typed-literal, named-fact, database,
and facade slices are documented with their fixtures and implementation paths
in `documentation/reference/pyac-vliw-semantic-slices.md`. The normative
requirements above remain the authority; the reference notes identify the
currently executable subset and its explicit unsupported cases.
