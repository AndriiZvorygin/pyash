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

### Stage 05: Abridge (deterministic extractive over each smart chunk)

#### 05.Implementation (current code path)

Current built-in `be abridge` behavior in `program/verbs/abridge.mjs`:

1. Read input from `from text/name text` or `ob text/name text`.
2. Split into sentence-like spans using `.`, `?`, `!`, and newline boundaries.
3. Detect simple sections from heading-like lines (`# ...`, all-caps heading forms, numbered heading forms).
4. Compute deterministic TF-IDF sentence scores.
5. Apply coverage guarantees before ranking:
   * keep first sentence of each detected section
   * keep action/decision style lines (`Action:`, `Decision:`, `TODO:`, `Next:`, `Follow-up:`).
6. Build a shortlist with dynamic `k`:
   * `k_total = clamp(round(sentence_count * 0.5), 12, 40)`
   * per-section `k = clamp(proportional share, 2, 8)`.
7. Dedupe shortlist with n-gram Jaccard (threshold `0.85`):
   * 3-gram default, 2-gram for very short sentences
   * numeric-claim guard: sentences with different numeric token sets are not deduped against each other.
8. Stitch in source order under byte budget (`atmost byte` / `atmost num`), joined by newline.

Current output shape:

```pyash
su name <target> ob text "<abridged text>" be text ya
```

Notes:

* This stage is deterministic and local (no mind call).
* Current implementation does not yet emit a span map object.

## Deterministic Abridger Spec

### Purpose

Produce a shorter version of an input text by selecting original spans verbatim, under a strict length budget, with repeatable results.

### Hard constraints

* Output text consists only of substrings copied from the input (verbatim).
* Deterministic: same input plus same options yields identical output.
* Output preserves original order of selected spans.
* Output includes an auditable span map from output back to input offsets.

---

## Inputs

### 1) `input_text: Text`

Unicode text.

### 2) `options: Map`

Recommended fields (all optional, with defaults):

#### Budget

* `budget_mode: "bytes" | "chars" | "tokens_approx"`
  Default: `"chars"`
* `budget_value: Integer`
  Default: `4000`
* `tokens_approx_ratio: Map`
  Used only when `budget_mode = "tokens_approx"`.
  Default: `{ "chars_per_token": 4 }`

#### Segmentation

* `section_heading_rules: List[Rule]`
  Each rule identifies a heading line and its level.
  Default: Markdown-like: `#`, `##`, `###`, plus “ALL CAPS line” heuristic.
* `sentence_split_rules: List[Rule]`
  Default: punctuation split on `. ? !` with common abbreviations list.
* `paragraph_split_rules: List[Rule]`
  Default: blank-line split, plus list markers.

#### Boilerplate removal

* `drop_repeated_lines: Boolean` default `true`
* `repeated_line_min_count: Integer` default `3`
* `drop_regexes: List[Regex]` default `[]`
  Use for footers, navigation, legal blocks, etc.

#### Salience scoring

* `keyword_boosts: Map[String -> Float]` default `{}`
* `cue_phrase_boosts: Map[String -> Float]` default includes:

  * “therefore”, “in summary”, “conclusion”, “decision”, “action”, “recommendation”
* `number_date_boost: Float` default `1.0`
* `named_entity_like_boost: Float` default `0.5`
  Simple heuristic, capitalised sequences, email, URL, currency.
* `position_boost_first_sentence_per_section: Float` default `0.8`
* `position_boost_first_paragraph_per_section: Float` default `0.4`

#### Diversity and redundancy

* `dedupe_mode: "ngram_jaccard" | "tfidf_cosine"` default `"ngram_jaccard"`
* `dedupe_threshold: Float` default `0.85`
* `mmr_lambda: Float` default `0.7`
  Higher favours relevance; lower favours diversity.
* `max_sentences_per_section: Integer | null` default `null`

#### Coverage guarantees

* `keep_first_sentence_each_section: Boolean` default `true`
* `keep_list_items_with_prefixes: List[String]` default `["Action:", "Decision:", "TODO:", "Next:", "Follow-up:"]`
* `keep_sentences_matching_regexes: List[Regex]` default `[]`

#### Formatting

* `joiner_between_spans: String` default `"\n"`
* `preserve_original_paragraph_breaks: Boolean` default `true`

---

## Outputs

### 1) `abridged_text: Text`

A concatenation of selected spans from the input.

### 2) `span_map: List[SpanRecord]`

Each record maps one output span to the input.

`SpanRecord` fields:

* `span_id: String` stable ID, derived from source offsets and a hash
* `source_start: Integer` character offset in `input_text`
* `source_end: Integer` character offset in `input_text` (exclusive)
* `section_id: String`
* `paragraph_index: Integer`
* `sentence_index: Integer`
* `score_total: Float`
* `score_breakdown: Map[String -> Float]`
* `output_start: Integer` character offset in `abridged_text`
* `output_end: Integer` character offset in `abridged_text` (exclusive)

### 3) `stats: Map`

* `input_chars`
* `output_chars`
* `budget_used`
* `sections_count`
* `sentences_selected`
* `sentences_dropped_deduped`

---

## Deterministic processing stages

### Stage A: Normalisation

Goal: stabilise the input for repeatable segmentation and scoring.

Steps:

