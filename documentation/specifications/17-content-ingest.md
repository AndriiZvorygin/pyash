# 17. Content Ingest

Purpose: define deterministic ingest from raw documents to structured chips and abridgements.

## 1. Stage keyword table

| Stage keyword | Meaning | Application |
| --- | --- | --- |
| ingest | source read/normalization | bring raw bytes/text into pipeline |
| gross chips | coarse segment split | stable large-block partitioning |
| strategy | chip-shape analysis | decide how final chips should be formed |
| structure | heading/anchor extraction | semantic section boundaries |
| wise chips | resolved semantic units | retrieval/manuscript/downstream input |
| abridge | bounded compression | concise faithful output |

## 2. Core chip model

The ingest stack has three distinct chip layers:

- `gross chip`: rough first-pass slices sized for model work.
- `wise chip`: resolved semantic units suitable for downstream use.
- `chip`: a higher-level adaptive refinery entrypoint that chooses how to produce the final wise chips.

Supporting preparation may also use:

- `be extract`: marker-based text slicing before chipping
  - `since ...`
  - `until ...`

`be chip` is the general-purpose contract. It receives a source and a requested chip shape, then decides whether the source should be chipped:

- programmatically,
- through gross-chip boundary proposal and wise-chip resolution,
- or through another deterministic strategy defined by the refinery.

## 3. Canonical `be chip` contract

The intended general surface is:

`be chip from <source> ob text <chip style prompt> to series <chips> do`

Meaning:

- `from <source>`: the source text, filename, markdown, transcript, minutes, form, or other readable input.
- `ob text <chip style prompt>`: the requested final chip shape in natural-language terms.
- `to series <chips>`: the final chip series.

The `ob text` prompt defines the target semantic unit, for example:

- question and answer pairs for channeling sessions,
- agenda items for meeting minutes,
- topic blocks for transcripts,
- clauses or duties for forms,
- sections/subsections for documentation.

The prompt is not just a classifier hint. It is the user-facing declaration of what the final chips should be.

## 4. Strategy selection

`be chip` should inspect the source and choose the best production path for the requested chip shape.

Preferred order:

1. programmatic extraction when the source has reliable explicit structure,
2. gross-chip plus LLM-guided boundary proposal when structure is implicit or fuzzy,
3. mixed mode when deterministic structure exists but needs limited model help.

Examples:

- channeling transcript markdown with clear `Questioner` / `Q` and answer structure may use programmatic extraction,
- long prose essays may use gross chips plus boundary proposals,
- meeting minutes may mix explicit headings with model-guided agenda-item grouping.
- downloaded markdown may use `be extract` to keep only the relevant session body before chipping.

## 5. Gross chip and wise chip roles

`be gross chip` remains the coarse slicing primitive.

`be wise chip` remains the lower-level resolver for turning either:

- source text plus boundary proposals,
- or timed itinerary cuts plus typed duration bounds,

into final semantic chips.

`be chip` sits above those primitives and chooses whether to call them.

So the relationship is:

- `be gross chip`: coarse partitioning
- `be wise chip`: semantic resolution
- `be chip`: adaptive refinery that chooses the best chip path

## 6. Refinery requirements

Use a refinery with one stage per ingest step and explicit stage outputs.

At minimum, a conforming adaptive chip refinery should expose:

1. source load/normalization
2. gross chip stage when needed
3. strategy analysis stage
4. programmatic or boundary-driven chip production
5. final wise-chip series emission

## 7. Invariants

- identical source + chip-style prompt + refinery policy -> deterministic final chip set,
- stable chip IDs/order,
- provenance retained across stages,
- no chunk loss across stage boundaries,
- final chip series is auditable from source and intermediate artifacts.

## 8. Validation checklist

- strategy choice is recorded,
- no chip loss across stage boundaries,
- deterministic stage ordering,
- reproducible final chip set for identical input,
- final chips match the requested chip style prompt rather than arbitrary byte windows.

## 9. Conformance

Implementation conforms when ingest outputs are deterministic, auditable, replayable, and shaped by an explicit chip contract rather than hidden helper heuristics.

## 10. Anchored document digestion v0.1

The bounded digestion package is the sentence-native boundary between the
existing `read`/artifact paths and later knowledge-core processing. Its first
supported inputs are exact UTF-8 Markdown/plain-text bytes and exact UTF-8 CSV
bytes. It does not perform OCR, autonomous truth adjudication, or model-guided
claim rewriting.

