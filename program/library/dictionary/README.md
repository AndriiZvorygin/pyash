# Pyac VLIW Dictionary Runbook

Published source and compiled dictionary volumes live in this directory. The
format and record grammar are specified in
`documentation/reference/pyac-vliw-dictionary.md`.

## Current Volume

`reference.pya` is the generated snapshot of accepted Pyash vocabulary;
`reference.pyac` is its compiled runtime volume. The current snapshot contains
58,630 entries, including 57,283 selected exact WordNet senses, SUMO links,
Chinese forms, and unique legacy translations. It includes 2,885 single
Chinese-character-to-atom links. A key may retain separate sense glosses for
different parts of speech. Each exact linked WordNet gloss is an interim
definition; a native compositional Pyash definition is optional. For Chinese
multi-character forms, Pinyin or Jyutping is composed only when every Han
character has one local reading and the surface resolves to one Pyash key.

`english-core.pya` and `.pyac` remain a small six-entry example volume for
vector, data, compare, select, sum, and lookup. The accepted vocabulary source
snapshot is generated on the `dev-vocab` branch from the canonical vocabulary
catalogs; do not hand-edit `reference.pya`.

## Setup Once

From the repository root, build the CLI executable once:

```sh
cargo build --release --manifest-path rust/pyac/Cargo.toml --bin pyac-dictionary
```

The binary is written to `rust/pyac/target/release/pyac-dictionary`. Normal
dictionary commands use that on-disk executable; they do not invoke Cargo or
compile source. Rebuild it only when the Rust CLI changes, not when entries
change. If the executable is absent, the command fails with the build
instruction rather than compiling during use.

## Add Or Update Entries

Promote new atoms, compounds, English forms, and exact WordNet links through
their canonical vocabulary workflows on `dev-vocab`. For a compound from
existing atoms, use `compound_catalog_add.mjs`; record the exact sense and its
review state with `vocabulary_entry_review.mjs` or the catalog's accepted-LLM
flow. An exact linked WordNet gloss becomes the interim definition. Then
regenerate the accepted snapshot on `dev-vocab`:

```sh
node program/library/dictionary/build_reference_source.mjs
```

Bring the generated `reference.pya` into this runtime worktree and build the
compiled volume:

```sh
pyash dictionary volume build from program/library/dictionary/reference.pya to program/library/dictionary/reference.pyac
```

The build validates and lowers the source, then atomically replaces the
`.pyac` volume. It does not rebuild the Rust executable. Keep the generated
snapshot and compiled volume together when publishing runtime data.

## Verify And Use

```sh
pyash dictionary forecast
pyash dictionary n:07285306-n
pyash dictionary sumo:Identifier
pyash dictionary hnan to zh
pyash dictionary volume inspect program/library/dictionary/reference.pyac
pyash dictionary volume lookup program/library/dictionary/reference.pyac surface zh 你
pyash dictionary volume lookup program/library/dictionary/reference.pyac source wordnet "Open English WordNet 2025" n:07285306-n
pyash dictionary volume read program/library/dictionary/reference.pyac key hdiftyec
```

`pyash dictionary` (also `pyash dict`) queries the reference volume by English
or Chinese surface, exact WordNet sense, `sumo:<concept>`, or Pyash key. The
`to zh` form prints Chinese first, followed by available Pinyin/Jyutping,
English forms, component breakdown, and WordNet interim glosses. Low-level
volume lookup returns all matching Pyash keys for homographs. `inspect` reports
counts, bytes, metadata, and open time; `read` returns lexical forms, source
links, exact glosses, component keys, and an optional native definition.

## Measure

Run a warmed file-backed surface lookup benchmark and save its Pyash record:

```sh
pyash dictionary volume benchmark program/library/dictionary/reference.pyac surface en forecast 100000 to artifacts/dictionary-benchmarks/reference-$(hostname)-$(date +%Y%m%d).pya
```

The command performs five warmups and records the timestamp, host/platform,
executable and volume sizes, entry/codelet counts, open time, total/mean lookup
latency, lookup rate, iteration count, and result count. `artifacts/` is
git-ignored; use a unique filename for each run and retain/copy the record
where local benchmark history is maintained.

The six-entry example volume's earlier benchmark is not representative of this
full snapshot. Benchmark `reference.pyac` when the volume, index reader, or
runtime command changes; its file-backed open cost and in-memory lookup rate
are separate measurements.

Full-volume baseline on this host, 2026-11-20: 58,630 entries, 6,261,431
codelets, 200,365,824-byte volume, 1,504,464-byte release executable. Opening
and validating the in-band indexes took 3.63 seconds. After opening, 100,000
English `forecast` lookups averaged 338 ns (about 2.96 million lookups/second);
each lookup returned three matching keys. The measurement record is
`artifacts/dictionary-benchmarks/reference-current.pya`. One-shot CLI calls
pay the index-open cost; repeated lookups within one Rust process use the
already loaded in-memory indexes.

Before publishing, check the keys and source IDs against the active catalogs,
build the volume, inspect it, run representative surface/source/read
lookups, run the dictionary Rust and source-import tests, and commit the source
and compiled volume together.
