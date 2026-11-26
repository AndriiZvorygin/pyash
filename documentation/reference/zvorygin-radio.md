# Zvorygin Radio Chain

Status: reference for the local radio station that turns channeling notes into songs.
Covers the lyrics chain (phase 1), the music engines (phase 2) and the radio
stage that plays the rendered catalogue (phase 3, section 6).

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
- Station command: `command/yiniana_radio.mjs` — the radio stage, the http stream.
- Station program: `examples/pyash/yiniana-radio.pya` — the station, wired as pyash sentences.
- Producer command: `command/yiniana_producer.mjs` — the songs the station is missing.
- Producer program: `examples/pyash/yiniana-radio-producer.pya` — the producer, wired as pyash sentences.
- Tag command: `command/yiniana_tag_catalogue.mjs` — the tags a player reads on every song of the catalogue.
- Tag program: `examples/pyash/yiniana-radio-tags.pya` — the tags, wired as pyash sentences.
- Transcript command: `command/yiniana_transcribe_catalogue.mjs` — the words the house heard, kept with the songs.
- Transcript program: `examples/pyash/yiniana-radio-transcribe.pya` — the transcripts, wired as pyash sentences.
- Name command: `command/extract_song_name.mjs` — the name the mind gave a song, read back as a title.
- Name program: `examples/pyash/yiniana-radio-song-name.pya` — the name of a song, wired as pyash sentences.
- Hook command: `command/song_hook.mjs` — the line a song sings again in every chorus.
- Lanes: `radio/topics.txt` — the curated topic rotation.
- Music engines: `music/comfyui/audio_ace_step_1_5_xl_turbo.*`, `music/comfyui/audio_yue2_own_melody.*`.
- Recovery check: `command/yiniana_lyric_recovery.mjs`.

## 3. Folder Contract

Everything the chain produces lands in one folder, named by topic:

```
radio/lyrics/source-<topic>.txt     the corpus excerpts
radio/lyrics/teaching-<topic>.txt   the learnteaching card
radio/lyrics/song-<topic>.txt       the hymn manuscript
radio/lyrics/name-<topic>.txt       the name of the song
radio/audio/<engine>-<topic>.mp3    the rendered song
```

Topics are single words. `slugifyTopic` throws on anything else, because the
helper and the `.pya` program build these names independently and must agree.

`radio/lyrics/` and `radio/audio/` are generated and gitignored. The tracked
part is three files:

```
radio/topics.txt     the lanes of the rotation: one topic per line
radio/rotation.txt   the order the station plays: the songs that came first
radio/imports.txt    the songs the house made before the radio
```

The engine of a song is the prefix of its name. `ace-step` and `yue2` are the
music engines, and `az` is Andrii Zvorygin, the house's own voice, for the
songs the house made before the radio.

The lanes are the corpus's own vocabulary, chosen by how widely a word is
spread across the channelings: 1788 files, 34 MB, and every lane is
supported by material in at least forty separate sessions, so no lane runs
dry. The order of the lanes is the programme: the heart of the material
first, the wider edges after.

A song of the house carries its own sheet, named for the song
(`song-az-god-remembers.txt`), so two songs about the same theme do not fight
over one file. A song of the rotation carries the sheet of its lane
(`song-dignity.txt`).

Experiments live beside the contract, never in it:

```
radio/audio-experiments/<engine>-<topic>-<variant>.mp3   a render under test
radio/lyrics-experiments/song-<topic>-<variant>.txt        its sheet
```

Both folders are gitignored. They are kept on disk so a render can be listened
to again, and they are kept out of the rotation so a try does not become the
programme. See §6, *The rotation contract*.

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
its contract headings before the step is allowed to succeed.

The card has a **depth**, and the radio asks for the lean one:

| Depth | Headings | Who wants it |
| --- | --- | --- |
| `full` | ten | the house's teaching workflows |
| `radio` | six | the songs |

The radio card keeps SEED CONCEPT, CARDINAL TRAINING SENTENCE, TEACHING
PROGRESSION, CAUSATIVE AND CONSEQUENCE, CARDINAL SCENES AND IDIOMS and BRIEF
MEMORY PHRASES — what the teaching is, the line that can be sung back, how it
unfolds, what follows from what, the pictures it draws and the short phrases
that become a refrain. It leaves out ORTHOGONAL FEATURES, SURPRISES AND
MISUNDERSTANDINGS, AFFAIRS OR ACTIVITIES and CONCEPT RELATIONS, because a song
never reads them.

`radio card depth` says which card the radio writes; it is `radio` at the
moment. The depth reaches the pipeline as `PYA_RADIO_CARD_DEPTH`, and each
depth has its own examples:

| Depth | Direct | Chunk card | Merge and refine |
| --- | --- | --- | --- |
| `full` | `learn-direct-from-filename.pya` | `learn-extract-card-from-filename.pya` | `learn-merge-refine-cards-from-filename.pya` |
| `radio` | `learn-radio-direct-from-filename.pya` | `learn-radio-extract-card-from-filename.pya` | `learn-radio-merge-refine-cards-from-filename.pya` |

The card a topic already has is kept when it is the card the radio wants: a
card that carries another depth's headings is written again, and a card of the
right depth is never written twice. The card is the slow part of the chain, so
this is the difference between a retry that costs a minute and a retry that
costs seven.

### Step 3 — sing

`module/hymn_manuscript.pya` turns the card into a hymn manuscript with the
shape of the house reference song:

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