1. Convert line endings to `\n`.
2. Trim trailing spaces on each line.
3. Collapse runs of more than 2 blank lines to 2 blank lines.
4. If `drop_repeated_lines = true`:

   * Count identical trimmed lines across the document.
   * Drop lines whose count ≥ `repeated_line_min_count`, except headings.

### Stage B: Structure detection

Produce a tree: Document → Sections → Paragraphs → Sentences.

Required records:

* `Section { section_id, heading_text, level, start_offset, end_offset, paragraphs[] }`
* `Paragraph { start_offset, end_offset, sentences[] }`
* `Sentence { start_offset, end_offset, text }`

Rules:

* Headings split sections by `section_heading_rules`.
* Paragraphs split by `paragraph_split_rules`.
* Sentences split by `sentence_split_rules`.

### Stage C: Feature extraction per sentence

Compute a feature map per sentence, using only deterministic methods.

Minimum features:

* `len_chars`
* `has_number_or_date_like`
* `has_named_entity_like`
* `keyword_hits_count`
* `cue_phrase_hits_count`
* `position_in_section` (0-based sentence index)
* `is_first_sentence_in_section`
* `is_in_kept_list_item` (prefix match)
* `matches_keep_regex` (any)

Optional features (still deterministic):

* `tfidf_score` relative to section or document
* `textrank_score` computed from sentence similarity graph using fixed iteration count

### Stage D: Salience scoring

Compute:

`score_total = Σ(weight_i * feature_i)`

Default weight recipe:

* Base `tfidf_score` weight: `1.0`
* Cue phrases: `0.6`
* Keyword boosts: add `keyword_boosts[k]` per hit
* Numbers/dates: `number_date_boost`
* Named entity like: `named_entity_like_boost`
* First sentence in section: `position_boost_first_sentence_per_section`
* First paragraph in section: `position_boost_first_paragraph_per_section`
* Keep-list-item: add `2.0`
* Keep-regex match: add `3.0`

Record `score_breakdown` for audit.

### Stage E: Budget allocation across sections

Compute section budgets deterministically.

Default:

* Compute `section_weight = sqrt(section_chars)` using section character count.
* `section_budget = floor(budget_value * section_weight / Σ(section_weight))`
* Apply minimum per section, example `min(200 chars, 5% of total)` if budget permits.
* Carry remainder by distributing 1 char at a time to earliest sections.

### Stage F: Selection per section

Goal: pick spans under each section budget, with redundancy control.

Required steps:

1. **Guarantees first**

   * If `keep_first_sentence_each_section`: include it.
   * Include any sentence with keep-list-item prefixes.
   * Include any sentence matching keep-regexes.
2. **Candidate pool**
   Remaining sentences become candidates.
3. **Deduplication pre-pass**
   Remove exact duplicates by normalised sentence text key.
4. **MMR selection** (deterministic)

   * Start set `S` with guaranteed sentences.
   * While budget remains and candidates remain:

     * For each candidate `c`, compute

       * `relevance = score_total(c)`
       * `diversity_penalty = max(sim(c, s) for s in S)` (0 if S empty)
       * `mmr = mmr_lambda * relevance - (1 - mmr_lambda) * diversity_penalty`
     * Select highest `mmr`.
     * Ties break by:

       1. higher `score_total`
       2. earlier `source_start`
       3. shorter `len_chars`
     * Add it if similarity to any selected sentence is below `dedupe_threshold`.
5. Enforce `max_sentences_per_section` if set.

Similarity `sim(a,b)`:

* For `"ngram_jaccard"`: Jaccard over 3-gram set of lowercased text.
* For `"tfidf_cosine"`: cosine similarity using a deterministic vocabulary build.

### Stage G: Global stitching

Combine selected sentences from all sections.

Rules:

* Sort selected spans by `source_start` ascending.
* Merge adjacent spans when gap is only whitespace and `preserve_original_paragraph_breaks = true`.
* Join spans using `joiner_between_spans`.
* Produce `span_map` with correct `output_start/output_end`.

---

## Determinism requirements

* Stable sorting with explicit tie-break rules.
* Fixed iteration counts for any graph scoring, example TextRank iterations = 20.
* Fixed thresholds, explicit numeric defaults.
* No randomness. If a library uses randomness internally, set seed to a constant through options, or avoid that library component.

---

## Validation and tests

### Golden corpus tests

For each sample input:

* Assert `abridged_text` equals a stored golden output.
* Assert every span in `span_map` equals the exact substring of `input_text` from `source_start:source_end`.
* Assert `output_chars <= budget_value` (or equivalent budget mode check).
* Assert `span_map` spans are ordered and non-overlapping in output.

### Property tests

* Removing a section heading changes only section boundaries and related budgets.
* Increasing `budget_value` yields a superset of spans, unless dedupe rules filter.

### Audit utilities

Provide a report function that prints, per section:

* selected sentences with `score_total`
* top 5 breakdown contributors
* dedupe rejections with similarity values

---

## Minimal data model for Pyash mapping

Use maps and lists only:

* `document = { text, sections: [section...] }`
* `section = { id, heading, level, start, end, paragraphs: [paragraph...] }`
* `paragraph = { start, end, sentences: [sentence...] }`
* `sentence = { start, end, features: map, score_total, score_breakdown }`
* `result = { abridged_text, span_map: [SpanRecord...], stats }`

This spec is sufficient for Codex to implement in one pass while keeping Pyash-specific syntax and container types.
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
