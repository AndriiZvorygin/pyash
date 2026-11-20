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

`english-core.pya` is the editable source for the first published volume,
`english-core.pyac`. It contains six source-linked entries for vector, data,
compare, select, sum, and lookup. This is a usable core slice, not the full
English or multilingual reference dictionary. The vocabulary workbook is at
`documentation/workbook/pyac-vliw-dictionary.md`; it is a curation
worksheet, not runtime data.

Author and update a version-controlled `.pya` source volume, then build it
with the prebuilt Rust executable through `pyash dictionary volume build from
<source.pya> to <volume.pyac>`. Definitions remain ordinary Pyash sentences
and are lowered through the existing VLIW compiler. Build the executable once
using the command in the dictionary reference; normal dictionary commands
never compile it. The CLI also provides `inspect`, indexed `lookup`, definition
`read`, and a benchmark command that records binary/volume sizes and timings
to a requested `.pya` result file.

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
