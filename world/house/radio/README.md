# The radio house

Zvorygin Radio: the station, the songs it makes, and the words it sings them
with.

This is a house — its own project, checked out under pyash's `world/house/`.
Everything specific to the radio lives here. Pyash above it keeps only what is
general: the interpreter, the configuration surface, the runners that call the
GPU housekeeper, and the text helpers that other houses also use.

## What is here

| Folder | What it holds |
| --- | --- |
| `program/library/` | the radio's own modules: the catalogue, the station, the ticker, the tempo, the channels, the page, the mp3 and the id3 readers |
| `command/` | the commands: the station, the producer, the transcribe pass, the song import, the tagger, the lyrics chain |
| `module/` | the pyash ceremonies the commands drive (`radio_*.pya`, `hymn_manuscript.pya`) |
| `examples/` | the pyash programs those ceremonies are run as |
| `quiz/` | the tests for all of it |
| `radio/` | the data: the lanes, the rotation, the channels and the import manifest |
| `documentation/` | how the station and the hymn refinery work |

The songs themselves are not here. The catalogue is runtime data, kept outside
the repository at `radio/audio/`, and named by `PYA_RADIO_CATALOGUE`.

## Running it

The commands are run from the pyash root, the way every house is:

```sh
# the station
node world/house/radio/command/yiniana_radio.mjs

# the producer: one song per run, or looping
node world/house/radio/command/yiniana_producer.mjs

# hear the songs that have no transcript yet
PYA_RADIO_CATALOGUE=/home/htaf/pyac/pyash/radio/audio \
  node world/house/radio/command/yiniana_transcribe_catalogue.mjs
```

The quizzes likewise:

```sh
node --test world/house/radio/quiz/*.test.mjs
```

## Reaching pyash

The house imports pyash two ways, both by relative path so a checkout is
self-contained:

- **Modules** climb four levels: `../../../../program/library/...`. A house
  cannot reach pyash any other way, and that is deliberate — the relative climb
  is the contract `command/check_house_api.mjs` checks.
- **Commands** the house runs (the interpreter, the GPU runners) are named from
  the pyash root at run time, which `program/library/roots.mjs` works out from
  the house's own place rather than from the working directory.

When the house needs something pyash does not have, that is a change to pyash.
When pyash needs something only the radio wants, it belongs here.
