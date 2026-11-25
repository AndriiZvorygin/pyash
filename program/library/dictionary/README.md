# Pyac VLIW Dictionary Source and Runbook

Published Pyash source and compiled dictionary volumes live in this directory.
The volume format and record grammar are specified in
`documentation/reference/pyac-vliw-dictionary.md`.

## Current Volumes

`reference.pya` is the generated source snapshot of accepted Pyash vocabulary.
Its profile-v3 marker describes the source entry grammar; the Rust build
converts it to the current profile-v4 runtime volume in `reference.pyac`. Both
contain 64,573 entries. The current v4 volume is 130 MB. The snapshot includes
7,084 promoted SUMO links: 5,658 `superclass-of` and 1,426 `equivalent-to`.

## Operation signatures

The snapshot carries operation signatures for every verb whose words resolve
through the encoder's vocabulary table. They are generated from the
code-resident tables in `program/verbs/*/**.mjs` by
`program/library/dictionary/operation_signatures.mjs`, never hand-written.

Atomic verbs spell their English surface and resolve to their pya atom
(`multiply` -> `hgoc`); compound verbs are already pya sequences
(`kl6m psas`). Both work, and the current snapshot carries 1,080 signatures
across 71 verbs.

Type words follow the encoder's own rule: `num`, `bool`, `vec`, and `float`
resolve to their grammar form (`number_`, `boolean_`, `vector`, `float`); any
other type word resolves by its own surface. `name <X>` is a named type, so
`X` is an arbitrary identifier and is not resolved against the vocabulary.

A skipped row means the **encoder** cannot resolve the verb or its types, not
that the catalog lacks a linkage. Many skipped verbs do have real dictionary
entries — `cut` has 47, `evoke` 3, `verify` 2 — but verb resolution still reads
the deprecated `program/library/pyashWords.json` through
`lookupLegacyWordSequence` instead of the volume, so coverage is bounded by that
older table. A concrete example is `ob date`: the catalog has `date`
(`hta2c`), but the encoder has no `date` type word, so those signatures are
correctly skipped. See
[`pyashwords-deprecated.md`](../../../documentation/reference/pyashwords-deprecated.md).
`collectOperationSignatures` reports every skipped row with a reason rather than
inventing a key.

The dispatch key is verb, mood, grammatical case, and value type. Argument names
and descriptions are documentation and do not constrain lexical forms, so they
are derived from the case name rather than authored. Compositional keywords such
as `become`, `fromtext`, and `tostate` are modifiers on a case, not cases of
their own, so they are not mapped to a case HNUC; doing so would render two
identical arguments in one signature.

V4 permits distinct exact WordNet senses for one Pyash key when they have
different parts of speech; a duplicate sense for the same part of speech is
rejected. Each exact linked gloss is an interim definition; a native
compositional Pyash definition is optional. Multi-character Chinese Pinyin or
Jyutping is composed only when each Han character has one local reading and the
surface resolves to one Pyash key.

The IWSP Q/K/V forms are present as Pyash dictionary keys: `hwas` resolves to
the English form `question`, `htis hsek` to `key`, and `hnuc gjat` to `value`.
All three carry exact Open English WordNet 2025 links: `hwas` to
`n:07208256-n` (question/query), `htis hsek` to `n:05802065-n` (key), and
`hnuc gjat` to `n:05864972-n` (value). The `attention-query`, `attention-key`,
and `attention-value` labels are IWSP role names, not English lexical forms;
the reference volume exposes the canonical English surfaces rather than
treating those role labels as dictionary aliases. Rust key, surface, and source
indexes are tested against these entries and exact links.

`english-core.pya` and `.pyac` are a six-entry v4 example for vector, data,
compare, select, sum, and lookup. It uses canonical Pyash keys in `su` and
case/type metadata without quoted schema labels. The accepted vocabulary
snapshot is generated on `dev-vocab` from canonical catalogs; do not hand-edit
`reference.pya`.

## Generate the Accepted Vocabulary Snapshot

The snapshot includes promoted atoms and compounds, exact linked WordNet senses
and glosses, SUMO links, Chinese forms selected from accepted links and the COW
crosswalk, and legacy translations only where an English form resolves to one
Pyash key. Candidate and decision-history records are not copied.

On `dev-vocab`, generate the snapshot from the current canonical catalogs with:

