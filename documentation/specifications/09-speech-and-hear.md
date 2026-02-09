# `09-speech-and-hear.md` (merged)

Merged specification sources (legacy IDs):
- 18-say-and-hear
- 19-speech-artifacts
- 20-whisper-english-to-pyash
- 23-caterer-hear-say-vendoring

---

# Say and hear (v0.1)

**Status:** v0.1 (frozen)

---

## 1. Purpose

Define the **`say`** (TTS) and **`hear`** (STT) library verbs, their aspect-driven
contracts, and the minimum observable behavior required for determinism.

This spec focuses on **interfaces and run-record behavior**. Backend choice and
device integration are implementation details gated by config.

For whisper-stream prompt support, see `documentation/specifications/whisper_initial_prompt.md`.

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
`03-vyah-and-aspect.md`).

### 3.2 `hear`

```pyash
su name <result> be hear do
```

Input audio source is configured by the runtime (device, file, or artifact),
and is intentionally out of scope for this spec.
If `ob text <prompt>` is provided for `hear`, it biases the decoder (backend
permitting). See `documentation/specifications/whisper_initial_prompt.md`.

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

Streaming output MAY be consumed by `say` itself (e.g., piping an LLM stream into
TTS). Implementations MAY buffer by punctuation (comma/period/etc.) before
emitting audio chunks.
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
`03-vyah-and-aspect.md` and `04-runtime-primitives.md`).

### 4.1 `say`

- `eval` (default): return **Value** containing an audio artifact reference.
- `stream`: return **Stream** of audio frames.
- `start`: return **TaskHandle** for an in-progress synthesis.
- `await`: wait for a handle, return **Value**.
- `finish`: flush/close a stream or handle, return **Value** status.
- `cancel`: cancel a stream or handle, return **Value** status.
  - `timebox`: timebox synthesis; return **Value** or **Stream** per backend policy. Duration is given by `during num <s>`.

### 4.2 `hear`

- `eval` (default): return **Value** containing a transcript.
- `stream`: return **Stream** of partial transcripts.
- `start`: return **TaskHandle** for an in-progress capture.
- `await`: wait for a handle, return **Value**.
- `finish`: flush/close a stream or handle, return **Value** status.
- `cancel`: cancel a stream or handle, return **Value** status.
  - `timebox`: timebox capture; return **Value** or **Stream** per backend policy. Duration is given by `during num <s>`.

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
during num <tSec>
be chip ya
```

Backends MAY buffer incoming text chunks and only emit audio once a word or
punctuation boundary is reached. When buffering is used, flushing behavior MUST
be deterministic for fixture runs, and partial-word audio MUST NOT be emitted.

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
during num <tSec>
be chip ya
```

Chunk ordering MUST be deterministic for the same input and fixture mode.

Backends MAY emit a sentinel line such as `[BLANK_AUDIO]` to signal end-of-stream.
When present, it is treated as an end marker and MUST NOT appear as a transcript
chip payload. Stream termination is triggered by a lifecycle finish/cancel, a
timebox reaching its duration, or a backend end marker.

---

## 6. Run recording and artifacts

Speech outputs that materialize bytes MUST be recorded as artifacts per
`05-run-recording-and-artifacts.md`.

Speech metadata MUST follow `09-speech-and-hear.md` when present. In fixture
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


---

# Speech artifacts (v0.1)

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


---

## Spec: Whisper Surface Form for Pyash Sentences (v0.1 draft)

Reference prompt: `documentation/whisper_initial_prompt.md`.

### 0. Purpose

Define a speech-friendly surface syntax that roundtrips deterministically into the existing Pyash sentence model: a sentence has a mood, a `be` verb, and keyworded cases. 

This spec adds a *surface* layer only. The internal sentence object, canonical case keywords, signature derivation, and official ordering remain the source of truth.  

---

## 1. Invariants

1. **Full reversibility**: `speech -> parse -> canonical emit -> parse` yields the same canonical sentence.
2. **Punctuation independence**: parsing ignores punctuation; tokens drive structure.
3. **Keyword-first structure**: every structural boundary is introduced by a keyword that exists in the grammar keyword lists. 
4. **Official ordering on emit**: emitted Pyash uses official compositional case order and official formatting so signatures stay stable.  

---

## 2. Tokenisation and normalisation

Input: a Whisper transcript.

Normalisation steps:

* lowercase
* replace punctuation `[.,;:!?]` with spaces
* collapse repeated whitespace
* split into space-delimited tokens

Quoted block delimiters are spoken as tokens, not punctuation:
* `quoted <lang>` opens a block
* `<lang> quoted` closes a block
Punctuation is stripped before this scan, so `quoted.<lang>.` and `.<lang>.quoted` collapse to the same token pairs.

