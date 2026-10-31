# Sino-Pyash Character Codebook Plan

**Status:** design for review; implementation is deferred until two Chinese AI reviewers have reviewed this plan.

## Goal

Create a Chinese-facing Pyash layer that maps each of the 8,105 characters in mainland China's *Table of General Standard Chinese Characters* to one unique, speakable Pyac syllable. The character codebook provides reversible character encoding. Chinese dictionary words and their senses provide the semantic anchors; an individual character may have multiple readings or meanings and does not have to stand for one Pyash concept by itself.

The existing Unihan 18.0.0 archive already provides the official table index through `kTGH` (`2013:<index>`). Its 8,105 unique indices cover 1–8,105 exactly: indices 1–3,500 are Level 1, 3,501–6,500 Level 2, and 6,501–8,105 Level 3. `kTGHZ2013` is a separate property containing Pinyin readings and dictionary page locations. The official index is not a corpus frequency rank. [MOE table](https://www.moe.gov.cn/jyb_sjzl/ziliao/A19/201306/t20130601_186002.html) · [Unicode UAX #38](https://www.unicode.org/reports/tr38/)

## Evidence and syllable selection

Use a tiered evidence policy:

1. Old/Middle Chinese reconstructions and documented Sinitic readings, including Mandarin and other varieties.
2. Documented Sino-Xenic character-reading traditions (Sino-Japanese, Sino-Korean, and Sino-Vietnamese), labeled as historical Chinese loans adapted into Japonic, Koreanic, and Austroasiatic languages respectively.
3. Attested Sino-Tibetan cognate sets and Chinese loan strata, recorded separately. Family membership alone does not make a particular word a cognate.
4. Attested Chinese loan strata in other neighboring language families, with the language, date or stratum, and source recorded per item.

Keep family descent, contact borrowing, and translation equivalence as distinct evidence relations. Translation equivalents can inform semantic anchoring or a separately declared cross-language phoneme-sampling method; they are not evidence for a Chinese pronunciation or a genealogical relationship. Do not turn a family proximity tier into a numeric phonetic weight without reviewer approval. See [language-family proximity](LANGUAGE-PROXIMITY.md) for the ranking and its limits.

Record source, period or variety, reading, and confidence for every evidence item. Within a tier, reuse the existing atom-generation phonetic scoring and candidate-ranking approach. A reconstruction is a scholarly hypothesis, not a directly recorded pronunciation: keep its system and uncertainty explicit. Baxter–Sagart covers nearly 5,000 items, not the full character inventory. [Baxter–Sagart data](https://ocbaxtersagart.lsait.lsa.umich.edu/BaxterSagartOCbyMandarinMC2014-09-20.pdf)

WikiHan provides structured IPA data across eight Chinese varieties and Middle Chinese. Unihan contains Mandarin, Cantonese, Tang, Hanyu Pinyin, definition, and other character properties. STEDT supplies lexical and etymological material for Sino-Tibetan languages; use documented relationships as such, not as a synonym for translation. [WikiHan](https://aclanthology.org/2022.coling-1.314/) · [STEDT data release](https://stedt.johnblowe.com/node/124.html)

Extend the current atom-generation workflow with a deterministic batch allocator. It must assign one distinct legal syllable to every standard character, exclude collisions with current Pyash words and VLIW codes, and reserve allocated code syllables from later allocation. Prioritize lower-complexity candidates for Level 1 characters, then use expanded Pyac layers to complete the inventory while preserving evidence ranking within each eligible set. Use the official level as a coarse priority and retain empirical frequency ranks from each corpus as separate evidence; do not treat the official index as a frequency ranking or combine corpora into a single score before reviewer approval. Current local inventory inspection found about 10,210 unreserved forms in the expanded 32-letter list, enough for 8,105 assignments with about 2,105 remaining. Recompute this at implementation time and fail with a clear report if the real candidate set cannot meet the uniqueness constraint.

## Codebook and semantic use

Store the canonical mapping and provenance in a Pyash `.pya` codebook. Each character has one stable code syllable and may retain multiple readings and senses. Separately, store Chinese lexical entries as word-level anchors linked to shared Pyash senses or compounds, using the existing Chinese dictionary, compound lexicon, and sense-linking workflow.

Encoding a Chinese character string concatenates its per-character code syllables and must round-trip back to the original standard characters. Word-level translation first identifies attested Chinese words and their senses, then maps their meanings and head/modifier relations into Pyash composition. Character order alone does not determine Pyash compound order.

For high-frequency Pyash concepts, prefer a natural one-character Chinese word as the anchor where one exists. Common two-character words remain acceptable and provide useful compound evidence. Track concepts whose natural Chinese anchor takes more than two characters as significant friction; check for a shorter attested synonym or compound, and preserve the longer form when it is the accurate lexical choice. Never shorten a word by assigning the whole meaning to one of its component characters without lexical evidence. Report the one-, two-, and over-two-character coverage for the high-frequency vocabulary sample.

The first scope is exactly the 8,105 standard mainland forms. Other variants require explicit variant records; do not silently normalize an unmapped character.

## Review before implementation

Ask both reviewers to assess:

- Whether the evidence tiers and the distinction between reconstruction, variety reading, cognate, loan, and translation are linguistically sound.
- Whether the family-proximity ranking correctly separates descent, contact, and character-reading evidence, including the status of Sino-Xenic readings and disputed wider-family proposals.
- Whether deep-family proposals such as Borean and Sino-Uralic should be represented as named, versioned hypotheses alongside the established classification, with their evidence status and proposed etymologies kept explicit.
- Whether the evidence sources cover the 8,105-character inventory adequately, including polyphonic characters and historical gaps.
- Whether the unique-syllable allocation preserves speakability, Pyac layer rules, and unambiguous reverse decoding.
- Whether character senses, Chinese compounds, and Pyash head/modifier composition are represented without assuming one meaning per character.
- Whether high-frequency concepts have natural one- or two-character Chinese anchors, and which accurate anchors require more than two characters.
- Data licensing, attribution, and any missing primary sources.

After both reviews, record the feedback and resolved decisions here. Begin implementation only after those decisions are incorporated into this plan.
