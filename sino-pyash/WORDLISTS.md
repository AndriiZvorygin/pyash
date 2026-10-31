# Comparative wordlists

## Initial acquired set

The first downloadable comparison set is a filtered subset of the 2025 ASJP Database, version 21. ASJP provides wordlists aligned to a shared 100-concept list; the subset here contains 25 variety records and 1,859 form rows. Some concepts have multiple forms, and several historical lists are incomplete.

The data is in [`sources/asjp-v21/`](sources/asjp-v21/):

- [`wordlists.csv`](sources/asjp-v21/wordlists.csv) contains the selected forms, concept IDs, source IDs, and transcription fields.
- [`languages.csv`](sources/asjp-v21/languages.csv) preserves ASJP's variety names, codes, classifications, and adds the comparison grouping used here.
- [`parameters.csv`](sources/asjp-v21/parameters.csv) maps the concept IDs to glosses.
- [`sources.bib`](sources/asjp-v21/sources.bib) contains the source entries referenced by the selected forms.
- [`TRANSCRIPTION.md`](sources/asjp-v21/TRANSCRIPTION.md) explains ASJP's sound transcription and segment conventions.
- [`LICENSE`](sources/asjp-v21/LICENSE) and [`UPSTREAM-README.md`](sources/asjp-v21/UPSTREAM-README.md) preserve the dataset license and citation instructions.

The selected variety records and their concept coverage are:

| Comparison set | Varieties | Attested concepts |
| --- | --- | ---: |
| Sinitic baseline | Mandarin | 100 |
| Other Sino-Tibetan | Central Tibetan, Lhasa Tibetan, Written Tibetan, Burmese | 40, 40, 39, 40 |
| Yeniseian | Ket (three source lists), Yugh (two source lists), Arin, Assan, Kott-Assan, Pumpokol | 26–89 per list |
| North Caucasian | Chechen, Abkhaz, Lezgian | 99, 98, 99 |
| Expanded Dene-Caucasian proposal samples | Burushaski, Basque, Navajo, Eyak, Tlingit | 98, 99, 99, 40, 40 |
| Separate comparison groups | Georgian (Kartvelian), Finnish and Hungarian (Uralic) | 99 each |

The list IDs, exact counts, ASJP source IDs, and per-form data are in the CSVs. The additional language groups are comparison samples for separately named proposals; their inclusion does not make those proposals accepted classifications. Georgian is included as an explicit Kartvelian comparator because it is outside the Sino-Caucasian and Dene-Caucasian proposals described in [LANGUAGE-PROXIMITY.md](LANGUAGE-PROXIMITY.md). Finnish and Hungarian represent Uralic for the separate Borean/Sino-Uralic discussion.

The language samples' clause-level word-order descriptions and their limits are documented in [WORD-ORDER.md](WORD-ORDER.md). The ASJP list rows themselves are translation equivalents, not syntactic examples, and cannot establish a variety's basic order.

## How to use the set

These are basic-vocabulary lists, not full dictionaries. ASJP concept matches give translation equivalents for a gloss. They do not establish cognacy, sound correspondence, borrowing, or descent. For phonetic sampling, record the language variety, source list ID, transcription, and whether the comparison is a translation equivalent, a documented loan, or a supported cognate. Treat the grouping column as a search label, not as a phonetic distance score.

The source file's `Value`, `Form`, and `Segments` columns follow the ASJP/CLDF conventions and should be read with the included transcription guide. They are not all IPA strings. The per-form `Source` IDs link to the selected bibliography in `sources.bib`.

For deeper Sino-Tibetan etymological coverage, [STEDT](https://stedt.johnblowe.com/node/124.html) is a useful next source. Its release page directs interested users to request the download URL; I have not bundled that database because a direct public download and redistribution license were not established here.

The filtered `wordlists.csv` SHA-256 is `800a130c0702b459760f31948ae160903f959fca3ad18304092b331f040b1f06`.

## Reproduction

Download the ASJP v21 release from [Zenodo record 16736409](https://doi.org/10.5281/zenodo.16736409), unpack it, and run:

```sh
node sino-pyash/scripts/extract-asjp-v21.mjs /path/to/lexibank-asjp-0127953
```

The extraction uses Node's built-in modules only. The source archive and extracted wordlist checksums, release citation, and retrieval date are recorded in [`SOURCES.md`](SOURCES.md).
