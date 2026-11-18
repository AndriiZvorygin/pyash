# Pyac VLIW semantic slices

The normative encoding and execution boundary is
`documentation/specifications/27-pyash-vliw-isa.md`. This reference records the
currently proven semantic slices and their fixtures.
For the full source-to-pack-to-backend picture and the distinction between
current support and target architecture, see
[`pyash-vliw-compiler-architecture.md`](pyash-vliw-compiler-architecture.md).

## Numeric plus

The first executable slice uses:

```pyash
ob num 1 to num 1 be plus do
```

The JavaScript reference backend accepts unsigned 16-bit `ob num A to num B`
plus. Each typed operand phrase is encoded in `quoteType, value, case-HNUC`
order. The `ob` phrase ends in its accusative HNUC; the second phrase ends in
the HNUC for its actual case, such as destination (`to`) or source (`from`).
Numeric plus saturates at `0xFFFF`, subtract floors at zero, divide returns the
integer quotient, and divide by zero is an explicit execution error.

The fixed 16-word codelet has this nine-word prefix:

```text
0149 881D A 245E 881D B 243E 8A64 295E
```

Seven zero words complete the vector. The decoder validates markers, numeric
quote fields, and the zero tail before returning the canonical sentence. The
reference implementation is `program/library/vliw/plus.mjs`; its fixture is
`examples/pyash/vliw-numeric-plus.pya`, with conformance in
`quiz/vliw_plus_semantics.test.mjs`.

## Quote descriptors and surface rendering

The legacy quote-denote is `0x001D`, with `0x881D` numeric, `0x081D` letter,
and `0x0E1D` paragraph-letter classes. `decodeQuoteHeader` exposes region,
pointed, sequence, vector-width, scalar-width, and sort fields. Numeric and
letter quotes consume one 16-bit payload; paragraph-letter quotes consume an
explicit length and character words. The uint sort also carries 32-bit and
64-bit scalars, and a vector thickness above zero states how many elements the
quote holds, so `0x981D` is a uint64 and `0x8F1D` is a uint16 vector of three
elements.

Quote markers describe value representation. Lexical Pyash spellings remain HNUC
table entries; the shared decoder combines typed values with case markers. The
plus golden vector renders as `hyikdoyu hyikdoka plustu`, while its canonical
semantic form remains `ob num 1 to num 1 be plus do`.

The decoder accepts unsigned numeric, single-character, and paragraph-letter
payloads. Surface number rendering currently covers legacy zero through twenty;
larger numbers remain structured until compound surface composition is added.

## Numeric vector arithmetic

Numeric arithmetic may take an existing unsigned numeric vector in `ob` and
either a scalar numeric operand or an equal-width unsigned numeric vector in
one of the operator's supported grammatical cases:

```pyash
ob ve num 1 2 3 4 to num 2 be plus do
```

The vector quote remains the legacy quote with its count in vector thickness
(or its explicit length word); it is followed by the accusative case, the
scalar quote and value, the scalar operand's case, operator, and deontic mood.
The example encodes as:

```text
0A41 8A1D 0001 0002 0003 0004 245E 881D 0002 243E 8A64 295E
```

The Rust CPU interpreter and browser WebGPU path apply the scalar arithmetic
semantics independently to each element. A single operation codelet supports
scalar-vector widths two through eight and vector-vector widths two through
four, constrained by the existing quote layouts and 16-word slot. Vector
operands must have equal widths. Multiplication returns unsigned-32 vector
elements so the full product of two uint16 values is retained; other current
operators return unsigned-16 elements. The JS reference path has matching
lowering, decoding, and execution. Existing vector quote support described
above is the data representation; this arithmetic sentence is the operation
over that data.

## Generic fixed-slot decoding

`program/library/vliw/codelets.mjs` losslessly decodes the existing 16-word slot,
delegating quote words to the shared decoder and resolving known lexical words
through HNUC. Unknown non-quote words remain raw. The first standalone zero marks
the used boundary and all following slots must be zero. `renderLegacyCodelet`
preserves raw words and supported typed values without claiming arbitrary codelets
are executable.

`program/library/vliw/word_code.mjs` ports lwonprom's
`neo_word_code_encode` shape: glyph length and placement select word class, then
consonant, vowel, tone, and final-consonant fields are packed. The inverse decodes
to Pyac. `pyashWords.json` supplies vocabulary membership and English glosses,
not HNUC calculation. Phrase codelets use this through `phrase.mjs`.

