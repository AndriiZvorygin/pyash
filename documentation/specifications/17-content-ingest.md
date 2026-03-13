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

## 10. Related references

- full draft reference: `documentation/recipes/spec-archive/17-content-ingest.full.md`
- adaptive chip reference: `documentation/reference/chip-refinery.md`
