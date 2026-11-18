# SUMO and WordNet evidence in Kwon

Pyash uses Open English WordNet 2025 as its canonical English lexical dataset. Princeton WordNet 3.1 sense keys provide a local crosswalk input. The SUMO WordNet mappings are specifically for WordNet 3.0, so their offsets are never treated as Open English WordNet 2025 offsets.

## Import and lookup

The source checkout is read-only at `know/sumo/`. Its expected commit and SHA-256 hashes are recorded in [sumo_wordnet.pya](../../program/library/translation/sumo_wordnet.pya). The import command verifies those pins and the configured WordNet source hashes before writing anything:

```sh
node command/sumo_wordnet_import.mjs
```

The command writes a local `.pya` crosswalk at `know/sumo/pyash_wordnet_mappings.pya` and a local Kwon index at `know/sumo/kwon_sumo_index.pya`. These generated files remain under ignored `know/`; the source ontology and mapping files are not copied into the repository. The index contains English SUMO labels, mapped WordNet lemmas and IDs, mapping relations, and verified current Open English WordNet IDs. SUMO definitions remain in their external source.

Kwon can search a mapped English lemma, an Open English WordNet ID, or a SUMO ID:

```sh
node command/vocab_suggest.mjs console
node command/vocab_suggest.mjs n:03097112-n
node command/vocab_suggest.mjs sumo:ComputerTerminal
node command/vocab_suggest.mjs command-session
```

`sumo_pyash_links.pya` contains Pyash-authored concept records. The `command-session` record describes Pyash's managed interactive process channel and relates it to SUMO's `ComputerTerminal`, `ComputerProcess`, and `ConsoleApplication` concepts. Those links express the relevant interface/process relationships; they do not identify a software command session with a physical terminal.

## Versioned crosswalk and relation meaning

The importer joins SUMO's WordNet 3.0 offset to a WordNet 3.0 sense key, follows that same key to the WordNet 3.1 offset, and then checks the corresponding Open English WordNet 2025 synset and lemma. Each mapping records `unique`, `ambiguous`, or `unmatched`. Ambiguous and unmatched mappings remain searchable as source evidence, but are not reported as a verified Open English WordNet link.

SUMO's mapping marker is retained with its meaning:

- `=`: equivalent to the SUMO concept
- `+`: the WordNet synset is subsumed by the SUMO concept
- `@`: the WordNet synset is an instance of the SUMO concept
- `:`, `[`, and `]`: complements of those three relations, respectively

For example, the WordNet 3.0 `console` sense maps to `ComputerTerminal+`. Its verified Open English WordNet 2025 ID is `n:03097112-n`. That is the scientific/computing console sense; the separate `console table` and comfort senses stay distinct. A transportation terminal is a different WordNet sense and does not become a computer-terminal alias.

## Source notice

SUMO and its WordNet mappings carry GNU GPL terms. The mapped WordNet data retain the Princeton University WordNet license and notices. The source checkout includes the required mapping citation; see its `WordNetMappings/README.txt`. The Pyash repository stores the pinned-source facts and its own concept links, not a copied SUMO ontology definition set.
