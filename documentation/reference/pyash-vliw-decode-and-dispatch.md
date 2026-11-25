# Pyash VLIW decode and dispatch

Status: reference/design note. Records the working model behind the VLIW
encoding and dispatch, and the gaps between that model, the specification, and
the current Rust core. It is not normative; the contracts remain
[`27-pyash-vliw-isa.md`](../specifications/27-pyash-vliw-isa.md) and
[`28-pyash-vliw-targets.md`](../specifications/28-pyash-vliw-targets.md).

## 1. Three representations

Pyash uses three representations of one program. They are stages, not
alternatives, and each one is authoritative for a different question.

| Layer | Artifact | Answers | Authority |
| --- | --- | --- | --- |
| Sentence | `.pya` | What does this mean? | Semantic truth. Surface spellings per language: `.en.pya`, `.fr.pya`, `.zh.pya`. |
| Codelet | `.pyac` | What are the exact bytes? | Transport and interlingua encoding. Deterministic, fixed-width, lossless with respect to the canonical sentence. |
| Control word | decoded (host `Vec`, GPU packed `[u32]`) | What executes next? | Derived and disposable. Never authoritative over the codelet bytes. |

The sentence is the meaning; the codelet is the meaning made portable; the
control word is the meaning made executable. A dispatch table or cache is a
control-word artifact, so it must be rebuildable from the bytes and must never
be trusted over them.

## 2. Why the interlingua framing matters

The `.pyac` codelet is the pivot for round-tripping between natural languages.
A program authored as `.en.pya` should lower to canonical sentences, encode to
codelets, and render back as `.fr.pya` or `.zh.pya` without semantic loss.

That priority ordering has a consequence that is easy to misread as a defect:
operands must be self-describing in the stream. Inline typed values and
explicit case markers are required for fidelity, and they make an instruction
wider than a conventional opcode-plus-register bundle. Bundling independent
operations into one fetched unit is therefore an optimization layered on top of
a correct, lossless encoding; it is not what the encoding is for.

## 3. The head bitmap is the field map

Each codelet is sixteen 16-bit words. Word 0 is the head:

- bit 0 marks whether this codelet completes the sentence;
- bits 1..15 mark phrase-closing slots (a case word or the closing mood word).

A slot is a boundary when its bit equals bit 0. `collect_sentence_at` already
uses this rule to find the last boundary and validate the words.
`SentenceView::boundary(index)` exposes the same test per token.

Two consequences follow, and they are the reason the bitmap exists:

1. The field spans are present in the encoding, not implied by a scan. A
   decoder can read the head once, enumerate the set bits, and know where every
   phrase ends without walking the payload.
2. The operand phrases are independent of one another. That is what permits a
   gather-then-dispatch shape: load or evaluate each phrase, then read the verb
   and dispatch on the signature. On hardware this is the natural mapping: a
   boundary bit per lane, one comparator per lane, and a final dispatch step.

`parse_sentence_range` now derives fields from the bitmap directly. For a
clause-free sentence it reads each head, enumerates the boundary slots, and
classifies only those tokens; value words are not decoded. A sentence that
contains nested-clause markers takes a clause-aware pass that preserves token
order, because a clause marker is recognized regardless of its boundary bit.
Equivalence with the previous state-machine parser is proven by a differential
test over fixtures, header and token corruptions, and a deterministic random
corpus.

## 4. Signature shapes and value families

These are different axes and should not be conflated:

- **Shape** is the set of grammatical cases and value types in a sentence. Shape
  space is open: any combination is a distinct signature, sorted by ascending
  case HNUC for comparison.
- **Value family** is the inventory of types currently executable in a context.
  Inside programlets that inventory is closed to scalar numeric and boolean
  values today; text, date, and vector values exist on the flat codelet path but
  not as programlet locals.

A new verb, or a new combination of cases and types for an existing verb, is a
new shape and needs no new mechanism. A new value family is runtime work.

## 5. Dispatch

Dispatch is two levels. The sentence mood selects a class table; within the
class, the key is the ordered verb HNUCs plus `(case, value-type)` pairs.

Level one is the six moods (exactly `is_mood`):

| mood | class | phase | level-2 entries |
| --- | --- | --- | --- |
| `def` | definition | pack load | `ceremony`, `myocpfun` |
| `prah` | definition close, invocation close | load and frame exit | `ceremony`, `myocpfun` |
| `ya` | static declaration | load and frame setup | `number`, `boolean`, `variable`, `pfun myoc` |
| `do` | execution | run loop | route handlers and the routine directory |
| `then` | conditional control | within one sentence | branch/join group |
| `ret` | return control | run loop | none |

