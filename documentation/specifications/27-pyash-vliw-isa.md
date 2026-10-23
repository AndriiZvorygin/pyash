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
The decoder collects the preceding/following vectors in codelet order until a
final index is reached, then validates the complete phrase and sentence before
execution. It MUST reject a missing continuation, an impossible boundary, a
non-zero unassigned tail, or an invalid quote length. It MUST NOT infer missing
words from source text.

The legacy layout is intentionally fixed: one codelet is sixteen words, each
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
- globally addressable working/output storage for references;
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

The executor MUST expose deterministic failure for malformed codelets,
unfulfilled dependencies, duplicate writers, invalid types, and unsupported
effects. It MUST NOT turn an execution failure into a different successful
sentence.

## 6. Conceptual interfaces

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

## 7. Compatibility examples

The following are golden vectors, not new syntax:

1. The legacy README example `hyikdoyu hyikdoka plustu` MUST retain the
   documented bytes
   `0149 881D 0001 287E 881D 0001 245E 8A64 295E` and the result `tyutdoka li`
   when run through the legacy-compatible surface.
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

Conformance tests should compare sentence round-trips, exact golden bytes,
malformed continuation/quote rejection, compatibility-table coverage,
dependency scheduling, single-writer enforcement, and interpreted versus
decoded result paragraphs. Tests must include at least one source-language
adapter and one unsupported-value rejection.

## 8. Non-goals

This specification does not add HNUCs, alter parser vocabulary, define the
catalog/container database, require a GPU, introduce a model server or queue,
or connect codelet execution to WorkTask/review/integration machinery. The
database contract is defined in
`documentation/reference/pyac-vliw-database.md`. This specification also does
not replace the current sentence/paragraph interpreter. The only
conforming future implementation is one that can prove the sentence result
and the legacy encoding bytes agree.

## 9. MVP semantic slice: numeric plus

The first executable slice uses the current canonical sentence:

```pyash
ob num 1 to num 1 be plus do
```

The JavaScript reference backend accepts `ob num A to num B be plus do` for
unsigned 16-bit integers. Current `ob` is the legacy instrumental operand and
current `to` is the legacy accusative operand. This preserves the legacy
operation: add the instrumental value to the accusative value and produce the
result.

The reference execution keeps the recovered legacy arithmetic boundaries:
numeric plus saturates at 0xFFFF, numeric subtract floors at zero, and numeric
divide returns the integer quotient. Division by zero is an explicit execution
error.

The backend emits one fixed 16-word codelet. Its nine-word compact prefix is:

```text
0149 881D A 287E 881D B 245E 8A64 295E
```

Seven zero words complete the 256-bit codelet. For `A = 1` and `B = 1`, this
retains the lwonprom README vector exactly. Decoding validates every marker,
the two numeric quote fields, and the zero tail before returning the canonical
Pyash sentence. Execution returns the same `result` number record produced by
the existing numeric `plus` handler.

The reference implementation lives at
`program/library/vliw/plus.mjs`; its source fixture is
`examples/pyash/vliw-numeric-plus.pya`. The focused conformance quiz is
`quiz/vliw_plus_semantics.test.mjs`. Rust lowering, GPU scheduling, paragraph
codelets, and compiler-command integration remain outside the current
reference adapter.

## 10. Quote descriptors and legacy surface rendering

The legacy quote-denote is `0x001D`. Its assigned quote classes include
`0x881D` for numeric values, `0x081D` for letters, and `0x0E1D` for
paragraph-letter values. `decodeQuoteHeader` exposes the legacy region,
pointed, sequence, vector-width, scalar-width, and sort fields. A numeric or
letter quote consumes one following 16-bit payload word in the reference
decoder, so `0x881D 0001` is the typed value `1` and `0x081D 0041` is the
letter `A`. A paragraph-letter quote consumes an explicit vector length word
followed by that many character words.

Quote markers describe value representation. Lexical Pyash spellings remain
HNUC table entries. The shared quote decoder uses the HNUC table for grammar
and verb words, then combines the typed value with its case marker. The plus
golden vector therefore renders as `hyikdoyu hyikdoka plustu` while its
canonical semantic form remains `ob num 1 to num 1 be plus do`.

The structured decoder accepts unsigned numeric payloads, single-character
payloads, and paragraph-letter payloads. Surface number-word rendering
currently covers the legacy zero-through-twenty table; larger numeric values
remain available in structured form while compound surface composition is
added in a later slice.

