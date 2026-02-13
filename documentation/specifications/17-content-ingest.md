# 17. Content Ingest

Purpose: define deterministic ingest from raw documents to structured chunks and abridgements.

## 1. Stage keyword table

| Stage keyword | Meaning | Application |
| --- | --- | --- |
| ingest | source read/normalization | bring raw bytes/text into pipeline |
| gross chips | coarse segment split | stable large-block partitioning |
| structure | heading/anchor extraction | semantic section boundaries |
| anchored segments | start/end anchored slices | deterministic segment identity |
| smart chunks | downstream chunk units | retrieval/summarization input |
| abridge | bounded compression | concise faithful output |

## 2. Invariants

- identical source + config -> deterministic segmentation,
- stable chunk IDs/order,
- provenance retained across stages.

## 3. Canonical pipeline pattern

Use a refinery with one stage per ingest step and explicit stage outputs.

## 4. Validation checklist

- no chunk loss across stage boundaries,
- deterministic stage ordering,
- reproducible final chunk set for identical input.

## 5. Conformance

Implementation conforms when ingest outputs are deterministic, auditable, and replayable.

## 6. Full draft reference

`documentation/recipes/spec-archive/17-content-ingest.full.md`
