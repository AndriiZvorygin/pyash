## Pyash-compatible spec: document ingest → gross chips → structure → anchored segments → smart chunks → abridgement

### 0. Purpose

Define a deterministic, small-model-friendly pipeline that ingests a large document, produces robust section boundaries using **start anchor + end anchor quoting**, then produces **smart chunks** (sections/subsections), then produces an **abridged** version that preserves voice by cutting, with a later optional summary pass.

This spec is compatible with:

* Pyash sentence shape, quoting, subordinate clauses 
* Mind (`be write`) invocation and recording hooks 
* Refinery pipelines (series entries as platform steps, deterministic scheduling) 
* Canonical ordering for json maps (RFC 8785 ordering rule) 

---

## 1. Terms

* **source**: original document bytes.
* **gross chip**: an initial, rough slice of the source text, sized for small models.
* **segment**: a discovered section, subsection, scene, or meeting slice, defined by anchors.
* **start anchor / end anchor**: short exact quotes that occur in the gross chip text, used to locate boundaries robustly.
* **smart chunk**: the resolved text slice for one segment, used for downstream tasks.
* **abridgement**: a cut-down version of the text that preserves voice by deleting low-value material, with minimal rewriting.
* **summary**: a higher compression representation that paraphrases.

---

## 2. Global invariants (normative)

1. Deterministic pipeline execution as a refinery: platform activities are normal sentences and scheduling is deterministic .
2. Anchors are quotes copied from input text. Boundary logic relies on matching anchors, avoiding byte counting.
3. Each stage emits structured outputs as json maps in official key order .
4. Each mind call records request and response events (for replay and audits) .

---

## 3. Data shapes

### 3.1 Segment record (json map)

Each discovered segment is represented as one json map with stable keys:

Keys (required):

* `segment_id` (text): stable id, for example `"S00042"`.
* `gross_chip_index` (num): 1-based index into the `gross chips` series.
* `kind` (text): `"section" | "subsection" | "scene" | "meeting_part" | "other"`.
* `title` (text): may be empty.
* `start_anchor` (text): exact quote, 80–240 characters recommended.
* `end_anchor` (text): exact quote, 80–240 characters recommended.
* `confidence` (num): 0.0–1.0.

Optional:

* `notes` (text)
* `parent_segment_id` (text)
* `order_hint` (num): within parent

Encoding in Pyash follows the existing json map def form .

### 3.2 Smart chunk record (json map)

Keys (required):

* `segment_id` (text)
* `text` (text): exact extracted text for the segment.
  Optional:
* `source_locator` (text): implementation-defined (for example “anchor-match v1”).

---

## 4. Recommended gross chip size (small local models, 4B or smaller)

Goal: keep each LLM call inside a reliable context window while leaving room for instructions and structured output.

Recommended gross chip target:

* **5040 bytes** max per chip (about 1,200 tokens), no padding.
* Chips may be smaller to preserve UTF-8 boundaries and prefer whitespace splits.

Overlap:

* **One-eighth overlap** between consecutive gross chips to avoid boundary loss at chip edges.

---

## 5. Pipeline as a refinery (platform stages)

### 5.1 Refinery declaration (shape)

Use a refinery where each platform is one stage; the runner preserves each platform activity sentence .

Conceptual skeleton:

```pyash
su name ingest document be refinery def
  su name stage 01 load            be ingest do
  su name stage 02 gross chip      from ve name stage 01 load be gross chip do
  su name stage 03 segment propose from ve name stage 02 gross chip be segment propose do
  su name stage 04 resolve chunks  from ve name stage 03 segment propose be smart chunk do
  su name stage 05 abridge         from ve name stage 04 resolve chunks be abridge do
prah
```

(Platform naming and depend vectors follow the refinery rules .)

---

## 6. Stage specs

### Stage 01: Ingest

**Input:** `from filename <path>` or `from text <doc>`
**Output:** `source text` (or an artifact reference if your runtime supports artifacts)

Minimal activity:

* read file as bytes, decode to text without normalising line endings.

Suggested surfaced facts:

```pyash
su name source ob text "<full text>" be text ya
```

---

### Stage 02: Gross chip

**Input:** `source`
**Output:** series of gross chips: `gross chips` (series), each entry is a text element.

Representation:

* `su name gross chips be series def ... prah` (series semantics exist in data formats spec) .

Normative splitting rules:

1. Read source text bytes (UTF-8).
2. Target max size **5040 bytes** per chip; no padding.
3. Overlap by **one-eighth** of the max size (630 bytes) between consecutive chips.
4. Split on a valid UTF-8 boundary at or before the max size.
5. Prefer a whitespace boundary when available at or before the max size.

Each chip entry (example):

```pyash
su name gross chips
  ob text "<chip text>"
  be text ya
```

Refer to a chip’s text by index using genitives, for example:

```pyash
text 1 of name gross chips
```

---

### Stage 03: Segment proposal (LLM over each gross chip)

**Purpose:** identify likely segment boundaries and return **anchors**, plus metadata.

**Invocation:** use `be write` with a small local mind .

#### 03.A Prompt template (per gross chip)

System prompt (store once in mind config), then per call user prompt:

**System prompt (mind config `from discourse`)**

* You output a json map list of segment records.
* Anchors are exact quotes from the provided text.
* Anchors must appear exactly once inside the provided chip whenever possible.
* Produce fewer segments if unsure.

**User prompt (per chip)**
Include:

* `gross_chip_index`
* `chip text`
* guidance for what counts as a boundary (heading changes, scene changes, speaker changes, agenda item changes).