Quoted blocks are collapsed into a single internal token (`__QUOTED_TEXT__:<text>`). The `<lang>` token is only used to find the closing delimiter and is not preserved. Because normalization lowercases and strips punctuation before collapsing, quoted content is lowercased and punctuation removed.

No reliance on commas, semicolons, or periods.

---

## 3. Keyword sets (source of truth)

The implementation MUST load these keyword sets from `program/library/grammar/keywords.mjs`. 

Required sets:

* **moods** (includes `ya`, `do`, `def`, `prah`, `then`, plus others)
* **cases** (includes `su`, `ob`, and compositional cases like `fromstate`, `fromindex`, `totext`, etc.)  
* **type tokens** (includes at least `num`, `text`, `date`, `filename`, `name`, `wo`, `la`, etc.) 
* clause delimiters: `la` and `ko` for subordinate clauses 

---

## 4. Surface aliases for Whisper

### 4.1 Subject and object aliases

The parser already accepts `subj` and `obj` at the surface and canonicalizes to `su` and `ob`. 

Extend this idea for speech:

* accept `subject` as alias of `su`
* accept `object` as alias of `ob`

Canonical emission always uses `su` and `ob`.

### 4.2 Split-form compositional cases

Compositional cases are single tokens canonically (example: `fromstate`), yet the parser may accept split forms and normalizes them (example: `from state` -> `fromstate`). 

For Whisper, accept split forms for compositional cases:

* `from state` -> `fromstate`
* `to state` -> `become`
* `to text` -> `totext`
* plus any other split forms already accepted by the core parser. 

---

## 5. Speech sentence shape

### 5.1 Canonical speech form (recommended for emission)

Emit speech in Pyash-like order because it is already keyworded and signature-stable:

```
[exists] <case>* be <verb> <mood>
```

This matches the sentence model that always has `be`, plus any number of cases. 

### 5.2 Accepted input variants (for convenience)

To reduce friction for commands, accept mood as a prefix during speech input:

```
<mood> [exists] <case>* be <verb>
```

Normalise internally to the canonical form with mood suffix.

Rules:

* If the first non-quoted token is a mood, treat it as `moodPrefix`.
* Else, require a mood token at the end as `moodSuffix`.
* If both appear, raise a parse error.
* Prefix moods are normalized to suffix moods.

`exists` is not enforced by the Whisper normalizer; enforcement remains a core/runtime concern.

---

## 6. Case payload parsing

A case begins at a case keyword and consumes a value.

### 6.1 Typed payloads

Typed payloads follow the existing pattern:

* `su name <x>` identifies a subject name 
* `ob num <n>` and `ob text <t>` are typed payloads 
* typed name references: `name <type> <literal>` where `<type>` immediately follows `name` and `<literal>` may be multi-word until the next keyword boundary 

Speech mapping keeps these tokens explicit:

* “object number 5” -> `ob num 5`
* “to name num counter” -> `to name num counter`

For multi-word or free-form text payloads, use quoted blocks (`quoted <lang> ... <lang> quoted`) to avoid keyword collisions.

### 6.2 Literal-word dispatch (`wo`)

Support `wo` in speech exactly, since it affects signature words and strict literal dispatch.  

Example speech:

* “from wo microphone be record do”

### 6.3 Subordinate clauses (`la … ko`)

Speech MUST include the delimiters `la` and `ko` as spoken tokens. Everything between them is exactly one embedded sentence form. 

Example speech:

* “object la subject name clause object text ok be text ya ko be evoke ya” 

### 6.4 Quoted blocks (`quoted <lang>` / `<lang> quoted`)

Speech MUST include the two-token delimiters `quoted <lang>` and `<lang> quoted`. Everything between them is treated as text and may include keywords; the Whisper normalizer lowercases and strips punctuation before collapsing the block.

Example speech:

* “object quoted pyash su name alpha ob num 1 be number ya pyash quoted”

---

## 7. Parsing algorithm (deterministic)

Given token stream:

1. Normalise aliases:

   * `subject` -> `su`
   * `object` -> `ob`
   * `subj` -> `su`
   * `obj` -> `ob`
2. Normalise split compositional cases as per core rules.
3. Determine mood:

   * prefix mood if the first non-quoted token is in moods
   * else suffix mood must exist as final non-quoted mood token
   * if both appear, error
   * prefix moods are normalized to suffix moods
4. Parse optional `exists` (Whisper normalizer does not validate mood).
5. Parse a sequence of cases:

   * read a case keyword
   * read its value as a typed payload, name reference, `wo` literal, subordinate clause, or quoted block
   * value ends at the next case keyword, the token `be`, or the mood suffix boundary
