# Pyash VLIW ISA and lowering contract

Status: normative encoding and semantic contract for the supported Pyash VLIW
subset. Implemented behavior and remaining gaps are tracked in
`documentation/reference/pyac-vliw-semantic-slices.md`. This specification
does not change the Pyash parser or sentence ABI.

## 1. Scope and authority

Pyash sentences and paragraphs remain the canonical semantic IR. A source
language front end MUST lower to that IR before it is encoded. VLIW codelets
are a compiled representation of the same sentences, not a second semantic
language. The sentence's mood, verb, cases, values, and dependency effects
remain authoritative after lowering.

WordNet and SUMO links are catalog metadata, not executable tokens. Sentences
and codelets use Pyash words and HNUCs. Lexical links identify concepts but do
not define runtime details such as types, precision, or errors. The shared Rust
runtime is the VLIW semantic reference; its contract is recorded here and in
the semantic-slice reference.

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
- **Independent section** is one named, top-level pure programlet delimited by
  the Pyash compound `myocpfun`; sections share no writable state or implicit
  dependencies and may be dispatched independently.
- **Semantic instruction** is one sentence together with its normalized read,
  write, control, and effect information.
- **Codelet** is one self-contained independent clause/sentence lowered to a
  sequence of legacy 16-bit words. A paragraph is a sequence of codelets and
  may also contain a multi-clause codelet when the legacy layout permits it.
- **Phrase** is a case/value region in a codelet. Its boundary is represented
  by the legacy index and phrase-marker bits/words, not by a separator string.
- **HNUC** is a current Pyash word/case identity validated by the compositional-
  case inventory. It is not interchangeable with an old `lwonprom` word number.
- **Lexical link** associates a Pyash word or compound with an external sense;
  it explains vocabulary identity, not sentence or runtime behavior.
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

The source front end MUST preserve semantic distinctions. A gloss,
translation pair, or pretty-printed sentence is not execution authority.
Translation pairs may provide a presentation surface, but a backend MUST
reject cases, types, mood, or values that the canonical sentence and legacy
word tables cannot represent. It MUST NOT drop fields, quote the whole
sentence opaquely, or attach an executable sidecar.

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

Legacy quote sort 6 with four-byte scalar width encodes one IEEE-754 binary32
value. Its scalar quote header is `0xd01d`; the payload is two 16-bit words in
little-endian order (low word first). The current scalar-float implementation
accepts finite values only and rejects NaN and infinities. Arithmetic promotes
both scalar operands to binary32 when either operand requires the float sort;
`plus`, `subtract`, `multiply`, and `divide` execute with binary32 results.
Unsigned-16-only arithmetic keeps its existing integer behavior. Typed vector
quotes and their distinction from variable-length arrays are specified in
`28-pyash-vliw-targets.md`.

The source form `quoted.<kind> ... .<kind>.quoted` delimits a payload and
annotates its kind. Preserve that kind as metadata outside the payload. A
non-default kind uses this paired `zi` frame:

```text
zi 0 tag [length-quote] [hash-quote] 0 payload 0 tag 0 zi
```

`zi` is the existing `quoted_` HNUC (`0x229E`). The complete typed tag is
framing metadata (not a quote sort) and is repeated unchanged at close. Optional
fields are typed quotes: none, payload length, or length then hash. Length is
an unsigned 16-bit number quote (`0x881D` plus word count); hash requires length.
Each quote header defines its extent.

Within the frame, zero words delimit the prefix, payload, and close; outside it,
zero retains its padding meaning. After `zi`, zero means padding and a nonzero
tag begins the frame. The payload uses its ordinary typed quote encoding; the
decoder follows declared extents, never scans payload for a tag, and validates
the optional length. A versioned profile MUST define the hash algorithm and
canonical bytes before producers emit hashes; until then, sentence decoding
rejects hash-bearing frames. Decoding restores the tag in `quoteKinds`. This
adds no quote sort or HNUC; flat v1 `.pyac` stores the frame in codelet words.

### 4.2 VLIW shape

The codelet is sixteen 16-bit words (256 bits / 32 bytes). Its first word is
the head/index; bits mark phrase boundaries and completion. Remaining words
encode quote data, cases, verb, mood, and zero tail padding.

Long paragraph quotes use the original Lwonprom blockquote framing: the
paragraph-letter quote has the legacy `L` flag and a 16-bit payload-word count.
Above 28 bytes, the indexed stream ends after its header/count and payload
occupies `ceil(payload_words / 16)` raw vectors (all 16 words are data). Final
padding is zero; the next vector resumes indexed encoding. The count defines
the raw extent. A decoder MUST skip exactly that many vectors and reject a
missing block or nonzero final padding. Short quotes stay inline.