Example user prompt text:

```
You are analysing one gross chip from a larger document.

Return a JSON array of segment records.

Rules:
- Each record MUST include: segment_id, gross_chip_index, kind, title, start_anchor, end_anchor, confidence.
- start_anchor and end_anchor are exact quotes copied from the chip text.
- Each anchor length: 80–240 characters.
- Prefer anchors that are unique within this chip.
- If you find zero reliable segments, return [].

gross_chip_index: 7
chip_text:
<<<
...chip text...
>>>
```

#### 03.B Output handling

Parse model output into a json map or series of json maps, stored as:

* `su name segments proposed ob ve name ...` or a series named `segments proposed`.

---

### Stage 03.W: Wise chip proposal (optional, mind-guided)

**Purpose:** identify section boundary anchors using a classifier + per-chip proposals, then resolve **wise chips** from boundaries.

#### 03.W.1 Classifier (single mind call)

Use the first gross chip to classify:

* document kind (report, transcript, meeting minutes, spec, code, etc.)
* section delimiter cues (heading styles, speaker labels, numbering, timestamps)
* anchor style guidance (length, uniqueness)

Output as a json map (suggested keys): `doc_kind`, `delimiter_rules`, `anchor_style`, `notes`.

#### 03.W.2 Boundary proposal (map over gross chips)

For each gross chip, call a mind with a prompt tailored by the classifier output.

**Output:** a series named `boundary proposals` where each entry contains **start/end anchor pairs** for that chip.

Sentence shape (series entry):

```pyash
su name boundary proposal
  from num 7
  ob ve text "<start anchor>" "<end anchor>" "<start anchor 2>" "<end anchor 2>"
  be boundary ya
```

Rules:

* `from num` is the `gross_chip_index` (1-based).
* `ob ve text` contains an **even** number of entries: alternating `start_anchor`, `end_anchor`.
* Anchors are exact quotes copied from the chip text.

You can produce `boundary proposals` by mapping a ceremony or mind over the `gross chips` series:

```pyash
from name gross chips by name boundary propose to name text boundary proposals be series map do
```

#### 03.W.3 Resolve wise chips

Combine the `boundary proposals` series with the full `source` text to extract **wise chips**:

1. Walk proposals in series order (or by `gross_chip_index` when present).
2. For each start/end anchor pair:
   * Find the first occurrence of `start_anchor` at or after the last resolved end.
   * Find the first occurrence of `end_anchor` after that start.
   * If either anchor fails, skip the pair.
3. Extract from the start of `start_anchor` to the end of `end_anchor`.
4. Emit each extracted slice as a wise chip (series of text entries).

Suggested output fact:

```pyash
su name wise chips
  ob text "<wise chip text>"
  be text ya
```

---

### Stage 04: Resolve smart chunks (anchor matching)

**Purpose:** convert proposals into extracted text slices.

**Algorithm (normative, pseudocode style):**

1. For each proposed segment record:

   * Find the first occurrence of `start_anchor` in the full `source`.
   * Find the first occurrence of `end_anchor` after that start.
2. If either anchor fails:

   * Retry with relaxed matching (trim leading/trailing whitespace, collapse runs of spaces).
3. If multiple matches:

   * Choose the match that falls inside the originating gross chip window, when available.
4. Extract from the start of `start_anchor` to the end of `end_anchor`.
5. Store as `smart chunk record` keyed by `segment_id`.

Suggested fact:

```pyash
su name S00042 ob text "<extracted segment text>" be text ya
```

---

### Stage 05: Abridge (LLM over each smart chunk)

**Purpose:** reduce length while preserving voice, structure, and wording as much as possible.

#### 05.A Abridgement rules (normative)

* Preserve original phrasing where possible.
* Delete filler, repetition, tangents, low-information digressions.
* Keep key claims, steps, decisions, names, numbers, dates.
* Keep headings and speaker labels when present.
* Minimal paraphrase.

#### 05.B Recommended abridgement chunk size

Smart chunks vary. For 4B or smaller:

* If a smart chunk exceeds about **1,800 tokens**, split it by paragraph blocks into abridgement sub-chunks, then stitch results in order.

#### 05.C Prompt template (per smart chunk)

User prompt text:

```
Task: produce an abridged version of the text below.

Rules:
- Preserve voice and terminology.
- Prefer deletion over rewriting.
- Keep headings, lists, and speaker turns.
- Remove repetition, rambling, and side trails.
- Preserve all numbers, dates, and action items.
- Output only the abridged text, no commentary.

TEXT:
<<<
...segment text...
>>>
```

Store abridged output as:

```pyash
su name S00042 abridged ob text "<abridged text>" be text ya
```

---

## 7. Optional later stage: Summarise (higher compression)

This stage is separate from abridgement: it paraphrases into fewer words and a different surface form. Use it when abridgement remains too large.

Abridgement and summarising are orthogonal:

* abridgement: same voice, mostly same wording, less material
* summary: new wording, smaller representation

---

## 8. Practical notes for small models

* Prefer fewer, higher-confidence segments.
* Use overlap in gross chips so a boundary that falls on a seam still has enough context.
* Use anchor length 80–240 characters to reduce collision probability while staying matchable.
* Emit structured json with stable keys to reduce parser failure.

---

If you want this expressed as a concrete `.pya` module with ceremony signatures for `be ingest`, `be gross chip`, `be segment propose`, `be smart chunk`, `be abridge`, I can draft the ceremony surfaces and the json map field ordering conventions using the sentence and dispatch rules. 
