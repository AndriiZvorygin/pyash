# Acquired Source Data

Retrieved 2026-10-31. Raw upstream files are preserved in the versioned directories below. The hashes identify the exact downloads used for local coverage checks.

## Unicode Unihan 18.0.0

- Archive: [`Unihan.zip`](sources/unihan-18.0.0/Unihan.zip)
- Upstream: <https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip>
- License: [Unicode License V3](sources/unihan-18.0.0/LICENSE.txt)
- SHA-256: `4c93ea9c1f636451729a840978f1667a53886af37ba854fdcce109721c63d43e`
- Relevant properties include `kTGHZ2013`, `kMandarin`, `kHanyuPinyin`, `kCantonese`, `kTang`, `kFanqie`, and `kDefinition` ([UAX #38](https://www.unicode.org/reports/tr38/)).
- Local coverage within the 8,105-character set: `kTGHZ2013` 8,105; `kMandarin` 8,105; `kCantonese` 8,064; `kTang` 2,319; `kHanyuPinyin` 5,596; `kFanqie` 5,103; `kDefinition` 7,758.
- `kTGHZ2013` values provide Pinyin readings and locations in the referenced dictionary; they do not encode the official table's three levels or list rank.

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

## Source follow-up

- The MOE page for the official *Table of General Standard Chinese Characters* is <https://www.moe.gov.cn/jyb_sjzl/ziliao/A19/201306/t20130601_186002.html>. Unihan gives the full 8,105-character set but not its official levels/order; acquire or extract the MOE table before assigning level-based priorities.
- WikiHan supplies Middle Chinese readings; the Baxter–Sagart workbook supplies Old Chinese reconstructions. Keep the two periods and their uncertainty labels distinct.
