# Simple English Wikipedia: Love — Forms of love

This corpus slice contains the paragraph under the `Forms of love` section of
the [Simple English Wikipedia article on Love](https://simple.wikipedia.org/wiki/Love).

- source locator: `https://simple.wikipedia.org/wiki/Love#Forms_of_love`
- retrieved: `2026-10-28`
- scope: first paragraph under `Forms of love`
- purpose: transfer the general English sentence pipeline to a new paragraph

The plain-text input is kept in
[simple-english-wikipedia-love-forms.txt](simple-english-wikipedia-love-forms.txt).

Run the same source-to-VLIW refinery from the repository root with visible
stage progress:

```bash
PYA_RUN_VERBOSE=1 PYA_RUN_ID=love-forms-paragraph-vliw \
node command/translate_document.mjs english \
  examples/translation/simple-english-wikipedia-love-forms.txt vliw
```
