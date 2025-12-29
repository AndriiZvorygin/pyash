# C Internal Representation (Stage 1 Flat IR)

**File:** `07-c-ir.md`  
**Status:** v0.1  
**Intent:** A close-to-Pyash, low-churn C IR that can ingest Pyash and emit Pyash.  
**Future:** A separate lowering pass may emit the high-speed pyac tuple stream later.

---

## 1. Goals

- Keep parsing and printing simple.
- Keep runtime execution fast enough for early progress.
- Keep code churn low as surface parsing and printing evolve.
- Preserve Pyash semantics from the existing specs.

---

## 2. Core principles

### 2.1 Flat keyworded fields

Pyash cases are keyworded fields (examples: `su`, `ob`, `to`, `from`, `by`, plus sequence registers).  
C IR stores these as flat optional fields on the sentence record.

### 2.2 Surface order vs in-memory order

Pyash surface order is postpositional (mood at end).  
C IR stores mood as a field (`sentence.mood`).  
Emitter prints mood at the end.

### 2.3 Two-layer plan

- Stage 1: Flat Sentence IR (this file)
- Stage 2: Lower Flat Sentence IR into pyac packed tuples (separate spec later)

Stage 2 must remain a pure lowering step so the parser and printer stay unchanged.

---

## 3. Interning and word IDs

Implementations may intern frequent words into `uint16_t` IDs:
- verbs (`be` values)
- case keywords (`su`, `ob`, etc.)
- mood keywords (`ya`, `do`, `def`, `prah`, `then`)
- common name types (`num`, `text`, etc.)

Arbitrary literals (free text, long identifiers) remain stored as strings (or indexes into a string table).

---

## 4. Data model

### 4.1 Mood

Moods are:

- `YA`
- `DO`
- `DEF`
- `PRAH`
- `THEN`

Store as an enum.

### 4.2 Name reference

A typed name reference corresponds to: `name <type> <literal>`

Store:
- `type` (interned word ID or string)
- `lit` (string or string-table index)

### 4.3 Genitive chain (path)

A genitive chain corresponds to: `this ti ob ti num` and similar.

Store:
- base: either `THIS` or a `NAME` reference
- steps: ordered list of selectors (interned word IDs preferred)

Direction is left-to-right: `this ti ob ti num` stores base `THIS` with steps `["ob", "num"]`, matching the surface order.

---

## 5. Value IR

Values are a tagged union.

### 5.1 Required value tags

- `V_NUM`        (double or fixed-point, backend choice)
- `V_TEXT`       (string view or string-table index)
- `V_BOOL`
- `V_HOLLOW`     (JSON null semantics)
- `V_UNSPEC`     (absence semantics)
- `V_NAME`       (typed name reference)
- `V_THIS`
- `V_PATH`       (genitive chain)
- `V_VECTOR`
- `V_MAP`
- `V_SENTENCE`   (inline sentence payload, used by `then` and other constructs)

### 5.2 Vectors

Vector stores:
- length
- element storage as `ValueRef[]` (indexes into a value pool) or `Value[]` (inline), backend choice

Stage 1 allows inline vectors for simplicity.

### 5.3 Maps

Two map kinds:
- `MAP_PYASH`
- `MAP_JSON`

JSON map rules:
- `V_HOLLOW` represents present null
- `V_UNSPEC` represents absence and gets omitted during JSON export and JSON enumeration

Map storage options in Stage 1:
- hash map for lookup
- optional sorted key cache for JSON maps (for official enumeration / export)

---

## 6. Sentence IR

### 6.1 Sentence structure

A sentence stores:
- `be` (interned verb ID or string)
- `mood` (enum)
- `exists` flag (valid only when mood is `YA`)
- flat optional case fields:
  - `su`, `ob`, `to`, `from`, `by`
  - `fromindex`, `toindex`, `atindex`
- optional inline consequence sentence for conditionals:
  - `then_sentence` (pointer or index)

### 6.2 Field presence

Each optional field has presence tracked via a bitmask.

Example bit names:
- `HAS_SU`, `HAS_OB`, `HAS_TO`, `HAS_FROM`, `HAS_BY`
- `HAS_FROMINDEX`, `HAS_TOINDEX`, `HAS_ATINDEX`
- `HAS_THEN`

Presence mask prevents sentinel hacks.

### 6.3 Register classification

Registers for dispatch matching:
- `fromindex`, `toindex`, `atindex` are sequence registers
- signature derivation skips sequence registers

Keep a `REGISTER_MASK` for quick filtering.

---

## 7. Dispatch support

### 7.1 Signature derivation helper

Provide a helper:

`derive_signature(sentence) -> signature_words`

Rules:
- Start with `be`
- Include case keywords that are present and outside `REGISTER_MASK`
- Sort included case keywords by keyword ID (or by keyword text if IDs are absent)

Store the signature in a compact form suitable for ceremony lookup:
- small vector of `uint16_t` word IDs is ideal

### 7.2 Ceremony lookup

Ceremonies are keyed by derived signature words.

If no handler exists:
- raise an error sentence (see Section 10) with a message that includes the derived signature words

---

## 8. Memory model alignment

### 8.1 Stored facts

`YA` sentences update memory.

Memory key:
- `su name <type> <literal>` identifies the stored fact

Store last-write-wins for a given subject.

### 8.2 Sandpit behaviour

Ceremony evaluation uses a sandpit memory layer that merges back after completion, per the mood and memory rules in the existing specs.

Stage 1 implementation may use:
- copy-on-write maps
- or a log of writes for merge-back

---

## 9. Ingest and emit

### 9.1 Ingest (Pyash parse)

Parser produces Flat Sentence IR directly:
- read postpositional mood at end and set `sentence.mood`
- read `be <verb>` and set `sentence.be`
- read keyworded fields and fill flat case slots
- parse typed names into `V_NAME`
- parse genitive chains into `V_PATH`
- parse `then <sentence>` into `then_sentence`

### 9.2 Emit (Pyash print)

Emitter prints official Pyash surface:
- print each case group in a stable order (sort by case keyword)
- print mood at end
- for conditionals, print `then <sentence>` inline

Stage 1 emitter goal: stable diffs for goldens.

---

## 10. Errors

Errors are represented as thrown sentences.

A thrown error sentence uses:
- mood `DO`
- `be error`
- required fields:
  - `su` as a name reference (`su name <error-name>`)
  - `ob` as text message (`ob text <message>`)
  - `from` as a name reference (`from name <source>`)

When emitted, error sentences follow the same stable case ordering used by signature derivation.

Provide helper:
- `make_error(error_name, message, source) -> Sentence`

---

## 11. Ownership and allocation

Stage 1 allows a simple arena allocator:
- allocate sentences, vectors, maps, strings from arenas
- free arenas per program run or per REPL transaction

Value payload options:
- inline small scalars
- string table for text literals
- reference-counted heap objects remain optional in Stage 1

---

## 12. Forward compatibility: lowering to pyac

Stage 2 will introduce a lowering pass:

`lower_flat_ir_to_pyac(program_flat_ir) -> pyac_tape`

Requirements for that future pass:
- preserve `derive_signature` behaviour
- preserve register skip rules for signature matching
- preserve `then` inline consequence semantics
- preserve JSON map omission rules for `V_UNSPEC` on export and enumeration

Stage 1 code should keep clean seams:
- IR construction
- dispatch
- execution
- emission

So Stage 2 can swap the execution backend without touching parsing or printing.

---
