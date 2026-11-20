# Pyac VLIW Dictionary Workbook

Status: temporary vocabulary-agent worksheet. Update this file while curating
the first dictionary content; do not treat it as the dictionary database or
as a substitute for the canonical vocabulary catalogs. Published compiled
volumes are planned for `program/library/dictionary/`.

See the [dictionary format and workflow reference](../reference/pyac-vliw-dictionary.md)
for the profile marker, serialized record contract, and Rust reader/writer.
Use the [repository hierarchy](../guideline/hierarchy.md) for the
library/runtime boundary.

## Decisions already recorded

| Role | Pyac key and HNUC sequence | Source sense / meaning | How it is used | State |
| --- | --- | --- | --- | --- |
| Machine-readable dictionary profile | `lyin kwon` (`0x680B 0x6C22`) | WordNet 3.0 `n:06639023` -> Open English WordNet 2025 `n:06651548-n`, machine-readable version of a standard dictionary | Profile sentence subject; `ob` text names the volume kind, e.g. `English Pyash dictionary` | Profile choice recorded |
| General dictionary | `kwon` (`0x6C22`) | Open English WordNet 2025 `n:06430544-n`, reference book containing an alphabetical list of words and information about them | General dictionary concept; not the profile discriminator | Existing atom |
| Dictionary entry | `tlat kwon` (`0xA96A 0x6C22`) | WordNet 3.0 `n:06300823` -> Open English WordNet 2025 `n:06311813-n`, an entry in a dictionary of information about a word | Entry-structure key; keep distinct from the dictionary concept | Accepted compound per reference |
| Contents / table of contents | `dvis hnok` (`0x8893 0x2C30`) | WordNet 3.0 `n:06501650-n`, list of divisions and their locations | TOC record subject | Accepted compound per reference |
| Alphabetical index | `lwat txik` (`0xA92B 0x28EA`) | WordNet 3.0 `n:06503777-n`, alphabetical listing of names and topics | Lookup-index record subject | Accepted compound per reference |

## Entry worksheet

Add one row per sense-specific Pyac key. Duplicate English surfaces are
allowed when they resolve to different keys/senses.

| Field | Record |
| --- | --- |
| Pyac key and exact HNUC sequence |  |
| Intended meaning / concise gloss |  |
| Versioned source IDs and mapping relations |  |
| Vocabulary-catalog status and evidence |  |
| Language-tagged exact surface forms |  |
| NFC lookup forms (preserve case) |  |
| Canonical Pyash definition sentences |  |
| Referenced Pyac keys and their meanings |  |
| Optional operation signature: verb, mood, case/type pairs |  |
| Review notes / unresolved choices |  |

## Review checklist

- The HNUC sequence comes from the active vocabulary catalog and matches the
  intended Pyac key.
- Each external sense ID includes its dataset/release and exact mapping
  relation; a broad or related sense is not presented as an exact match.
- Lexical surfaces are preserved exactly; normalized lookup strings use NFC
  and are not silently case-folded.
- Definitions are Pyash sentences, not English-only glosses or JSON payloads.
- Every definition reference resolves to the same volume or a declared linked
  volume.
- A review state is copied from the vocabulary catalog, never inferred from
  the presence of a row in this workbook.
- Workbook changes remain curation notes until an explicit importer/build
  workflow converts accepted entries to `DictionaryVolume` input and a
  validated `.pyac` volume.
