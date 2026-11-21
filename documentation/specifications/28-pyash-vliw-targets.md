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

Vectors are typed hardware values with 1-16 lanes, not arbitrary-length
collections. Unsigned and boolean lanes retain their legacy sorts; finite
binary32/binary64 lanes use float sort 6 and little-endian IEEE payload words.
For example, `0xd41d` is 16 float32 lanes (32 payload words), while
`0xd61d 0x0006` is six lanes (the count is logical elements, followed by 12
payload words). Float64 uses four words per lane. Decoders MUST reject invalid
types/counts, non-finite values, and widths above 16.

Long vectors use indexed continuation, preserving word zero as each codelet's
index and lane order across the completion marker. Continuation cannot consume
the next sentence. Text vectors have at most 16 members; each member is a
normal text or length-framed paragraph quote, not a numeric-sort payload.
Programlet slots remain scalar.

Variable-length collections use arrays. Numeric arrays of unsupported fixed
vector widths use quote thickness 6 and a 16-bit logical element count
(1-65,535), followed by typed payload. Text arrays use letter sort, thickness
6, the sequence bit, a string count, then individually framed members. Indexed
continuation applies to both. The JavaScript lowerer/decoder executes arrays
through 65,535 elements; the shared Rust `CoreResult` ABI currently returns at
most 16 lanes, so large-array execution remains a transport-capacity gap.

## 10. Scalar product (dot product)

The Pyash compound `kl6m psas` means **dot product**. Inline form:

```pyash
ob ve float32 1 2 3 by ve float32 4 5 6 be kl6m psas do
```

`ob` and `by` are the left and right operands: an inline typed vector or one
preceding named float32/float64 vector literal in the pack. For example:

```pyash
su name features ob ve float32 1 2 be vector ya
su name weight ob ve float32 4 5 be vector ya
ob name features by name weight be kl6m psas do
```

Named operands are read-only; missing or duplicate names are errors. Mutable
float32 vectors may be destinations only. Optional `to name <vector> at num
<lane>` stores the scalar in a preceding zeroed vector (1-16 lanes, zero-based
index, writes in source order); omitting it returns only the scalar. Verb HNUCs:
`0x0D62 0x8944`.

Operands MUST be finite, non-empty float32 or float64 vectors of matching type
and equal length, from one to `MAX_VECTOR_LANES` (currently 16). Multiply
matching lanes, then add products to a zero accumulator in ascending lane order
at the operand precision. Return a scalar of that precision. Reject malformed
phrases and type/length mismatches; non-finite inputs/results produce the
float-domain error. Without `shader-f64`, reject float64 with the unsupported-
operation error. Rust CPU and native Vulkan enable `shader-f64`; WGSL/WebGPU
omits it, so there float32 is supported and float64 is not. Implementations
MUST preserve the specified operation order and precision.

## 11. Float-vector operations

The shared Rust runtime accepts these Pyash forms (including preceding named
float vectors):

```pyash
ob ve float32 1 2 3 to num 0.5 be multiply do
ob ve float32 1 2 3 to ve float32 4 5 6 be plus do
ob ve float32 1 2 3 be tfo2t do
```

`multiply` scales each lane; its `to` operand is a finite numeric scalar,
converted to the vector precision. `plus` adds equal-width, same-precision
vectors lane-wise; it does not broadcast. `tfo2t` (`0xBC8A`) sums a non-empty
vector in ascending lane order at its precision and returns a scalar of that
type. Results preserve vector precision; non-finite inputs/results, empty
sums, incompatible types, and unequal widths are errors. Vectors may span
indexed codelets and have 1-16 lanes. Preceding named vectors must resolve
uniquely. CPU/native Vulkan support float32/float64; WGSL supports float32.

The existing compound `gjat bwit` (`0xA9B2 0xA831`, magnitude + boundary) is
also an operation verb for maximum reduction:

```pyash
ob ve float32 1 2 3 be gjat bwit do
```

It returns the greatest finite lane as a scalar of the input precision. It
requires 1-16 lanes; ties retain the first lane. This returns a value, not an
index (`argmax`). Rust CPU/native Vulkan support float32/float64; WGSL supports
float32.

## 12. Exact-match count (`pluk tlas`)

This evaluator compares two named float32 vectors in one PyAC pack. Its typed
Pyash signature is:

```pyash
ob name prediction value
by name reference point value
to name num correct count
be pluk tlas do
```

The `ob` and `by` fields are references, not inline vector literals. Each MUST
resolve to exactly one preceding named float32 vector declaration in the same
pack. A mutable prediction vector may be populated by earlier indexed dot
products; unwritten lanes stay zero. Both vectors MUST have equal nonzero width
(at most 16) and finite lanes. The result counts corresponding lanes equal under exact
IEEE-754 binary32 numeric comparison; there is no tolerance, and positive and
negative zero compare equal. Return one unsigned scalar in the range 0 to 16.

The verb uses the existing two-word `pluk tlas` HNUC sequence and deontic mood;
no quote type or vocabulary allocation is added. Unbound or duplicate names,
non-float32 inputs, malformed declarations, and unequal widths are errors. The
shared Rust VLIW runtime owns CPU and GPU execution semantics; JavaScript only
lowers the sentence and does not calculate the count.

## 13. Non-goals

This specification does not add HNUCs, alter parser vocabulary, define the
catalog/container database, require a GPU, introduce a model server or queue,
or connect codelet execution to WorkTask/review/integration machinery. The
database contract is defined in
`documentation/reference/pyac-vliw-database.md`. This specification also does
not replace the current sentence/paragraph interpreter. The only
conforming future implementation is one that can prove the sentence result
and the legacy encoding bytes agree.

## 14. Implementation references

The proven numeric-plus, quote, fixed-slot, typed-literal, named-fact, database,
and facade slices are documented with their fixtures and implementation paths
in `documentation/reference/pyac-vliw-semantic-slices.md`. The normative
requirements above remain the authority; the reference notes identify the
currently executable subset and its explicit unsupported cases.