| | old sheet | reference song | sheet today |
|---|---|---|---|
| sections | intro, verse, chorus, verse, chorus, bridge, chorus, outro | verse, verse, chorus, verse, chorus, bridge, chorus, outro | verse, verse, chorus, verse, chorus, bridge, chorus, outro |
| words | about 110 | 353 | 299 |
| words per second over 175 s | 0.6 | 2.0 | 1.7 on the sheet, 1.94 sung |
| lead-in | 0 s | 13.8 s | 7.1 s |
| longest stall | 18.1 s | 7.0 s | 7.6 s |
| hook occurrences | 8 | 3 | 3 |
| chorus lines repeated verbatim | hook and echo, 3 times each | none | none |
| 4-grams recovered | 113/119, 95.0 % | 247/270, 91.5 % | 196/222, 88.3 % |

The render of that sheet sings all eight sections in order and ends on the
outro's crux. The song fills its 175 s: singing runs from 7.1 s to 175 s.

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
| ACE-Step 1.5 XL turbo | `acestep_v1.5_xl_turbo_bf16.safetensors` | 175 s | The station engine. Its graph is the house reference's own graph |
| YuE2 | `yue2_3b_int8_convrot.safetensors` | 175 s | A comparison engine: off mode, empty abc, `full` melody and chords |

**ACE-Step turbo is the station's text-to-music flow.** `music workflow default`
in `configure/default.pya` names it, so `be music say do` renders with it and
nothing else has to be chosen. YuE2 is kept as a comparison engine — it is
reachable by naming its workflow, but it is not part of the flow.

### The reference graph

`music/comfyui/audio_ace_step_1_5_xl_turbo.json` is the ComfyUI prompt graph
that produced the house reference song, taken from that song's own ID3 tags.
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

### The seed is a lottery

The same sheet, the same style, the same workflow and the same graph can come
back with the words or come back instrumental. Measured on the reference-shape
sheet, seed 20261125:

| seed | what came back |
|---|---|
| 20261125 | instrumental for the first 156 s; only the outro was sung (7 words) |
| -36606723980325 | the lyrics, sung in order from 16.6 s |
| 424242 | the lyrics, sung in order from 30.0 s |

Nothing in the graph differs between those three runs — same nodes, same
settings, same 175 s latent, only the `PrimitiveInt` value. So a render cannot
be trusted on its own: the station has to **audition the seed**. Render a few,
transcribe each, and keep the one that carries the words.

That is the same reason the lyric-recovery check exists. A render can look
right and still have lost its words, and the recovery number is what tells the
two apart.

### Lyric budget

The reference song carries 353 words over 175 s, which is 2.0 words per second.
That is the number to aim at. The old sheet carried about 110 words, and the
model answered the shortage by dragging the verses to 0.6 words per second and
ramming the chorus to 3 — the "drawn out, then rushed out of sync" symptom.

The reference-shape sheet carries 325 words, which is 1.86 words per second, and
the render sings at 2.1 words per second overall with a 16.6 s lead-in against
the reference's 13.8 s.

The YuE2 budget of about 235 words was measured on the old sheet and does not
transfer. Above the budget the ending is where the song runs out, so a sheet
longer than the budget loses its outro rather than a verse; the 130 wpm ceiling
is not the binding constraint.

## 6. The Radio Stage

The station is a plain HTTP mp3 stream served by pyash itself. It plays the
rendered catalogue the way a radio plays: one programme, many listeners, and
the song changes by itself. There is no Icecast and no liquidsoap — the
station is a few hundred lines of Node and a small frame reader.

### The pieces

- `program/library/radio/mp3.mjs` — the frame reader: frame headers, duration, frame clock.
- `program/library/radio/id3.mjs` — the tag at the head of a file: the title a song carries, the tags a player reads, written and read.
- `program/library/radio/tags.mjs` — the tags of a song: who made it, what it belongs to, the day the audio was made, and the stamping of the songs of the catalogue.
- `program/library/radio/ticker.mjs` — the words of a song and the time they are sung: the transcript, the alignment, the placement, the sheet it falls back to, and the line that is sung now.
- `program/library/radio/placement.mjs` — the placement of the words of a sheet on the words that were heard: every line put where its own words were sung.
- `program/library/radio/catalogue.mjs` — the catalogue scan: which files are playable, which engine and topic each one carries, which lyric sheet belongs to it.
- `program/library/radio/rotation.mjs` — the rotation: the lanes, the engines, the names the station is contracted to play.
- `program/library/radio/station.mjs` — the programme: the loop, the fan-out to listeners, the now playing state.
- `program/library/radio/page.mjs` — the station page.
- `command/yiniana_radio.mjs` — the server.
- `module/radio_station.pya` — the pyash ceremony `radio station serve`.
- `examples/pyash/yiniana-radio.pya` — the example wiring.
- `quiz/yiniana_radio.test.mjs` — the quiz for all of the above.

### The shape of the stream

| Route | What it gives |
| --- | --- |
| `GET /stream.mp3` | the live programme: `audio/mpeg`, chunked, never ends |
| `GET /` | the station page: now playing, the catalogue, a tune-in button, a download for every song |
| `GET /playlist.json` | the catalogue with titles, engines, lengths and download urls |
| `GET /status.json` | the now playing state, its download url and the listener count |
| `GET /lyrics.json` | the words of the song that is playing, with the time of every line |
| `GET /events` | the words of the song, streamed in step with the audio the station sends |
| `GET /song/<name>` | the song itself, as an attachment a listener may keep |
| `GET /health` | the liveness check |

