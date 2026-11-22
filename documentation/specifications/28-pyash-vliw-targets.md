# Pyash VLIW Targets and Compatibility

This companion extends the normative [Pyash VLIW ISA and lowering
contract](27-pyash-vliw-isa.md) with target capabilities, semantic lowering,
compatibility examples, and implementation boundaries.

## 6. Target capabilities and lowering

The portable semantic core is a **minimum target contract, not a performance
ceiling**. A backend MAY use any target instruction, execution model, memory
facility, or accelerator, but the compiler MUST preserve canonical Pyash
semantics. Each target profile MUST mark each capability native, lowered from
supported operations, or unavailable. Selection MUST be explicit and
reproducible; when several valid implementations exist, a backend SHOULD prefer
the native or fastest one. Runtime selection and multiple variants are allowed.

A native or lowered implementation MUST preserve specified results, effects,
and ordering, including any declared approximation tolerance. Reject an
operation when no implementation meets its contract; never substitute one
merely because its name is similar. Capabilities do not allocate legacy
16-word codelet fields or reuse reserved bits. Operations not represented by
the legacy mapping remain unsupported until a versioned encoding is specified.

## 7. Conceptual interfaces

These signatures define the boundary; the shared Rust VLIW runtime is
authoritative for execution semantics. JavaScript helpers provide lowering,
encoding, and decoding:

```text
lowerSentence(sentence) -> Codelet[] | EncodingError
lowerParagraph(paragraph) -> Codelet[] | EncodingError
decodeCodelet(words) -> SemanticInstruction[] | EncodingError
executeCodelets(codelets, inputs) -> Paragraph | ExecutionError
```

Lowerers MUST use the canonical sentence ABI and compatibility table. The
decoder MUST validate indexes, quotes, continuations, HNUCs, types, and
dependencies. Execution MUST return sentence/paragraph-shaped results under
Rust semantics; retained JavaScript execution is compatibility-only. A target
MAY compile codelets using native or lowered operations, but MUST preserve
interpreter results (including numeric saturation) and observable effects.
Approximation is allowed only within a declared tolerance. Reject codelets
that cannot meet the contract.

## 8. Compatibility examples

The following are golden vectors, not new syntax:

1. The numeric-plus sentence `ob num 1 to num 1 be plus do` MUST encode each
   operand as quote type, value, then its grammatical-case HNUC, producing
   `0149 881D 0001 245E 881D 0001 243E 8A64 295E` and result `2`.
2. The legacy single-codelet form
   `0051 291D E928 28BE 245E E948 295E 0000 0000 0000 0000 0000 0000 0000 0000`
   MUST decode with its head, phrases, verb/mood, and unused tail intact.
3. Typed literals fitting the legacy quote-sort contract MUST round-trip
   byte-for-byte with their type preserved. Sources lowering to the same
   canonical sentence MUST produce the same bytes; distinct cases or values
   MUST NOT collapse because their glosses look alike.
4. An unmapped HNUC, unsupported nested value, conflicting write, or
   unrepresentable effect MUST return an explicit encoding error and no
   executable codelet.
5. A date literal MUST travel in the uint sort with the 64-bit scalar
   thickness, so `ob date 2025-05-01 be date ya` MUST encode with the
   eight-word body `00C1 981D 9C00 8924 0196 0000 245E 217E`, where the four
   payload words carry the milliseconds since the Unix epoch.
6. A numeric vector literal MUST travel in the uint sort with the vector
   thickness that states its element count, so `ob ve num 1 2 3 be vector
   ya` MUST encode with the seven-word body `0061 8F1D 0001 0002 0003 245E
   217E`, and a width without a fixed legacy thickness MUST use the explicit
   length form.
7. A boolean vector literal MUST travel in the signed integer sort with the
   vector thickness that states its element count, so `ob ve bool truth lie
   truth be vector ya` MUST encode with the seven-word body `0061 AF1D 0001
   0000 0001 245E 217E`, where a truth is the non-zero element and a lie is
   the zero element.
8. A text vector literal MUST travel as one letter-sort region per element,
   because the legacy quote sorts hold fixed-width elements and a text
   element is a string, so `ob ve text Name Age be vector ya` MUST encode
   with the fourteen-word body `3001 0E1D 0004 004E 0061 006D 0065 0E1D
   0003 0041 0067 0065 245E 217E`. Every element MUST keep its exact
   characters and its case.
   The vector may continue across indexed codelets without consuming an
   element as an index word.
9. A paragraph-letter quote longer than 28 bytes MUST use the legacy `L`
    blockquote form: indexed quote header and exact payload-word count,
    followed by the required number of raw 16-word vectors with no index
    words, then indexed continuation. The raw extent and zero-padding rules
    above are normative; encoding a long paragraph quote as ordinary indexed
    payload is not conforming.
10. Numeric vector arithmetic MUST reuse the unsigned vector quote as its
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
11. A destination MUST compile codelets to interpreter-equivalent results. The
   golden codelet in example 1 MUST leave `2` in the first argument register;
   its executable image's entry point MUST run the program and stop.

