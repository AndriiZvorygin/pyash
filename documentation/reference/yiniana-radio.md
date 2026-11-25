# Yiniana Radio Chain

Status: reference for the local radio station that turns channeling notes into songs.
Covers the lyrics chain (phase 1) and the music engines (phase 2). The Icecast
station itself (phase 3) is not in this document yet.

## 1. Purpose

The station is a three-step chain. Each step owns one job and hands a file to
the next:

1. **Read** — pull the teaching around a topic word out of the channeling corpus.
2. **Teach** — turn that excerpt into a learnteaching card.
3. **Sing** — turn the card into a hymn manuscript, then into an mp3.

The lyrics are made by pyash itself. A separate lyrics agent was tried and
folded back into pyash, because pyash already owns every step of it.

## 2. Surfaces

- Helper command: `command/yiniana_lyrics_chain.mjs` — steps 1 and 2, plus the song verifier.
- Program: `examples/pyash/yiniana-radio-lyrics.pya` — all three steps, wired as pyash sentences.
- Lanes: `radio/topics.txt` — the curated topic rotation.
- Music engines: `music/comfyui/audio_ace_step_1_5_xl_turbo.*`, `music/comfyui/audio_yue2_own_melody.*`.
- Recovery check: `command/yiniana_lyric_recovery.mjs`.

## 3. Folder Contract

Everything the chain produces lands in one folder, named by topic:

```
radio/lyrics/source-<topic>.txt     the corpus excerpts
radio/lyrics/teaching-<topic>.txt   the learnteaching card
radio/lyrics/song-<topic>.txt       the hymn manuscript
radio/audio/<engine>-<topic>.mp3    the rendered song
```

Topics are single words. `slugifyTopic` throws on anything else, because the
helper and the `.pya` program build these names independently and must agree.

`radio/lyrics/` and `radio/audio/` are generated and gitignored. `radio/topics.txt`
is the tracked part.

## 4. The Lyrics Chain

### Step 1 — read

`collectTopicExcerpts` walks `/home/htaf/channelingtxt` and keeps the lines
around each match of the topic word. The corpus holds year folders reached
through symlinks, so the walker follows links. The step is bounded on purpose:
at most 40 files, at most 2 context lines per match, at most 96 KB of source.
For "dignity" that is 29 files, 33 matches and 88 KB.

### Step 2 — teach

`runLearnPipeline` spawns `command/learn_from_filename_pipeline.mjs` and reads
the card back out of its stdout. `validateLearnCard` checks the card carries
its ten contract headings before the step is allowed to succeed.

### Step 3 — sing

`module/hymn_manuscript.pya` turns the card into a hymn manuscript: an intro, a
verse, a chorus, a second verse, a chorus, a bridge, a chorus and an outro,
with the hook recurring in the intro, the choruses and the outro. The sheet is
plain bracketed-tag text.

ACE-Step parses `[verse 1]` as the section "verse" with the numbering stripped,
so the manuscript is fed to the engine as it is. No tag adapter is needed.

### Running it

```sh
cd /home/htaf/pyac/pyash
PYA_GPU_MIND_QUEUE=truth PYA_GPU_HOUSEKEEPER_URL=http://localhost:18886 \
  node command/run_pya_program.mjs examples/pyash/yiniana-radio-lyrics.pya \
  ob text dignity to name topic ya ob text radio to name radio_dir
```

The helper can also be run on its own:

```sh
node command/yiniana_lyrics_chain.mjs dignity radio
node command/yiniana_lyrics_chain.mjs --verify-song radio/lyrics/song-dignity.txt
```

## 5. The Music Engines

Both engines are ComfyUI API prompt graphs with a companion `.pya` mapping that
names the graph fields. The mapping spells its keys in words (`voice boost
path`); the runner asks for them in camel case (`voiceBoostPath`) and the two
spellings meet.

| Engine | Checkpoint | Length | Notes |
|---|---|---|---|
| ACE-Step 1.5 XL turbo | `acestep_v1.5_xl_turbo_bf16.safetensors` | 180 s | Turbo preset: steps 8, cfg 1.0, ode, shift 3 |
| YuE2 | `yue2_3b_int8_convrot.safetensors` | 175 s | off mode: empty abc, `full` melody and chords |