## Typed literals

The second slice covers:

```pyash
ob num 7 be number ya
ob text "A" be text ya
```

The five-word prefixes are:

```text
0019 881D value 245E 217E
0019 081D code-unit 245E 217E
```

Numeric values use unsigned 16-bit payloads; letters use one UTF-16 code unit;
paragraph letters use an explicit length and bounded UTF-16 payload. Decoding
returns the canonical `ya` sentence and execution returns the same typed fact.
The implementation is `literal.mjs`, with fixtures
`vliw-typed-literals.pya` and `vliw-extended-values.pya` and quizzes
`vliw_literal_semantics.test.mjs` and `vliw_extended_values.test.mjs`.

## Named scalar facts

Named facts use the legacy index, name, nominative case, typed quote/payload,
accusative case, and realis mood:

```text
0065 name 24DE 881D value 245E 217E
0065 name 24DE 081D code-unit 245E 217E
```

`named_literal.mjs` supports one or more legacy vocabulary words per name,
unsigned numeric values, and bounded paragraph-letter text. Unknown names, wider
text, and unsupported quote widths retain explicit rejection reasons. The runnable
fixture is `examples/pyash/vliw-named-literals.pya`.

`buildVliwDatabaseFromTranslation(lines, options)` resolves an existing
translation adapter, preserves one source record per translated sentence, and
passes canonical sentences through catalog, pack, query, and replay contracts.
Records retain language, locator, line index, sentence index, and original text.

## Numeric operators

The binary numeric operators share one nine-word prefix. The operator word at
slot 7 names the operation, and the head word at slot 0 is the legacy parse
index for that shape:

```text
0149 881D A 245E 881D B case-HNUC operator 295E
```

For example, `to` is `0x243E` and `from` is `0x313E`; neither is inferred from
the operator or replaced by a generic case marker. A named operand uses its
type HNUC, name HNUC value, and grammatical-case HNUC in that same order.

`arithmetic.mjs` covers `subtract` (`0xABD2`), `multiply` (`0xEC90`),
`divide` (`0x8893`), `xor` (`0xA810`), `exponential` (`0x8C29`), and `remains`
(`0xE82A`). `plus` keeps its own adapter because it saturates at `0xFFFF`.

`exponential` and `remains` are Pyash-native semantics in the legacy binary
operator layout: the legacy has no power or remainder verb, so the vocabulary
word is normative but no legacy sentence exists for them. The right operand
comes from `from` or `by`, because in those two verbs `to` is the result
target. The result saturates into the unsigned 16-bit range, and a zero
divisor is a `division-by-zero` execution error.

## Conditional numeric selection

The Rust pack interpreter and browser WebGPU path execute the scalar
conditional slice emitted by the JavaScript sentence encoder:

```pyash
ob num 5 be equally from num 5 then ob num 7 be number else ob num 9 be number ya
```

The condition and both numeric-literal arms form one completion-marked,
two-codelet group. The CPU executor evaluates the inline equality; WebGPU
validates the same group through the Rust semantic decoder, then compares the
two operands and selects an arm in WGSL. Both return only the selected unsigned
result. The bounded programlet evaluator also accepts `not`/`and`/`or`
predicates whose comparison leaves resolve numeric or boolean arguments and
local slots in the active frame. The expression stack is bounded to eight
levels and preserves short-circuit evaluation. Nested conditional branches,
side-effecting arms, and conditional RISC-V code generation remain
unsupported. CPU true/false coverage is in
`rust/pyac/tests/pack_execution.rs`; the Rust GPU conformance matrix includes
true and false composed-local cases, and browser CPU/GPU parity coverage is in
`rust/pyac-browser/smoke.mjs`.

## Numeric invert

The legacy invert codelet carries the value in the accusative phrase and the
bound it is inverted about in the dative phrase:

```text
0149 881D A 245E 881D B 207E AAD2 295E
```

The legacy computes `not value + bound`. Pyash inverts a number by negating
it, so the bound is fixed at zero and the legacy phrase shape is kept. A
codelet whose dative phrase names a bound is the legacy's own form; Pyash has
no verb for it, so the decoder rejects it rather than inventing a meaning.
The implementation is `program/library/vliw/invert.mjs`, with conformance in
`quiz/vliw_invert.test.mjs`.

