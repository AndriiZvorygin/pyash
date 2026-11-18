---
name: pyash-chinese-character-atom-refinery
description: "Maintain and run the frequency-ranked Chinese character to Pyash atom workflow; use when reviewing character meanings, proposing atoms from translations, or promoting character links."
---

# Pyash Chinese Character Atom Refinery

Use this workflow for single-character lexical atoms. It produces candidate vocabulary and link records for human review; it never promotes model output automatically.

## Run and resume

- Configure the model, prompt revision, character limit, Housekeeper duty limit, and concurrency in `program/library/translation/chinese_character_atom_refinery.pya`.
- Run `node command/chinese_character_atom_refinery.mjs`. The command initializes Pyash, registers the configured `.pya` refinery graph, and routes every model request through `vyah start future be gpu mind do` plus `vyah await`.
- The run processes at most `housekeeper-duties-per-pass` model duties. Independent duties are submitted in Housekeeper-managed waves bounded by `housekeeper-parallelism`.
- Resume the same source/config run by rerunning the command. It reads the parser-readable `checkpoint.pya`; source or model/prompt identity changes create a new run folder.
- Inspect `review.pya` and the stage artifacts under the ignored `artifacts/chinese-character-atom-refinery/<run-id>/` folder. Do not commit prompts, queue records, model responses, or checkpoint history.

## Evidence and decisions

- Rank by SUBTLEX-CH first. Use Jun Da only as a separate supplemental rank for characters absent from SUBTLEX-CH; never merge the frequency scores.
- Compare exact English glosses against existing lexical atoms and grammar targets before considering ranked related targets. Ask Housekeeper to choose only when the exact match is ambiguous, a ranked related candidate needs semantic review, or an inherited mapping conflicts with a marked sense.
- If no dictionary translation exists, queue a translation from CC-CEDICT, Unihan, the local *Shuowen Jiezi*, and bounded *Analects* contexts. Use classical contexts as attestation evidence, not as standalone definitions.
- If the exact English concept lacks generator phonetics, request evidence for that exact concept. Feed it to the existing deterministic atom generator only as unpromoted candidate evidence. Do not replace it with a near-synonym.
- Frequency is a prior only among semantically compatible meanings. For example, 你 is informal “you” and is much more frequent than courteous 您; the ordinary form may fit base atom `hnan`, while 您 needs a reviewed target that represents its added register. Do not collapse both characters to one atom from the shared broad gloss.
- Preserve unresolved, uncertain, and no-fit records in the local review artifact. A Housekeeper selection is evidence for review, never acceptance.

## Promotion

- Add only approved character links to `program/library/translation/chinese_character_atom_links.pya` using accepted `link:<character>:<atom>` rows.
- Record `withdraw:<character>:<atom>` when an inherited Kwon mapping is wrong; this suppresses that projection without editing the acquired Kwon source.
- Add a genuinely new root atom to `program/library/pyashWords.json` only after its English meaning and generator evidence are reviewed. Keep the compact accepted link catalog as the promoted vocabulary record; keep full decision history in ignored run artifacts.
- The `pyash dict ... to zh` projection and Chinese CSV/index generators consume the accepted link catalog. Preserve source attribution in `sino-pyash/SOURCES.md` and historical-source caveats in `sino-pyash/CLASSICAL-CORPUS.md`.