```sh
node program/library/dictionary/build_reference_source.mjs
```

The generator selects one deterministic WordNet sense per Pyash key and part
of speech, using English30k rank, comparable WordNet tag counts, shorter
English targets, normalized target, and sense ID. Distinct parts of speech
remain separate interim definitions under one Pyash key. It resolves duplicate
HNUC spellings to the first canonical atom spelling. For single Han forms, it
keeps one Pyash atom per character and drops unresolved frequency ties.

Each WordNet gloss is stored as `source-gloss` attached to its exact
`source-link`. That linked sense gloss is the interim definition; a native
Pyash definition is optional. Compound component keys remain ordered.

For multi-character Chinese forms, the snapshot includes composed Mandarin
Pinyin or Cantonese Jyutping when each Han character has one local reading and
the whole surface resolves to one Pyash entry. It omits composed readings when
any character is ambiguous or missing.

## Update and Publish Volumes

Promote new atoms, compounds, English forms, and exact WordNet links through
their canonical vocabulary workflows on `dev-vocab`. For a compound from
existing atoms, use `compound_catalog_add.mjs`; record the exact sense and its
review state with `vocabulary_entry_review.mjs` or the catalog's accepted-LLM
flow. Regenerate the accepted snapshot as described above and bring the
generated `reference.pya` into this runtime worktree.

Build the compiled volume from the source with:

```sh
pyash dictionary volume build from program/library/dictionary/reference.pya to program/library/dictionary/reference.pyac
```

The build validates and lowers the source, then atomically replaces the
`.pyac` volume. It does not rebuild the Rust executable. The profile-v3 source
grammar is converted to the current profile-v4 runtime format. Index records
are generated from source data; change the catalogs and regenerate instead of
editing those records. Publish the generated snapshot and compiled volume
together.

## Build the CLI Once

From the repository root, build the CLI executable once:

```sh
cargo build --release --manifest-path rust/pyac/Cargo.toml --bin pyac-dictionary
```

The binary is written to `rust/pyac/target/release/pyac-dictionary`. Normal
dictionary commands use that on-disk executable; they do not invoke Cargo or
compile source. Rebuild it only when the Rust CLI changes, not when entries
change. If the executable is absent, the command fails with the build
instruction rather than compiling during use.

## Verify and Use

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

The command requires profile v4, performs five warmups, and records the
timestamp, host/platform, executable and volume sizes, entry/codelet counts,
open time, total/mean lookup latency, lookup rate, iteration count, and result
count. `artifacts/` is git-ignored; use a unique filename for each run and
retain or copy the record where local benchmark history is maintained.

Current reference-volume verification on Mriczo, 2026-11-25: rebuilding
`reference.pyac` from the checked-in `reference.pya` parsed 100,269,153 source
bytes in 12.552 s and completed in 17.506 s. The result contains 64,572 entries
and 4,065,444 codelets, occupies 130,094,240 bytes, and has SHA-256
`cfd71496549c629263c74316adc3e5fe510746aea1b86b79bdb24bbfa9424c62`. A
10,000-iteration warmed `en`/`tensor` lookup measured 106,218 ns mean
(9,414.5 lookups/s), one result per lookup; the release CLI was 1,527,152
bytes. The local Pyash run record is
`artifacts/dictionary-benchmarks/reference-mriczo-20261125-iwsp-query-link.pya`.

The six-entry example volume's earlier benchmark is not representative of this
full snapshot. The previous 2026-11-20 338 ns figure measured v3 after loading
runtime indexes; it is not a v4 raw-file lookup result. Legacy v2/v3 lookups
use seek-and-scan and are slower. The current published volume is v4 and is
eligible for the full-volume raw-file benchmark.

Historical legacy-reader smoke check on this host, 2026-11-23: the then-current
v3 volume (58,630 entries, 6,261,431 codelets, 200,365,824 bytes) took about
0.37 seconds to open. A single `en`/`map` lookup returned six offsets in about
3.90 seconds through the compatibility scan path. This records the older
artifact only; the checked-in runtime file is now v4. For current performance,
use the warmed v4 full-volume benchmark above.

Before publishing, check keys and source IDs against the active catalogs,
build the matching profile volume, inspect it, run representative
surface/source/read lookups and the dictionary Rust/source-import tests, then
publish the source and compiled volume together.
