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
  to filename "artifacts/music/song.opus"
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
- Workflow default name: `music workflow default` or `audio_ace_step_1_5_checkpoint`.
- Missing lyrics is deterministic failure: `music say defective: missing lyrics`.

Outputs:
- Writes `.opus` audio file.
- Writes adjacent `.metadata.json` with canonical JSON fields including:
  - `kind`, `backend`, `workflow`, `host`, `inputSha256`, `outputSha256`, `format`, `streaming`, `options`.
- Records artifacts through exchange artifact recording (`kind: say`, metadata artifact kind).

## 8. Existing Quiz Coverage

- `quiz/music_video_signatures.test.mjs` validates module signature registration and resolution.
- `quiz/music_say.test.mjs` validates output writing, options-map propagation, and interpreter signature path.
