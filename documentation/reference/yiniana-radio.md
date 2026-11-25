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

`module/hymn_manuscript.pya` turns the card into a hymn manuscript with the
shape of the Yiniana reference song:

```
[Verse] [Verse] [Chorus] [Verse] [Chorus] [Bridge] [Chorus] [Outro]
```

There is no intro. The sheet is plain bracketed-tag text, and each tag opens
its own line.

**The model writes each distinct piece once; the code assembles the song.**
Seven sections are generated — three verses, one chorus, a bridge, an outro and
one closing line — and the arrangement, the repeats and the tag vocabulary are
the code's job:

- the chorus is one four-line stanza whose first line is the hook,
- the second chorus is the first chorus verbatim,
- the third chorus is the first chorus's first three lines plus one rewritten
  closing line,
- the outro is three short lines.

`hymn sheet assemble` is that assembly, and it is exported, so the sheet format
is testable without a model in the loop.

The tag vocabulary is the reference's, because it is measurable: the same words
and the same seed, with `[Verse]/[Chorus]/[Bridge]/[Outro]` spelled that way,
give a 13.8 s lead-in and a 7.0 s worst stall, while `[verse 1]/[chorus]`
gives a 6.3 s lead-in and a 14.5 s worst stall. Lower-case, numbered tags are
not a cosmetic choice.

**Density is the dominant cause of a bad render.** The reference song carries
353 words over 175 s, which is 2.0 words per second. The sheet this module used
to write carried about 110 words, and at that sparsity the model drags the
verses to 0.6 words per second and slams the chorus to 3, which is the
"drawn out, then rushed out of sync" symptom. The section prompts ask for
44–56 words per verse and 42–52 for the chorus, and the deterministic checks
hold the sections inside a wide band around those targets.

**The gates rate, they do not fail.** Every verifier — imagery, communal voice,
source thrust — returns HIGH, MID or LOW, and HIGH or MID passes. A LOW is
recorded as a note and the pipeline keeps the best value it has. There is no
fatal guarantee left in the module: a song that is not quite right still gets
written, because the radio station needs songs more than it needs perfect ones.
The one gate that stays hard is structural: the sheet's section order and the
chorus's four lines, because the assembly reads them.

Measured on the dignity card:

| | old sheet | reference sheet | sheet today |
|---|---|---|---|
| sections | intro, verse, chorus, verse, chorus, bridge, chorus, outro | verse, verse, chorus, verse, chorus, bridge, chorus, outro | verse, verse, chorus, verse, chorus, bridge, chorus, outro |
| words | about 110 | 353 | about 320 |
| words per second over 175 s | 0.6 | 2.0 | about 1.8 |
| hook occurrences | 8 | 3 | 3 |
| chorus lines repeated verbatim | hook and echo, 3 times each | none | none |

The old `ACE-Step parses [verse 1] as the section "verse" with the numbering
stripped` claim was wrong: the tag is what the model reads, and how it is
spelled changes the render.

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
| ACE-Step 1.5 XL turbo | `acestep_v1.5_xl_turbo_bf16.safetensors` | 175 s | The station engine. Its graph is the Yiniana reference's own graph |
| YuE2 | `yue2_3b_int8_convrot.safetensors` | 175 s | A comparison engine: off mode, empty abc, `full` melody and chords |

**ACE-Step turbo is the station's text-to-music flow.** `music workflow default`
in `configure/default.pya` names it, so `be music say do` renders with it and
nothing else has to be chosen. YuE2 is kept as a comparison engine — it is
reachable by naming its workflow, but it is not part of the flow.

### The reference graph

`music/comfyui/audio_ace_step_1_5_xl_turbo.json` is the ComfyUI prompt graph
that produced the Yiniana reference song, taken from that song's own ID3 tags.
The reference's mp3 carries the full API prompt it was rendered with, so the
station renders on the same graph rather than on a lookalike:

- `UNETLoader` + `DualCLIPLoader` (`qwen_0.6b_ace15` + `qwen_4b_ace15`) +
  `VAELoader` for the models,
- `TextEncodeAceStepAudio1.5` for the style caption and the lyrics,
- `EmptyAceStep1.5LatentAudio` for the length,
- `ModelSamplingAuraFlow` at shift 3 and `KSampler` at 8 steps, cfg 1.0,
  euler/simple,
- `SaveAudioMP3` at V0.