### Taking a song home

A radio that plays a song can be asked to hand it over, and this one does:
every song of the catalogue has a download link on the station page, next to
the song that is playing and next to every entry of the list.

The route is `GET /song/<name>`, and it is deliberately narrow, because the
station listens to the open internet:

- only a song of the programme can be downloaded — the name is looked up in
  the programme, not in the folder;
- the file is the one the catalogue names, inside the catalogue folder, and
  a name that carries a separator or a parent step is refused outright;
- the answer carries `Content-Disposition: attachment`, so a browser saves
  the mp3 rather than playing it in a tab;
- the file is offered under the name of the song, so *Lover Is Closer* is
  saved as `Lover Is Closer.mp3` and not under the lane it was made for.

The playlist and the status both carry the download url of their song, so a
player built on the json does not have to guess the route:

```json
{
  "filename": "az-compassion.mp3",
  "title": "Compassion",
  "topic": "compassion",
  "engine": "az",
  "durationSeconds": 140.064,
  "lyricSheet": "song-az-compassion.txt",
  "downloadUrl": "/song/az-compassion.mp3"
}
```

### The titles

A song's title is the name the house gave it. The songs the house made before
the radio existed carry their own name in the tag of the file: `az-mirror-stranger.mp3`
is *Lover Is Closer*, `az-fresh-light.mp3` is *Fresh Light for Valentina*.
A song that carries no name of its own is named by the lane it was made for,
written out: `ace-step-love.mp3` is *Love*, `ace-step-love-expands.mp3` is
*Love Expands*.

The title, the engine, the topic and the length travel with the song in the
playlist and in the now-playing state, so a listener always knows what they are
hearing. The lane stays the topic either way, so the programme still plays
the song it contracted to play.

### The name of a song

A song the house made before the radio existed carries a name the house wrote
by hand. A song the radio makes now would carry the name of its lane, which is
the name of the topic and not the name of the song. So the house asks for the
name.

`module/radio_song_name.pya` holds the ceremony `radio song name`, its prompt
and its mind. The ceremony takes the sheet of a song and gives back the name of
that song:

1. The mind reads the sheet and is asked for the title: the phrase the song
   repeats, shortened to its heart, in title case, taken from the words of the
   song itself.
2. `command/extract_song_name.mjs` reads the answer. A reply that cannot be
   read as a name — a sentence, a question, a paragraph — is not a name.
3. When there is no name, the house falls back on the line the song sings again
   in every chorus. `command/song_hook.mjs` finds that line: the first line of
   the first block of the sheet the sheet sings twice.

The reader is deliberately strict, because a title that is too long is not a
title. A name is at most ten words, one line, with the small words small:
*Love Expands the Light*, *Every Walk One in Christ*. A name that is longer
keeps its first clause — the part before the comma, or before the word that
joins two halves of a line — because that is where a song's meaning sits.

The name is written to `radio/lyrics/name-<topic>.txt`, beside the sheet, and
it is written once: a song that has a name keeps it. The producer reads the
name when it stamps the song, so the title in the player's tag is the name of
the song and not the lane it was made for. A song whose name cannot be asked
for keeps the lane, and the station says so.

```sh
cd /home/htaf/pyac/pyash-dev
node command/run_pya_program.mjs examples/pyash/yiniana-radio-song-name.pya \
  ob filename /home/htaf/pyac/pyash/radio/lyrics/song-presence.txt to name sheet ya \
  ob filename /tmp/name.txt to name target
```

### The tags of a song

A listener plays a song in a player, and a player shows what the file says
about itself. Every song of the catalogue therefore carries the tags of a
song in the tag of the file:

| Tag | Frame | What it says |
| --- | --- | --- |
| title | `TIT2` | the name of the song |
| artist | `TPE1` | who made it: *Andrii Zvorygin* for the songs of the house, *Zvorygin Radio* for the songs the station made for itself |
| album | `TALB` | *Zvorygin Radio*, the album every song belongs to |
| date | `TDRC` | the day the audio was made |
| comment | `COMM` | the station, the voice and the lane: *Zvorygin Radio · ACE-Step 1.5 XL turbo · grace* |

The day of a song is written once, when the song enters the catalogue: the
day of the source of an imported song, and the day the render finished for a
song the producer made. A later pass fills in what is missing and leaves the
day alone, because the file's own timestamp moves whenever the file is
touched.

The three places that put a song on the air write the tags: the import, when
it brings a song in; the producer, when it publishes a render; and the tag
command, which walks the catalogue and writes the tags of every song that
does not carry them yet.

```sh
cd /home/htaf/pyac/pyash-dev
PYA_RADIO_CATALOGUE=/home/htaf/pyac/pyash/radio/audio \
  node command/yiniana_tag_catalogue.mjs
```

or, as pyash sentences:

```sh
node command/run_pya_program.mjs examples/pyash/yiniana-radio-tags.pya
```

The tag is written in front of the same audio the station plays, and the
song is written beside the catalogue and renamed onto it, so a half written
song is never on the air.

### The words of the song

A listener wants to read along with the song. The words are the words of the
song, as they were written — and the times are the times the house heard them.

