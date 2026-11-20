# Shared VLIW Dictionary Volumes

This directory is the permanent repository location for published, versioned
multilingual dictionary volumes encoded in the Pyac VLIW dictionary profile.
The format and reader/writer contract is documented in
`documentation/reference/pyac-vliw-dictionary.md`.

Vocabulary agents may maintain dictionary content through trusted,
version-controlled changes. The read-only rule applies to runtime/model
consumers, not to repository maintenance. Agents should curate Pyac keys,
WordNet/source links, lexical forms, and Pyash definitions in the vocabulary
workflow, then publish a validated `.pyac` volume here.

## Current State

No production dictionary volume has been published here yet. The vocabulary
workbook is at
`documentation/suggest/pyac-vliw-dictionary-workbook.md`; it is a curation
worksheet, not runtime data.

The Rust writer currently accepts `DictionaryVolume` values with already-
lowered definition codelets. It does not import the workbook or vocabulary
catalogs, so producing a volume still requires a Rust-side authoring step. Do
not copy the test fixture into this directory as if it were production data.

## Publication Checks

Before adding or replacing a published volume:

- verify every key and HNUC sequence against the current vocabulary catalogs;
- check each external source ID, release, and mapping relation;
- ensure lexical forms use the declared language tags and NFC lookup forms;
- lower the definition sentences to ordinary VLIW codelets;
- build the volume with `encode_dictionary` and reopen it with
  `DictionaryFileReader`;
- verify the output with Pyash's existing `.pyac` decoder and the dictionary
  integration tests; and
- commit the volume and its source/review evidence together.
