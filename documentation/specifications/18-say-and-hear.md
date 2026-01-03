# `18-say-and-hear.md` (draft v0.1)

**Status:** draft (semantics locked, wording polish pending)

---

## 1. Purpose

Define the **`say`** (TTS) and **`hear`** (STT) library verbs, their aspect-driven
contracts, and the minimum observable behavior required for determinism.

This spec focuses on **interfaces and run-record behavior**. Backend choice and
device integration are implementation details gated by config.

---

## 2. Terms

- **say**: convert text to audio.
- **hear**: convert audio to text.
- **utterance**: one unit of text sent to `say`.
- **transcript**: text returned by `hear`.
- **audio frame**: a chunk of audio bytes in a streaming response.
- **fixture mode**: deterministic test mode that returns pinned outputs.

---

## 3. Canonical invocation forms

### 3.1 `say`

```pyash
su name <result> ob text <utterance> be say do
```

`ob text` is required. The effective aspect is read from `vyah` (see
`08-vyah-and-aspect.md`).

### 3.2 `hear`

```pyash
su name <result> be hear do
```

Input audio source is configured by the runtime (device, file, or artifact),
and is intentionally out of scope for this spec.

---

## 4. Aspect contracts (normative)

Aspect is part of dispatch and controls the return type (see
`08-vyah-and-aspect.md` and `09-runtime-primitives.md`).

### 4.1 `say`

- `fa` (default): return **Value** containing an audio artifact reference.
- `me`: return **Stream** of audio frames.
- `pfih`: return **TaskHandle** for an in-progress synthesis.
- `tyih`: wait for a handle, return **Value**.
- `mweh`: flush/close a stream or handle, return **Value** status.
- `qa`: cancel a stream or handle, return **Value** status.
- `dweh`: timebox synthesis; return **Value** or **Stream** per backend policy.

### 4.2 `hear`

- `fa` (default): return **Value** containing a transcript.
- `me`: return **Stream** of partial transcripts.
- `pfih`: return **TaskHandle** for an in-progress capture.
- `tyih`: wait for a handle, return **Value**.
- `mweh`: flush/close a stream or handle, return **Value** status.
- `qa`: cancel a stream or handle, return **Value** status.
- `dweh`: timebox capture; return **Value** or **Stream** per backend policy.

---

## 5. Streaming payload rules

### 5.1 `say me` stream

Each stream chunk MUST be an envelope with:

- `seq` (integer, monotonic)
- `payload` (audio bytes or a stable locator)
- `final` (bool)
- `tMs` (optional)

### 5.2 `hear me` stream

Each stream chunk MUST be an envelope with:

- `seq` (integer, monotonic)
- `payload` (partial transcript text)
- `final` (bool)
- `tMs` (optional)

Chunk ordering MUST be deterministic for the same input and fixture mode.

---

## 6. Run recording and artifacts

Speech outputs that materialize bytes MUST be recorded as artifacts per
`11-run-recording-and-artifacts.md`.

Speech metadata MUST follow `19-speech-artifacts.md` when present. In fixture
mode, the metadata and hashes MUST be stable for the same fixture id.

---

## 7. Determinism rules

- Fixture mode MUST be available for `say` and `hear`.
- In fixture mode, output bytes and transcripts are pinned and replayable.
- Run records MUST be byte-stable across interpreter/JS/C for fixture runs.

---

## 8. Conformance

An implementation conforms if it:

- accepts the canonical forms in §3,
- honors the aspect contracts in §4,
- emits streaming envelopes per §5,
- records artifacts and metadata per §6,
- produces deterministic fixture runs per §7.