The hear lane is not the words. What it heard is kept with the song — the
transcript, `radio/lyrics/song-<topic>.srt` — but a word can come out of the
mouth of the song garbled, and what the machine heard is not what a listener
should read. So the house's own alignment does the work: the words of the
sheet, placed at the times of the transcript. It is the same alignment the
karaoke subtitles of the music videos use — lyric text with ASR time. The
aligned words are kept beside the sheet, in
`radio/lyrics/song-<topic>.aligned.srt`.

The lane hears the song in phrases of twenty seconds at most
(`PYA_HEAR_MAX_SEGMENT_SECONDS`), not the thirty seconds whisper writes by
default: the shorter the phrase, the closer the words of the song can be
placed against the song. A song heard that way gives a line every five to ten
seconds, which is what a ticker moves at.

#### A song the house could not align

The alignment refuses a song whose words it cannot trust: the anchor coverage
of the sheet against the transcript has to hold, and the house does not loosen
that bar for the karaoke videos, so it does not loosen it here either.

A refused song still has a transcript, and the transcript knows when the song
was sung. So the words of the sheet are placed on the words that were heard:
every line is looked for in the transcript, and put where its own words were
sung — a word that came out garbled is still recognised, and a line the song
never sang is left out, because a listener should not read words that are not
being sung. A song that sings its verses in another order than the sheet is
placed in the order it was sung.

This is the work of `program/library/radio/placement.mjs`, and it is what the
route reports as `source: "song"`.

#### The words in step with the music

The words are streamed to the listener with the music, on `GET /events`. The
station sends the song it is playing, the words of that song with the time of
every line, and the place that song takes in the audio it has sent; it sends
the clock of that audio four times a second.

The listener reads the words against the audio that has reached them, not
against the clock of the station. A browser holds a second or two of audio
before it plays it, and the words have to wait for that audio — so the page
measures the buffer of its own player and puts the words on the audio that is
being heard. The song that is called now playing is the song that is being
heard, and it changes with the music, not with a poll.

The route `GET /lyrics.json` serves the same words of the song that is
playing, for a listener that asks for them in one piece:

```json
{
  "station": "Zvorygin Radio",
  "filename": "ace-step-pleasure.mp3",
  "title": "Pleasure",
  "durationSeconds": 175.056,
  "source": "lyrics",
  "lines": [
    { "start": 0, "end": 14.9, "text": "We sit quietly in stillness to align with the Father above." },
    { "start": 14.9, "end": 23.1, "text": "Love returns a thousandfold when open hearts serve each other well." }
  ]
}
```

The page follows the song with them: a running ticker under the header, and
the line that is being sung with the one that follows it under the now
playing block.

The `source` says where the words come from: `lyrics` for the words placed at
the times by the house's alignment, `song` for the words placed on the words
that were heard, `sheet` for the words alone with an estimated timing, and
`none` for a song without words.

### The words of the songs that came before

The songs the house made before the radio were never heard by the machine, so
they have no transcript yet. The transcript command listens to them, and places
the words of their sheets at the times it heard them:

```sh
cd /home/htaf/pyac/pyash-dev
PYA_RADIO_CATALOGUE=/home/htaf/pyac/pyash/radio/audio \
  node command/yiniana_transcribe_catalogue.mjs
```

or, as pyash sentences:

```sh
node command/run_pya_program.mjs examples/pyash/yiniana-radio-transcribe.pya
```

It walks the catalogue, listens to the songs that have no transcript, and
keeps what it heard beside the sheet of the song. A song that was already
heard is left alone, and a song that cannot be heard does not stop the rest.

The words that were heard are kept even when the house refuses to align
them: the transcript is the record of the song, and it is what the words of
the sheet are placed on.

### Real time, not file speed

The station reads the frames itself and paces them. Every MPEG layer three
frame carries the same number of samples, so the frame index is the clock:
the station writes a piece of audio, waits for the frame clock to catch up,
and writes the next. The bytes that go out are the bytes that were rendered;
nothing is re-encoded and no external encoder is involved.

A listener who tunes in joins the song that is playing. A listener that
cannot keep up — its socket buffer passes 4 MB — is dropped rather than
allowed to hold the station back.

### Configuration

The settings live in the pyash configuration surface, in `configure/default.pya`:

| Fact | Default | Meaning |
| --- | --- | --- |
| `radio host` | `::` | the address the station binds |
| `radio port` | `8090` | the port the station listens on |
| `radio catalogue` | `radio/audio` | the folder of rendered songs |
| `radio station name` | `Zvorygin Radio` | the name on the page and in the status |
| `radio station command` | `node command/yiniana_radio.mjs` | the command the pyash ceremony runs |
| `radio song imports` | `radio/imports.txt` | the manifest of the songs the house made before the radio |
| `radio tags command` | `node command/yiniana_tag_catalogue.mjs` | the command the pyash ceremony runs to write the tags of the songs |
| `radio transcribe command` | `node command/yiniana_transcribe_catalogue.mjs` | the command the pyash ceremony runs to keep the words of the songs |

The environment overrides the same names: `PYA_RADIO_HOST`, `PYA_RADIO_PORT`,
`PYA_RADIO_CATALOGUE`, `PYA_RADIO_STATION_NAME`.

The default bind is every interface over both families — the station answers
on IPv4 and on IPv6 — so it can be tuned in from another machine on the house
network and from the tunnel. Set `radio host` to `127.0.0.1` when it should
only answer on this machine.

### The public address

The station is published at `https://radio.zvorygin.ca/stream.mp3`. The edge
is Caddy in Docker on the zvorygin host, and it reaches the station over the
house IPv6 tunnel:

