---
name: pyash-vocab-tooling
description: "Safely add or update Pyash atoms, compounds, English forms, and vocabulary links using their canonical catalogs and validation tools."
---

# Pyash Vocab Tooling

Use this skill when adding or updating Pyash atoms, compounds, English forms, or vocabulary links, and when checking token validity.

## Common commands

- Check a proposed token:
  `node command/vocab_suggest.mjs "new verb name"`
- Scan `.pya` files:
  `node command/vocab_suggest.mjs examples/pyash`
- Enforce known tokens:
  `node command/vocab_check.mjs examples/pyash`
- Ask whether a word is used as a Pyash *name* anywhere:
  `node command/scan_pyashtoken.mjs <word>`
- Inspect a stable Open English WordNet synset directly:
  `kwon n:07558676-n`
- Write machine-readable lookup output:
  `node command/vocab_suggest.mjs n:07558676-n --map /tmp/love-synset.json`
- Propose a new lexical atom (read-only):
  `node command/vocab_atom_suggest.mjs "new concept"`
- Add a compound from existing atoms (replace the placeholders):
  `node command/compound_catalog_add.mjs "<target>" "<English gloss>" <modifier> <head>`
- Record or update one vocabulary entry's WordNet review:
  `node command/vocabulary_entry_review.mjs <one-entry.pya>`

Synset IDs are POS-qualified (`a`, `n`, `r`, `v`, or `s`) and use the matching POS suffix,
such as `n:07558676-n`. The lookup reports the source lemmas and gloss, linked Pyash anchor,
Pyac sequence, and whether the link is active, withheld, or absent. The optional `vocab-suggest-v3`
map is a query result for tooling; the `.pya` bridge and compound catalogs remain canonical.
Vocabulary and synset file reads are asynchronous. Module callers reuse in-flight and loaded
indexes within their process; the `kwon` executable starts a fresh process for each invocation.
For several related terms, pass them in one `kwon term-one term-two` call to share that process's
loaded indexes.

The English, Pyac, and POS-qualified WordNet sidecar lookup indexes are generated from the
canonical catalogs. Normal queries use the current sidecar postings without hashing or scanning
source catalogs, so lookup remains fast while vocabulary grows. Results can lag the canonical
catalogs until the next refresh; if a rewrite moves a stored byte offset, Kwon skips the row when
its record identity no longer matches instead of returning a different record.

Indexes refresh hourly from the schedule in
`world/house/refinery-watchdog/conduct/calendar.pya`, under `kwon lookup index refresh schedule`
(default: `minute 17 every hour`). Set that value to `disabled` to remove the refresh, then apply
the calendar with `node world/house/refinery-watchdog/program/install-cron.mjs`. To refresh
immediately, run `node command/vocab_lookup_index.mjs`. The source catalogs remain canonical.

## Safely add or update vocabulary

### Inspect before adding

Check the current dictionary and canonical catalogs before creating a word. Use
`node command/vocab_suggest.mjs "<English term>"` for single-term token, alias,
and WordNet coverage. For compound targets, inspect the curated compound
catalog with the parser-backed reader; a multiword target may be split into
individual English lookups. For a specific WordNet meaning, query its
POS-qualified synset (for example, `kwon n:07558676-n`) instead of relying on
the English lemma alone. Prefer an existing atom or a compositional compound
when it already expresses the intended meaning.

### Choose the canonical record

- **New lexical atom:** run `node command/vocab_atom_suggest.mjs "<concept>"`.
  This is a read-only proposal based on the configured translation and
  phonetic evidence; it does not add vocabulary. Review the proposed form,
  English meaning, layer, and HNUC against current usage before accepting it in
  `program/library/pyashWords.json`. Keep each Pyac form and HNUC unique, and
  do not reuse an existing atom for a different meaning. See
  `program/library/translation/README.md` under “Atom word proposals” for the
  generator inputs and acceptance boundary.
- **Compound from existing atoms:** run
  `node command/compound_catalog_add.mjs "<target>" "<English gloss>" <modifier> <head>`.
  Quote multiword targets and glosses. Give atoms in head-final order, with the
  final atom as the head. This command writes the curated compound catalog and
  checks that components are existing atoms with layer data, the target is not
  already an atom, and neither the target nor the sequence conflicts with an
  existing compound. Repeating an identical addition is safe and reports
  `already-present`.
- **Additional English spelling or alias:** use the appropriate anchor or
  English lemma catalog. `anchor_words_add.mjs` adds an anchor form; it does
  not create an atom. English lemma mappings live in
  `program/library/translation/english_lemmas.pya`. Do not create a duplicate
  atom just to cover an English inflection or alternate spelling.
- **Chinese link:** for Chinese character links, follow
  `pyash-chinese-character-atom-refinery`. Do not edit acquired source
  dictionaries or generated lookup indexes to change a link.