`myocpfun` and `pfun myoc` are compound verbs, not moods. `prah` is the same
mood at two levels: it closes a definition at load and an invoked frame at run
time. `ya` initializes declarations and frame slots. Only `do` is consulted for
execution, so the execution key does not include mood; the class is already
selected.

A handler may be a routine body defined earlier in the same programlet. That
makes the model threaded code plus signature matching rather than a fixed
opcode set. The routine directory implements this: built once from the bytes,
sorted, binary-searched, and passed to the GPU as a packed `[u32]` scratch
buffer with read-time validation.

### Dispatch dictionary

The reference dictionary already carries the descriptive table. In
`rust/pyac/src/dictionary/operation.rs`, `OperationSignature { verb, mood,
arguments, results }` has `OperationArgument { grammatical_case, value_type,
name, description }` and `OperationResult { value_type, name, description }`,
with validation requiring a name and description for every argument and result.

That key includes mood because the reference volume is the global view across
all classes; the execution table is its `do`-only projection. The volume is
`program/library/dictionary/reference.pyac`, built from `reference.pya`. It
keeps multiple named results, so the runtime's single destination fold is the
part that should eventually adopt the dictionary's shape, not the reverse.

## 6. Revision semantics

lwonprom permits revision: the most recent definition takes precedence. The
current Rust routine directory instead rejects an equal signature key with
`ERROR_DUPLICATE_SIGNATURE`.

Within one programlet, latest-wins is well defined by definition order: keep the
directory sorted for binary search, but resolve a collision by the latest
definition offset instead of failing. This is recorded as a divergence in
[`pyac-vliw-semantic-slices.md`](pyac-vliw-semantic-slices.md) until it is
implemented. Cross-pack revision needs a version or sequence field and is a
later question.

## 7. Self-extension requirements

"An AI extends its own vocabulary" needs four capabilities. The mechanism
exists for the first; the loop does not yet exist for the rest.

| Capability | Status |
| --- | --- |
| Define a new word (body) at runtime | Yes: ceremony definitions register a signature at definition time. |
| Define a new signature shape | Yes: any set of cases and types, within the executable value families. |
| Persist a definition | No: the registry is rebuilt per pack. Durable vocabulary is a catalog workflow, not yet a runtime act. |
| Introspect the vocabulary | No in-language reflection; host commands (`vocab_suggest`, `kwon`) only. The reference dictionary already carries operation signatures with argument names and descriptions; the runtime does not consume them yet. |
| Revise a definition | No: duplicate signatures are fatal today; latest-wins is the target. |

Two scales that are easy to confuse:

- the **lexical catalog** is `program/library/dictionary/reference.pya` and its
  compiled `reference.pyac`: 64,572 entries and 4,065,444 codelets, generated
  on `dev-vocab`. It is the vocabulary reference and must not be hand-edited.
  `program/library/pyashWords.json` is a legacy encoding projection used by JS
  lowering for HNUC lookup, not the vocabulary reference;
- the **executable namespace** per programlet is bounded (64 routines, 8
  arguments, 8 signature cases, 10 sentence fields, call depth 8).

Growing vocabulary as behavior eventually needs the executable namespace to
become a persisted, queryable table, not an in-pack array.

## 8. Open decision: which machine the ASIC implements

Three execution models are named in different places today. They imply different
silicon and different answers to "can vocabulary grow after tape-out?".

| Model | Issue | Vocabulary growth | Where it is named |
| --- | --- | --- | --- |
| Serial sentence machine | One semantic action per step; a program counter. | Verbs are hardware; growth needs microcode reload. | The Rust core. |
| Bundled (VLIW) fetch | K independent phrases or sentences per fetched unit, slot masks in header bits 1..15. | Compile-time growth; same hardware. | The name "VLIW". |
| Signature/dataflow machine | A codelet is ready when its operands are present and its signature matches a table entry. | Growth is a new table row, not new gates. | Spec 27 §5.2 ("ready-work queue rather than a mandatory program counter"). |

The current implementation is the first. The encoding supports the second: the
boundary bits already express operand independence.

**Decision:** the target is the third, the signature/dataflow machine, chosen
for ASIC compatibility and vocabulary growth rather than throughput. The current
Rust core is a transitional serial implementation of the same two-level
dispatch: mood selects the class, and the execution class is keyed by verb plus
sorted case/type pairs. Bundling independent operations per fetched unit remains
an optional optimization inside that model, not the model itself. Spec 27 §5.2's
ready-work queue is the target contract; the program-counter loop is the
current implementation.
