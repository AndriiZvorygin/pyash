# Yiniana Radio Chain

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

- `program/library/radio/mp3.mjs` — the frame reader: id3 tag size, frame headers, duration, frame clock.
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
| `GET /` | the station page: now playing, the catalogue, a tune-in button |
| `GET /playlist.json` | the catalogue with titles, engines and lengths |
| `GET /status.json` | the now playing state and the listener count |
| `GET /health` | the liveness check |

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
| `radio station name` | `Yiniana Radio` | the name on the page and in the status |
| `radio station command` | `node command/yiniana_radio.mjs` | the command the pyash ceremony runs |

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
   the corpus excerpts, the learnteaching card, the hymn manuscript.
3. **Audition.** The seed is a lottery — the same sheet and graph came back
   instrumental for one seed and sung for two others. So the producer renders
   `radio producer seeds` seeds and keeps the one that carries the most of the
   words. The measurement is the opening of the render: the first
   `radio producer window seconds` are cut, the hear lane says what it hears,
   and the lyric recovery says how much of the sheet came back. An
   instrumental render answers "(upbeat music)" and recovers nothing.
4. **Publish.** The winner is copied into the catalogue and renamed into
   place, so a half written song is never on the air. The station's own
   catalogue scan takes it from there, within the quarter of a minute.

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
| `radio producer window seconds` | `60` | the opening that decides a song |
| `radio producer min recovery` | `10` | the percent of the words a song must carry |
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
az-god-remembers.mp3 | /home/htaf/pyac/pyash/know/input/AZ-God_Remembers_All.opus | /home/htaf/pyac/pyash/know/input/AZ-God_Remembers_All.lyrics.txt
```

The name is the name the song takes in the catalogue. The source is where the
audio is. The sheet is where the words are, and it is optional: a song without
a sheet is audio we have and words we do not.

The import turns each song into an mp3 the station can stream, puts it in the
catalogue, and copies the sheet into `radio/lyrics/` under the song's own
name. It reads the mp3 back before it publishes it, so a file that came out
wrong never reaches the air, and it renames the finished file into place, so
a half written song is never on the air either.

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

Measured on the humility lane, on this machine:

| Step | Cost | How it was measured |
| --- | --- | --- |
| the corpus excerpts | under a second | the walk of 1788 files |
| the learnteaching card | 6.6 min | `source-humility.txt` at 09:31:56, `teaching-humility.txt` at 09:38:32 |
| the hymn manuscript | 0.8 min | `teaching-humility.txt` at 09:38:32, `song-humility.txt` at 09:39:17 |
| an ACE-Step render | 65 s | the two renders at 09:40:26 and 09:41:31 |
| the audition | 4.3 s | whisper.cpp base over a 60 s window |
| **a song, end to end** | **about 10 min** | the sum |

The card is the song's cost, not the render: it is about two thirds of the
time. The card is ten fixed headings — SEED CONCEPT, CARDINAL TRAINING
SENTENCE, TEACHING PROGRESSION, ORTHOGONAL FEATURES, SURPRISES AND
MISUNDERSTANDINGS, AFFAIRS OR ACTIVITIES, CAUSATIVE AND CONSEQUENCE, CARDINAL
SCENES AND IDIOMS, BRIEF MEMORY PHRASES, CONCEPT RELATIONS — written by the
mind over the corpus excerpts, and the hymn is written from the card.

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

## 10. Existing Quiz Coverage

- `quiz/yiniana_lyrics_chain.test.mjs` — the corpus walk, the topic pattern, the atomic write, the card read, the song structure verifier.
- `quiz/yiniana_lyric_recovery.test.mjs` — tag stripping, n-gram counting, the three transcript shapes.
- `quiz/music_comfyui_runner.test.mjs` — the workflow and mapping pairs, node detection, the mapping spellings, the save format, and the byte sniffing.
- `quiz/music_say.test.mjs` — the verb side of the music surface.
- `quiz/yiniana_radio.test.mjs` — the frame reader, the catalogue scan, the programme loop, the slow listener, the http surface, the rotation contract, the order of the programme and the pyash ceremony.
- `quiz/yiniana_producer.test.mjs` — the lanes, the work list, the seed choice, the publishing, the song that is rejected, and the pyash ceremony.
- `quiz/yiniana_song_import.test.mjs` — the manifest, the song that is already there, the sheet naming, the mp3 the station cannot play, the part file that never lands, and the pyash ceremony.
