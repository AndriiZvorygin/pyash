# `19-speech-artifacts.md` (v0.1)

**Status:** v0.1 (frozen)

---

## 1. Purpose

Define the **speech artifact metadata schema** used to make `say`/`hear` outputs
replayable and verifiable in `again` mode.

This schema is a deterministic, content-addressed record that can be stored as
an artifact and referenced from the run newspaper.

---

## 2. Terms

- **speech artifact**: audio bytes (say) or transcript bytes (hear) that are
  persisted and content-addressed.
- **speech metadata**: structured record describing the speech artifact.
- **fixture id**: a stable identifier for deterministic test mode.

---

## 3. Metadata record (normative)

There is exactly one metadata record per speech artifact (one `say`/`hear`
output). It is written once for the whole artifact and stored as its own
content-addressed artifact.

The metadata record is a JSON map with the following fields:

- `kind` (text): `"say"` or `"hear"`.
- `backend` (text): backend id (e.g., `espeak`, `piper`, `whisper`).
- `model` (text, optional): model id or version.
- `voice` (text, optional): voice or speaker id.
- `locale` (text, optional): language/locale tag.
- `inputSha256` (text): sha256 of the input text or input audio bytes.
- `outputSha256` (text): sha256 of the output bytes (audio or transcript).
- `format` (text, optional): container/codec label (e.g., `wav`, `pcm_s16le`).
- `sampleRateHz` (num, optional): audio sample rate.
- `channels` (num, optional): audio channel count.
- `streaming` (bool): `true` if generated via streaming mode.
- `fixtureId` (text, optional): fixture identity for deterministic tests.

### 3.1 Streaming chunk list (optional)

Streaming runs may optionally include a chunk summary list for `again` mode
verification. This list exists only inside the metadata record (not in the live
stream) and may be omitted or capped for long streams.

When `streaming` is `true`, the record MAY include:

- `chunks` (array of maps), each with:
  - `seq` (num)
  - `sha256` (text)
  - `bytes` (num)
  - `toIndex` (num, optional)
  - `tMs` (num, optional)

Each chunk entry summarizes one stream chip. Chunk ordering MUST be ascending
by `seq`. If `toIndex` is present, `final` is implied when `seq == toIndex`.

If the chunk list is serialized in Pyash sentence form, use the same hash and
size fields as other artifacts: `accordingto name sha256 fromtext text "<hex>"`
and `by num <bytecount>`.

Pyash stream chunk (chip) example:

```pyash
su name S3
atindex num 2
toindex num 4
ob text "partial"
accordingto name sha256 fromtext text "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881"
by num 7
during num 120
be chip ya
```

---

## 4. Storage and linking

- The metadata JSON bytes MUST be content-addressed and recorded as an artifact.
- The run newspaper MUST reference the metadata artifact when speech bytes are
  recorded.
- The metadata record MUST NOT include wall-clock timestamps.

---

## 5. Again mode verification

In again mode, implementations MUST:

- verify `outputSha256` matches recorded bytes,
- verify chunk hashes when `chunks` is present,
- surface a deterministic error if verification fails.

---

## 6. Conformance

An implementation conforms if it:

- emits metadata using the field set in §3,
- stores and links metadata per §4,
- verifies outputs per §5.