6. Require `be <verb>`.
7. Emit canonical Pyash:

   * canonical case keywords (single-token forms) 
   * official case ordering for formatting and signatures 

---

## 8. Canonical emission back to speech

Emit in canonical speech form:

```
[exists] <cases in official order> be <verb> <mood>
```

Cases appear in official compositional keyword order, matching dispatch and signatures.  

---

## 9. Examples

### 9.1 Your command example, speech-first mood

Speech input (Whisper-friendly):

* “do be plus object number 5 to name result”

Normalised canonical Pyash:

```pyash
ob num 5 to name result be plus do
```

You can also supply the second operand via `from` when no `to` is present:

```pyash
ob num 2 from num 3 be plus do
```

If you prefer the “be plus … do” ordering during emission, keep it consistent with your formatter, since signature derivation uses canonical ordering anyway. 

### 9.2 Subject included without using `by`

Speech input:

* “subject name alice do be plus object number 5 to name result”

Canonical Pyash:

```pyash
su name alice ob num 5 to name result be plus do
```

This uses `su` and `ob` via speech aliases, avoiding overload of `by` which remains available as a true case keyword (`by` in the quantity context). 

### 9.3 Literal dispatch word

Speech input:

* “from wo microphone be record do”

This preserves literal-word signature behaviour. 

---

## 10. Error handling

All speech-parse failures surface as the standard error sentence contract when observed, and propagate as `be error do` internally. 

Include source context fields when available, including `from filename`, `by num`, and `at la … ko`. 

---

If you want this spec to plug into dispatch cleanly, emit canonical order and canonical case keywords before deriving signature words, since dispatch is signature-first and case order is normalised. 

---

# Future: SRT + see + video reading (notes)

This spec will extend `hear` to support **SRT output** (subtitle blocks with
timestamps). The intent is to keep `hear` as the canonical STT verb and expose
SRT as an output mode rather than a separate verb. Proposed shape:

- `be hear ... become wo srt` returns SRT text.
- `be hear ... become wo srt to name <text>` assigns the SRT text to a name.

We will also add a `see` capability for **local VL models** (vision-language).
Video reading will combine `hear` + `see`:

- `hear` produces SRT (timestamps + text).
- For each SRT window (or every N windows), sample frames.
- Pass sampled frames to `see` and merge the image summaries with the SRT block.

This keeps speech and vision separate, composable tools: `hear` owns audio
transcription, `see` owns image understanding, and a higher-level video reader
joins them using the SRT timeline.


# Specification: `see` (vision-language)

`see` exposes a Pyash module/ceremony rather than a built-in verb. The canonical call is:

```
ob text "<prompt>" from filename <loc> be see to name text <result> do
```

The input prompt lives in `ob.text` and the image locator draws from `from.filename`. The module sends the prompt to `node command/see_vl_runner.mjs` over stdin and passes the image/model/host flags:

```
--prompt-stdin
--image "<loc>"
--model "<model>"
--host "<ollama host>"
```

`<model>` is supplied via `as text "<model>"`. `configure/default.pya` adds **dynamic defaults** so any `be see` call is expanded with:

```
exists su name see default mind ob la be see ko as text "qwen3-vl:8b-instruct" be default ya
exists su name see default prompter ob la be see ko ob text "Describe the image." be default ya
exists su name see default output ob la be see ko to name text "see result" be default ya
```

The host is read from the remembered `ollama host` fact defined in `configure/default.pya` or `configure/secret.pya`.

The runner builds an OpenAI-compatible chat request:

```
{
  "model": "qwen3-vl:8b",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "<prompt>" },
        { "type": "image_url", "image_url": "data:<mime>;base64,<base64bytes>" }
      ]
    }
  ],
  "max_tokens": 300
}
```

Each image is encoded as a `data:<mime>;base64,` URL and added to the single message’s `content` array immediately after the prompt text part. `max_tokens` is optional and only included when explicitly configured.

Requests are POSTed to `http://<ollama host>/v1/chat/completions` (OpenAI-compatible). If that returns `404` or `405`, the runner retries via `http://<ollama host>/api/chat` using Ollama’s `messages[].images` format. The response text is extracted from `choices[0].message.content` (OpenAI-style) or `message.content` (Ollama-style). The runner writes the assembled description to stdout, so that the Pyash module can return it as `ob.text`.

For offline testing, set `PYA_SEE_VL_FIXTURE` to a fixed string before invoking `see`. When that environment variable is present, `command/see_vl_runner.mjs` bypasses Ollama and simply echoes the fixture string.

## Evidential tagging for `see`/`hear` outputs (draft v0.2)

This section defines default evidential semantics for perceptual tools.

