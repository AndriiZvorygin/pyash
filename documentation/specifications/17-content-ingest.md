# 17. Content Ingest

Purpose: define deterministic ingest pipeline from raw documents to structured chunks and abridgements.

## 1. Pipeline stages

Recommended stages:
- ingest source bytes/text
- gross chips (coarse segmentation)
- structure extraction
- anchored segments
- smart chunking
- abridgement

## 2. Invariants

- deterministic segmentation for identical source + config
- stable chunk identifiers
- explicit provenance retained through stages

## 3. Data shape

Each stage output should map into canonical map/series structures and remain sentence-compatible.

## 4. Abridger profile

Abridgement must be deterministic under fixed model/config profile and bounded by explicit limits.

## 5. Validation

Required checks:
- no chunk loss across stage boundaries
- deterministic ordering
- reproducible final chunk list for same inputs

## 6. Conformance

Implementation conforms when ingest outputs are deterministic, auditable, and replayable through documented stage transforms.

## 7. Full draft reference

Detailed stage specs and examples are preserved at:
`documentation/recipes/spec-archive/17-content-ingest.full.md`
