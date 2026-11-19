# Pyash VLIW Targets and Compatibility

This companion extends the encoding and execution contract in
[Pyash VLIW ISA and lowering contract](27-pyash-vliw-isa.md). Its sections are
normative where they define target capability selection, semantic lowering,
compatibility examples, and implementation boundaries.

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

These signatures describe the semantic boundary. JavaScript helpers still
provide source lowering and codelet encoding/decoding, but the shared Rust VLIW
runtime is authoritative for execution semantics:

```text
lowerSentence(sentence) -> Codelet[] | EncodingError
lowerParagraph(paragraph) -> Codelet[] | EncodingError
decodeCodelet(words) -> SemanticInstruction[] | EncodingError
executeCodelets(codelets, inputs) -> Paragraph | ExecutionError
```

`lowerSentence` and `lowerParagraph` MUST use the canonical sentence ABI and
the compatibility table. `decodeCodelet` MUST validate all index, quote,
continuation, HNUC, type, and dependency metadata. `executeCodelets` MUST
return sentence/paragraph-shaped results and preserve the Rust runtime's
semantics. Any retained JavaScript execution helper is a compatibility path,
not an independent semantic authority. The host language, OpenCL, or another
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
   The vector may continue across indexed codelets without consuming an
   element as an index word.
10. A paragraph-letter quote longer than 28 bytes MUST use the legacy `L`
    blockquote form: indexed quote header and exact payload-word count,
    followed by the required number of raw 16-word vectors with no index
    words, then indexed continuation. The raw extent and zero-padding rules
    above are normative; encoding a long paragraph quote as ordinary indexed
    payload is not conforming.
11. Numeric vector arithmetic MUST reuse the unsigned vector quote as its
    accusative operand, followed by a scalar numeric quote or an equal-width
    unsigned vector quote in its grammatical case, the operator, and deontic
    mood. Thus `ob ve num 1 2 3 4 to num 2 be plus do` MUST encode as `0A41
    8A1D 0001 0002 0003 0004 245E 881D 0002 243E 8A64 295E` and compute `[3,
    4, 5, 6]`; `ob ve num 1 2 3 4 to ve num 5 6 7 8 be plus do` MUST compute
    `[6, 8, 10, 12]`. Fixed and explicit-length quotes MUST retain their
    legacy layouts. Scalar-vector operations MUST fit one 16-word codelet and
    support widths two through eight; vector-vector operations MUST use equal
    widths two through four so both quotes and all sentence markers fit one
    codelet. Elementwise operations MUST preserve scalar arithmetic semantics,
    with multiplication promoted to unsigned 32-bit vector results.
12. A destination MUST compile a codelet into machine code that computes the
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

## 9. Vector values and arrays

A vector quote is one typed hardware value with at most 16 lanes in the current
shared Rust CPU/GPU runtime. It is not an arbitrary-length collection. Finite
binary32 and binary64 lanes use legacy float sort 6, preserve their IEEE bit
patterns, and serialize their 16-bit payload words in little-endian order.
Unsigned integer and boolean vectors retain their existing legacy sorts.

For binary32, `0xd41d` denotes the fixed 16-lane form followed by 32 payload
words (two words per lane). `0xd61d 0x0006` denotes an explicit six-lane form:
the count word is the number of lanes, followed by 12 payload words. It is not
a codelet count or payload-word count. Binary64 payloads use four words per
lane. A decoder MUST reject unsupported types, malformed counts, non-finite
float values, and widths above 16.

Word zero of every codelet remains its index. Vector payloads that continue
across codelets use indexed continuation, not raw quote blocks. The decoder
collects the indexed words through the completion marker, then validates the
typed quote and sentence cases. Continuation MUST preserve lane order and
cannot consume the next sentence. Fixed-width vectors are results and inputs;
mutable programlet slots remain scalar in this runtime.

Text vectors also have at most 16 lanes. Each lane is an ordinary typed text
quote, and a long text lane uses the existing length-framed paragraph quote.
Text lanes are not packed into the numeric vector sort.

An array is the representation for a variable-length collection, including
text elements. Fixed legacy vector widths remain available for numeric counts
1, 2, 3, 4, 8, and 16. Other numeric extents use quote thickness 6: the quote
header is followed by a 16-bit element count from 1 through 65,535, then the
typed payload. This count is the number of logical elements, not payload words
or codelets. Indexed continuation preserves word zero as each codelet's index.

A text array uses a letter-sort, thickness-6 quote with the sequence bit set.
Its count is the number of strings; each member follows as an ordinary
single-letter or length-framed paragraph-letter quote. This keeps member
boundaries unambiguous even when text contains words that resemble quote
headers. The sequence flag distinguishes this container from a flat text
quote. For compatibility, a multi-member text vector that fits in one codelet
may retain the legacy per-member quote layout; single-member and continued text
arrays use the counted form.

The JavaScript VLIW lowerer, decoder, and `executeCodelets` path now round-trip
and execute numeric arrays through 65,535 elements and length-framed text
arrays across indexed codelets. This does not change SIMD lane width. The shared
Rust CPU/GPU interpreter still returns values through a fixed `CoreResult`
buffer sized for 16 lanes; large-array execution through that ABI remains a
runtime transport/capacity gap. Programlet slots remain scalar typed values.

## 10. Non-goals

This specification does not add HNUCs, alter parser vocabulary, define the
catalog/container database, require a GPU, introduce a model server or queue,
or connect codelet execution to WorkTask/review/integration machinery. The
database contract is defined in
`documentation/reference/pyac-vliw-database.md`. This specification also does
not replace the current sentence/paragraph interpreter. The only
conforming future implementation is one that can prove the sentence result
and the legacy encoding bytes agree.

## 11. Implementation references

The proven numeric-plus, quote, fixed-slot, typed-literal, named-fact, database,
and facade slices are documented with their fixtures and implementation paths
in `documentation/reference/pyac-vliw-semantic-slices.md`. The normative
requirements above remain the authority; the reference notes identify the
currently executable subset and its explicit unsupported cases.