Vector quote layout and continuation rules are defined in
`28-pyash-vliw-targets.md`.

The index has two required properties from the legacy VM:

- a completion bit indicates whether the current 16-word vector is the final
  part of a codelet; and
- phrase/mood marker bits identify phrase or mood words relative to that
  completion state.

For multi-vector values or clauses, the decoder collects vectors in order to
the final index and validates the flattened words. It MUST reject a missing
continuation, impossible boundary, nonzero unassigned tail, or invalid quote
length; it MUST NOT infer words from source text. Semantic adapters require a
sentence-specific golden fixture before execution.

A transport MAY batch codelets but MUST preserve their bytes and order.

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

## 5.1 Runtime signature dispatch

The Rust VLIW runtime selects one semantic handler from the encoded sentence
signature before executing it. The matching key is:

```text
ordered be-verb HNUCs
+ sorted [(case HNUC, value-type descriptor)]
```

Case pairs are sorted by ascending unsigned numeric HNUC for dispatch-key
comparison. Each type descriptor preserves the encoded semantic type, including
quote sort, scalar width, and scalar-versus-vector form where applicable. A
compound verb retains its encoded HNUC sequence and order. The source codelet,
payloads, and phrase boundaries are not reordered; sorting applies only to the
temporary dispatch key. Mood remains part of sentence validation and handler
semantics, but is not part of this key. Identifier payloads and literal values
likewise remain values, not signature identity.

This runtime ordering is independent of source-language spelling, English
glosses, WordNet/SUMO links, and dictionary lookup. The Rust core reads numeric
HNUCs and quote headers already present in the codelet. It uses bounded
fixed-capacity storage, performs no allocation or text conversion, and
dispatches to at most one handler. An unknown verb or unsupported case/type
shape returns an error instead of probing other handlers as fallbacks.

Continuation-framed values and programlet branch encodings have dedicated
structural routes because their payload words are not ordinary phrase tokens;
those routes validate their framing before selecting the corresponding shared
semantic operation.

## 5.2 General execution contract

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

### IWSP float-vector compositions

These operation forms are part of the shared Rust programlet runtime. They are
ordinary typed Pyash sentences; they do not introduce transformer-specific
opcodes.

`kl6m psas` (dot product) has two programlet output forms:

```text
ob name float vector-left by name float vector-right
  to name float dot-result be kl6m psas do
ob name float vector-left by name float vector-right
  to name dot-lanes at num lane be kl6m psas do
```

The first writes a float local with the operands' precision. The second writes
the scalar result into the indicated lane of a declared float vector. Both
require equal, non-empty, finite float32 or float64 operands of the same
precision. The generic `float` type preserves the actual float width. An
unindexed typed scalar destination and an indexed vector-lane destination are
distinct signatures of the same dot-product operation.

`gjat bwit` (maximum) is a reduction when no comitative vector is present. With
an equal-width, same-precision comitative vector it is elementwise maximum:

```text
from name preactivation with name zero-vector
  to name activated be gjat bwit do
```

The output is a float vector; ties retain the source lane. A zero vector thus
expresses ReLU directly as `max(preactivation, zero-vector)`, with no hidden
activation or host-side callback.

`dwic kwap` is the standard-deviation operation over a scalar variance:

```text
from name float variance with num epsilon
  to name float deviation be dwic kwap do
```

The optional epsilon defaults to zero. Variance and epsilon must be finite,
non-negative, and the same float width; the result is `sqrt(variance +
epsilon)` at that width. A negative input or epsilon returns the shared
float-domain error. The shared no-std implementation uses a bounded Newton
iteration; it is tested on normal and subnormal values on CPU, and the CUDA
conformance case exercises it in the full block.

The Stage 8 LayerNorm composition computes mean as a dot product with a uniform
`1/N` vector, subtracts that scalar from the input, computes population
variance as a dot product of centered values and values scaled by `1/N`, then
divides by `dwic kwap` with a small positive epsilon. Residual connections use
the existing equal-width vector `plus` operation. The runnable Stage 8 example
is a two-feature proof: it does not add a fused LayerNorm, matrix-multiplication
opcode, or arbitrary-shape tensor execution.

### Independent named sections

A sectioned source packet uses matching `myocpfun` paragraph boundaries around
each self-contained programlet:

