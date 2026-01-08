# Translation adapters

This folder keeps per-language adapters separate so contributors can work in parallel.

Pattern:
- `<language>.mjs` exports a line-to-sentence mapper (e.g., `englishLineToSentence`).
- Add Pyash → target language logic by exporting a sentence formatter (e.g., `sentenceToEnglish`).
- Wire new languages in `program/verbs/exchange/translation.mjs` without touching parser or compiler code.

Notes:
- Russian/French adapters are stubbed and currently throw a clear error when invoked.