## Head and index words

The head word at slot 0 is the legacy index. Bit 0 says whether the vector
completes the codelet, and every other bit marks one slot that holds a
phrase-closing case word or a codelet-ending mood word. The legacy VM reads a
slot as a boundary when its bit equals bit 0, so the head carries the
completion bit plus one bit per boundary slot. `indexWordFor` in
`program/library/vliw/codelets.mjs` computes that word, and the legacy golden
vectors agree with it: the numeric plus head `0x0149` marks the accusative,
destination, and deontic slots, and the named-literal head `0x0065` marks the
nominative, accusative, and realis slots.

## Date literals

A date is a uint64 count of milliseconds since the Unix epoch. The legacy quote
format reserves the 64-bit scalar thickness for exactly this, so the value
travels in a uint quote with four payload words:

```text
00C1 981D word0 word1 word2 word3 245E 217E
```

The date string must be ISO-8601 and reproducible: a plain day is midnight UTC,
and a date-time needs an explicit timezone. `now`, `today`, and local times are
rejected, because their lowering would not be reproducible. Decoding renders the
canonical Pyash form, which is a plain day when the value is midnight UTC and
the full ISO form otherwise. The implementation is
`program/library/vliw/date.mjs`, with conformance in
`quiz/vliw_date.test.mjs`.

## Vector literals

A numeric vector travels as a uint quote whose vector thickness states how
many 16-bit elements it holds. The legacy has fixed thicknesses for two, three,
four, eight, and sixteen elements and an explicit length form for every other
width:

```text
0061 8F1D element element element 245E 217E
0301 8E1D length element element element element element 245E 217E
```

The quote sort is the element type, so a boolean vector travels in the signed
integer sort with the same thickness rule, where a truth is the non-zero
element and a lie is the zero element:

```text
0061 AF1D element element element 245E 217E
```

A text vector cannot use one region, because the legacy quote sorts hold
fixed-width elements and a text element is a string. It travels as one
letter-sort region per element instead, which keeps every character and its
case exactly:

```text
3001 0E1D length character character character character 0E1D length character character character 245E 217E
```

A one-element vector is refused, because its quote is identical to a numeric
literal and the format cannot tell the two apart. A numeric or boolean vector
holds at most eleven elements, the widest that still fits in one codelet, and a
text vector holds at most six. An element type without a proven legacy quote
encoding keeps an explicit rejection reason. The implementation is
`program/library/vliw/vector.mjs`, with conformance in
`quiz/vliw_vector.test.mjs`.

Both literal families share the layout in
`program/library/vliw/literal_layout.mjs`: head, optional name phrase with its
nominative case, one or more quote regions, accusative case, and realis mood.
The legacy format has no slot for the `exists` keyword, so a declared literal
is written without it and a name outside the legacy vocabulary is refused.

## Reference facade

`program/library/vliw/index.mjs` exposes:

- `lowerSentence(sentence)` and `lowerParagraph(paragraph)`;
- `decodeCodelet(words)`;
- `executeCodelets(codelets)`; and
- `scheduleCodeletDependencies(instructions)`, which rejects unresolved
  references and duplicate writers.

The proven facade supports numeric `plus`, scalar `subtract`, `multiply`,
`divide`, `xor`, `exponential`, and `remains`; numeric `invert`; anonymous and
named numeric/text/boolean literals; multiword legacy names; bounded
paragraph-letter text; and numeric, boolean, and text vector literals, plus
date literals. Valid but unknown codelets decode losslessly and are then
rejected explicitly.

The Rust CPU pack executor and GPU targets share the scalar operator set, the
invert codelet, and the date and vector literal families. Their bounded
programlet path also supports scalar numeric and boolean control flow below;
unsupported program forms remain explicit errors rather than guesses.

## Bounded scalar programlets

The shared VLIW semantics runtime, CPU pack executor, native Vulkan shader, and
browser WebGPU path run this ordinary Pyash shape:

```pyash
su name count once to name num answer be ceremony def
exists su name count ob num 0 as name variable be number ya
ob num 1 to name num count be plus do
su name count ret
su name count once be ceremony prah
to name num answer be count once do
```

