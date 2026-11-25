# Music Module Profile

Status: reference profile for music generation surfaces used by `module/music_video.pya` and `be music say do`.

## 1. Purpose

Provide a stable contract for:
- `music video` pipeline assembly from an audio source, and
- `music say` lyric+style audio generation (ComfyUI-backed).

This document is non-normative reference guidance for implementers and test authors.

## 2. Surfaces

- Module export: `module/music_video.pya` (`exists su name music video be export ya`).
- Built-in verb: `be music say do` (`program/verbs/music_say.mjs`).

## 3. Music Video Signatures

Module-level ceremonies currently expose these call shapes:

```pyash
su name out from filename "input.wav" be music video do
su name out from filename "input.wav" to filename "artifacts/video/out.mp4" be music video do
su name out from filename "input.wav" be music video wide do
su name out from filename "input.wav" to filename "artifacts/video/out-wide.mp4" be music video wide do
```

Behavior notes:
- `music video wide` temporarily sets `draw widescreen mode` to `truth` for the invocation and restores it to `lie` after completion.
- `to filename` forms copy the generated result to the requested destination and return that destination filename.

## 4. Music Video Pipeline Contract

`music video` orchestrates the following stage classes:
1. preflight discharge (`mind`, `draw`, `hear`, `qwen say`),
2. transcribe audio to `captions.srt`,
3. cut captions into itinerary windows,
4. promptify visual scene prompts from cuts,
5. generate title, thumbnail heading, and description from transcript text,
6. generate draw images (shorts or widescreen size according to mode),
7. render thumbnail and burn heading,
8. concatenate scene cuts into `music-video.mp4`,
9. apply subtitles via `footnote by mode` into `music-video-footnote.mp4`,
10. burn opening heading, then return final `music video` filename payload.

Current artifacts root:
- `artifacts/<run id>/...` when `run id` exists,
- `artifacts/manual/...` when `run id` is missing.

## 5. Footnote and Layout Defaults

The module imports shared helpers from `module/video_common.pya`:
- `current thumbnail heading y ratio`
- `current video heading y ratio`
- `current subtitle margin ratio`
- `current footnote mode`
- `footnote by mode`

This keeps subtitle/heading/footnote mode logic aligned with teaching-video and avoids module-local branch drift.

## 6. Music Say Signature Profile

Built-in `music say` supports text or named-text lyrics, optional style prompt (`fromtext`), optional options map (`with name <map>`), and optional output filename.

Canonical form:

```pyash
su name out
  fromtext text "ambient cinematic"
  ob text "hello world lyric"
  with name opts
  to filename "artifacts/music/song.mp3"
be music say do
```

Supported options map value primitives: `text`, `num`, `boolean`.

## 7. Music Say Runtime Contract

- Host resolution order:
  1. `music host`
  2. `say host`
  3. `draw host`
  4. fallback `http://localhost:8188`
- Workflow root default: `music workflow root` or `./music/`.
- Workflow default name: `music workflow default` or `audio_ace_step_1_5_xl_turbo`.
- Missing lyrics is deterministic failure: `music say defective: missing lyrics`.

Outputs:
- Writes an mp3 audio file by default. The extension names the container the bytes really carry: the runner sniffs what ComfyUI produced and refuses to write a file whose name contradicts its bytes.
- Writes adjacent `.metadata.json` with canonical JSON fields including:
  - `kind`, `backend`, `workflow`, `host`, `inputSha256`, `outputSha256`, `format`, `streaming`, `options`.
- `format` is read from the output extension, so the metadata never claims a format the file does not carry.
- Records artifacts through exchange artifact recording (`kind: say`, metadata artifact kind).

## 8. Music Runner Contract

`command/music_comfyui_runner.mjs` submits the ComfyUI prompt through the GPU
Housekeeper first (`submitManagedGpuJob`, job kind `comfyui-prompt`, VRAM
request 12000 MB, profile name = the workflow name). The direct ComfyUI
`/prompt` call is a fallback for hosts with no Housekeeper configured, and the
runner never takes that path when a Housekeeper URL is reachable.

The runner resolves the graph fields it may override from the companion `.pya`
mapping, then falls back to node-type detection: `AceStepSFTTextEncode`,
`YuE2GenerateMusic` and `TextEncodeAceStepAudio1.5` carry lyrics and style;
`AceStepSFTGenerate` and `KSampler` carry the sampler fields;
`EmptyYuE2LatentAudio` and `EmptyAceStep1.5LatentAudio` carry the length;
`AceStepSFTSaveAudio`, `SaveAudioOpus` and `SaveAudio` carry the output.

Option names are accepted in camel case, snake case and spaced form, so
`voiceBoost`, `voice_boost` and `voice boost` are the same option.

The radio chain and the two engines it drives are described in
`documentation/reference/yiniana-radio.md`.

## 9. Existing Quiz Coverage

- `quiz/music_video_signatures.test.mjs` validates module signature registration and resolution.
- `quiz/music_say.test.mjs` validates output writing, options-map propagation, and interpreter signature path.
- `quiz/music_comfyui_runner.test.mjs` validates the workflow and mapping pairs, node detection, the mapping spellings, the save format, and the byte sniffing.
- `quiz/comfyui_admin_guard.test.mjs` validates that a discharge does not cancel a ComfyUI job another surface is running.
