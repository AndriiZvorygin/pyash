# Pyac VLIW Dictionary Runbook

Published source and compiled dictionary volumes live in this directory. The
format and record grammar are specified in
`documentation/reference/pyac-vliw-dictionary.md`.

## Current Volume

`english-core.pya` is the editable source for `english-core.pyac`. The volume
has six exact-sense-linked entries: vector (`dlek`), data (`drut hnuc`),
compare (`tras`), select (`kcut`), sum (`tfo2t`), and lookup (`tsoc hsat`).
It is a real, usable core slice, not complete English or multilingual
coverage. Current entries include concise English WordNet glosses in Pyash
text-definition sentences; richer compositional definitions can be added as
their vocabulary relations are curated.

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

1. Edit `english-core.pya` (or a separate volume source). Use the exact
   canonical Pyash key in `su`; for a compound, write its Pyash atoms in order
   (for example, `drut hnuc`), not an English alias such as `data`.
2. Start each entry with `su name tlat kwon ob name <key> at text "entry" be
   text ya`. Add its `lexical-form` and exact versioned `source-link` records,
   then one or more definition sentences whose `su` is that same key.
3. Preserve each written form and its NFC lookup form. Use a distinct Pyash
   key for a distinct WordNet sense; shared English surfaces are allowed.
4. Increment the source volume revision when publishing the update.
5. Build the compiled volume from the source:

```sh
pyash dictionary volume build from program/library/dictionary/english-core.pya to program/library/dictionary/english-core.pyac
```

The build validates and lowers the source, then atomically replaces the
`.pyac` volume. It does not rebuild the Rust executable. Keep the `.pya` and
`.pyac` together in version control.

## Verify And Use

```sh
pyash dictionary volume inspect program/library/dictionary/english-core.pyac
pyash dictionary volume lookup program/library/dictionary/english-core.pyac surface en data
pyash dictionary volume lookup program/library/dictionary/english-core.pyac source wordnet "Open English WordNet 2025" n:08479331-n
pyash dictionary volume read program/library/dictionary/english-core.pyac key "drut hnuc"
```

Inspect reports entry/codelet counts, volume and executable bytes, metadata,
and open time. Surface lookup returns all matching senses and their Pyash
keys. Source lookup selects an exact dataset/release/identifier. Read returns
only the definition paragraph for the requested key, not the lexical or index
records.

## Measure

Run a warmed file-backed surface lookup benchmark and save its Pyash record:

```sh
pyash dictionary volume benchmark program/library/dictionary/english-core.pyac surface en vector 100000 to artifacts/dictionary-benchmarks/english-core-$(hostname)-$(date +%Y%m%d).pya
```

The command performs five warmups and records the timestamp, host/platform,
executable and volume sizes, entry/codelet counts, open time, total/mean lookup
latency, lookup rate, iteration count, and result count. `artifacts/` is
git-ignored; use a unique filename for each run and retain/copy the record
where local benchmark history is maintained.

Baseline on `mriczo`, 2026-11-20: six entries, 353 codelets, 11,328-byte
volume, 1,396,632-byte release executable; 100,000 vector surface lookups
averaged 163 ns (about 6.13 million lookups/second). The run record was
`artifacts/dictionary-benchmarks/english-core-mriczo-20261120.pya`. This is a
small-volume CPU lookup baseline, not a large-corpus benchmark.

Before publishing, check the keys and source IDs against the active catalogs,
build the volume, inspect it, run representative surface/source/read
lookups, run the dictionary Rust and source-import tests, and commit the source
and compiled volume together.