The `exists` marker is source syntax; the canonical codelet carries the named
declaration, typed initializer, `as name variable`, and `ya` mood. The runtime
reads that sentence structure from the existing 16-word codelets and uses
bounded invocation-local frames. Constants reject writes. No `.pyac` version
change, slot opcode, or alternate candidate format is involved.

The shared Rust runtime now executes nested ceremony calls, typed numeric and
boolean arguments/locals/results, the pure scalar operator set, comparisons
and composed boolean predicates over literals/arguments/locals, one-level
conditional actions with an optional alternative, and bounded
`fromindex`/`toindex` traversal. Calls have a
maximum depth of 8 and at most 8 arguments; each invocation has at most 64
local slots and 64 codelets, under the 65,536-step default budget. The same
runtime source is compiled for the Rust CPU executor, Vulkan SPIR-V, and the
WGSL target. Date and vector codelets remain supported by the ordinary shared
codelet interpreter, but date/vector values are not programlet-local types;
text-bearing programlet values and arbitrary effects remain unsupported.

Each routine frame binds its return slot to the output name declared by that
routine. A call's `to` name is a separate caller-side destination; the returned
value is copied there when the callee closes. Nested-loop conformance exercises
this distinction with three inner iterations inside each of three outer
iterations, plus 299 outer iterations to verify repeated routine names reuse
bounded symbol scratch.

Conformance tests are in `rust/pyac/tests/pack_execution.rs`; GPU worker result
decoding is covered in `rust/pyac-gpu/worker/src/main.rs` tests. The source-level
reference fixture is `examples/pyash/vliw-programlet-local-slots.pya`.

## Pure-program semantics inventory

This inventory separates behaviors already admitted by the JavaScript Pyash
programlet reference from the slices currently implemented in the shared Rust
core and Rust pack executor.

| Semantic family | Pyash reference behavior | Shared Rust CPU/GPU status | Remaining parity work |
| --- | --- | --- | --- |
| Scalar values | unsigned/signed `num` and `bool` literals/results | codelet values plus typed numeric/boolean programlet arguments, locals, and returns on CPU and GPU | wider integer widths and additional local value families |
| Pure scalar verbs | `plus`, `subtract`, `multiply`, `divide`, `exponential`, `invert`, `xor`, `remains` | shared codelet semantics and bounded programlet writes; negative signed operands are rejected where the existing arithmetic contract is unsigned | additional verbs only where Pyash defines deterministic pure semantics |
| Comparisons | `equally`, `tiny`, `giant` | shared codelet predicates and programlet comparisons against literals, arguments, and locals, including signed and boolean values; standalone numeric/boolean literal comparisons return typed booleans | using named/local comparison results as boolean-composition leaves |
| Boolean composition | `not`, `and`, `or` over boolean-producing sentences, as specified in `documentation/specifications/02-core-execution.md` | VLIW sentence lowering and shared Rust CPU/GPU runtime support nested boolean facts and literal comparisons, bounded to depth 8; `and`/`or` short-circuit | additional pure boolean-producing leaf forms and live GPU conformance through the standalone runtime service |
| Local quantities | initialized numeric/boolean variables and constant quantities; typed writes; constants reject writes; frame discarded at return | CPU and GPU execute typed declarations, operator writes, boolean writes, local `ret`, and frame isolation | date/vector/text locals and shared mutable program state |
| Ceremony calls | typed outputs and bounded calls; each call gets a fresh frame | nested calls execute with up to 8 arguments and call depth 8; depth overflow is an explicit error | broader signatures, general recursion semantics, and larger configurable limits |
| Branches | conditional sentences with true and optional alternative action | one-level programlet predicates over literal/argument/local values select numeric or boolean actions | nested branches and multi-statement branch bodies |
| Loops | bounded `fromindex`/`toindex` traversal under the programlet step budget; an explicit `ret` role updates the final evoker's loop register before progression | loop index and bound are available as typed arguments; explicit `fromindex` returns resolve literals or `this toindex` genitives and update the supervisor's remaining range; zero-width ranges skip execution; nested bounded loops preserve independent call-frame cursors | wider iteration/index types |
| Effects | rejects effectful or unknown verbs | no general programlet effects; unsupported sentence forms fail | keep host effects outside pure core unless explicitly specified |

The legacy named-slot candidate map format is not a Pyash sentence encoding and
is not accepted by the Rust pack or Housekeeper runtime. The executable
programlet contract above is the canonical sentence/codelet path.

## Parity completion plan

