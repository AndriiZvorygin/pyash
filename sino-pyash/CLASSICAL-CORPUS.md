# Classical Chinese corpus layer

## Scope

Keep this material as a named Classical Chinese layer beside the modern character and comparative-language resources. The first literary corpus is the *Analects* as a Confucian core. It does not stand for all Classical Chinese. Later comparison corpora should be separately identified by work, period, tradition, source edition, and witness. Candidates include the *Mencius*, *Mozi*, *Laozi*, *Zhuangzi*, *Xunzi*, and *Zuo Tradition*.

The files acquired here are source witnesses for future lexical-compound review. No compound inventory or frequency count has been generated from them yet. Preserve original wording and edition attribution when recording any candidate passage. Keep three labels separate:

- **Lexical compound:** a multi-character lexical item supported by context and source evidence.
- **Fixed idiom:** a conventional expression whose fixed form and idiomatic meaning need separate treatment.
- **Phrase or uncertain:** an adjacent character sequence whose word status is not established.

For counts, exclude punctuation from written-character totals, but retain the source passage and exact witness. Adjacent characters alone do not establish a compound. Never merge witnesses or editions before comparing their variants.

## Acquired Analects witnesses

| File | Witness and use | Provenance and caveat | SHA-256 |
|---|---|---|---|
| [`gutenberg-4094-legge.txt`](sources/classical-chinese/analects/gutenberg-4094-legge.txt) | James Legge, *The Chinese Classics*, volume 1, containing the Chinese *Analects* and English translation. Primary working witness for this layer; extract only the Chinese original in a later corpus-preparation step. | Project Gutenberg eBook 4094. The digitizer says the Unicode transcription was made from its Big5 text, preserves page breaks, and substitutes some rare/nonstandard forms. The electronic file does not identify its exact print exemplar; do not silently treat every character as a critical-edition reading. Project Gutenberg marks it public domain in the United States. | `e92780d776ce096aac09e8416a70e1d421d3074de9e35c852c0565b456e42d30` |
| [`gutenberg-23839-wen-yen.txt`](sources/classical-chinese/analects/gutenberg-23839-wen-yen.txt) | Chinese-only *Lun Yu* transcription produced by Wen Yen. Keep as an independent comparison witness; it is not the canonical text and should not be concatenated with Legge. | Project Gutenberg eBook 23839. Its source print edition is not identified in the eBook metadata. The header records a correction (`己之` should be `己知`), which is preserved in the raw file. Project Gutenberg marks it public domain in the United States; confirm the applicable rights before redistributing in other jurisdictions. | `dd2385d1e6bc3a5cde6d4d5efdf16d1bab0bff40a0209a7dc9c4909b80bf3035` |

