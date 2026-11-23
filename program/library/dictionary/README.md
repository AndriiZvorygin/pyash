# Pyac VLIW Dictionary Runbook

Published source and compiled dictionary volumes live in this directory. The
format and record grammar are specified in
`documentation/reference/pyac-vliw-dictionary.md`.

## Current Volume

`reference.pya` is the generated snapshot of accepted Pyash vocabulary;
`reference.pyac` is its compiled runtime volume. The checked-in snapshot has
58,630 entries and remains profile v3 pending curation of 3,363 keys with
multiple exact Open English WordNet 2025 senses. Do not rebuild that snapshot
as v4 until those conflicts are reviewed. V4 permits one exact WordNet sense
per dataset release for each Pyac key; cross-release links to the same sense
remain valid. Each exact linked gloss is an interim definition; a native
compositional Pyash definition is optional. Chinese multi-character Pinyin or
Jyutping is composed only when each Han character has one local reading and
the surface resolves to one Pyac key.

`english-core.pya` and `.pyac` are a six-entry v4 example volume for vector,
data, compare, select, sum, and lookup. Its source demonstrates direct Pyac
keys in `su` and case/type metadata without quoted schema labels. The accepted
vocabulary source snapshot is generated on the `dev-vocab` branch from the
canonical vocabulary catalogs; do not hand-edit `reference.pya`.

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
pyash dictionary volume benchmark <v4-volume.pyac> surface en forecast 100000 to artifacts/dictionary-benchmarks/reference-$(hostname)-$(date +%Y%m%d).pya
```

The command requires profile v4, performs five warmups, and records the timestamp, host/platform,
executable and volume sizes, entry/codelet counts, open time, total/mean lookup
latency, lookup rate, iteration count, and result count. `artifacts/` is
git-ignored; use a unique filename for each run and retain/copy the record
where local benchmark history is maintained.

The six-entry example volume's earlier benchmark is not representative of this
full snapshot. The previous 2026-11-20 338 ns figure measured v3 after loading
runtime indexes; it is not a v4 raw-file lookup result. Legacy v2/v3 lookups
use seek-and-scan and are intentionally slower. Do not run a large iteration
benchmark against a legacy volume; first migrate it to v4 after the curation
gate is clear.

Legacy-reader smoke check on this host, 2026-11-23: opening the checked-in v3
volume (58,630 entries, 6,261,431 codelets, 200,365,824 bytes) took about
0.37 seconds. A single `en`/`map` lookup returned six offsets in about
3.90 seconds through the legacy scan path. This is a compatibility check, not
a v4 performance baseline. Record the v4 full-volume benchmark after the
reference data passes its exact-sense curation gate.

Before publishing, check the keys and source IDs against the active catalogs,
build the v4 volume, inspect it, run representative surface/source/read
lookups, run the dictionary Rust and source-import tests, and commit the source
and compiled volume together.