The parity target is the pure-program subset defined by the Pyash execution
specification and encoded by canonical `.pyac` input, with the same typed
results on the JavaScript interpreter, Rust CPU executor, native Vulkan, and
browser WebGPU. The JavaScript interpreter is an implementation under test,
not the authority for expected behavior: known implementation defects must be
fixed to match the spec rather than copied into the other backends. Host
effects are outside this pure subset; valid pure semantics are not excluded
merely because one backend is harder to implement. Every runtime rejection
must also preserve the same documented error category and boundary.

Work proceeds in these slices, with each completed slice backed by differential
fixtures before the next one expands the surface:

| Slice | Scope and exit evidence | Status |
| --- | --- | --- |
| 0. Contract inventory | Record each spec-defined pure semantic, its encoding, and current JS/Rust CPU/Vulkan/WebGPU coverage; identify every remaining gap in the inventory above. | Initial inventory recorded. This pass closes the boolean-fact composition gap; continue auditing each remaining leaf form, typed value family, and error category before claiming parity. |
| 1. Hardware conformance harness | Submit canonical packs through Housekeeper, require Vulkan backend/device identity, and compare exact spec-derived typed outputs for nested calls, branches, loops, booleans, scalar arithmetic, vectors, and capacity cases. | Harness added; all 16 cases passed through Housekeeper on the NVIDIA GeForce RTX 3090 using the current worker and shader, including conditional loop-cursor returns. |
| 2. Differential semantic fixes | For every mismatch against the spec, add a minimal Pyash fixture and make JS reference, Rust CPU, Vulkan, and WebGPU agree on value, frame/side-effect boundary, and error category. Include boundary capacities and forwarded typed cases. | The earlier 16-case matrix passed through the then-current live Vulkan route. Follow-up CPU coverage adds nested bounded loops and boolean composition; this pass adds VLIW lowering and JS reference coverage for `not`/`and`/`or`, literal comparisons, and Rust pack execution for those boolean results. A live RTX 3090 attempt passed the first three existing cases, then the combined new boolean pack failed at codelet 0 (`shared VLIW core error 1`); `/runtime/vliw` reports legacy `housekeeper-vliw`, not the standalone Rust HTTP runtime. Browser parity remains unverified; shader compilation alone is not runtime conformance. |
| 3. Bounded GPU execution and shader structure | Preserve the shared 65,536-step contract while structuring execution into device-safe resumable work; prove successful completion below the limit and the same step-budget error at the limit without GPU hangs. Keep generated WGSL within browser parser limits. | Pending. Chromium/Naga rejects the current generated WGSL at its 127-level nesting/chaining limit during module creation, before either browser GPU pipeline can run. The checked-in pre-change WGSL fails the same way, so this is a pre-existing browser-target gap, not introduced by the genitive fix. |
| 4. Remaining pure value/control-flow parity | Implement every spec-defined pure behavior still missing from shared Rust semantics, including boolean composition and any typed local/control forms confirmed by the contract audit, with minimized cross-backend fixtures. | Boolean composition over nested boolean facts and literal numeric/boolean comparisons is implemented and covered on the JS reference and Rust CPU pack paths, with seven corresponding GPU conformance cases. Named/local comparison leaves and remaining audited typed/local/control forms remain. Live GPU execution awaits routing to the standalone runtime service. |
| 5. Completion audit | Run the full differential matrix against JS, Rust CPU, native Vulkan via Housekeeper, and browser WebGPU; verify effectful/unsupported forms reject consistently and confirm resource/error boundaries. | Not started. |

The generated WGSL currently lowers the whole programlet interpreter into one
very large entrypoint (about 92,000 lines in the current generated file). Its
state arrays and control-flow joins produce nesting beyond Chromium/Naga's
limit. A viable Slice 3 design should reduce per-dispatch live state and
separate bounded execution steps, rather than weakening the smoke assertion or
reducing the semantic step budget.

The earlier Vulkan timeout observation came from a worker image built from the
separate `dev` checkout, not from `dev-vliw-backend`; it is a risk signal, not
branch-valid evidence. Do not lower the shared step budget or silently fall
back to CPU to make a GPU test pass. Browser tests must treat an available raw
WebGPU adapter and a successfully created VLIW pipeline as separate facts; a
CPU fallback does not count as GPU parity.

## The RISC-V destination

