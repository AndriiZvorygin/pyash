# Deprecated: `program/library/pyashWords.json`

Status: **deprecated historical asset.** It is not the vocabulary and not the
authority for HNUC identity. The new standard is the Rust dictionary volume
described in [`pyac-vliw-dictionary.md`](pyac-vliw-dictionary.md).

This note covers the Rust VLIW surface only. JavaScript interpreter paths that
still read the file are out of scope here; they are not a reason to treat the
file as authoritative.

## What replaced it

| Artifact | Role |
| --- | --- |
| `program/library/dictionary/reference.pya` | generated source snapshot of accepted vocabulary |
| `program/library/dictionary/reference.pyac` | compiled profile-v4 volume that runtimes read |

The Rust reader (`rust/pyac/src/dictionary/`) searches the volume directly and
owns the canonical key, surface, source, and operation-signature indexes. It
currently carries 64,585 keys and 85,553 distinct English surfaces.

`pyashWords.json` carries 7,841 rows, roughly an eighth of the catalog.

## Why this matters for VLIW work

The concrete failure this caused: VLIW verb resolution reads `pyashWords.json`
through `lookupLegacyWordSequence` in `program/library/vliw/quotes.mjs`. Verbs
with real dictionary entries — `cut` (47 entries), `multiply` (5), `write` (4),
`evoke` (3), `verify` (2) — resolve there only when the old file happens to
contain them, and 56,744 dictionary keys are absent from it entirely.

A word having no linkage in the catalog and a word being unresolvable by the
encoder are different facts. Check the volume before concluding a word is
unlinked.

## Current dependency state on the VLIW path

- `program/library/vliw/quotes.mjs` builds its HNUC maps from
  `pyashWords.json`. VLIW lowering in `sentence.mjs` and `phrase.mjs` resolves
  verb and grammar words through that table, so the encoder is still bounded by
  it.
- `program/library/dictionary/build_reference_source.mjs` reads it to seed atom
  spellings for the snapshot it generates.
- `program/library/dictionary/operation_signatures.mjs` reads it for type and
  case lookups.

None of these make the file authoritative, and none of them should be widened to
compensate for the older table.

## Recorded repairs

Defect repairs are allowed on a working branch because the encoder still reads
this table. Each repair is recorded here rather than folded in silently.

| Date | Row | Defect | Repair |
| --- | --- | --- | --- |
| 2026-11-25 | `social_` | shared spelling `syi7h` / `0x804F` with `existential_clause_`, so two meanings had one identity | generated layer-16 spelling `kyuh` (`0x5017`) via `generateGrammarCandidates`; verified free before applying |
| 2026-11-25 | `choice_gender_` | recorded `0x9517`, which is `inductive_mood_`'s identity for `kcu7h` | corrected to `0x5517`, the value `kcuh` encodes to |

`hzef` keeps an empty `en` field by design: it denotes unspecified or blank, so
the blank gloss is not a defect.

After these repairs the table has zero duplicate HNUCs and every stored HNUC
equals what `encodePyacWord` derives from its spelling.

## Rules for Rust VLIW work

- **Do not add rows to `pyashWords.json`.** Vocabulary enters through the
  catalog and regeneration path in
  [`pyac-vliw-dictionary.md`](pyac-vliw-dictionary.md).
- **Do not cite `pyashWords.json` as the vocabulary** in a spec, plan, or
  review. Cite the volume.
- **A lookup miss in `pyashWords.json` is not evidence that a word is
  unlinked.** Query `reference.pyac` first.
- When a VLIW module needs vocabulary, resolve through the Rust dictionary
  volume. If that is not yet possible for a case, record the dependency here
  rather than widening the old table.

## Exit criteria

The asset is removable from the VLIW path when no module under
`program/library/vliw/` or `program/library/dictionary/` imports it. A targeted
grep is enough to re-measure:

```sh
grep -rln 'pyashWords.json' program/library/vliw program/library/dictionary
```