Conformance tests should compare sentence round-trips, exact golden bytes,
malformed continuation/quote rejection, compatibility-table coverage,
dependency scheduling, single-writer enforcement, and interpreted versus
decoded result paragraphs. Tests must include at least one source-language
adapter and one unsupported-value rejection.

### Rust programlet routine dispatch

Pyac-defined ceremony routines use a flat canonical signature, distinct from
the built-in sentence-handler key in section 5.1 of the VLIW ISA specification:

```text
type HNUC(s), case HNUC, type HNUC(s), case HNUC, ..., routine-name HNUC(s)
```

The Rust runtime derives each type from the declared argument or destination
type and each case from its grammatical role. It sorts complete type/case
groups by ascending numeric case HNUC, preserving the type with its case, then
appends the routine name's HNUC sequence. Thus changing source case order does
not change the key. `number`, `bool`, `float`, and `vec float` are represented
by their Pyac type HNUC sequence; generic float types bind to the concrete
float32 or float64 precision carried by the invocation.

The destination type participates under `to`; destination variable names,
argument names, and values do not. `fromindex` and `toindex` are loop controls,
not callable arguments, and do not enter the key. The runtime builds a bounded
directory once per program packet, sorts the complete flat keys, and resolves
calls by binary search. Nested calls use the same directory. A duplicate full
signature is an error; an absent exact key is unsupported. Dispatch does not
fall back to name-only matching or probe another routine after a mismatch.

This is the Rust VLIW execution contract; the JavaScript implementation is not
the semantic authority. Implementation and packet tests are in
`rust/pyac-vliw-core/src/semantics_runtime/programlet_dispatch_index.rs` and
`rust/pyac-vliw-core/src/semantics_runtime/tests/programlet_signature_dispatch.rs`.

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
Programlet frames support up to 64 scalar locals and 8 named floating-vector
locals, each bounded by the 16-lane vector limit. Generic `float` and
`vec float` ceremony types bind to the concrete float32 or float64 precision
carried by the invocation; the called routine preserves that precision.

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

### 11.1 Pyash-composed stable exponential normalization

Stable softmax is currently a Pyash ceremony composed from the primitives
above, not a separate `softmax` opcode. The source fixture
[`vliw-programlet-vector-weight.pya`](../../quiz/fixtures/vliw-programlet-vector-weight.pya)
compiles this routine and invokes it with a float32 vector:

```pyash
su name vector weight from name vec float features to name vec float answer be ceremony def
from name features to name float count be gjat bwit do
from name features with name count to name vec float weight be subtract do
from name weight to name vec float vector be exponential do
from name vector to name float count be tfo2t do
from name vector with name count to name vec float answer be dvis do
su name answer ret
su name vector weight be ceremony prah
```

The generic formal/output types accept either float32 or float64 vectors, with
the invocation's precision preserved through the max reduction, vector-minus-
scalar, elementwise exponential, ordered sum, and vector/scalar division (`dvis`). The
`subtract` route is selected from its vector source signature, so scalar
subtraction retains its existing route. Inputs must be finite and non-empty;
non-finite positive results and zero denominators fail. A negative overflow in
the max-subtraction intermediate is treated as negative infinity, whose
exponential is zero. CPU Rust tests cover float32/float64, equal logits,
extreme finite logits, and empty input. GPU/WGSL execution of this newly added
programlet path still requires separate conformance verification.

## 12. Exact-match count (`pluk tlas`)

This evaluator compares two named float32 vectors in one PyAC pack. Its typed
Pyash signature is:

```pyash
ob name prediction value
by name reference point value
to name num correct count
be pluk tlas do
```

The `ob` and `by` fields reference named vectors, not inline literals. Each
MUST resolve to one preceding float32 vector in the pack. Earlier indexed dot
products may populate a mutable prediction vector; unwritten lanes are zero. Both
vectors MUST be finite, equal-width, and nonempty (maximum 16 lanes). Return an
unsigned count (0-16) of lanes equal under exact IEEE-754 binary32 comparison;
there is no tolerance, and signed zeros compare equal.

The verb uses the existing two-word `pluk tlas` HNUC sequence and deontic mood;
it adds no quote type or vocabulary. Unbound/duplicate names, non-float32 input,
malformed declarations, or unequal widths are errors. Rust owns CPU/GPU
execution; JavaScript only lowers the sentence.

## 13. Non-goals

This spec adds no HNUCs/parser vocabulary, catalog/container database, GPU,
model server/queue, WorkTask/review/integration connection, or replacement for
the sentence/paragraph interpreter. See the [database contract](../reference/pyac-vliw-database.md).
A conforming implementation MUST prove sentence results agree with legacy bytes.

## 14. Implementation references

The [semantic-slice reference](../reference/pyac-vliw-semantic-slices.md)
documents proven paths and fixtures for numeric-plus, quote, fixed-slot,
typed-literal, named-fact, database, and facade slices. This spec is
authoritative; the reference identifies implemented subsets and unsupported cases.