```text
su name first be myocpfun def
... programlet definition and invocation ...
su name first be myocpfun prah
su name second be myocpfun def
... independent programlet definition and invocation ...
su name second be myocpfun prah
```

Section names MUST be unique, HNUC-encodable, and at most eight HNUC words;
the packet supports at most 64 sections. A section body has no fixed
codelet-count ceiling: its length is bounded by the enclosing packet and the
executor's step budget. Each section MUST be a valid pure programlet and MUST not read
or write another section's local state. The
boundaries lower to ordinary codelets inside the existing flat v1 `.pyac`
stream; this does not add a container section table or change codelet bytes.
The source ordinal is retained as `sectionIndex` for identity, not as a result
ordering constraint. Executors MAY schedule independent sections in any order
and MUST return each result as its section completes. Thus result order is
completion order, while the included source ordinal and Pyash name allow
consumers to associate each value with its section. The deprecated JavaScript
interpreter is serial and completes sections in source order; Rust CPU and GPU
executors may complete them in a different order. Any
dependency between sections disqualifies them from this independent section
form and must be expressed within an ordered programlet instead.

### Inline immutable storage sections

An executable pack may end with one or more immutable storage sections. Each
section is declared by an ordinary Pyash sentence using the existing `pfun
myoc` section verb:

```text
exists su name weights from filename "weights.bin"
  by ve num <length-low-u16> <length-high-u16>
  as name float with ve num <rows> <columns>
  be pfun myoc ya
```

`from filename` is a compile-time asset locator and is omitted from the
compiled descriptor. `by ve num` contains exactly two unsigned 16-bit words;
the low word precedes the high word and together they give the exact uint32
byte length. `as name` selects the element representation. The Pyash numeric
family's storage widths are fixed:

| Pyash numeric type | storage width |
| --- | ---: |
| `paucal_number_` | 8 bits |
| `number_` | 16 bits |
| `plural_number_` | 32 bits |
| `multal_number_` | 64 bits |

These widths describe storage representation, not the arithmetic semantics of
an operation. `float` selects IEEE floating-point storage and must resolve to
32- or 64-bit elements from the declared shape and exact payload length.
`with ve num` contains one through eight positive uint16 dimensions. The
dimension product times the element width MUST equal the declared byte
length. The total pack still obeys the v1 uint32 byte-length field.

The compiler emits the descriptor as ordinary sentence codelets, immediately
followed by `ceil(byteLength / 32)` opaque payload codelets. Bytes occupy the
little-endian byte order of the 16 uint16 words; only the final codelet may be
padded, and all padding bytes MUST be zero. The header remains the existing
32-byte v1 header, its reserved field remains zero, and its codelet count
includes both descriptor and payload codelets. Executable sentences MUST
precede storage sections. A reader identifies a section from its complete
Pyash signature, reads its exact extent, and skips the payload without scanning
it for sentence boundaries. Payload codelets are data, never executable
instructions.

The resident Rust GPU worker binds the descriptors, Pyac names, and exact
payload bytes as separate read-only GPU inputs. Its shared Rust semantics
runtime resolves named rank-one float32/float64 storage vectors for `kl6m psas`
(dot product); the storage length is not restricted by the inline vector lane
limit. It also accepts a rank-two matrix as the named `by` operand. In this
form, `to name <output> at num <row>` selects the matrix row whose dot product
is returned. Repeating that sentence for successive row indices computes a
matrix-vector product from ordinary dot-product sentences; it adds neither a
matrix-multiplication opcode nor mutable tensor output. The selected row is
bounds-checked; flattened rank-two payload elements are row-major, and the
declared dimensions must multiply to the exact stored element count. Inline
vector literals retain their independent
hardware-oriented lane limit. Descriptor dimensions, element widths, exact
byte lengths, unique names, and final-codelet padding are validated before GPU
dispatch. The v1 pack's
uint32 total-byte field is the protocol ceiling; hosts and devices may impose
lower practical memory limits during allocation, and those failures are
reported rather than silently falling back to another execution path.

### Payload-backed embedding-row view

The matrix row operation can bind a row under a named vector without copying
its payload into the inline-vector result:

```pya
from name pset gjat at num 1 to name lyac dlek be tsoc hsat do
ob name hwas by name lyac dlek be kl6m psas do
```

