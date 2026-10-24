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
English uses the English30k, lemma, grammar, compound, and sentence resources; the other
registered adapters use their existing structured line parsers until free-text analyzers are
added. A caller may supply the existing Housekeeper verifier for contextual candidates.

The durable command writes the translation evidence catalog and the existing Pyac catalog/pack:

```
node command/translate_document.mjs english source.txt translation.pya catalog.pya pack.pyac
```

The translation catalog remains the evidence record. Only resolved canonical sentences are passed
to Pyac lowering; unresolved vocabulary stays available for later catalog expansion.

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