## 11. Generic fixed-slot codelet decoding

`program/library/vliw/codelets.mjs` provides lossless decoding for the existing
16-word codelet slot. It walks the used prefix in order, delegates quote words
to the shared quote decoder, and resolves known lexical words through the HNUC
table. Unknown non-quote words remain raw words so decoding never invents a
lexical meaning. The first standalone zero marks the used-word boundary; every
following slot must also be zero. `renderLegacyCodelet` exposes a diagnostic
surface that preserves raw words and renders supported typed values without
claiming that arbitrary codelets are executable Pyash.

This layer exposes typed items and the used-word count. It does not infer
arbitrary grammar or execute unknown codelets. Numeric-plus and the proven
typed-literal adapter validate their marker sequences from the generic items;
unknown codelets remain explicit unsupported records.

## 12. MVP semantic slice: typed literals

The second executable slice covers anonymous scalar facts whose legacy vectors
are proven by `lwonprom/program/interpret.c` and its encoding quizzes:

```pyash
ob num 7 be number ya
ob text "A" be text ya
```

Both forms use the five-word compact prefix:

```text
0019 881D value 245E 217E
0019 081D code-unit 245E 217E
```

The numeric vector uses `0x881D` and an unsigned 16-bit payload. The single
letter vector uses `0x081D` and one UTF-16 code unit. A paragraph-letter quote
uses `0x0E1D`, an explicit length, and UTF-16 payload words; it supports up to
ten code units for an anonymous fact and up to nine code units for a named
fact within one fixed codelet. Decoding returns the canonical `ya` sentence and
execution returns that same typed fact.

The reference implementation lives at
`program/library/vliw/literal.mjs`; its source fixtures are
`examples/pyash/vliw-typed-literals.pya` and
`examples/pyash/vliw-extended-values.pya`. The focused conformance quizzes are
`quiz/vliw_literal_semantics.test.mjs` and
`quiz/vliw_extended_values.test.mjs`.

## 13. MVP semantic slice: named scalar facts

The next executable slice covers named scalar facts whose legacy
result layout is emitted by the named arithmetic interpreters:

```pyash
su name collector ob num 7 be number ya
su name collector ob text "A" be text ya
```

The fixed vector uses the legacy index word followed by the name, nominative
case, typed quote and payload, accusative case, and realis mood:

```text
0065 name 24DE 881D value 245E 217E
0065 name 24DE 081D code-unit 245E 217E
```

The name resolves through the existing legacy vocabulary table. The reference
adapter supports one or more legacy vocabulary words per name, unsigned
16-bit numeric payloads, and paragraph-letter text that fits the fixed slot.
Unknown names, wider text, and other quote widths retain explicit rejection
reasons. The adapter
lives at `program/library/vliw/named_literal.mjs`; its runnable Pyash example
is `examples/pyash/vliw-named-literals.pya`.

The translation-fed database entry point is
`buildVliwDatabaseFromTranslation(lines, options)`. It resolves an existing
translation registry adapter, preserves one source record per translated
sentence, and passes the resulting canonical sentences through the existing
catalog, pack, query, and replay contracts. Source records retain language,
locator, line index, sentence index, and original text.

## 14. Reference semantic facade

`program/library/vliw/index.mjs` provides the reference boundary:

- `lowerSentence(sentence)` returns one lowered codelet for a supported
  canonical sentence;
- `lowerParagraph(paragraph)` lowers sentences in source order;
- `decodeCodelet(words)` returns the decoded items and canonical sentence for
  a supported semantic adapter; and
- `executeCodelets(codelets)` executes supported codelets sequentially and
  returns the existing Pyash result records.
- scheduleCodeletDependencies(instructions) returns a stable dependency order
  while rejecting unresolved references and duplicate writers.

The facade currently supports numeric `plus`, scalar `subtract`, `multiply`,
`divide`, `remains`, and `xor`, anonymous and named numeric/text/boolean
literals, multi-word legacy names, and paragraph-letter text values that fit
one codelet. Decoded instructions expose stable read/write effects for catalog
queries and dependency scheduling. A valid but unrecognized codelet is
decoded losslessly, then rejected by the semantic facade with an explicit
unsupported-codelet error. Vector and date values remain explicit unsupported
catalog rows until their exact legacy layouts receive golden fixtures.
