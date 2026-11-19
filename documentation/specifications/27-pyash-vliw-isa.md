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

Legacy quote sort 6 with four-byte scalar width encodes one IEEE-754 binary32
value. Its scalar quote header is `0xd01d`; the payload is two 16-bit words in
little-endian order (low word first). The current scalar-float implementation
accepts finite values only and rejects NaN and infinities. Arithmetic promotes
both scalar operands to binary32 when either operand requires the float sort;
`plus`, `subtract`, `multiply`, and `divide` execute with binary32 results.
Unsigned-16-only arithmetic keeps its existing integer behavior. Float vectors,
binary64 values, and float storage in mutable programlet slots are not part of
this scalar-float slice.

The source form `quoted.<kind> ... .<kind>.quoted` is a block delimiter and
payload annotation, distinct from the legacy quote sort. Parsing must retain
the block kind as semantic metadata alongside the payload; it must not fold
the delimiters into the payload or silently discard the kind. The kind is
external to the payload, consistent with the legacy quote model's separation
of value bytes and type information. In the VLIW sentence stream, a non-default
kind uses the paired `zi` frame:

```text
zi 0 tag [length-quote] [hash-quote] 0 payload 0 tag 0 zi
```

`zi` is the existing `quoted_` HNUC (`0x229E`). The tag is a complete,
self-delimiting typed quote value carrying the source quote kind (a text quote
when the kind is textual); its full encoded words are repeated unchanged at
close. It is framing metadata, not the legacy quote-sort field. Each optional
field is a complete, properly typed quote value. No optional fields means
neither length nor hash; one means the payload length in 16-bit words; two
means payload length followed by hash. Thus a hash is never present without
the length field. Each value's quote header and length determine its extent,
so hashes need not have a fixed width. The length field is an unsigned 16-bit
number quote (`0x881D` followed by the word count).
The zero after `zi` distinguishes a frame from zero padding: a following zero
means padding, while a nonzero tag begins the frame. The zero before `payload`
ends the tag and optional-field prefix, and the payload uses its ordinary
typed quote encoding. The closing zero and repeated tag must be followed by
`zi`.

Within this frame, the decoder interprets zero words as delimiters; outside
the frame, zero words retain their existing padding meaning. It parses the
tag and optional typed fields by their declared extents, then parses the
payload by its quote header and length. It does not scan arbitrary payload
words for a matching tag. If present, the payload length is checked against
the decoded payload extent. Before producers emit a hash, a versioned profile
MUST specify its algorithm and the canonical payload bytes it covers.
Until such a profile is configured, the structural decoder can read a hash
field but the sentence decoder rejects hash-bearing frames rather than
silently treating an unverified digest as valid.
Decoding restores the tag's quote kind to the sentence's `quoteKinds` map.
This framing allocates no legacy quote-sort value or new HNUC; the flat v1
`.pyac` container preserves the frame in its codelet words.

### 4.2 VLIW shape

The legacy codelet is a vector of sixteen 16-bit words: 256 bits / 32 bytes.
The first word is the head/index word. Its bits mark phrase boundaries and
whether a word is a phrase, case, verb, mood, or continuation according to
the legacy index format. The remaining words hold quote denotations, content,
case/phrase markers, the verb, mood, and zero/unassigned tail words where the
codelet ends early.

Long paragraph quotes follow the original Lwonprom blockquote framing. A
paragraph-letter quote carries the legacy `L` vector-thickness flag and an
explicit 16-bit payload-word count. For payloads larger than 28 bytes (more
than fourteen 16-bit letter units), the indexed codelet stream ends that
prefix immediately after the quote header and count. The quote data then
occupies `ceil(payload_words / 16)` raw 16-word vectors: those vectors have no
index word, so all sixteen words are available to the quote. Unused words in
the final raw vector are zero. The next vector resumes the ordinary indexed
stream, where the following grammatical case, verb, mood, or sentence begins.
The count, not a scan for an index-like word or a terminator, determines the
raw extent. A decoder MUST skip exactly that many vectors and MUST reject a
missing block or nonzero final padding. Short paragraph quotes remain inline
in the indexed stream.

Ordinary vectors use indexed continuation, not raw blockquote vectors.
Numeric and boolean vector quote headers identify their element type and
fixed/explicit element count; their elements may cross any number of indexed
codelets. Text vectors retain one typed letter quote per element and use the
same indexed continuation for the vector as a whole. A text element that is
itself a long paragraph quote uses the long-quote framing above. Decoding MUST
preserve element order, zero-valued elements, and the distinction between a
vector and a scalar.

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
the packet supports at most 64 sections, with at most 64 codelets in each
section body. Each section MUST be a valid pure programlet and MUST not read
or write another section's local state. The
boundaries lower to ordinary codelets inside the existing flat v1 `.pyac`
stream; this does not add a container section table or change codelet bytes.
The source ordinal is retained as `sectionIndex` for identity, not as a result
ordering constraint. Executors MAY schedule independent sections in any order
and MUST return each result as its section completes. Thus result order is
completion order, while the included source ordinal and Pyash name allow
consumers to associate each value with its section. The JavaScript reference
interpreter is serial and therefore completes sections in source order; Rust
CPU and Vulkan executors may complete them in a different order. Any
dependency between sections disqualifies them from this independent section
form and must be expressed within an ordered programlet instead.

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

Target capability selection, backend lowering, and compatibility examples are
normative in [Pyash VLIW targets and compatibility](28-pyash-vliw-targets.md).
