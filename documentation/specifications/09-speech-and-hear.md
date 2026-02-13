# 09. Speech And Hear

Purpose: define speech/hear contracts, speech artifacts, and whisper-oriented surface normalization.

## 1. Scope

This chapter covers:
- `be say`
- `be hear`
- speech metadata/artifact records
- spoken surface aliases mapped into canonical Pyash sentences

## 2. Invocation contracts

Speech/hear calls must produce sentence-shaped outputs with explicit payload/type fields.

## 3. Streaming and artifacts

Streaming speech/hear outputs should be chunked deterministically and linked to artifacts when persisted.

## 4. Determinism and replay

For same audio/text input and configured model profile, output normalization should be reproducible within defined tolerance.

Replay must rely on recorded metadata + artifacts.

## 5. Evidential tags

Outputs that describe observed/reported content should carry evidential categories for traceability.

## 6. Conformance

Implementation conforms when speech/hear results are canonical sentence outputs with deterministic metadata and artifact linkage.

## 7. Full draft reference

Detailed whisper aliasing and evidential sections are preserved at:
`documentation/recipes/spec-archive/09-speech-and-hear.full.md`
