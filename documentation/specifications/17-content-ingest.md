## Pyash-compatible spec: document ingest → gross chips → structure → anchored segments → smart chunks → abridgement

### 0. Purpose

Define a deterministic, small-model-friendly pipeline that ingests a large document, produces robust section boundaries using **start anchor + end anchor quoting**, then produces **smart chunks** (sections/subsections), then produces an **abridged** version that preserves voice by cutting, with a later optional summary pass.

This spec is compatible with:

* Pyash sentence shape, quoting, subordinate clauses 
* Mind (`be write`) invocation and recording hooks 
* Refinery pipelines (series entries as platform steps, deterministic scheduling) 
* Deterministic replay and checkpoint behavior in refinery runs

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
3. Each stage emits structured outputs as Pyash facts (`text`, `series`, and sentence entries).
4. Each mind call records request and response events (for replay and audits) .

---

## 3. Data shapes (current path)

* `source`: `su name source ob text "<full text>" be text ya`
* `gross chips`: a `series` of `ob text "<chip text>"`.
* `boundary proposals`: a `series` of `boundary` sentences, typically one boundary marker quote per entry.
* `wise chips`: a `series` of `ob text "<wise chip text>"`.

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

### Stage 03: Segment proposal (deferred)

This repository currently uses the Stage 03.W wise-chip path below.
Any richer segment-record schema is deferred until it has a concrete Pyash-first implementation.

---

### Stage 03.W: Wise chip proposal (optional, mind-guided)

**Purpose:** identify section boundary anchors using a classifier + per-chip proposals, then resolve **wise chips** from boundaries.
In current implementation, wise chips are the primary smart chunks.

#### 03.W.1 Classifier (single mind call)

Use the first gross chip to classify:

* document kind (report, transcript, meeting minutes, spec, code, etc.)
* section delimiter cues (heading styles, speaker labels, numbering, timestamps)
* anchor style guidance (length, uniqueness)

Output as plain `text` that will be reused as the per-chip boundary prompt.
Keep this as Pyash text flow (no required external key schema).

#### 03.W.2 Boundary proposal (map over gross chips)

For each gross chip, call a mind with a prompt tailored by the classifier output.

**Output:** a series named `boundary proposals` where each entry contains boundary marker quote(s) for that chip.

Sentence shape (series entry):

```pyash
su name boundary proposal
  from num 7
  ob ve text "<boundary marker>" "<boundary marker 2>" "<boundary marker 3>"
  be boundary ya
```

Rules:

* `from num` is the `gross_chip_index` (1-based).
* Current simple path may emit a single marker as `ob text "<boundary marker>"`.
* Multi-marker form `ob ve text ...` is allowed but not required.
* Markers are exact quotes copied from the chip text.

You can produce `boundary proposals` by mapping a ceremony or mind over the `gross chips` series:

```pyash
from name gross chips by name boundary propose to name text boundary proposals be series map do
```

Mapping options:

* **series map**: for `series` (entries are full sentences).
* **vector map**: for `vector` values.
* **at all**: vector-only sugar when you want to mutate or map a vector in-place.
* **map structures**: enumerate map entries first (for example `all su of <map> be read do` or `all ob of <map> be read do`), then map the resulting vector/series.

#### 03.W.3 Resolve wise chips

Combine the `boundary proposals` series with the full `source` text to extract **wise chips**:

1. Walk proposals in series order.
2. For each boundary marker in order:
   * Find the first occurrence of the marker at or after the last resolved end.
   * If the marker fails to match, skip it.
3. Normalize wrapper quotes on markers before matching (for example `"..."` or `“...”`).
4. Ignore duplicate markers that resolve to the same source offset.
5. Emit the slice from this marker to the next matched marker (or end of source if last marker).
6. Optional sizing knobs:
   * `atmost byte <n>` splits oversized slices.
   * `atleast byte <n>` merges undersized neighboring slices.
7. Emit each extracted slice as a wise chip (series of text entries).

Suggested output fact:

```pyash
su name wise chips
  ob text "<wise chip text>"
  be text ya
```

---

### Stage 04 (deferred): Alternate smart-chunk resolver

**Purpose:** optional richer resolver path.

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
* Do not pad with whitespace to hit target size; size limits are by natural split/merge only.
* Current wise-chip resolver does not add overlap between output chips.

---
If you want this expressed as a concrete `.pya` module with ceremony signatures for `be ingest`, `be gross chip`, `be wise chip`, and `be abridge`, I can draft the ceremony surfaces using only Pyash-native records. 
