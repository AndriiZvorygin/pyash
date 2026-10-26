---
name: pyash-source-to-vliw-refinery
description: "Implement or maintain Pyash translation refineries that carry source text through sentence analysis, semantic refinement, and VLIW database output."
---

# Source-to-VLIW refinery

Use this skill when the requested boundary is source text in and a Pyash
translation catalog plus Pyac/VLIW catalog and pack out.

## Canonical shape

- Keep the workflow graph in a `.pya` refinery with named stages, typed map
  outputs, and explicit `from name` or `from ve name` dependencies.
- Keep resource/index access, asynchronous Housekeeper work, and binary file
  writes in a narrow JavaScript adapter.
- Treat WordNet, vocabulary review, and lazy compound translation as child
  refinement stages. They select supplied inventory evidence and preserve
  unresolved records when evidence remains insufficient.
- Reuse `runRefinery()` so stage order, checkpoints, retries, and newspaper
  callbacks retain the normal refinery contracts.
- Lower only resolved sentence records through `lowerTranslationToPyac()` and
  write the catalog/pack with `writeVliwDatabaseFiles()`.

## Validation

Run the focused source-to-VLIW quiz, the translation and WordNet refinery
quizzes, VLIW database coverage, and the full suite with fixture environment
variables explicitly unset. Run `vocab_suggest` against new `.pya` workflow
tokens. Keep the translation catalog as the durable source record and use the
VLIW catalog/pack as executable output.

## References

- `documentation/specifications/10-pipelines.md`
- `documentation/specifications/11-translation.md`
- `program/verbs/exchange/translation/translation_to_vliw_refinery.pya`
