---
name: pyash-chinese-character-grammar-refinery
description: "Build or run the separate Chinese-character-to-Pyash-grammar link pass; use for grammar-word coverage, candidate selection, and high-confidence link promotion."
---

# Pyash Chinese Character Grammar Refinery

This workflow finds links only to existing entries in `program/library/translation/english_grammar.pya`. It is separate from the Chinese atom refinery and does not create or propose lexical root atoms.

## Candidate sources and boundary

- The classical seed list is `sino-pyash/sources/classical-chinese/function-characters-24.pya`, derived from a text-classification heuristic in CCL-15-112. Treat membership as a search seed, never as proof of grammatical use.
- The pinned UD Chinese-GSDSimp train/dev/test files add modern POS-tagged attestations. POS tags are imperfect and only bound candidates; a candidate also needs an exact CC-CEDICT gloss match to an existing English grammar entry.
- Existing grammar entries qualify only when their Pyash sequence has one word and `classifyPyacWord` identifies it as `SHORT_GRAMMAR` or `LONG_GRAMMAR`. Root-shaped words and multiword grammar sequences are not targets in this first pass.
- Keep Classical Analects contexts separate by witness. Context is attestation evidence; do not treat a passage as a standalone gloss.
- Character-to-atom assignments are one-to-one: neither a Chinese character nor a Pyash atom may appear twice. Rank links by frequency of the relevant Chinese use. When characters compete for one atom, the highest-frequency use claims it; others fall back to their next relevant use or remain unlinked. Apply this across grammar and lexical character-link work to preserve reverse and round-trip precision.

## Run and resume

- Configure the model, prompt revision, maximum characters, Housekeeper duty limit, and concurrency in `program/library/translation/chinese_character_grammar_refinery.pya`.
- Run `node command/chinese_character_grammar_refinery.mjs`. It uses the GPU Housekeeper queue and writes prompts, decisions, and resumable checkpoint data under ignored `artifacts/chinese-character-grammar-refinery/<run-id>/`.
- The first pass is capped at 64 model duties per run. Rerun with the same inputs to resume the same parser-readable checkpoint; source or prompt changes create a distinct run identity.
- Inspect `review.pya` for accepted, uncertain, no-fit, and low-confidence decisions. Only high-confidence, non-marked model selections are appended to `english_grammar.pya` as `chinese-character-link:` rows. Do not hand-promote decisions as the main workflow.
- Keep model prompts, responses, queue state, and checkpoints in ignored run artifacts. Preserve source citations and licenses in `sino-pyash/SOURCES.md` and the limitations in `sino-pyash/CLASSICAL-CORPUS.md`.
