# Pronunciation Data Audit

Audit date: 2026-10-31. This report checks the selected ASJP v21 rows for Ket and other Yeniseian varieties, North Caucasian varieties, and Tibetan. It describes what the checked-in data can support; it does not independently validate the original field transcriptions.

## Coverage

Every row in these three groups has both `Form` and `Segments` populated. Together they contain 960 form rows. A row is not always a single word: `+` in `Segments` preserves a boundary in multiword forms.

| Group | Variety/list | Rows | Concepts | Distinct segment symbols | Multiword forms |
| --- | --- | ---: | ---: | ---: | ---: |
| Yeniseian | Eighteenth-century Ket | 71 | 30 | 25 | 0 |
| Yeniseian | Ket | 38 | 37 | 25 | 0 |
| Yeniseian | Ket, second source list | 101 | 89 | 33 | 1 |
| Yeniseian | Yugh | 41 | 39 | 26 | 3 |
| Yeniseian | Yugh, second source list | 44 | 34 | 28 | 0 |
| Yeniseian | Arin | 67 | 34 | 27 | 0 |
| Yeniseian | Assan | 43 | 26 | 20 | 0 |
| Yeniseian | Kott-Assan | 69 | 36 | 28 | 0 |
| Yeniseian | Pumpokol | 38 | 26 | 24 | 0 |
| North Caucasian | Chechen | 108 | 99 | 35 | 4 |
| North Caucasian | Abkhaz | 106 | 98 | 35 | 0 |
| North Caucasian | Lezgian | 110 | 99 | 38 | 7 |
| Tibetan | Central Tibetan | 41 | 40 | 34 | 0 |
| Tibetan | Lhasa Tibetan | 41 | 40 | 26 | 18 |
| Tibetan | Written Tibetan | 42 | 39 | 28 | 14 |

“Concepts” counts distinct ASJP concept IDs, not distinct meanings established by a dictionary. The second Ket and Yugh lists are separate source lists, not extra language varieties. The data retain source IDs in [`wordlists.csv`](sources/asjp-v21/wordlists.csv) and citations in [`sources.bib`](sources/asjp-v21/sources.bib). The full selected-list coverage is in [`WORDLISTS.md`](WORDLISTS.md).

Across these 960 rows, there are 89 distinct sound-symbol tokens plus the `+` word-boundary marker. All 89 sound symbols occur in the upstream transcription inventory with both BIPA and CLTS SoundClass marked valid. No row in these groups has an empty form, empty segment string, or placeholder-like segment token. This is a syntax and inventory check; it does not establish that a token is a faithful phonetic transcription of the cited language source.

## What the transcription fields mean

The source is ASJP, which transcribes forms using its own simplified code. `Segments` makes the forms usable as token sequences and maps the used tokens into the inventory recorded in [`TRANSCRIPTION.md`](sources/asjp-v21/TRANSCRIPTION.md). It is a useful normalized comparison layer, but it is not an independent narrow-IPA transcription or an audio-derived pronunciation. ASJP's reduced sound classes can merge distinctions that matter in an individual language; a discussion of cross-linguistic phonetic databases notes that its 41 equivalence classes do not retain all central phonological distinctions ([NorthEuraLex study](https://link.springer.com/article/10.1007/s10579-019-09480-6)).

In this selected subset, the segment strings include distinctions such as aspiration, glottalization, palatalization, labialization, and vowel nasalization. They contain no explicit lexical-tone symbols. That means these rows cannot support tone-sensitive pronunciation comparison, even for a tonal variety. Written Tibetan is also a written-language list and should not be treated as a third spoken Tibetan pronunciation; keep it separate from Central and Lhasa Tibetan.

The source site describes ASJP's transcription symbols and notes that a language can have multiple lists from different dialects or sources ([ASJP database guide](https://asjp.clld.org/help)). The checked-in list IDs preserve those source distinctions. Concept matches are translation equivalents, not evidence that two words are cognate or historically related.

## Recommended normalization policy

Keep the ASJP evidence as a source layer. For pronunciation-based atom generation, each evidence record should retain:

- the language variety and list/source ID;
- the source form exactly as acquired and its transcription system, such as ASJPcode, IPA, orthography, or reconstruction;
- a normalized broad-IPA segment sequence produced with a language- and variety-specific profile;
- any supported tone, length, stress, or phonation information, without filling absent values by guesswork;
- word boundaries, keeping multiword translation forms distinct from single lexical words;
- the profile/version and the provenance of any derived transcription.

Derive a separate CLTS sound-class or feature-comparison view from that record. Do not overwrite the source form, and do not treat conversion of ASJPcode into segment tokens as recovery of distinctions that ASJP did not encode. For candidate selection, current ASJP rows are useful as broad phoneme hints; stronger pronunciation weights should come from language-specific dictionaries, grammars, or recorded speech with explicit transcription provenance.

## Audit method

Counts were computed from `wordlists.csv`: rows per `Language_ID`, distinct `Parameter_ID` values, distinct `Segments` tokens excluding `+`, and forms containing whitespace. The 89 used sound tokens were matched against the segment table in the included upstream `TRANSCRIPTION.md`; all had ✓ for BIPA and CLTS SoundClass. The check does not audit the accuracy of the source's transcription or reconstruct missing tonal and phonetic detail.
