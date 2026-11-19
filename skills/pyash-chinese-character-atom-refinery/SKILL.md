---
name: pyash-chinese-character-atom-refinery
description: "Maintain and run the frequency-ranked Chinese character to Pyash atom workflow; use when reviewing character meanings, proposing atoms from translations, or promoting character links."
---

# Pyash Chinese Character Atom Refinery

The refinery keeps its full translation and atom-generation contract. Its default first pass only considers links to existing Pyash atoms; the later stages remain available through the full pass.

## Run and resume

- Select `refinery-pass` in `program/library/translation/chinese_character_atom_refinery.pya`. `first-pass` is the default; set it to `full` to run the complete six-stage graph, including missing-meaning translation and atom proposal generation.
- Configure the model, prompt revision, character limit, Housekeeper duty limit, and concurrency in the same `.pya` file.
- Run `node command/chinese_character_atom_refinery.mjs`. The command registers both Pyash graphs and runs the configured graph. Every model request goes through `vyah start future be gpu mind do` and `vyah await`.
- The run processes at most `housekeeper-duties-per-pass` model duties. Independent duties are submitted in Housekeeper-managed waves bounded by `housekeeper-parallelism`.
- Resume the same source/config run by rerunning the command. It reads the parser-readable `checkpoint.pya`; source or model/prompt/pass identity changes create a new run folder.
- Inspect `review.pya` and stage artifacts under ignored `artifacts/chinese-character-atom-refinery/<run-id>/` for abstentions and diagnostics. Do not commit prompts, queue records, model responses, or checkpoint history.

## First pass and evidence

- The first pass filters out characters already linked by Kwon, the promoted atom catalog, or the grammar catalog. Its target list contains root atoms only; it excludes grammar-catalog targets and underscored grammar atoms. It asks Qwen to rank all candidate-bearing characters, including rows with one candidate, by semantic fit only.
- Qwen returns `verdict: match` with ordered supported targets. The deterministic allocator accepts high or medium confidence, ignores marked meanings, and tries each remaining target in ranked order. It assigns at most one character to each Pyash atom and one atom to each character.
- Allocate by SUBTLEX-CH rank first. Use Jun Da only among characters missing from SUBTLEX-CH, as a separate supplemental order; never use it to break an equal SUBTLEX rank or combine the scores. Equal frequency ranks stay tied; standard index and then code point provide stable processing order when tied characters compete for one atom. A more frequent character claims a shared target before a less frequent one, which then tries its next ranked semantic candidate.
- Reconcile existing promoted conflicts before a first-pass run: keep the promoted root mapping when the same character also has a generated grammar link, and keep the higher-frequency character when multiple promoted characters claim the same atom.
- The separate `cow_wordnet_crosswalk.pya` catalog joins every COW Han form to local WordNet senses through the shared ILI, including senses without an active Pyash target. Keep this evidence separate from atom promotion. For each WordNet sense, prefer the shortest COW form; among tied one-character forms, use SUBTLEX-CH rank and then Jun Da only among forms missing SUBTLEX-CH. Equal ranks remain tied: Jun Da cannot break a SUBTLEX tie, and equal-length multi-character forms remain available when no character-frequency evidence applies.
- For a Chinese form with multiple local WordNet sense candidates, rank by ascending English30k rank. Use exact Princeton `tag_cnt` descending only to break an English30k tie when every tied sense has a known count; missing counts remain unknown and leave the candidates tied. Do not choose an alphabetical winner. The catalog preserves lower-ranked and tied evidence, with `frequencyStatus` identifying the top sense, unresolved top tie, lower-frequency candidate, or missing English30k rank. Intersect the form and sense preferences for the primary lookup; the existing one-character/one-atom allocation still applies later when a Pyash target is assigned.
- For example, 你 may fit the common base atom `hnan`; courteous 您 should not get that generic atom from a shared broad gloss. Any honorific compound belongs to later work.
- In the full pass, missing translations still use CC-CEDICT, Unihan, local *Shuowen*, and bounded *Analects* contexts. Treat classical contexts as attestations, not standalone definitions. If an exact concept lacks generator phonetics, request evidence for that concept and feed it to the existing deterministic generator as unpromoted candidate evidence.

## Promotion

- The first pass writes eligible links to `program/library/translation/chinese_character_atom_links.pya` using accepted `link:<character>:<atom>` rows. It does not generate compounds or new root atoms.
- Record `withdraw:<character>:<atom>` when an inherited Kwon mapping is wrong; this suppresses that projection without editing the acquired Kwon source.
- Keep the compact accepted link catalog as the promoted vocabulary record; keep full decision history in ignored run artifacts. The `pyash dict ... to zh` projection and Chinese CSV/index generators consume the accepted link catalog.
- Preserve source attribution in `sino-pyash/SOURCES.md` and historical-source caveats in `sino-pyash/CLASSICAL-CORPUS.md`.