```
radio.zvorygin.ca  ->  caddy (zvorygin)  ->  [eb22:3b21:2100:e8c1::]:8090  ->  the station (mriczo)
```

The DNS record is kept by the zvorygin DNS script, `~/byin/dns.zvorygin.ca.sh`
on the edge host, which publishes the A and AAAA records of every public site
in the `WEB_FQDNS` list. Caddy takes the certificate for the name through
ACME.

The Caddy block is in `~/hven/caddy/Caddyfile` on the edge host:

```
radio.zvorygin.ca {
	reverse_proxy [eb22:3b21:2100:e8c1::]:8090 {
		flush_interval -1
	}
}
```

`flush_interval -1` keeps the proxy from holding the programme back: the
stream is one long lived response.

### Keeping it playing

The station runs as a systemd user unit, `yiniana-radio.service`, so it
survives a logout and comes back after a crash:

```sh
systemctl --user status yiniana-radio
journalctl --user -u yiniana-radio -f
```

The unit lives in `~/.config/systemd/user/yiniana-radio.service`. It runs the
station from the `dev` checkout, and points the catalogue at the house
checkout, so a song rendered there joins the rotation without a restart:

```ini
[Service]
Type=simple
WorkingDirectory=/home/htaf/pyac/pyash-dev
Environment=PYA_RADIO_CATALOGUE=/home/htaf/pyac/pyash/radio/audio
ExecStart=/home/htaf/.nvm/versions/node/v24.22.1/bin/node command/yiniana_radio.mjs
Restart=always
RestartSec=5
```

### Running it

```sh
cd /home/htaf/pyac/pyash
node command/yiniana_radio.mjs
```

or, as pyash sentences:

```sh
node command/run_pya_program.mjs examples/pyash/yiniana-radio.pya
```

Then tune in with any player:

```sh
mpv http://127.0.0.1:8090/stream.mp3
ffplay http://127.0.0.1:8090/stream.mp3
```

or open `http://127.0.0.1:8090/` in a browser, where the page shows what is
playing and holds the same stream.

### The catalogue refreshes

The station rescans the catalogue every fifteen seconds. A render that lands
while the station is running joins the rotation without a restart, and a track
that has gone away is dropped from the rotation.

The lanes file and the rotation file are read again on every scan, so a new
lane joins the programme as well, without a restart. The only thing that asks
for a restart is a change to the code itself.

Measured: a song copied into the catalogue at 10:54:16 was in the playlist at
10:54:38, and the station's start time never changed.

### The rotation contract

The rotation is not "whatever is in the folder". It is the contract:

```
every lane of radio/topics.txt  ×  every engine of the `radio producer engines` map
+ every song radio/rotation.txt names
```

`rotationContract` reads the lanes file, the engine map and the rotation file
and builds the set of names, and the catalogue scan leaves everything else out.

That is what keeps the programme and the work list the same list. The producer
fills the lanes and the station plays the lanes, so the two can never drift
apart. The songs the rotation file names are the ones that came before the
radio: they are not lanes, so the producer never makes them again, and they are
still songs the station is allowed to play.

An experiment is a render whose name is not in the contract:
`ace-step-dignity-reference-shape.mp3` is a try at a seed, a shape and a
ballad, not a song of the rotation. Such a file stays on disk under
`radio/audio-experiments/` and the station does not play it. A station with no
contract — no lanes, no engines — plays everything it finds, so a station that
has lost its settings still plays something.

The station says the size of the contract and how much of it is rendered when
it starts:

```
yiniana radio: the rotation holds 129 song(s), 24 rendered
```

### The order of the programme

The station does not play in alphabetical order, and it does not play the same
programme twice. It keeps a bag of the songs and empties it before it fills it
again: every song of the rotation is heard once before any of them is heard
twice. The song that is playing is never put back into the bag, so a song
cannot come round twice in a row either.

The bag is shuffled when it is filled, so the programme is different every
time it comes round. The rotation file still decides *which* songs are in the
rotation and in what order the station lists them — the songs that came before
the radio first, then the lanes of the rotation — but the order they are
played in is the station's own choice.

## 7. The Producer

The station plays what has been rendered. The producer is what makes more.

- `command/yiniana_producer.mjs` — the producer.
- `module/radio_producer.pya` — the ceremony `radio producer run`.
- `examples/pyash/yiniana-radio-producer.pya` — the example wiring.
- `quiz/yiniana_producer.test.mjs` — the quiz.

### What one run does

1. **Pick.** The lanes of `radio/topics.txt`, in order. For each lane, every
   engine that has no song in the catalogue yet. The catalogue is the state: a
   song that already sits in `radio/audio/` is never made again, so the
   rotation fills lane by lane and the second engine of a lane reuses the
   sheet the first one wrote.
2. **Write.** The sheet for the topic, when the station does not have one yet:
   the corpus excerpts, the learnteaching card, the hymn manuscript. When the
   radio already holds the card the topic wants, only the hymn is written from
   it — the card is the slow part of the chain, so a retry that only lost the
   hymn costs a minute and not seven. Measured: a lane whose card was already
   on disk went from "writing the lyrics" to the first render in 1 min 18 s.
3. **Audition.** The seed is a lottery — the same sheet and graph came back
   instrumental for one seed and sung for two others. So the producer renders
   `radio producer seeds` seeds and keeps the one that carries the most of the
   words. The whole render is heard: the hear lane says what it hears, and the
   lyric recovery says how much of the sheet came back. An instrumental render
   answers "(upbeat music)" and recovers nothing.
