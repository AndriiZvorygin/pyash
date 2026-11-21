# Accepted Vocabulary Reference Source

`reference.pya` is a snapshot of promoted vocabulary for the VLIW reference
dictionary. It includes accepted atoms and compounds, exact linked WordNet
senses and glosses, SUMO links, Chinese forms selected from accepted links and
the COW crosswalk, and legacy translations only where the English form
resolves to one Pyash key. It does not copy candidate or decision-history
records.

Generate the snapshot from the current canonical catalogs with:

```sh
node program/library/dictionary/build_reference_source.mjs
```

The generator applies one deterministic WordNet sense per Pyash key and part
of speech, using English30k rank, comparable WordNet tag counts, shorter
English targets, normalized target, and sense ID. Distinct parts of speech
remain separate interim definitions under one Pyash key. It resolves duplicate
HNUC spellings to the first canonical atom spelling. For single Han forms, it
keeps one Pyash atom per character and drops unresolved frequency ties.

Each WordNet gloss is stored as `source-gloss` attached to its exact
`source-link`. That linked sense gloss is the interim definition; a native
Pyash definition is optional. Compound component keys remain ordered.

The VLIW worktree imports `reference.pya` and compiles the volume with:

```sh
pyash dictionary volume build from program/library/dictionary/reference.pya to program/library/dictionary/reference.pyac
```

The compiled volume is the runtime lookup artifact. When accepted vocabulary
changes in its canonical atom, compound, WordNet, Chinese, or translation
catalog, regenerate this snapshot and rebuild the compiled volume. Do not edit
the generated sidecar indexes as a substitute for changing source catalogs.

For multi-character Chinese forms, the snapshot includes composed Mandarin
Pinyin or Cantonese Jyutping when each Han character has one local reading and
the whole surface resolves to one Pyash entry. It omits composed readings when
any character is ambiguous or missing.
