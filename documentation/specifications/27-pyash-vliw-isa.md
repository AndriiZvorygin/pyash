# Pyash VLIW ISA and lowering contract

Status: normative encoding and semantic contract for the supported Pyash VLIW
subset. Implemented behavior and remaining gaps are tracked in
`documentation/reference/pyac-vliw-semantic-slices.md`. This specification
does not change the Pyash parser or sentence ABI.

## 1. Scope and authority

Pyash sentences and paragraphs are the canonical semantic IR. Source front
ends MUST lower to that IR; mood, verb, cases, values, and effects remain
authoritative after encoding. WordNet and SUMO links are catalog metadata, not
executable identity or semantics. The shared Rust runtime defines supported
VLIW behavior.

Encoding follows the legacy `lwonprom` repository at
`b6ef5eefcea4d10b5a0f09680976377ccfb28a35` (`documentation/encoding.tex`,
`documentation/vmOnOpenCL.tex`, `program/encoding.c`,
`program/translation.c`). No word allocation, extension bit, or executable
sidecar is added; unproven compatibility MUST be rejected. This contract
covers lowering, encoding, and execution. The searchable catalog and `.pyac`
container are specified in
[`pyac-vliw-database.md`](../reference/pyac-vliw-database.md); compiler
optimization, GPU runtime, host memory, and new Pyash commands are out of scope.

## 2. Terms

- **Sentence / paragraph:** the existing typed flat Pyash object / an ordered
  list of sentences.
- **Independent section:** a named top-level pure programlet delimited by
  `myocpfun`; sections share no writable state or implicit dependencies.
- **Semantic instruction:** a sentence with normalized read, write, control,
  and effect information.
- **Codelet / phrase:** a legacy 16-bit sequence for a clause (possibly
  multi-clause) / a case-value region marked by index bits.
- **HNUC:** current Pyash word/case identity validated by the compositional
  case inventory; it is not an older `lwonprom` phonological word number.
- **Canonical bytes:** exact little-endian encoded words in codelet order,
  without timestamps, addresses, paths, or runtime pointers.

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

The source front end MUST preserve semantic distinctions. A gloss, translation
pair, or pretty-printed sentence is not execution authority. Existing
translation pairs may provide a presentation or fallback surface, but a backend
MUST reject cases, types, mood, or values that the canonical sentence and legacy
word tables cannot represent. It MUST NOT drop fields, encode the whole sentence
as an opaque quote, or attach an executable sidecar.

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

Quotes use a five-bit quote-denote and eleven-bit sort payload for region,
sequence, and scalar or vector width. Zero length denotes raw bytes; otherwise
length counts following 16-bit fields. The decoder MUST enforce type
compatibility; quotes cannot hide unrepresentable sentences.

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

The codelet is sixteen 16-bit words (256 bits / 32 bytes), a single-sentence
encoding unit rather than parallel operations. Its first word is the canonical
head/index: bit 0 marks sentence completion; bits 1..15 mark phrase-closing
slots. A slot is a boundary exactly when its bit equals bit 0. Decoders SHOULD
derive phrase spans from these offsets; token walking MUST yield the same
fields, verb span, mood, and error. Writers MUST align boundary bits with case
and mood words. Remaining words encode quote data, cases, verb, mood, and zero
tail padding.

Long paragraph quotes use the legacy Lwonprom blockquote framing: the
paragraph-letter quote has the `L` flag and a uint16 payload-word count. Above
28 bytes, indexed encoding ends after the header/count and payload occupies
`ceil(payload_words / 16)` raw vectors, all words data. Final padding is zero;
the next vector resumes indexed encoding. The count defines the extent. A
decoder MUST skip exactly that many vectors and reject a missing block or
nonzero final padding. Short quotes stay inline.

Vector quote layout and continuation rules are defined in
`28-pyash-vliw-targets.md`.

