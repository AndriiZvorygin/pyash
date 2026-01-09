Understood. Here is the spec content (no quoting), written as a single Markdown file you can save as `documentation/specifications/caterer-hear-say-vendoring.md`.

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
    from text "https://example.com/en_US-amy.onnx"
    accordingto name sha256 fromtext text "bbbbbbbb...dddd"
    by num 9876543
    to filename "caterer/say/vocalization/piper/en_US-amy/voice.onnx"
    as name linux-x64
    with name license from filename "caterer/say/license/vocalization/en_US-amy.LICENSE.txt"
    be asset ya
prah
```

### Hear manifesto requirements

tool.id: whisper.cpp
tool.license: MIT

Required binaries per computer:

* whisper-main (required)
* whisper-stream (optional)

#### Whisper-stream usage (reference)

Common usage (capture mic ID 0, write transcript to file):

```bash
./caterer/hear/binary/linux-x64/whisper-stream \
  -c 0 \
  -m ./caterer/hear/template/whisper/ggml-base.bin \
  -f /tmp/whisper.txt
```

If you only have the English model, use `ggml-base.en.bin` instead.

Note: `whisper-stream` emits `[BLANK_AUDIO]` when silence exceeds its internal
thresholds. Pyash integrations SHOULD treat this as an end marker and MUST NOT
include it as transcript text.

Help output (flags and defaults):

```text
  -t N,     --threads N     [4      ] number of threads to use during computation
            --step N        [3000   ] audio step size in milliseconds
            --length N      [10000  ] audio length in milliseconds
            --keep N        [200    ] audio to keep from previous step in ms
  -c ID,    --capture ID    [-1     ] capture device ID
  -mt N,    --max-tokens N  [32     ] maximum number of tokens per audio chunk
  -ac N,    --audio-ctx N   [0      ] audio context size (0 - all)
  -bs N,    --beam-size N   [-1     ] beam size for beam search
  -vth N,   --vad-thold N   [0.60   ] voice activity detection threshold
  -fth N,   --freq-thold N  [100.00 ] high-pass frequency cutoff
  -tr,      --translate     [false  ] translate from source language to english
  -nf,      --no-fallback   [false  ] do not use temperature fallback while decoding
  -ps,      --print-special [false  ] print special tokens
  -kc,      --keep-context  [false  ] keep context between audio chunks
  -l LANG,  --language LANG [en     ] spoken language
  -m FNAME, --model FNAME   [models/ggml-base.en.bin] model path
  -f FNAME, --file FNAME    [       ] text output file name
  -tdrz,    --tinydiarize   [false  ] enable tinydiarize (requires a tdrz model)
  -sa,      --save-audio    [false  ] save the recorded audio to a file
  -ng,      --no-gpu        [false  ] disable GPU inference
  -fa,      --flash-attn    [true   ] enable flash attention during inference
  -nfa,     --no-flash-attn [false  ] disable flash attention during inference
```

Required assets:

* at least one Whisper template file under:

  * caterer/hear/template/whisper/

defaults:

* defaultTemplateId: string
* preferStreamBinary: boolean

### Say manifesto requirements

tool.id: piper
tool.license: MIT

Required binaries per computer:

* piper (required)
* espeak-ng (optional)

Required assets:

* at least one Piper vocalization package consisting of:

  * one .onnx file
  * one .json file
    placed under:
  * caterer/say/vocalization/piper/<vocalization-id>/

defaults:

* defaultVocalizationId: string
* fallback: object

  * tool: espeak-ng or none

## Installer behaviour

A single installer command is assumed (name is implementation detail). It performs:

### Detect

* compute current computer
* check for required binaries and assets at their declared paths
* verify hashes for anything present

### Consent

* list missing items
* list total download size
* list destination root
* require explicit acceptance before downloading

### Download and verify

For each binary or asset:

* download into a temporary file inside caterer/<hear|say>/circumstances/tmp/
* verify sizeBytes when provided
* compute SHA-256 and match sha256
* move into final path using atomic rename when possible

Downloads and build outputs live under `caterer/<hear|say>/building/` and are not tracked.

### Source builds

For linux-x64 whisper.cpp, build and stage binaries with:

* `command/build_whisper_cpp_linux_x64.sh`

The script writes:

* `caterer/hear/binary/linux-x64/whisper-main`
* `caterer/hear/binary/linux-x64/whisper-stream` (when SDL2 is available)

### Extract

When extract is present:

* extract into a temporary directory
* move only declared outputs into final paths
* remove temporary directory

### File permissions

On Unix:

* if output entry has chmodX true, set executable bit

### Self test

After installation, run:

Hear:

* whisper-main --help exit code success
* optional: transcribe a tiny bundled wav sample and confirm non-empty text output

Say:

* piper --help exit code success
* piper synth test:

  * provide short text
  * output raw PCM or wav
  * confirm bytes written

### Record circumstances

Write caterer/<hear|say>/circumstances/installed.pya:

This file is a **pyash map** (per `30-data-formats.md`). The only pure JSON
file in this subsystem is the Piper voice `.json` sidecar.

Required entries (as sentences in the map):

* `su name schemaVersion ob num <n> ya`
* `su name pack be established during date "<ISO 8601 timestamp>" ya`
* `su name computer ob text "<computer>" ya`
* `su name <tool-id> ob text "<tool-version>" with name license ti name "<license>" be tool ya`
* one `be binary ya` sentence per installed binary
* one `be asset ya` sentence per installed asset

Example (Pyash map, shortened):

```pyash
su name caterer say installed be map def
  su name schemaVersion ob num 1 ya
  su name pack be established during date "2025-05-07T12:00:00Z" ya
  su name computer ob text "linux-x64" ya
  su name piper ob text "1.2.0" with name license ti name "MIT" be tool ya
  su name binary piper to filename "caterer/say/binary/linux-x64/piper" accordingto name sha256 fromtext text "aaaaaaaa...cccc" by num 1234567 be binary ya
  su name asset en_US-amy to filename "caterer/say/vocalization/piper/en_US-amy/voice.onnx" accordingto name sha256 fromtext text "bbbbbbbb...dddd" by num 9876543 be asset ya
prah
```

## Selection rules for runtime

The speech bridge resolves tools in this order:

Hear:

1. vendored whisper-main in caterer/hear/binary/<computer>/
2. optional system fallback if enabled by configuration

Say:

1. vendored piper in caterer/say/binary/<computer>/
2. vendored espeak-ng if piper missing and fallback enabled
3. optional system fallback if enabled by configuration

Templates and vocalizations resolve from caterer paths by default. Overrides require explicit configuration.

## Update policy

Manifesto updates must:

* bump tool version and reform date
* update url, sha256, sizeBytes for changed items
* preserve old ids for assets when content stays identical
* treat any sha256 change as a new asset id unless it is a corrected hash for the same bytes

Installer modes:

* ensure: install missing items only
* verify: hash-check current items only
* upgrade: reinstall when version differs or hashes differ

## Licence handling

Store tool licences in:

* caterer/hear/license/
* caterer/say/license/

Store vocalization licences in:

* caterer/say/license/vocalization/

Installer prints a short licence summary and points to the local files.

## Appendix: whisper-stream optionality

whisper-stream is optional. If it has external runtime requirements on a given platform, the installer may skip it and record this in circumstances. Runtime continues using whisper-main with chunked audio feeding policies implemented in the bridge.
