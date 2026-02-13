# 09. Speech And Hear

Purpose: define `say`/`hear` contracts, streaming behavior, and artifact/evidential recording.

## 1. Verb and keyword table

| Surface | Meaning | Application |
| --- | --- | --- |
| `be say do` | synthesize/output speech | TTS or speech rendering |
| `be hear do` | transcribe/input speech | STT ingestion |
| `vyah stream` | incremental output mode | live transcript chunks |
| `vyah cancel` | stop stream/listen process | deterministic interruption |

## 2. Canonical forms

Hear text:
```pyash
from filename "audio.wav" to name text transcript be hear do
```

Hear stream:
```pyash
su name mic stream vyah stream be hear do
```

Cancel hear stream:
```pyash
su name mic stream vyah cancel be hear do
```

## 3. Metadata and artifacts

Speech/hear runs should record:
- source/target artifact paths,
- model/backend metadata,
- transcript result sentence,
- evidential tags when content is observational/reported.

## 4. Determinism

For same input bytes + same model/profile, normalization should be reproducible within documented tolerance.

## 5. Conformance

Implementation conforms when speech/hear surfaces are sentence-shaped, stream-safe, and artifact-linked for replay.

## 6. Full draft reference

`documentation/recipes/spec-archive/09-speech-and-hear.full.md`
