# Character Frequency Evidence

The codebook has two distinct ordering signals:

- The official `kTGH` table index assigns characters to standard levels: 1–3,500, 3,501–6,500, and 6,501–8,105. This is the official table order, not a frequency rank.
- Corpus frequency ranks estimate how often characters occur in particular kinds of contemporary text. Keep each corpus rank labeled by source and register; do not merge them into one score yet.

## Sources and coverage

| Source | Register and size | Inventory coverage against the official 8,105 | Level 1 result |
| --- | --- | ---: | --- |
| Jun Da Modern Chinese character frequency list | Modern informative and imaginative writing; 193,504,018 character occurrences; 9,933 ranked characters | 6,976 standard characters | 3,499 of 3,500 occur; `啰` is absent. 262 present Level 1 characters rank below 3,500 in this corpus. |
| SUBTLEX-CH | Film and television subtitles; 46,841,097 characters across 6,243 contexts; 5,936 ranked characters | 5,298 standard characters | 3,491 of 3,500 occur; `堰 捌 浙 渤 湘 滇 皖 赣 闽` are absent. 322 present Level 1 characters rank below 3,500 in this corpus. |

Among the 5,243 standard characters covered by both corpora, their ranks have a Spearman correlation of 0.9061. The top-ranked standard-character sets overlap at 72/100, 377/500, and 820/1,000 characters. The lists largely agree on common characters, with differences reflecting register and corpus selection.

The corpus top 3,500 contain 3,498 standard characters in Jun Da and 3,492 in SUBTLEX-CH. These are corpus-specific top-3,500 sets; they are not substitutes for the official Level 1 set, which is a separately defined standard category ([MOE explanation](https://www.moe.gov.cn/jyb_xwfb/s271/202009/t20200915_488073.html)).

## Most frequent characters in each corpus

Jun Da, first 20: `的 一 是 不 了 在 人 有 我 他 这 个 们 中 来 上 大 为 和 国`

SUBTLEX-CH, first 20: `我 的 你 是 了 不 们 这 一 他 么 在 有 个 好 来 人 那 要 会`

The separate lists are useful for selecting higher-priority codebook entries. The semantic anchor for a Chinese word still comes from the word and its sense; character frequency alone does not determine meaning.

## Reproduction notes

- Official levels and indices: parse `kTGH` from `sources/unihan-18.0.0/Unihan.zip`; validate 8,105 unique indices across 1–8,105.
- Jun Da data was downloaded to `sources/junda-local/CharFreq-Modern.txt`, decoded as GB18030 for analysis, and verified to sum to 193,504,018 occurrences. It remains local-only because the source site does not state redistribution rights.
- SUBTLEX-CH is preserved in `sources/subtlex-ch-2010/`. The UTF-8 TSV converts the tab-delimited file inside the original ZIP, normalizes line endings, and removes trailing empty fields; all populated values are unchanged.
