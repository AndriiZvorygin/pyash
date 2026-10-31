# Acquired Source Data

Retrieved 2026-10-31. Raw upstream files are tracked where redistribution terms permit. Restricted or unclear data is kept local-only; hashes identify the exact downloads used for local checks.

## Unicode Unihan 18.0.0

- Archive: [`Unihan.zip`](sources/unihan-18.0.0/Unihan.zip)
- Upstream: <https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip>
- License: [Unicode License V3](sources/unihan-18.0.0/LICENSE.txt)
- SHA-256: `4c93ea9c1f636451729a840978f1667a53886af37ba854fdcce109721c63d43e`
- Relevant properties include `kTGH`, `kTGHZ2013`, `kMandarin`, `kHanyuPinyin`, `kCantonese`, `kTang`, `kFanqie`, and `kDefinition` ([UAX #38](https://www.unicode.org/reports/tr38/)).
- `kTGH` provides all 8,105 official table indices as `2013:<index>`. Local validation found 8,105 unique indices spanning 1–8,105; the documented level ranges are 1–3,500, 3,501–6,500, and 6,501–8,105.
- Local coverage within the 8,105-character set: `kTGHZ2013` 8,105; `kMandarin` 8,105; `kCantonese` 8,064; `kTang` 2,319; `kHanyuPinyin` 5,596; `kFanqie` 5,103; `kDefinition` 7,758.
- `kTGHZ2013` values provide Pinyin readings and locations in the referenced dictionary. The official index and level are in the distinct `kTGH` property.

## WikiHan comparative Sinitic pronunciations

- Dataset: [`wikihan-ipa.tsv`](sources/wikihan-4106233/wikihan-ipa.tsv)
- Upstream repository: <https://github.com/cmu-llab/wikihan>
- Pinned upstream commit: `410623360489e057d13a25067559fc5964d4c20f`
- Upstream documentation: [`UPSTREAM-README.md`](sources/wikihan-4106233/UPSTREAM-README.md)
- License: [CC0 1.0](sources/wikihan-4106233/LICENSE)
- SHA-256: `d6f3917736b4f86db80d893d4f4a6047b9ea59581b53aef81dd1588afbf2c6c9`
- The TSV has 21,227 rows and columns for Middle Chinese and eight selected Sinitic varieties: Cantonese, Gan, Hakka, Jin, Mandarin, Hokkien, Wu, and Xiang.
- Local check: the TSV contains 17,321 distinct characters; 5,388 of the 8,105 standard characters occur in it. The same standard-character coverage is present in each reading column. This is partial coverage, not a complete pronunciation table for the standard list.
- The dataset is derived from Wiktionary pronunciation entries and is a comparative resource, not a uniform field survey. Cite Chang, Cui, Kim, and Mortensen (COLING 2022): <https://aclanthology.org/2022.coling-1.314/>.

## Baxter–Sagart Old Chinese workbook (local-only)

- Authors' source page: <https://sites.lsa.umich.edu/ocbaxtersagart/>
- Local file: `sources/baxter-sagart-local/BaxterSagartOC2015-10-13.xlsx`
- SHA-256: `d4d3b50866622f5eaed90f31f3d73e61fc231dad36fe31e63d8bd2ff85c1970b`
- The authors' page links this workbook as supplementary material for nearly 5,000 reconstructed Old Chinese items, but states no redistribution license. The workbook is locally available for inspection and ignored by Git; only its provenance and checksum are tracked.

## Jun Da Modern Chinese character frequencies (local-only)

- Listing: [Jun Da Chinese text computing, character frequency lists](https://lingua.mtsu.edu/chinese-computing/statistics/)
- Direct source: <https://lingua.mtsu.edu/chinese-computing/statistics/char/download.php?Which=MO>
- Supporting corpus description: [Da, 2004, fourth technical report](https://lingua.mtsu.edu/academic/dajun-4thtech.pdf)
- Local file: `sources/junda-local/CharFreq-Modern.txt` (GBK/GB18030 encoded)
- SHA-256: `de6649a691da4bccefc7b1467b2ff5888c85830a9fc88056e5d3d675ee9bb1a6`
- The file contains 9,933 ranked characters. Its counts sum to 193,504,018 character occurrences; the source describes a modern Chinese corpus with informative and imaginative text. It supplies a broad written-language frequency signal.
- The source site carries a copyright notice and does not state a redistribution license for the list. The downloaded file is therefore local-only and ignored by Git.

## SUBTLEX-CH character frequencies

- Dataset page: [Ghent University SUBTLEX-CH](https://www.ugent.be/plone_portal/pp/experimentele-psychologie/en/research/documents/subtlexch/overview.htm)
- Original citation: Cai, Q., & Brysbaert, M. (2010). “SUBTLEX-CH: Chinese Word and Character Frequencies Based on Film Subtitles.” *PLOS ONE* 5(6): e10729. [doi:10.1371/journal.pone.0010729](https://doi.org/10.1371/journal.pone.0010729)
- Downloaded archive: [`SUBTLEX-CH-CHR.zip`](sources/subtlex-ch-2010/SUBTLEX-CH-CHR.zip)
- Normalized text: [`SUBTLEX-CH-CHR.utf8.tsv`](sources/subtlex-ch-2010/SUBTLEX-CH-CHR.utf8.tsv), converted from the archive's GB18030 text encoding to UTF-8 with LF line endings; trailing empty tab fields are removed, and non-empty fields and values are unchanged.
- SHA-256: archive `ac5f26c497bf3975bec52895cef039cdb72b667dc3c95f05e4ee35ca8cb97a1f`; normalized TSV `eb5a5485df580fe54071ca8fe2891401ff39030c6a98fc2c768a12856478f4b1`.
- The file reports 46,841,097 characters across 6,243 contexts and includes counts, per-million frequency, and context dispersion. PLOS describes the paper as openly available under its Creative Commons Attribution License; preserve attribution to Cai and Brysbaert and the original article when using or adapting the data.
- See [`FREQUENCY.md`](FREQUENCY.md) for validation and the comparison against the official 8,105-character inventory.

## ASJP v21 comparative wordlists

- Dataset: filtered, reproducible subset in [`sources/asjp-v21/`](sources/asjp-v21/); usage and coverage notes in [`WORDLISTS.md`](WORDLISTS.md).
- Upstream dataset: [The ASJP Database, version 21](https://doi.org/10.5281/zenodo.16736409), Wichmann, Holman, Brown, Dryer, and Ran (eds.), 2025. The release is also downloadable through the [ASJP site](https://asjp.clld.org/download).
- License: CC BY 4.0; the upstream license and readme are included with the acquired subset. Preserve the upstream citation and each form's `Source` reference.
- Retrieved 2026-10-31. Upstream archive SHA-256: `4704ea0cb5ecfb31b6fcf052ef9c18c74e813bccf1b4461072dd40b029b88f90`.
- Extracted subset: 25 variety records, 100 concepts, 1,859 form rows, and 25 cited source records. `wordlists.csv` SHA-256: `800a130c0702b459760f31948ae160903f959fca3ad18304092b331f040b1f06`.
- Includes Mandarin; Central, Lhasa, and Written Tibetan; Burmese; Yeniseian lists for Ket, Yugh, Arin, Assan, Kott-Assan, and Pumpokol; Chechen, Abkhaz, and Lezgian; Burushaski, Basque, Navajo, Eyak, and Tlingit; plus Georgian, Finnish, and Hungarian comparison lists. Coverage varies by source list; see [`languages.csv`](sources/asjp-v21/languages.csv).
- The ASJP words are concept-aligned translations and do not by themselves show cognacy or family relationships. Family/proposal labels are separated in [`LANGUAGE-PROXIMITY.md`](LANGUAGE-PROXIMITY.md) and [`WORDLISTS.md`](WORDLISTS.md).

## Classical Chinese corpus and references

- Corpus scope, acquired files, source editions, and access constraints are documented in [`CLASSICAL-CORPUS.md`](CLASSICAL-CORPUS.md).
- The first corpus layer is the *Analects* as a distinct Confucian text. The preserved Legge witness and the separately labeled Wen Yen transcription are in [`sources/classical-chinese/analects/`](sources/classical-chinese/analects/); they are not merged into one normalized text.
- The Taiwan Ministry of Education idiom data archive is stored unchanged in [`sources/classical-chinese/moe-idioms/`](sources/classical-chinese/moe-idioms/). Its CC BY-ND terms mean the original archive is a reference source, not an input for a modified/repackaged derived database.
- Ke (2024), an ancient Chinese segmentation/POS methodology paper, is preserved under its post-2016 ACL CC BY 4.0 terms in [`sources/classical-chinese/references/`](sources/classical-chinese/references/). The paper describes an annotated corpus but does not provide a corpus download in its Anthology record; availability of the annotations remains unverified.
- CText, PKU CCL, and Kroll are linked as lookup resources, not mirrored. See the access notes in [`CLASSICAL-CORPUS.md`](CLASSICAL-CORPUS.md).

## Word-order references

- Clause-level order observations for the acquired Ket, Tibetan, Caucasus, Basque, Sinitic, and Uralic comparison samples are recorded in [`WORD-ORDER.md`](WORD-ORDER.md). Profiles are tied to individual varieties and sources; they are not phonetic-proximity scores or compound-head rules.

## Source follow-up

- Unihan's `kTGH` property already provides each character's official *Table of General Standard Chinese Characters* index and the index ranges identify its level. No additional table download is needed for level membership.
- WikiHan supplies Middle Chinese readings; the Baxter–Sagart workbook supplies Old Chinese reconstructions. Keep the two periods and their uncertainty labels distinct.
- Frequency rankings depend on corpus/register. Preserve Jun Da's modern written-text rank separately from SUBTLEX-CH's film/television-dialogue rank.
- For family classification and Chinese-contact evidence, see [LANGUAGE-PROXIMITY.md](LANGUAGE-PROXIMITY.md). It distinguishes Sinitic/Sino-Tibetan descent from Sino-Xenic reading strata, documented loans, and translation equivalents; those relationships must not be combined into one proximity score.
- The same note records Starostin/EHL's Borean proposal and the separate Sino-Uralic/Finno-Sinic proposal as attributed hypotheses, with the limits of each stated. Neither is a reason to label Finno-Ugric a Chinese descendant.