4. **Name.** The song is named before it is sung: the house asks the mind for
   the name of the song in the sheet and keeps the answer beside the sheet, in
   `radio/lyrics/name-<topic>.txt`. A song that already has a name keeps it,
   and the name is asked once per song. See §6, *The name of a song*.
5. **Publish.** The winner is copied into the catalogue and renamed into
   place, so a half written song is never on the air. The song is stamped
   with the tags of a song — its name, the house that made it, and the day
   the render finished — before it is heard. The transcript of the render,
   the words the house heard, is kept beside the sheet of the song, so a
   listener can read along with it. The station's own catalogue scan takes
   the song from there, within the quarter of a minute.

A song whose best seed carries less than `radio producer min recovery` percent
of the words is not published. The lane stays open, and the next run tries
fresh seeds.

The seed is a whole number and never negative. The lottery draws from 0 to
2³²−1, because the YuE2 node takes its seed with a minimum of zero and
refuses a negative one: a negative seed fails the render instead of drawing a
different song. ACE-Step takes a negative seed, so the failure only showed up
when the producer reached the second engine of a lane.

### The producer runs until the rotation is full

One song costs about ten minutes of the GPU, so a producer that wakes every
two hours is not a radio filling up, it is a radio filling up by accident.
With `radio producer loop` on, the producer keeps going: it takes the next
lane, makes the song, publishes it, and takes the next lane, until the
catalogue holds every song of the rotation. Then it stops.

The systemd unit runs it that way:

```
Type=simple
Environment=PYA_RADIO_PRODUCER_LOOP=true
Restart=on-failure
RestartSec=60
```

The timer is the safety net: it wakes the producer again every six hours, so
a lane added to `radio/topics.txt` at noon is being made by the evening. A
timer that fires while the producer is already running does nothing, so there
is never a second producer on the same lane.

`radio producer pause seconds` puts a pause between songs. It is zero by
default: the render itself takes long enough to pace the work, and the GPU is
better spent on the next song than on waiting.

### The engines

`radio producer engines` says which engines make songs. It holds `ace-step`
alone at the moment: the YuE2 renders came back instrumental more often, they
take three times as long, and the variety the rotation needs comes from the
lanes, not from the engines. The YuE2 song that is already made stays on the
air — it is named in `radio/rotation.txt`, and a song the rotation file names
is a song the station plays.

Adding YuE2 back is one line in the map:

```
su name radio producer engines be map def
  su name ace-step ob text "audio_ace_step_1_5_xl_turbo" ya
  su name yue2 ob text "audio_yue2_own_melody" ya
prah
```

### The settings

| Fact | Default | Meaning |
| --- | --- | --- |
| `radio producer lanes` | `radio/topics.txt` | the topic rotation |
| `radio producer engines` | map | the engine and the workflow that serves it |
| `radio producer durations` | map | the engine and the length of its song |
| `radio producer seeds` | `2` | seeds rendered per song |
| `radio producer song count` | `1` | songs made per run |
| `radio producer audition seconds` | `0` | the window that decides a song; `0` hears the whole render |
| `radio producer min recovery` | `10` | the percent of the words a song must carry |
| `radio card depth` | `radio` | the card the radio writes: `radio` or `full` |
| `radio producer loop` | `lie` | keep going until the rotation is full |
| `radio producer pause seconds` | `0` | the pause between songs |
| `radio producer command` | `node command/yiniana_producer.mjs` | the command the ceremony runs |

### Running it

```sh
cd /home/htaf/pyac/pyash
node command/yiniana_producer.mjs
```

or, as pyash sentences:

```sh
node command/run_pya_program.mjs examples/pyash/yiniana-radio-producer.pya
```

It runs as a systemd service, `yiniana-radio-producer.service`, in loop mode:
it keeps making songs until the rotation is full. The timer,
`yiniana-radio-producer.timer`, wakes it every six hours, so a lane added
later is made the same day. A timer that fires while the producer is already
running does nothing, so there is never a second producer on the same lane.

The producer needs two things from its environment, and the unit sets both:

- `PYA_WORLD_ROOT` — the world the GPU worker watches. The mind calls of the
  lyrics chain queue there; without it the chain waits forever for a worker
  that is not looking at this checkout.
- `PYA_RADIO_CATALOGUE` — the folder the songs are published into. The
  default is `radio/audio` beside the run.