One seed feeds both halves of the render. The sampler seed and the text
encoder's seed are the same `PrimitiveInt` node, so the audio codes the
language model writes and the noise the sampler consumes come from one seed.
The old workflow gave the two halves different seeds.

The length lives in two places — the text encoder's `duration` and the
latent's `seconds` — and the runner writes the same number to both.

### Running an engine

```sh
PYA_GPU_HOUSEKEEPER_URL=http://localhost:18886 \
  node command/music_comfyui_runner.mjs \
  --lyrics "$(cat radio/lyrics/song-dignity.txt)" \
  --workflow-name audio_ace_step_1_5_xl_turbo \
  --workflow-root ./music/ \
  --host http://localhost:8188 \
  --options-json '{"seed":20261125,"maxDuration":175}' \
  --output radio/audio/ace-step-dignity.mp3
```

No `--style` is passed, so the workflow's own caption — the station style — is
what plays.

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

An explicit discharge from another session still reaches the runtime, and a
seven-minute render can still be cut short by one. The runner therefore repeats
a render that was interrupted: the Housekeeper reports an interrupted run as a
failed job, so the runner recognises that shape of failure and tries again with
the same seed, which produces the same song. `PYA_COMFYUI_ATTEMPTS` sets how
many tries are allowed (default 3).

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

Measured on the pre-restructure dignity hymn with the station style, 180 s,
ACE-Step XL turbo:

- the file is a real mp3 — ID3v2.4, MPEG layer III, 192 kbps, 48 kHz stereo;
- duration 180.02 s;
- 113 of 119 4-grams recovered (95.0 %).

Measured on the same hymn, 175 s, YuE2:

- a real mp3, 192 kbps, 48 kHz stereo;
- duration 175.03 s;
- 107 of 119 4-grams recovered (89.9 %).

The missing 4-grams are the intro-to-verse seam, one re-worded line
("warm bread breaks soft" was sung as "warm bread breaks off") and, on the
YuE2 render, the outro's last line.

Measured on the restructured sheet, 180 s, ACE-Step XL turbo, station style:

- a real mp3 — ID3v2.4, MPEG layer III, 192 kbps, 48 kHz stereo;
- duration 180.02 s;
- 167 of 167 4-grams recovered (100.0 %).

The restructured sheet is longer than the old one, so it carries more 4-grams
(167 against 119). The render is clean: the engine sang every line of the sheet
back. The only thing it added was a second pass over the outro's hook line.

A caution on the transcriber: Qwen3-ASR heard 63 % of the ACE-Step song's
4-grams and mis-heard "dignity" as "tragedy". Whisper large-v2 heard 94.1 % of
the same audio. Measure recovery with a transcriber that can sing, and treat a
low number as a question about the transcriber first.

### The style prompt

The style prompt is the station's voice. The two workflow files carry it as
their default caption, byte-identical to claudia's `radio/style.txt`:

```
electronic symphony, electroclash techno, 128 bpm, D minor, mature adult European
female vocals, mid-30s voice, low monotone speech-singing verses, warm low-mid
timbre, indie pop attitude, crisp mid-range sung chorus, orchestral strings,
epic brass stabs, cinematic builds, choir pads, heartbeat rhythm, lub-dub
double-kick pulse, deep sub kick, acid bassline, supersaw stabs, instant opening
chorus, key change into final chorus
```

`instant opening chorus` is the one tag the Yiniana reference carries that the
station style did not. It asks the model to open on the chorus instead of
building towards it, which is what a rendered "cinematic builds" intro sounds
like: a long instrumental runway before the first word.

The runner's `--style` overrides that default. A render that is meant to
represent the station should not pass `--style` at all, so the shipped default
is what actually plays.

Every rendered mp3 carries its own ComfyUI prompt in the ID3 `TXXX` tag, so
the file says what produced it. Read the tag when a render does not sound like
the station and the cause is usually the prompt that was passed.

## 7. Existing Quiz Coverage

- `quiz/yiniana_lyrics_chain.test.mjs` — the corpus walk, the topic pattern, the atomic write, the card read, the song structure verifier.
- `quiz/yiniana_lyric_recovery.test.mjs` — tag stripping, n-gram counting, the three transcript shapes.
- `quiz/music_comfyui_runner.test.mjs` — the workflow and mapping pairs, node detection, the mapping spellings, the save format, and the byte sniffing.
- `quiz/music_say.test.mjs` — the verb side of the music surface.