The index marks completion in bit 0 and phrase/mood boundaries in bits 1..15,
relative to that completion state. For multi-vector values or clauses, the
decoder collects through the final index and validates the flattened words.
It MUST reject missing continuations, impossible boundaries, nonzero
unassigned tails, and invalid quote lengths; it MUST NOT infer words from
source text. Semantic adapters require a sentence-specific golden fixture.

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

## 5.1 Runtime signature dispatch

Mood selects a class: `def` loads definitions but never executes; `prah` closes
definitions at load and invoked frames on exit; `ya` initializes declarations
and frames; `do` executes; `then` selects conditional control; and `ret` returns.
Only `do` performs runtime lookup. Its key is ordered be-verb HNUCs plus
`(case, value-type)` pairs sorted by unsigned HNUC; mood, case source order,
literals, and payload values do not affect identity. The reference dictionary's
mood-qualified key is the flattened view across classes. Dispatch MUST use
numeric data, select at most one handler, and reject unsupported signatures
without fallback. Handlers MAY be earlier routines in the same programlet;
structural values MUST validate framing first. Later equal-key definitions
supersede earlier ones by source order. See [implementation details](../reference/pyac-vliw-semantic-slices.md#runtime-signature-dispatch).

## 5.2 General execution contract

Status: target model. Rust currently uses a program counter and bounded call
stack; the ready-work queue below is not implemented.

Instructions carry stable input/output references, fulfillment state, working
locations, and read/write effects. Each dependency region MUST have one writer
per reference; decoders MUST reject conflicts unless the sentence orders them.
Inputs and control MUST be fulfilled before execution. Executors MAY reorder
independent work while preserving dependencies, writer rules, side-effect
order, and codelet boundaries; workers synchronize before exposing values to
dependents.

Target model: immutable codelets, stable working/output references, a
ready-work queue, worker-local call stacks, and completion history. Branches
and rejoins use explicit dependencies or call boundaries. Static loops repeat
codelets; dynamic loops require explicit bounded continuations. Calls enqueue
local frames and rejoin after outputs are fulfilled. Parallel work requires
proven independence.

### IWSP float-vector compositions

These are ordinary typed sentences, with no transformer-specific opcodes. See
[the target contract](28-pyash-vliw-targets.md) for `kl6m psas` and `gjat
bwit`. Dot product preserves precision and accepts equal, non-empty, finite
float32 or float64 inputs; maximum with a comitative vector is elementwise,
requires matching width and precision, and retains the source lane on ties.

`dwic kwap` returns `sqrt(variance + epsilon)` at the input float width;
epsilon defaults to zero. Both inputs MUST be finite, non-negative, and the
same width. Negative values return the shared float-domain error. LayerNorm is
composable from these primitives and ordinary vector operations; it adds no
fused opcode.

### Independent named sections

A packet MAY contain up to 64 independent sections delimited by matching
`myocpfun def` / `myocpfun prah` sentences with the same `su name`. Names MUST
be unique, HNUC-encodable, and at most eight HNUC words. Bodies MUST be pure
programlets without cross-section state or dependencies. Boundaries use
ordinary flat-v1 codelets and add no table or codelet limit; packet and step
budgets apply. Executors MAY return sections in completion order, identified
by source ordinal and name. JavaScript runs in source order; Rust may differ.

### Inline immutable storage sections

A v1 pack MAY end with immutable storage sections declared by the existing
`pfun myoc` verb:

```text
exists su name weights from filename "weights.bin"
  by ve num <length-low-u16> <length-high-u16>
  as name float with ve num <rows> <columns> be pfun myoc ya
```

`from filename` is a compile-time locator omitted from the descriptor. The two
`by` words encode the exact uint32 byte length, low word first. `with ve num`
has one to eight positive uint16 dimensions; their product times element width
MUST equal that length. Numeric widths are `paucal_number_` 8, `number_` 16,
`plural_number_` 32, and `multal_number_` 64 bits; `float` resolves to 32 or
64 bits from shape and payload length.

Executable sentences MUST precede storage sections. Each descriptor is
ordinary sentence codelets, followed by `ceil(byteLength / 32)` payload
codelets containing exact little-endian bytes. Only final-codelet padding is
allowed, and it MUST be zero. The 32-byte v1 header and zero reserved field
remain unchanged; its count includes descriptors and payload, and total pack
length fits uint32. Readers MUST recognize the full section signature/extent,
validate unique names, dimensions, widths, lengths, and padding, then skip
payload as data. GPU consumers bind it read-only; rank-two floats are row-major
and match the stored element count. Allocation failures never trigger fallback.

### Payload-backed embedding-row view

A `tsoc hsat` sentence may bind one row of an immutable file-backed rank-two
float32/float64 section as a named vector:

```pya
from name pset gjat at num 1 to name lyac dlek be tsoc hsat do
ob name hwas by name lyac dlek be kl6m psas do
```

Its signature is `SOURCE name`, `DESTINATION name`, `LOCATIVE uint16|name`,
and `do`. A literal uint16 selects a zero-based row; a named selector reads
one uint16 from immutable rank-one `number_` storage. Add
`MULTIPLICATIVE uint16` to select a zero-based position in that named sequence.
In Pyash, that case is `fromindex num <position>`:

```pya
from name pset gjat at name lwat txik fromindex num 0 to name lyac dlek be tsoc hsat do
```

It is zero-copy. Invalid selectors or storage fail. Resolution scans prior
groups without an index or copy. IDs are supplied; text tokenization and
word-sense disambiguation remain separate.

### Pyash VLIW authentication sentence

Binary Housekeeper upload concatenates two independently framed `.pyac` packs:
an authentication sentence followed by the exact job pack. The sentence is:

```text
su name identity ob text "<username>"
  from text "<host-id>" to text "<handle-id>"
  at ve num <8 uint16 nonce words>
  with ve num <16 uint16 SHA-256 words>
  by ve num <16 uint16 HMAC-SHA-256 words> be handshake do
```

Words encode little-endian values. HMAC-SHA-256 covers the UTF-8 bytes of
`pyac-vliw-upload-v1\0<username>\0<host-id>\0<nonce-hex>\0<handle-id>\0<job-sha256-hex>`
using the key in machine-local `configure/secret.pya`; the job digest covers
the complete following pack. The key is declared by `exists su name gpu
authentication key ob text "<secret>" be text ya`. Receivers validate both
frame boundaries, the identity sentence, digest, and HMAC before queue
admission. The client posts raw concatenated bytes to `/submit-pyac` as
`application/vnd.pyac-vliw-upload`, without JSON or Base64. Housekeeper stores
the verified pack by content hash and forwards raw bytes to the resident Rust
runtime; peers verify the shared-secret signature independently. Queue status
uses the existing JSON control API.

### Hosted PyashForth memory profile

Hosted JavaScript programlet v1 admits invocation-local unsigned 16-bit numeric
slots declared before actions:

```text
exists su name count ob num 0 as name variable be number ya
exists su name limit ob num 5 as name permanently number be number ya
```

`variable` slots accept typed `to name num` writes; `permanently number`
slots are read-only. Each invocation gets a fresh frame, discarded on return;
initializers are the declaration's `ob num` values. Unsupported declarations,
slot types, and allocation forms fail explicitly. This slice adds no `.pyac`
section or program-wide state. Logical pages and quoted-payload initialization
remain future work.

The executor MUST report malformed codelets, unfulfilled dependencies,
duplicate writers, invalid types, and unsupported effects as failures, never
as a different successful sentence.

## Target companion

Target capability selection, dot product (`kl6m psas`), exact-match count
(`pluk tlas`), backend lowering, and compatibility examples are normative in
[Pyash VLIW targets and compatibility](28-pyash-vliw-targets.md).