It needs a third thing, and it is the one that breaks silently: **the PATH**.
The pyash run script is a bash script that calls `node` from the PATH, and
the system node is older than the house's code — `import ... with { type:
"json" }` is a syntax error to it. A unit that starts the producer without a
PATH gets a chain whose every child dies on the first import, five seconds
into the run, with a bare "child run defective" and nothing else. The unit
therefore names the same node as its `ExecStart`:

```
Environment=PATH=/home/htaf/.nvm/versions/node/v24.22.1/bin:/usr/local/bin:/usr/bin:/bin
```

A chain that fails in five seconds is almost always this, and not a topic
the corpus cannot carry.

```ini
[Service]
Type=simple
WorkingDirectory=/home/htaf/pyac/pyash-dev
Environment=PYA_RADIO_CATALOGUE=/home/htaf/pyac/pyash/radio/audio
Environment=PYA_WORLD_ROOT=/home/htaf/pyac/pyash/world
Environment=PYA_RADIO_PRODUCER_LOOP=true
ExecStart=/home/htaf/.nvm/versions/node/v24.22.1/bin/node command/yiniana_producer.mjs
Restart=on-failure
RestartSec=60
```

## 8. The Import

The house made songs before the radio existed. They live in
`know/input/` and in `~/Downloads/`, as opus and as wav and as mp3, and they
are the fastest way to a rotation that is worth listening to.

`radio/imports.txt` names them, one per line:

```
az-god-remembers.mp3 | /home/htaf/pyac/pyash/know/input/AZ-God_Remembers_All.opus | /home/htaf/pyac/pyash/know/input/AZ-God_Remembers_All.lyrics.txt | God Remembers All
```

The name is the name the song takes in the catalogue. The source is where the
audio is. The sheet is where the words are, and it is optional: a song without
a sheet is audio we have and words we do not. The title is the name the house
gave the song, and it is optional too: a song without one is named by its
lane.

The import turns each song into an mp3 the station can stream, puts it in the
catalogue, writes the tags of the song into the tag of the file, and copies
the sheet into `radio/lyrics/` under the song's own name. It reads the mp3
back before it publishes it, so a file that came out wrong never reaches the
air, and it renames the finished file into place, so a half written song is
never on the air either.

A song that is already in the catalogue is left alone, apart from its tags:
the import writes the tags into a song that does not carry them yet, and
touches nothing else. So the import can be run again whenever the house makes
more songs, and it is how a song gets the name and the day it had before the
radio.

```sh
cd /home/htaf/pyac/pyash-dev
PYA_RADIO_CATALOGUE=/home/htaf/pyac/pyash/radio/audio \
  node command/yiniana_song_import.mjs
