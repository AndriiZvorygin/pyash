# Simple English Wikipedia: Love

This first corpus slice contains the opening paragraph from the **Beginning** section of the [Simple English Wikipedia article on Love](https://simple.wikipedia.org/wiki/Love).

- source locator: `https://simple.wikipedia.org/wiki/Love#Beginning`
- retrieved: `2026-10-24`
- scope: opening paragraph only
- purpose: exercise the general English sentence pipeline before expanding to the full article

The plain-text input is kept in [simple-english-wikipedia-love.txt](simple-english-wikipedia-love.txt).

Run the source-to-VLIW refinery from the repository root with visible stage
progress:

```bash
PYA_RUN_VERBOSE=1 PYA_RUN_ID=love-paragraph-vliw \
node command/translate_document.mjs english \
  examples/translation/simple-english-wikipedia-love.txt vliw
```

The run folder is `artifacts/love-paragraph-vliw/` and contains the durable
translation catalog, VLIW catalog, and `.pyac` pack. The checkpoint newspaper
is `newspaper/love-paragraph-vliw.pya`. Inspect the latest completed stage with:

```bash
node command/read_translation_refinery.mjs love-paragraph-vliw .
```
