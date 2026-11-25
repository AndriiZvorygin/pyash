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

The dispatch key is ordered be-verb HNUCs plus grammatical-case/value-type
pairs sorted by unsigned HNUC. Preserve types, verb order, and payloads;
validate mood but exclude mood and literals from key identity. Dispatch MUST
use numeric data, select at most one handler, and reject unsupported signatures
without fallback. Structural values MUST validate framing first. See
[implementation details](../reference/pyac-vliw-semantic-slices.md#runtime-signature-dispatch).

## 5.2 General execution contract

Instructions carry numbered input/output references, fulfillment state, and
working-memory locations, and identify reads and writes. Each dependency region
MUST have at most one writer per reference; decoders MUST reject conflicts
unless the sentence defines an ordered effect.

Inputs and control conditions MUST be fulfilled before execution. Executors
MAY reorder independent work but MUST preserve dependencies, single-writer
rules, observable side-effect order, and paragraph/codelet boundaries. Workers
synchronize at evaluation boundaries before exposing values to dependent
codelets.

The execution model has:

- immutable codelet storage;
- working/output storage addressed by stable references;
- a ready-work queue rather than a mandatory program counter;
- worker-local call-frame stacks; and
- completion history sufficient to diagnose or replay codelets.

Branches write conditions/references that dependent clauses await; rejoins MUST
use explicit dependencies or call boundaries. Static loops repeat codelets;
dynamic loops require an explicit continuation/jump reference and bounded
termination. Calls enqueue a local frame and rejoin after declared outputs are
fulfilled; parallel execution requires proven independence.

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

A packet MAY contain up to 64 independent sections, each delimited by matching
`myocpfun def` and `myocpfun prah` sentences with the same `su name`. Names
MUST be unique, HNUC-encodable, and at most eight HNUC words. Each body MUST
be a valid pure programlet and MUST neither access another section's local
state nor depend on another section. Boundaries use ordinary codelets in the
flat v1 stream and add no container table or codelet limit; packet and step
budgets still apply. Executors MAY complete sections in any order and return
results in completion order; callers identify them by source ordinal and name.
The JavaScript interpreter completes in source order; Rust may differ.

### Inline immutable storage sections

A v1 pack MAY end with immutable storage sections declared by the existing
`pfun myoc` verb:

```text
exists su name weights from filename "weights.bin"
  by ve num <length-low-u16> <length-high-u16>
  as name float with ve num <rows> <columns> be pfun myoc ya
```

`from filename` is a compile-time locator and is omitted from the descriptor.
The two `by` words encode the exact uint32 byte length, low word first.
`with ve num` has one to eight positive uint16 dimensions whose product times
the element width MUST equal that length. Numeric-family storage widths are
`paucal_number_` 8, `number_` 16, `plural_number_` 32, and `multal_number_`
64 bits; `float` resolves to 32 or 64 bits from shape and payload length.

Executable sentences MUST precede storage sections. Each descriptor is
encoded as ordinary sentence codelets, followed by `ceil(byteLength / 32)`
payload codelets containing the exact little-endian bytes. Only final-codelet
padding is permitted, and it MUST be zero. The existing 32-byte v1 header and
zero reserved field remain unchanged; its codelet count includes descriptors
and payload, and total pack length is bounded by its uint32 field. Readers
MUST recognize the complete section signature and declared extent, validate
unique names, dimensions, widths, byte lengths, and padding, and skip payload
without treating it as instructions. GPU consumers bind validated payloads
read-only; rank-two float storage is row-major, with dimensions matching the
stored element count. Allocation failures are errors, never a backend fallback.

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