The lookup signature is exactly `SOURCE name`, `DESTINATION name`, and
`LOCATIVE uint16`, with deontic mood. The source names an immutable,
file-backed rank-two float32/float64 section; `at num` is a zero-based uint16
row number; the destination names a row view. The row-major payload remains in
its original storage section. A later named-vector operation in the same pack
resolves the most recent preceding lookup that assigned that name, then reads
the selected row directly from the payload. This supports widths above the
16-lane inline literal limit. An alias colliding with a storage-section name
is rejected. Missing sections, malformed shapes, unsupported element types,
and out-of-range rows produce errors; the lookup itself returns no vector
value.

This first slice uses a literal `at num` row. It does not yet read a dynamic
token ID from a named runtime value, tokenize text, or choose a WordNet sense.
Those remain later IWSP stages. Named-view resolution scans preceding sentence
groups in the submitted pack; it creates no runtime index or copied tensor.

The surface words have these documented lexical meanings:

| Pyash form | Lexical anchor and meaning | Role here |
|---|---|---|
| `pset gjat` | Open English WordNet 2025 `n:05873065-n`, “a generalization of the concept of a vector”; SUMO `Quantity` (`+`). Its linked components are `extend` (`pset`) + `magnitude` (`gjat`). | Existing tensor name for the rank-two embedding table. |
| `tsoc hsat` | Open English WordNet 2025 `n:13574763-n`, a table lookup operation that determines whether one or more items has a specified property; SUMO `ContentDevelopment` (`+`). Existing compound components: `searching` (`tsoc`) + `see` (`hsat`). | Existing lookup verb; binds one indexed row. |
| `lyac` | Open English WordNet 2025 `v:00599310-v`, learn/acquire knowledge; SUMO `Learning` (`+`). | Modifier in the result label. |
| `dlek` | Open English WordNet 2025 `n:05873161-n`, a vector quantity resolvable into components; SUMO `FunctionQuantity` (`=`). | Head of the result label. |
| `lyac dlek` | Descriptive composition “learned vector.” Its atoms link to the senses above, but this sequence is not asserted to be a separately curated compound. | Name of the zero-copy row view. |

The example's learned-embedding wording describes the role of the payload;
these lexical links do not imply that lookup trains or learns the stored values.

The internal storage descriptor retains all eight possible extents after its
eight general metadata fields. This is a host/GPU binding structure, not extra
codelet syntax or a `.pyac` header field. Rank-two float sections use row-major
flattened payload order for the `kl6m psas` row operation above.

This profile adds no header field, second pack format, sidecar, pointer, or
runtime-generated index. A reader that does not recognize the storage
signature MUST reject the pack rather than dispatching opaque payload words as
instructions. The compiler embeds and validates file-backed sections; the
runtime extracts their storage bindings while retaining executable codelets as
the original uint16 input stream.

### Pyash VLIW authentication sentence

The binary Housekeeper upload is two consecutive, independently framed `.pyac`
packs: an authentication sentence, then the exact job pack. Its Pyash source
form is:

```text
su name identity ob text "<username>"
  from text "<host-id>" to text "<handle-id>"
  at ve num <8 uint16 nonce words>
  with ve num <16 uint16 SHA-256 words>
  by ve num <16 uint16 HMAC-SHA-256 words>
  be handshake do
```

The vectors carry fixed-size binary values as little-endian uint16 words: an
8-word (128-bit) nonce and 16-word digests. The caller signs the UTF-8 bytes of
`pyac-vliw-upload-v1\0<username>\0<host-id>\0<nonce-hex>\0<handle-id>\0<job-sha256-hex>`
with HMAC-SHA-256 and the key declared by
`exists su name gpu authentication key ob text "<secret>" be text ya`
in machine-local `configure/secret.pya`. The job digest covers every byte of
the complete following pack, including its existing header and embedded
storage. The receiver validates both frame boundaries, the Pyash identity
sentence, the digest, and the HMAC before durable queue admission.

The client posts this raw concatenation to Housekeeper `/submit-pyac` using
`application/vnd.pyac-vliw-upload`; it does not Base64-encode the program or
place the pack in JSON. Housekeeper persists the verified job pack by content
hash, then sends the raw pack to the resident Rust VLIW runtime's
`/v1/execute-pack` endpoint. If Housekeeper routes the job to a peer, it
forwards the same signed byte stream and the peer independently authenticates
it with the shared secret. Queue admission and status remain available through
the ordinary JSON Housekeeper control API.

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

## Target companion

Target capability selection, dot product (`kl6m psas`), exact-match count
(`pluk tlas`), backend lowering, and compatibility examples are normative in
[Pyash VLIW targets and compatibility](28-pyash-vliw-targets.md).