Both text files were acquired as raw UTF-8 text on 2026-10-31. Their embedded headers and license notices are unchanged. The print volume is cataloged as *The Chinese Classics*, volume 1, London: Trübner, 1861 ([CiNii bibliographic record](https://ci.nii.ac.jp/ncid/BA46589279)). Because Project Gutenberg cautions that its eBooks may include transcription and modernization changes, cite the eBook identifier and exact local file checksum alongside that historical edition citation; the exact print exemplar behind the e-text is not stated in its header.

Project Gutenberg identifies these items as public domain in the United States, but its policy asks users outside the US to check their local copyright law. See the [eBook 4094 record](https://www.gutenberg.org/ebooks/4094), [eBook 23839 record](https://www.gutenberg.org/ebooks/23839), and [Project Gutenberg permissions guidance](https://www.gutenberg.org/policy/permission.html).

## Acquired segmentation reference

[`ke-2024-ccl-1.64.pdf`](sources/classical-chinese/references/ke-2024-ccl-1.64.pdf) is Yonghong Ke's 2024 paper, “Construction of Ancient Chinese Word Segmentation and Part-of-Speech Corpus,” *Proceedings of the 23rd Chinese National Conference on Computational Linguistics*, pp. 819–829. The ACL Anthology describes a corpus of 46 works, over 3.23 million characters and 2.17 million words, annotated with segmentation and POS, using manual and machine-assisted work. This is a method/reference paper: the Anthology record links the paper, not a downloadable annotated corpus. The article is included under the ACL Anthology's CC BY 4.0 license for 2016-and-later materials. SHA-256: `4a5bd60c0664c893ab15b22fe0eca98e4efaf0f20b66280ea69f42b86b9dc03c`.

Citation and access: Yonghong Ke (2024), [ACL Anthology 2024.ccl-1.64](https://aclanthology.org/2024.ccl-1.64/). The paper informs segmentation methodology; it does not supply the text edition for our *Analects* corpus.

## Acquired idiom reference

[`dict_idioms_2020_20260929.zip`](sources/classical-chinese/moe-idioms/dict_idioms_2020_20260929.zip) is the official Taiwan Ministry of Education text-data archive for the *Dictionary of Chinese Idioms*, downloaded unchanged on 2026-10-31. The archive contains one XLSX file, `dict_idioms_2020_20260929.xlsx`. SHA-256: `33dc230ceb126cccfe3dc6e17e3b38b99618b8d6c6ff85ee911493065dc2850e`.

The Ministry states that the dictionary data are released under **CC BY-ND 3.0 Taiwan**: redistribution, including commercial redistribution, is allowed with attribution, while modifications are prohibited. Preserve the ZIP/XLSX as supplied. Use the dictionary as an idiom lookup/reference; do not normalize, filter into a derivative dataset, or republish altered entries as though the license allowed adaptation. Source and terms: [official MOE download page](https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/dict_idiomsdict_download.html).

## Query-only and licensed references

| Resource | Role | Acquisition boundary |
|---|---|---|
| [Chinese Text Project](https://ctext.org/) | Search the *Analects* and named pre-Qin/Han works; inspect text sources and available translations. | CText says its site and content are protected and prohibits automated bulk downloading. It permits reasonable private use and limited quotation; translations may have separate rights. Use as an interactive research reference. Acquire a specific text from a separately verified source/edition when a local corpus copy is needed. |
| [Peking University CCL](https://corpus.pku.edu.cn/) | Cross-check a word or construction in ancient and modern collections; use corpus path and period filters to avoid treating modern and ancient results as one pool. | The 2026 corpus includes ancient and modern material and is a web query service. Its guide documents result exports with daily limits. Use bounded, attributed query results for cross-checks; do not mirror the corpus. |
| [Kroll, *A Student's Dictionary of Classical and Medieval Chinese*](https://chinesereferenceshelf.brillonline.com/chinese-english) | Check historical senses and word combinations across Classical and Medieval Chinese. | Brill-hosted reference access is subscription-controlled. No dictionary file has been acquired or copied. Treat it as a lookup reference, not a redistributable lexical dataset. |
| [Taiwan MOE Dictionary of Chinese Idioms](https://dict.idioms.moe.edu.tw/) | Check fixed idioms and textual attributions. | The unchanged official archive is acquired above under CC BY-ND 3.0 Taiwan; no modified derivative is stored. |

The Chinese Text Project's terms and download guidance are on its [FAQ](https://ctext.org/faq). PKU's [CCL 2026 overview](https://corpus.pku.edu.cn/ccl_corpus_statistics.html) and [query guide](https://corpus.pku.edu.cn/CCLCorpus_User_Guide.html) describe period/path filters and export limits.

## Object-fronting background

Object-fronting examples in Classical Chinese should first be recorded as attested constructions with their local context. Their presence alone does not establish an earlier SOV basic order. The *Analects* compound scan should not classify the whole corpus as SOV based on marked fronting.

References for balanced follow-up:

- Djamouri, Redouane, Waltraud Paul, and John Whitman (2013), “Syntactic Change in Chinese and the Argument–Adjunct Asymmetry,” in *Breaking Down the Barriers: Interdisciplinary Studies in Chinese Linguistics and Beyond*, pp. 577–594. [Author-hosted PDF](https://conf.ling.cornell.edu/whitman/DjamouriPaulWhitman2013Syntactic.pdf). The paper reports 94% SVO among 26,000 complete Shang inscription sentences in the corpus it discusses. Treat this as a study-specific reported result, not a frequency measured in the *Analects* or a corpus-independent estimate.
- Pan and Jiao, [overview of Archaic Chinese object-fronting](https://academic.oup.com/edited-volume/61882/chapter-abstract/547695035).
- Peyraube (1997), [“On the SVO basic word order in Archaic Chinese”](https://www.persee.fr/doc/clao_0153-3320_1997_num_26_1_1502).
- Meisterernst, [analysis of object preposing](https://mx.nthu.edu.tw/~meisterernst/docs/publications/Object%20Preposing_JEAL2010.pdf).
- Wang, [study of Late Archaic Chinese](https://www.york.ac.uk/language/ypl/ypl2/13/YPL2-13-full.pdf).

When citing quantitative claims such as an estimated SVO proportion, record the analyzed corpus and method from the paper itself; do not generalize a sample statistic to the entire language history.

## Next acquisition boundary

The next corpus expansion should add one named comparison work at a time, with a selected witness and redistribution terms recorded before ingest. Do not scrape CText or bundle PKU CCL, Kroll, or the MOE idiom archive in transformed form. The listed comparison texts are targets for later separately sourced layers, not contents already present in this corpus.