Rules:

1. `see` outputs SHOULD carry an optical/direct evidential shell by default.
2. `hear` outputs SHOULD carry an audio/direct evidential shell by default.
3. If the source is a news report or secondary retelling, outputs SHOULD use reported/news evidential.
4. If the source is an authoritative primary document (for example a research paper, official spec, or original record), outputs SHOULD use direct evidential.
5. If a claim is corroborated by multiple independent sources, outputs MAY be promoted to factive evidential.

Source-strength policy:

* primary/authoritative source -> direct evidential
* secondary/reporting source -> reported/news evidential
* multi-source corroboration -> factive evidential (promotion step, not default)

Implementations SHOULD record source anchors and provenance fields alongside evidential tagging so promotions are auditable.


---

# Specification: Caterer vendoring for hear and say

## Objective

Provide a portable, local dependency bundle for Pyash `hear` (STT) and `say` (TTS) that:

* installs into `caterer/`
* works without system package managers
* verifies integrity with SHA-256
* records `circumstances` for reproducibility
* keeps paths speakable and stable across platforms

## Canonical vocabulary

* hear: STT dependency set
* say: TTS dependency set
* computer: OS + arch identifier
* manifesto: dependency declaration JSON
* circumstances: record of what is installed and verified
* template: Whisper model file
* vocalization: Piper voice package
* binary: directory for executables

## Layout

### Hear layout

caterer/hear/manifesto/deps.pya
caterer/hear/binary/<computer>/whisper-main[.exe]
caterer/hear/binary/<computer>/whisper-stream[.exe] (optional)
caterer/hear/template/whisper/<template-file>
caterer/hear/circumstances/installed.pya
caterer/hear/license/whisper.cpp.LICENSE.txt
caterer/hear/building/

### Say layout

caterer/say/manifesto/deps.pya
caterer/say/binary/<computer>/piper[.exe]
caterer/say/binary/<computer>/espeak-ng[.exe] (optional)
caterer/say/vocalization/piper/<vocalization-id>/<voice>.onnx
caterer/say/vocalization/piper/<vocalization-id>/<voice>.json
caterer/say/circumstances/installed.pya
caterer/say/license/piper.LICENSE.txt
caterer/say/license/vocalization/<vocalization-id>.LICENSE.txt
caterer/say/building/

## Computer values

Use these strings:

* linux-x64, linux-arm64
* darwin-x64, darwin-arm64
* win-x64

The installer determines the active computer at runtime.

## Manifesto files

There are two manifesto files:

* caterer/hear/manifesto/deps.pya
* caterer/say/manifesto/deps.pya

Each manifesto is computer-aware and declares:

* what to download
* where to place it
* how to verify it
* defaults for the speech bridge

### Common manifesto schema (pyash map)

Manifesto files are **pyash maps** (not json maps). Each entry is a full
sentence keyed by `su`. This avoids nested json maps and lets entries carry
multiple cases.

Required entries (as sentences in the map):

* `su name schemaVersion ob num <n> ya`
* `su name depend be reform during date "<ISO 8601 date>" ya`
* `su name <tool-id> ob text "<tool-version>" with name license ti name "<license>" be tool ya`
* `su name computer ob ve name <computer...> ya`
* `su name <default-key> ob text "<value>" be default ya`

Computer-specific binaries and assets are listed as one sentence per item, e.g.:

* binary entry:
  `su name binary <id> from text "<url>" accordingto name sha256 fromtext text "<hex>" by num <size> to filename "<path>" as name <computer> be binary ya`
* asset entry:
  `su name asset <id> from text "<url>" accordingto name sha256 fromtext text "<hex>" by num <size> to filename "<path>" as name <computer> be asset ya`

Optional cases (only when needed):

* `from name zip|tar.gz` + `fromtext text "<subdir>"` for extract info
* `by num <size>` for size verification
* `with name chmodX` when executable bit is required
* `with name license` + `from filename "<path>"` for asset license file

Example (Pyash map, shortened):

```pyash
su name caterer say manifesto be map def
  su name schemaVersion ob num 1 ya
  su name depend be reform during date "2025-05-01" ya
  su name piper ob text "1.2.0" with name license ti name "MIT" be tool ya
  su name computer ob ve name linux-x64 darwin-arm64 ya
  su name vocalization ob text "en_US-amy" be default ya
  su name fallback ob text "espeak-ng" be default ya
  su name binary piper
    from text "https://example.com/piper-linux-x64.tar.gz"
    accordingto name sha256 fromtext text "aaaaaaaa...cccc"
    to filename "caterer/say/binary/linux-x64/piper"
    as name linux-x64
    be binary ya
  su name asset en_US-amy
```