```

or, as pyash sentences:

```sh
node command/run_pya_program.mjs examples/pyash/yiniana-radio-import.pya
```

The import is idempotent: a song that is already in the catalogue is left
alone, so the command can be run again whenever the house makes more songs.

### What the archive holds

The archive holds about thirty-three files, but only about twenty distinct
songs. Eight of the files are other seeds of the same song — "balance love
and wisdom" — and three are other seeds of another one. The rotation plays
the song, not the seed, so the import takes one take of each.

Measured on the archive, with whisper.cpp base reading the first thirty
seconds of each file:

| Song | What the transcriber hears |
| --- | --- |
| `az-compassion` | "A neighbour speaks, a neighbour hears / Compassion brings the people near" |
| `az-god-remembers` | "God remembers all / When the world forgets / Your kindness" |
| `az-voices-speak` | "The ability allows all voices to speak / We stand as vessels letting light flow through" |
| `az-true-power` | "True power resides within ourselves / Love to turn storm into a peaceful view" |
| `az-fresh-light` | "Fresh life with Valentina / Every breath is a quiet prayer" |
| `az-love-leads` | "We woke halfway into a sunny treaching for a cue" |
| `az-power-quiet` | instrumental |
| `az-psytrance` | instrumental |

## 9. Verification

A rendered song can look right and still have lost its words. The check is the
share of the sheet's 4-grams that a transcription carries back:

```sh
node command/yiniana_lyric_recovery.mjs radio/lyrics/song-dignity.txt transcript.json
```

The transcript may be plain text, the JSON the hear runner prints, or Whisper's
segment list.

### What a song costs

Measured on the humility lane, on this machine, with the full teaching card:

| Step | Cost | How it was measured |
| --- | --- | --- |
| the corpus excerpts | under a second | the walk of 1788 files |
| the learnteaching card | 6.6 min | `source-humility.txt` at 09:31:56, `teaching-humility.txt` at 09:38:32 |
| the hymn manuscript | 0.8 min | `teaching-humility.txt` at 09:38:32, `song-humility.txt` at 09:39:17 |
| an ACE-Step render | 65 s | the two renders at 09:40:26 and 09:41:31 |
| the audition | 4.3 s | whisper.cpp base over a 60 s window |
| **a song, end to end** | **about 10 min** | the sum |

The audition now hears the whole render, so it costs about 26 s of whisper
instead of 4.3 s — see the audition window below for why.

The card is the song's cost, not the render: it is about two thirds of the
time. The card is ten fixed headings — SEED CONCEPT, CARDINAL TRAINING
SENTENCE, TEACHING PROGRESSION, ORTHOGONAL FEATURES, SURPRISES AND
MISUNDERSTANDINGS, AFFAIRS OR ACTIVITIES, CAUSATIVE AND CONSEQUENCE, CARDINAL
SCENES AND IDIOMS, BRIEF MEMORY PHRASES, CONCEPT RELATIONS — written by the
mind over the corpus excerpts, and the hymn is written from the card.

The radio card is the lean one: six headings, the ones a song reads. It is
also cheaper, because the mind is asked for less. One radio card over a 100 KB
source took 3 min 50 s through the whole pipeline — fifteen chunks, two merge
layers — against the full card's 6.6 min. One chunk on its own takes 25 s.

The mind and the music engines share one GPU: qwen3.5:9b is resident on the
card at 6.6 GB, 100 % GPU, and the renders want the same device. So the
minutes add up. A hundred and seven lanes at ten minutes each is about
eighteen hours of filling, unattended, and the songs are permanent when it
is done.

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

### The audition window

The audition used to hear only the first sixty seconds of a render. A
175-second song carries its words through the whole of itself, so a window of
sixty seconds hears about a third of the sheet — and a song whose words arrive
late is judged on an instrumental runway and thrown away.

Measured over the published songs, the share of the sheet's 4-grams the hear
lane carried back:

| Song | first 60 s | first 90 s | the whole render |
| --- | --- | --- | --- |
| ace-step-compassion | 22.6 % | 31.3 % | 46.1 % |
| ace-step-dignity | 0 % | 0 % | 0 % |
| ace-step-forgiveness | 26.5 % | 42.2 % | 56.6 % |
| ace-step-humility | 21.1 % | 34.0 % | 36.7 % |
| ace-step-love | 24.9 % | 27.3 % | 28.7 % |
| az-armour-of-light | 45.5 % | 58.0 % | 55.7 % |
| az-compassion | 33.5 % | 45.1 % | 57.2 % |
| az-every-walk | 22.8 % | 30.4 % | 62.0 % |
| az-fresh-light | 23.6 % | 40.0 % | 66.2 % |
| az-go-forth | 0 % | 0 % | 0 % |
| az-god-remembers | 28.0 % | 47.0 % | 68.0 % |

The two wordless renders answer nothing in every window; the sung ones answer
21 % to 45 % of the sheet in the first minute. The whole render separates the
same two groups — nothing against 28 % to 68 % — without judging a song by
its intro, so the audition now hears the whole render
(`radio producer audition seconds` is `0`, which means the whole render, and a
number asks for a window instead).

The floor stays where it was: a song must carry at least
`radio producer min recovery` percent of the words. The floor was measured on
the sixty-second scale, where a good render reached 21 % to 45 % and a
wordless one 0 %. On the whole-render scale the same renders reach 28 % to
68 %, so the floor still means the same thing — a song that carries some of
its words — and it no longer rejects a good seed for arriving late.

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

`instant opening chorus` is the one tag the house reference carries that the
station style did not. It asks the model to open on the chorus instead of
building towards it, which is what a rendered "cinematic builds" intro sounds
like: a long instrumental runway before the first word.

The runner's `--style` overrides that default. A render that is meant to
represent the station should not pass `--style` at all, so the shipped default
is what actually plays.

Every rendered mp3 carries its own ComfyUI prompt in the ID3 `TXXX` tag, so
the file says what produced it. Read the tag when a render does not sound like
the station and the cause is usually the prompt that was passed.

The name of a song lives in the same tag, in the `TIT2` frame, next to the
artist, the album, the day and the comment. The import and the producer write
them there, so a file carries its own name with it.

## 10. Existing Quiz Coverage

- `quiz/yiniana_lyrics_chain.test.mjs` — the corpus walk, the topic pattern, the atomic write, the card read, the song structure verifier.
- `quiz/yiniana_lyric_recovery.test.mjs` — tag stripping, n-gram counting, the three transcript shapes.
- `quiz/music_comfyui_runner.test.mjs` — the workflow and mapping pairs, node detection, the mapping spellings, the save format, and the byte sniffing.
- `quiz/music_say.test.mjs` — the verb side of the music surface.
- `quiz/yiniana_radio.test.mjs` — the frame reader, the catalogue scan, the programme loop, the slow listener, the http surface, the download of a song and what a download refuses, the rotation contract, the order of the programme and the pyash ceremony.
- `quiz/yiniana_producer.test.mjs` — the lanes, the work list, the seed choice, the publishing, the song that is rejected, the audition window, the sheet that reuses its card, the name a song is given, the song that cannot be named, and the pyash ceremony.
- `quiz/yiniana_song_import.test.mjs` — the manifest, the song that is already there, the song that is named, the sheet naming, the mp3 the station cannot play, the part file that never lands, and the pyash ceremony.
- `quiz/radio_id3.test.mjs` — the title a file carries, the title written onto a file, the frames that are kept, the tag the writer leaves alone, and the tags a player reads.
- `quiz/radio_tags.test.mjs` — the tags of a song, the voice of an engine, the day a song carries, the day written once, and the catalogue stamped song by song.
- `quiz/radio_ticker.test.mjs` — the words of a transcript, the sentences of a line, the placement of a song the house could not align, the words kept inside the song, and the line that is sung at that moment.
- `quiz/radio_placement.test.mjs` — the placement of the words of a sheet on the words that were heard.
- `quiz/radio_song_name.test.mjs` — the name the mind gave, the furniture around a name, the reply that is not a name, the name that keeps its first clause, the title case, the line a song repeats, and the pyash ceremony.
- `quiz/yiniana_transcribe_catalogue.test.mjs` — the song that is heard, the song that was heard already, the catalogue heard song by song, and the pyash ceremony.
- `quiz/yiniana_tag_catalogue.test.mjs` — the tags of every song of the catalogue, the day of an imported song, and the pyash ceremony.
- `quiz/learn_card_headings.test.mjs` — the two card depths, the headings an argument may name, the headings a card carries, and the card that matches a depth.
- `quiz/learn_module.test.mjs` — the learn ceremonies, and the radio card's own ceremonies and prompts.
- `quiz/learn_internal_examples.test.mjs` — the learn examples, and the radio examples that call the radio stages.
- `quiz/learn_filename_pipeline.test.mjs` — the card depth and the examples it runs.
- `quiz/normalize_learn_card.test.mjs` — the heading spellings, the phrase repair, and the radio hook that is kept whole.
- `quiz/validate_learn_card.test.mjs` — the full card, the radio card, and the phrase limits of each.