### 10.1 Source identity and registration

The source identity is content-derived and independent of a filename or an
artifact ordinal:

`src-<full lowercase sha256 of exact UTF-8 bytes>`

The hash covers every input byte, including a UTF-8 BOM and every `CR`, `LF`,
or `CRLF` byte. Implementations MUST NOT normalize line endings or strip a BOM
before hashing or calculating offsets. The source registration is the first
record in the canonical digestion stream and has this shape:

```text
exists su name src-<sha256> ob text "<decoded source>" accordingto name sha256 fromtext text "<sha256>" by num <byte length> be source ya
```

The source artifact may additionally be recorded through the existing artifact
path. Artifact aliases and ordinal artifact names are operational records, not
source identity.

### 10.2 Anchor identity and spans

Anchor IDs are deterministic ASCII-only identifiers accepted by the existing
Knowledge Core source/anchor validator. They MUST begin with an ASCII letter
or digit and contain only ASCII letters, digits, `.`, `_`, `:`, and `-`.

Markdown/plain-text candidates are paragraph slices. A paragraph is a
contiguous run of non-blank physical lines; an ATX heading starts the next
sequential section and is not itself a candidate. Text before the first heading
belongs to section `0001`. Each candidate receives an anchor ID encoding its
sequential section/paragraph identity, inclusive 1-based line range, and
zero-based half-open byte span:

`section-<4-digit>-paragraph-<4-digit>-lines-<start>-<end>-bytes-<start>-<end>`

For example, `section-0002-paragraph-0001-lines-4-5-bytes-62-104` means that
`sourceBytes.slice(62, 104)` is the exact anchored paragraph and that it covers
physical lines 4 through 5 inclusive. The span excludes the line terminator
after the final line.

CSV candidates include the header and each data row. CSV logical rows may span
multiple physical lines when a quoted field contains a line break. The header
anchor is:

`table-header-lines-<start>-<end>-bytes-<start>-<end>`

Data rows use their one-based ordinal after the header:

`table-row-<4-digit ordinal>-lines-<start>-<end>-bytes-<start>-<end>`

CSV row spans refer to the original CSV row bytes, excluding its terminating
line break. Quoting, commas, Unicode, BOM bytes, and line endings remain in the
span exactly as supplied.

Every emitted span MUST be in bounds, end no earlier than start, land on valid
UTF-8 boundaries, and map back to the exact source bytes. A failed round-trip
is a digestion defect, not a recoverable candidate.

### 10.3 Canonical records and candidates

The canonical digestion stream is ordered in source order:

1. source registration;
2. for each anchor in source order, its anchor marker;
3. the candidate sentence for that anchor.

An anchor marker records the exact span and uses `be anchor`. A candidate uses
the propositive mood `pi7`, an embedded `fromtext` source/anchor clause,
`accordingto name reported-evidential`, and `by num 1`:

```text
su name <candidate-id> ob text "<exact span text>" fromtext la su name src-<sha256> ob text <anchor-id> be text ko accordingto name reported-evidential by num 1 be text pi7
```

`pi7` marks a high-recall extraction candidate; it does not assert that the
candidate's claim is true. In this package, confidence (`by num`) means
extraction and anchor fidelity, not claim truth. The initial bounded extractor
therefore uses `1` only after the exact span round-trip succeeds.

The candidate and marker IDs are derived from format and source order, never
from an artifact ordinal or wall-clock value. Candidate object text is the
decoded exact span text; no line-ending or whitespace normalization is allowed
inside the anchored span.

The Pyash entrypoint is an imperative sentence such as:

```text
su name principle from filename "policy.md" to name principle be digestion do
```

### 10.4 Replay and rejection contract

Identical bytes and format MUST produce byte-identical canonical record streams,
including their canonical Pyash sentence rendering. A replay check MAY use the
existing artifact hash verification path and MUST compare the canonical
digestion stream (not timestamps, run folder aliases, or deprecated `--again`
execution behavior). General `again` execution restoration remains outside this
bounded package.

The package MUST reject empty input, invalid UTF-8, malformed CSV, and any span
that does not map back to the source bytes. It MUST fail before emitting a
partial canonical stream when any of these guards fail.

## 11. Related references

- full draft reference: `documentation/recipes/spec-archive/17-content-ingest.full.md`
- adaptive chip reference: `documentation/reference/chip-refinery.md`
