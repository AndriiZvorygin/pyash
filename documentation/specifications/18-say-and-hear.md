# `18-say-and-hear.md` (v0.1)

**Status:** v0.1 (frozen)

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

### 3.3 Aspectful invocation forms

Aspect is expressed via `vyah` and changes what is returned. Examples below
pair each invocation (`do`) with its returned sentence (`ya`).

`say` (one-shot, stream, start):

```pyash
su name <result> ob text <utterance> be say vyah eval do
su name <result> ob name <artifact> be say ya

su name <stream> ob text <utterance> be say vyah stream do
su name <stream> as name open be stream ya

su name <handle> ob text <utterance> be say vyah start do
su name <handle> as name running be duty ya
```

`say` (lifecycle on handle/stream):

```pyash
su name <result> be say vyah await do
su name <result> be say vyah await success ya

su name <status> be say vyah finish do
su name <status> be say vyah finish success ya

su name <status> be say vyah cancel do
su name <status> be say vyah cancel success ya
```

Working with the results (pull chips until `atindex == toindex` or an error):

```pyash
su name <stream> be chip vyah eval do
su name <stream> atindex num <seq> toindex num <last> ob <payload> be chip ya
```

`hear` (one-shot, stream, start):

```pyash
su name <result> be hear vyah eval do
su name <result> ob text <transcript> be hear ya

su name <stream> be hear vyah stream do
su name <stream> as name open be stream ya

su name <handle> be hear vyah start do
su name <handle> as name running be duty ya
```

`hear` (lifecycle on handle/stream):

```pyash
su name <result> be hear vyah await do
su name <result> be hear vyah await success ya

su name <status> be hear vyah finish do
su name <status> be hear vyah finish success ya

su name <status> be hear vyah cancel do
su name <status> be hear vyah cancel success ya
```

---

## 4. Aspect contracts (normative)

Aspect is part of dispatch and controls the return type (see
`08-vyah-and-aspect.md` and `09-runtime-primitives.md`).

### 4.1 `say`

- `eval` (default): return **Value** containing an audio artifact reference.
- `stream`: return **Stream** of audio frames.
- `start`: return **TaskHandle** for an in-progress synthesis.
- `await`: wait for a handle, return **Value**.
- `finish`: flush/close a stream or handle, return **Value** status.
- `cancel`: cancel a stream or handle, return **Value** status.
  - `timebox`: timebox synthesis; return **Value** or **Stream** per backend policy. Duration is given by `during num <ms>`.

### 4.2 `hear`

- `eval` (default): return **Value** containing a transcript.
- `stream`: return **Stream** of partial transcripts.
- `start`: return **TaskHandle** for an in-progress capture.
- `await`: wait for a handle, return **Value**.
- `finish`: flush/close a stream or handle, return **Value** status.
- `cancel`: cancel a stream or handle, return **Value** status.
  - `timebox`: timebox capture; return **Value** or **Stream** per backend policy. Duration is given by `during num <ms>`.

---

## 5. Streaming payload rules

### 5.1 `say stream`

Each stream chunk MUST be an envelope with:

- `seq` (integer, monotonic)
- `payload` (audio bytes or a stable locator)
- `tMs` (optional, integer milliseconds since stream start; monotonic)
- `final` is implied when `atindex == toindex` (when `toindex` is present).

Pyash representation (no shadow JSON):

```pyash
su name <stream>
atindex num <seq>
toindex num <last>
ob <payload>
during num <tMs>
be chip ya
```

### 5.2 `hear stream`

Each stream chunk MUST be an envelope with:

- `seq` (integer, monotonic)
- `payload` (partial transcript text)
- `tMs` (optional, integer milliseconds since stream start; monotonic)
- `final` is implied when `atindex == toindex` (when `toindex` is present).

Pyash representation (no shadow JSON):

```pyash
su name <stream>
atindex num <seq>
toindex num <last>
ob text <payload>
during num <tMs>
be chip ya
```

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
