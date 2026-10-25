# Translation adapters

This folder keeps per-language adapters separate so contributors can work in parallel.

Pattern:
- `<language>.mjs` exports a line-to-sentence mapper (e.g., `englishLineToSentence`), used as `toPyash`.
- Add Pyash → target language logic by exporting a sentence formatter (e.g., `sentenceToEnglish`), used as `fromPyash`.
- Register new languages in `program/verbs/exchange/translation/registry.mjs` without touching parser or compiler code.

Notes:
- Russian/French adapters are stubbed and currently throw a clear error when invoked.

## Translation pairs

`pairs_english.pya` stores a pyash map keyed by the canonical Pyash sentence (via `sentenceToPyash`).
The value is a plain English gloss string. The translation pipeline checks this map first when
translating Pyash → English, then falls back to the formatter. `pairs_russian.pya` and
`pairs_french.pya` follow the same shape.

Template pairs live alongside exact pairs:
`pairs_english_templates.pya`, `pairs_russian_templates.pya`, `pairs_french_templates.pya`.
Templates use placeholders like `[name of su]` and `[num of ob]` so a single entry covers many
sentences. Exact pairs always win; templates are a fallback before the formatter.

## Document pipeline

`translation_pipeline.mjs` is the shared source-text path. It accepts an explicit registered
language and a sentence-aware document, preserves source offsets, resolves deterministic lexical
and grammar evidence, and emits resolved, provisional, or unresolved records. Provisional records
retain token evidence and queued vocabulary candidates without entering executable Pyac output.
English uses the English30k, lemma, grammar, compound, WordNet, and sentence resources; the other
registered adapters use their existing structured line parsers until free-text analyzers are
added. A caller may supply the existing Housekeeper verifier for contextual candidates.

The English analyzer is deterministic-first. It applies the grammar catalog, existing atomic
and accepted compound vocabulary, conservative inflection, and sentence constructions before
consulting semantic evidence. The read-only WordNet slice is configured by
`english_wordnet.pya` and loaded from `/home/htaf/pyachso2n/wordnet-core.txt`; each unresolved
token retains its part of speech, synset, gloss, and bounded same-synset Pyash candidates.
WordNet evidence can narrow a review candidate, but a lexical mapping is auto-selected only
when the existing Pyash evidence leaves one deterministic result. Ambiguity remains queued for
the existing Housekeeper/LLM verifier, which may choose only from supplied candidates.
The English surface `such as` is classified as an `exemplifier` construction under the broader
`exemplification` category; its Pyash grammar sequence remains a vocabulary-review item until
the grammar inventory supplies an authoritative token.

The durable command writes the translation evidence catalog and the existing Pyac catalog/pack:

```
node command/translate_document.mjs english source.txt translation.pya catalog.pya pack.pyac
```

The command automatically submits one deduplicated vocabulary-review duty through the existing
`vyah start future be gpu mind do` path. The returned handle and candidate queue state are written
into the translation catalog. The translation catalog remains the evidence record. Only resolved
canonical sentences are passed to Pyac lowering; unresolved vocabulary stays available for later
catalog expansion. The queued LLM receives a bounded slice of `pyashWords.json` plus the grammar
catalog, returns schema-constrained review evidence, and never edits the lexicon directly. A
worker result is durable at the returned GPU handle; accepting it into the lexicon remains a
separate evidence-backed catalog change.

To regenerate the English pairs from `examples/pyash/*.pya`:

```
node -e "import fs from 'node:fs/promises'; import path from 'node:path'; import { buildProgram } from './program/program.mjs'; import { sentenceToPyash } from './program/beautiful.mjs'; import { sentenceToEnglish } from './program/verbs/exchange/translation/english.mjs'; const dir='examples/pyash'; const entries=new Map(); const files=(await fs.readdir(dir)).filter(f=>f.endsWith('.pya')); for (const file of files){ const text=await fs.readFile(path.join(dir,file),'utf8'); const program=buildProgram(text); for (const sentence of program.sentences){ if (!sentence) continue; const pyash=sentenceToPyash(sentence); if (!pyash || entries.has(pyash)) continue; entries.set(pyash, sentenceToEnglish(sentence)); } } const keys=[...entries.keys()].sort(); let out='su name translation_pairs_english be map def\\n'; for (const key of keys){ const val=entries.get(key) ?? ''; out+=`su text ${JSON.stringify(key)} ob text ${JSON.stringify(val)} ya\\n`; } out+='prah\\n'; await fs.writeFile('program/verbs/exchange/translation/pairs_english.pya', out, 'utf8');"
```

The reverse Pyac slice is `pyac_to_english_pyash.mjs`. It expands fused Pyac
roots and grammar endings, lowers the expanded words through
`program/library/vliw/phrase.mjs`, and returns structural Pyash evidence plus
readable English-Pyash and English projections from the decoded VLIW phrase.
Word numbers come from the lwonprom-compatible algorithm in
`program/library/vliw/word_code.mjs`; the vocabulary remains the membership
and gloss source. English-Pyash keeps composed noun and prepositional phrases
as visible words (`ob us from evil`) rather than collapsing them into a
quoted text literal. Vocative phrases render as an address prefix (`O ...`);
the remaining case inventory is derived from the vocabulary's `_case_` entries.
The `translation` verb accepts `from state pyac` with `to state pyash` or
`to state english`; unknown or unsegmentable Pyac tokens remain hard errors.

## Atom word proposals

`atom_word_generation.mjs` adapts the original `pyachso2n/rootWordPhon.js`
allocation method to one concept at a time. It loads the existing multilingual
phonetic catalog, applies the source `NativeWeights` profile, builds the same
weighted CV/CCV(C) root candidates, and selects the first candidate available
in the cumulative 16/19/24/28/32 glyph inventories. Existing Pyash words and
their algorithmically encoded HNUCs are reserved before selection, so a
proposal stays non-overlapping with the checked-in vocabulary.

English30k rank and frequency remain attached as concept evidence. They order a
larger generation batch; the phonetic profile determines the candidate word.
The proposal command is read-only and emits evidence rather than editing
`pyashWords.json`:

```
node command/vocab_atom_suggest.mjs blueprint
```

Grammar concepts use the same allocator with a trailing underscore and reserve the
historical Pyash word list as well:

```
node command/vocab_grammar_suggest.mjs example
```

For `example`, the deterministic proposal is `example_ -> tfum` (`0xA8A`, layer 16).
The command remains read-only; accepting a proposal into `pyashWords.json` and the
English grammar catalog is a separate vocabulary change.

The command uses `pyachso2n/phonetics.json.txt`, `pyachso2n/English30k.txt`,
and the five `*GlyphWordList.txt` files. A concept absent from the phonetic
catalog returns `missing-phonetic-evidence`, preserving the deterministic
boundary instead of inventing a pronunciation. The durable workflow facts are
recorded in `atom_word_generation.pya`; `renderAtomWordProposalPya` can place a
proposal into a parser-readable evidence map for later review.