A destination compiles a codelet into the machine code that computes the same
result the interpreter produces: the quoted operands become immediates, the
operator word becomes the instruction that computes the result, and the result
leaves in the first argument register. The compiler is in
`rust/pyac/src/backend/riscv.rs` and the image it builds is
`rust/pyac-riscv/`.

The compiled program keeps the interpreter's numeric semantics, including the
saturation to `0xffff` that the JavaScript reference backend applies to
addition, subtraction, and exponentiation. The backend emits no branches: a
branchless program needs no label resolution, so the emitted words are the
whole program.

The evidence that the two agree is the golden codelet
`0149 881D 0001 245E 881D 0001 243E 8A64 295E`. The interpreter runs it and
answers `2`; the Rust backend compiles it and its executor answers `2`; and the
image holds the machine code for the same result:

```text
0000000080000000 <pyac_body>:
  addi t0, zero, 1
  addi t1, zero, 1
  add  t2, t0, t1
  lui  t4, 0x10
  addi t4, t4, -1
  sltu t5, t4, t2
  sub  t5, zero, t5
  xori t6, t5, -1
  and  t2, t2, t6
  and  t4, t4, t5
  or   t2, t2, t4
  addi a0, t2, 0
  ret
```

Building the image needs the bare-metal target:

```bash
rustup target add riscv64gc-unknown-none-elf
cargo build --manifest-path rust/pyac-riscv/Cargo.toml --release \
  --target riscv64gc-unknown-none-elf
```

The conformance tests are `rust/pyac/tests/riscv_backend.rs` and
`quiz/vliw_riscv.test.mjs`, and the instruction encodings are pinned to the
instruction set's own field layout in
`rust/pyac/src/backend/riscv.rs`.

The image is not executed here. The backend carries its own executor for the
instruction subset it emits, and that executor is what proves the result
matches the interpreter; running the image itself needs a RISC-V machine or
emulator, which this repository does not yet depend on.

## Pyash source through a persisted `.pyac` pack

The existing compile verb can lower a one-paragraph Pyash source file into the
fixed-width PyAC VLIW pack, then compile that pack to C:

```pyash
from filename "examples/pyash/vliw-constant-arithmetic.pya" fromstate pyash tostate pyac to filename "examples/out/vliw-constant-arithmetic.pyac" be compile do
from filename "examples/out/vliw-constant-arithmetic.pyac" fromstate pyac tostate c to filename "examples/out/vliw-constant-arithmetic.c" be compile do
```

The first compile fails with the source sentence number if a sentence cannot
be lowered, and it requires a destination filename so the binary pack is
persisted. The current flat pack does not preserve paragraph boundaries.
`examples/pyash/compile-vliw-constant-arithmetic.pya` is a runnable build
driver; its source fixture uses three independent constant arithmetic
sentences.

```bash
./run examples/pyash/compile-vliw-constant-arithmetic.pya
cc -std=c11 -Wall -Werror -o examples/out/vliw-constant-arithmetic examples/out/vliw-constant-arithmetic.c
./examples/out/vliw-constant-arithmetic
```

The executable prints `42`, `40`, and `42`, one result per codelet.
`examples/out/` is ignored by Git.

## C from a persisted `.pyac` pack

The existing Pyash compile verb accepts a persisted PyAC pack as a C source:

```pyash
from filename "program.pyac" fromstate pyac tostate c to filename "program.c" be compile do
```

This path validates the pack header, decodes each 16-word codelet, schedules
named-state dependencies, and emits executable C for every semantic currently
accepted by the VLIW executor: typed and named number/text literals, boolean
literals, numeric `plus` and arithmetic (`subtract`, `multiply`, `divide`,
`xor`, `exponential`, and `remains`), numeric `invert`, named queries, dates,
and numeric, boolean, and text vectors. Named numeric subtraction updates its
named value before later codelets query it. The generated executable prints
one JSON fact per codelet in source-pack order, matching the reference
executor. Division and remainder by zero fail visibly at execution. Malformed
packs and codelets without a VLIW semantic adapter fail compilation rather
than becoming placeholder code.

The conformance quiz persists packs, compiles them through this Pyash surface,
runs the generated C executable, and compares its JSON facts with
`executeCodelets`. Named values are mutable during execution; the flat `.pyac`
container still carries a sequence of codelets rather than paragraph
boundaries.
