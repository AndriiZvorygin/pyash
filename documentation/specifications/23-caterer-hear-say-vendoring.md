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