Both write mp3 at 192 k through `AceStepSFTSaveAudio`.

The ACE-Step workflow is self-contained: the style BPM comes from a
`PrimitiveInt` node, not from a reference track in the ComfyUI input folder.

### Running an engine

```sh
PYA_GPU_HOUSEKEEPER_URL=http://localhost:18886 \
  node command/music_comfyui_runner.mjs \
  --lyrics "$(cat radio/lyrics/song-dignity.txt)" \
  --style "acoustic worship ballad, warm felt piano, ..." \
  --workflow-name audio_yue2_own_melody \
  --workflow-root ./music/ \
  --host http://localhost:8188 \
  --options-json '{"seed":20261125,"maxDuration":175}' \
  --output radio/audio/yue2-dignity.mp3
```

The runner goes through the GPU Housekeeper first. The direct ComfyUI `/prompt`
call survives only as a fallback for when no Housekeeper is configured.

### One ComfyUI, four surfaces

The draw, say, hear and music surfaces all run on the same ComfyUI container
(`draw host` is `http://mriczo:8188`, `say host` and `music host` are
`http://localhost:8188`). An interrupt aimed at one of them lands on the whole
runtime.

A render is not a quick call: the ACE-Step track takes about ninety seconds,
the YuE2 track about seven minutes. Before the shared-runtime guard, any pyash
say or draw discharge cancelled the running render — `music say` alone fired
four global interrupts, and a YuE2 render died 191 seconds in, at 46 % of its
sampling.

`program/motor/comfyui_admin_guard.mjs` now asks the GPU Housekeeper whether a
ComfyUI job is running before the draw and qwen-say discharges interrupt the
runtime. A discharge that would cancel someone else's work is skipped and says
so; an explicit `restart` or `stop` still interrupts, because that is what it
was asked to do.

### Lyric budget

A 175 s YuE2 song carries about 235 lyric words. Above that the ending is
where the song runs out, so a sheet longer than the budget loses its outro
rather than a verse. The 130 wpm ceiling is not the binding constraint.

## 6. Verification

A rendered song can look right and still have lost its words. The check is the
share of the sheet's 4-grams that a transcription carries back:

```sh
node command/yiniana_lyric_recovery.mjs radio/lyrics/song-dignity.txt transcript.json
```

The transcript may be plain text, the JSON the hear runner prints, or Whisper's
segment list.

Measured on the dignity hymn, 180 s, ACE-Step XL turbo:

- the file is a real mp3 — ID3v2.4, MPEG layer III, 192 kbps, 48 kHz stereo;
- duration 180.02 s;
- 112 of 119 4-grams recovered (94.1 %).

Measured on the same hymn, 175 s, YuE2:

- a real mp3, 192 kbps, 48 kHz stereo;
- duration 175.03 s;
- 106 of 119 4-grams recovered (89.1 %).

The missing 4-grams are the intro-to-verse seam, one re-worded line
("warm bread breaks soft" was sung as "warm bread breaks off") and, on the
YuE2 render, the outro's last line.

A caution on the transcriber: Qwen3-ASR heard 63 % of the ACE-Step song's
4-grams and mis-heard "dignity" as "tragedy". Whisper large-v2 heard 94.1 % of
the same audio. Measure recovery with a transcriber that can sing, and treat a
low number as a question about the transcriber first.

## 7. Existing Quiz Coverage

- `quiz/yiniana_lyrics_chain.test.mjs` — the corpus walk, the topic pattern, the atomic write, the card read, the song structure verifier.
- `quiz/yiniana_lyric_recovery.test.mjs` — tag stripping, n-gram counting, the three transcript shapes.
- `quiz/music_comfyui_runner.test.mjs` — the workflow and mapping pairs, node detection, the mapping spellings, the save format, and the byte sniffing.
- `quiz/music_say.test.mjs` — the verb side of the music surface.
