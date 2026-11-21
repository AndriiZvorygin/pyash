---
name: pyash-vocab-tooling
description: "Operate Pyash vocabulary on dev-vocab: inspect, add, link, validate, and publish atoms, compounds, English forms, and WordNet or Chinese mappings."
---

# Pyash Vocab Tooling

Use this skill for vocabulary lookup, vocabulary edits, WordNet coverage, or
compound-sweep operations.

## Start with the operator guide

Read [the dev-vocab operations guide](../../documentation/runbooks/dev-vocab-operations.md)
before changing vocabulary or operating a sweep. It is the canonical
step-by-step workflow for branch and host checks, counts, decision history,
recovery, promotion, validation, and publishing. Do not rely on chat history.

Confirm the current branch is dev-vocab before acting. Vocabulary work does
not belong on dev or dev-vliw-backend. Preserve all dirty files, especially
in a checkout where the sweep may be writing catalogs. Never reset, stash, or
switch an active sweep checkout.

## Pick the right operation

- Look up an English form or POS-qualified WordNet sense with <code>kwon TERM</code>
  or <code>kwon n:07558676-n</code>.
- Count linked WordNet senses with
  <code>node command/wordnet_link_coverage.mjs</code>.
- Read sweep state with the guide's read-only <code>inspectWordnetSweep()</code>
  command. Do not run the refinery to get a status count.
- Propose an atom with <code>node command/vocab_atom_suggest.mjs "CONCEPT"</code>.
- Add a compound from existing atoms with
  <code>node command/compound_catalog_add.mjs "TARGET" "GLOSS" MODIFIER HEAD</code>.
- Review one exact WordNet entry with
  <code>node command/vocabulary_entry_review.mjs ENTRY.pya</code>.
- For Chinese character links, follow
  [the Chinese character refinery skill](../pyash-chinese-character-atom-refinery/SKILL.md).

Use a POS-qualified synset as the identity for a WordNet link. A matching
English lemma or a nearby WordNet relation is evidence, not proof that two
senses are equivalent.

## Guardrails

- accepted-llm is an accepted outcome when it is already in the canonical
  active catalog. Do not insert a second manual-promotion step. Verify the
  active record before reporting it as available.
- review, uncertain, rejected, and failed are not accepted links. Distinguish
  semantic uncertainty from a provider, parser, queue, or storage failure by
  reading the saved decision and error evidence.
- Use the configured GPU Housekeeper for model work. Never call Ollama or
  another provider directly.
- Edit canonical atom, compound, bridge, lemma, or Chinese-link catalogs.
  Generated kwon_*_index.pya files are sidecars; rebuild them with
  <code>node command/vocab_lookup_index.mjs</code> instead of editing them.
- Do not commit ignored run artifacts, newspapers, prompts, responses, or
  unpromoted decision history. Publish only intended active vocabulary.

## Validation

Run the narrow test group for the changed vocabulary type, query the resulting
entry with kwon or pyash dict, and rebuild lookup indexes only when the new
entry must be visible immediately. For exact test commands and the WordNet,
compound, Chinese, and dictionary procedures, follow the operator guide and its
linked subsystem references.