- **English WordNet review/link:** create a one-entry `.pya` map and run
  `node command/vocabulary_entry_review.mjs <one-entry.pya>`. The entry must
  include `target`, `gloss`, `pyash`, `sense-id`, `review-status`, and
  `evidence`; `model-status` is optional and records the model decision
  separately from human review. Use a POS-qualified synset ID such as
  `n:01025762-n`.

  ```pya
  su name vocabulary entry review be map def
  su text "target" ob text "procedure" ya
  su text "gloss" ob text "course of action intended to achieve a result" ya
  su text "pyash" ob text "rwoc hrom" ya
  su text "sense-id" ob text "n:01025762-n" ya
  su text "model-status" ob text "accepted-llm" ya
  su text "review-status" ob text "review-needed" ya
  su text "evidence" ob text "The ordered Pyash atoms express a procedure." ya
  prah
  ```

  `review-needed`, `rejected-curated`, and `deferred-curated` update the
  per-entry review ledger without creating an active WordNet link.
  `accepted-curated` links the exact sense to the existing atom or compound;
  for compounds it adds the curated gloss and ordered atom sequence, or updates
  the gloss and evidence when the target already has that same sequence. A
  sequence conflict fails for review. A later non-accepted status removes only
  the bridge row that this review entry created. Existing bridge conflicts
  fail for review rather than silently replacing another mapping. The model
  status remains intact as a separate field.

### Update existing entries

`compound_catalog_add.mjs` is an add operation, not a review/status command. If
the same target is already present with a different gloss or atom sequence, it
intentionally fails. For a sense-linked compound whose gloss or review state
needs updating, use the one-entry `vocabulary_entry_review.mjs` flow above.
Inspect the matching canonical row with the parser-backed reader:

```
node command/pya_to_json.mjs <catalog.pya> --pretty
```

Then make a focused change to that row in its source catalog. Preserve its
evidence, provenance, aliases, source-language fields, and any WordNet sense
links unless the update explicitly changes them. Re-run the compound catalog,
lexicon, coverage, and lookup checks below.

Treat an atom's Pyac form and HNUC as stable identity. To correct an English
form, add or update the appropriate anchor/lemma mapping. If the underlying
meaning changes, add a distinct atom or compound and migrate its links rather
than silently repurposing the existing atom. For Chinese mappings, record a
withdrawal in the canonical overlay when an inherited Kwon link is wrong; do
not edit the acquired Kwon data.

### Verify the change

- For a new atom or English form, check the token with
  `node command/vocab_suggest.mjs "<term>"`. For a new compound, confirm the
  add command reports the intended atom sequence and gloss; the focused tests
  below exercise catalog parsing, coverage, and VLIW compound resolution.
- For compound catalog changes, run:
  `node --test quiz/translation_compound_catalog.test.mjs quiz/translation_compound_lexicon.test.mjs quiz/translation_compound_coverage.test.mjs quiz/vocab_suggest_compounds.test.mjs`
- For new atom proposals or Pyac encoding changes, run:
  `node --test quiz/translation_atom_word_generation.test.mjs quiz/vliw_word_code.test.mjs`
- For English anchor changes, run `node --test quiz/translation_anchor_words.test.mjs`.
- Rebuild the Kwon sidecar indexes with `node command/vocab_lookup_index.mjs`
  only when the updated catalogs need to be visible to Kwon immediately. The
  canonical catalogs remain the source of truth; never edit the sidecar index
  directly.

The entry review command updates the canonical catalogs, but Kwon's generated
sidecar indexes can lag. Run `node command/vocab_lookup_index.mjs` when the new
accepted link must be available to lookup immediately.

## Canonical words over legacy aliases

`vocab_suggest` accepts a word that resolves through the English dictionary
alias table, so a legacy alias can survive unnoticed. A name must be spelled
with the canonical Pyash word, not the alias.

`kind` is such an alias: it resolves to `sort` and is not a Pyash word of its
own. The alias was purged from every Pyash name position (name-role tokens,
map row keys, quoted JSON/YAML keys, quoted Pyash source, and the JavaScript
that writes or reads those keys). `node command/scan_pyashtoken.mjs kind`
reports zero hits, and `quiz/pyash_name_purge.test.mjs` pins that.

`scan_pyashtoken.mjs` only reports name positions. English prose that happens
to use the word is data, not a name, and is skipped.

Exact English dictionary blacklist alternatives take precedence over prefix
matches. For example, `kwon accord` must return its alternatives rather than
the unrelated prefix match `accordions`.

## Anchor helpers

- Add anchor form:
  `node command/anchor_words_add.mjs --anchor <name> --form <text> --role <role>`
- Suggest -ing anchors:
  `node command/vocab_anchor_ing_suggest.mjs`

## Notes

- Quoted prompt text does not need Pyash vocabulary.
- `vocab_suggest` accepts paths or raw text; it infers mode by checking if an arg is a file/dir.
