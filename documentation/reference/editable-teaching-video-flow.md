# Editable Teaching Video Flow (Draft)

Status: draft reference spec for a resumable, section-wise, editable teaching-video pipeline.

Related:
- `documentation/specifications/25-teaching-video.md`
- `module/brief_video.pya`
- `program/verbs/itinerary_media.mjs`
- `program/bridge/refinery.mjs`

## 1. Purpose

Define an editable teaching-video workflow where users can:
- run long scripts section-by-section (for lower loss on failure),
- edit intermediate artifacts (prompt text, heading/metadata, selected images),
- rerun with the same run context and regenerate only missing/outdated outputs,
- keep deterministic build behavior.

This document captures:
- current implemented behavior,
- desired behavior,
- explicit gaps.

## 2. Current Implemented Baseline

Current `be teaching video do` flow in `module/brief_video.pya`:
1. source manuscript text (no manuscript generation),
2. title/heading/description generation and thumbnail prompt/render,
3. split manuscript paragraphs into section itinerary (`cut from text`),
4. map each section through a section renderer:
   - section sentence split,
   - qwen-say tone/direction promptify per sentence,
   - sentence-wise `qwen say`,
   - sentence audio assemble into section narration audio,
   - section `hear`,
   - section `cut`,
   - section draw `promptify`,
   - section `draw` (including thumbnail generation in draw stage),
   - section `concatenate`,
   - section `footnote` (wordflow),
5. write section clip series manifest,
6. final `concatenate` over section clip itinerary rows,
7. draw discharge.

Current promptify coverage:
- draw promptify: implemented (`module/brief_video.pya`, `be promptify do` in `program/verbs/itinerary_media.mjs`).
- qwen-say tone promptify: implemented (`module/brief_video.pya` + `program/verbs/qwen_say.mjs`).
- title/heading/description promptify: not currently implemented (direct `write` prompts).

Current artifact behavior:
- draw writes image artifacts and can write a `.series.pya` manifest for photographs.
- cut from filename/text writes a `.series.pya` itinerary manifest when run id is available.
- promptify writes a run-scoped `.series.pya` itinerary manifest, with `by num` suffix support for per-section isolation.
- pipeline produces run artifacts and metadata records through exchange/artifact recording.
- checkpoint reuse validates required output file presence before reuse (`run`, `runjs`, `runc`).

## 3. Target Editable Flow

### 3.1 Section-wise execution

For long manuscripts, pipeline should process in stage order over all sections:
- section itinerary for all sections,
- qwen-say tone promptify plan for all section sentences,
- sentence-wise qwen-say for all sections,
- section audio assemble for all sections,
- hear/cut/promptify/draw/concatenate/footnote for all sections,
- final assemble from section clips.

Section boundaries should be deterministic and persisted as source artifacts.

### 3.2 Editable source artifacts

A stage is editable when its input is persisted as a concrete source artifact and later stages consume that persisted source.

Minimum editable sources:
- per-cut draw prompt itinerary,
- title,
- heading,
- description,
- optional per-section script text.

Expected user workflow:
1. edit source artifact on disk,
2. delete downstream derived artifact(s) they want regenerated,
3. rerun same video project/run context,
4. pipeline regenerates only missing/outdated descendants.

### 3.3 Deterministic stage contract

Each stage should have:
- deterministic input artifact path(s),
- deterministic output artifact path(s),
- explicit dependency list.

Rebuild decision for each stage:
- identify per-item outputs (section/cut/sentence),
- rerun only items whose output is missing/stale/failed,
- reuse completed items,
- avoid full-stage regeneration by default.

## 4. Promptify Artifact Contract (Needed)

Promptify must produce editable artifacts, not only in-memory itinerary facts.

Required persisted outputs:
- `draw-prompts.series.pya` (canonical per-cut prompt itinerary),
- optional `draw-prompts.txt` human-readable export.

Draw stage must read from persisted prompt itinerary for rebuild runs.

Thumbnail in draw stage (normative for this flow):
- thumbnail render is part of draw stage outputs and participates in the same rebuild contract.
- thumbnail should not be treated as a late detached stage after draw completion.

Rationale:
- users can edit prompt text directly,
- delete selected images,
- rerun and regenerate with edited prompts.

## 5. Checkpoint + Missing Artifact Semantics (Needed)

Current gap:
- checkpoint hit can skip a stage even when output artifact file was manually deleted.

Required behavior:
- checkpoint reuse must be conditional on artifact existence for that stage output contract.
- if required output file is missing, checkpoint is invalid for that item and only that missing item reruns.
- this applies transitively for downstream dependents.

Optional stronger mode:
- verify both existence and recorded hash match before reuse.

Manifest format requirement:
- platform manifests must be stored as Pyash series files (`.series.pya`).
- each row should be one sentence per output file/item, carrying status and artifact metadata.

## 6. Aspect Ratio Profiles

Teaching video should support named size profiles with deterministic maps:
- `shorts` (9:16) existing baseline,
- `landscape` (16:9) for standard video.

Profile selection should be a data input (map/name), not hardcoded per module copy.

## 7. Implemented vs Gap Summary

| Area | Implemented now | Gap |
| --- | --- | --- |
| Teaching video end-to-end flow | yes (`module/brief_video.pya`) | paragraph index formatting is numeric (`paragraph-1`) rather than zero-padded |
| Draw promptify generation | yes | no optional human-readable `.txt` companion prompt plan export |
| Qwen-say tone promptify | yes | no project-level editable tone plan artifact |
| Artifacts and run recording | yes | transpiled checkpoint payload still stores only result sentence line (no exported artifact set) |
| Manual edit and partial rebuild | partial (delete-missing rerun works) | no dependency timestamp/hash invalidation policy beyond missing-file detection |
| Aspect ratio support | shorts map present | explicit 16:9 profile + selection contract not formalized |

## 8. Proposed Incremental Plan

1. Persist promptify outputs as canonical draw-prompt artifacts and read from them in draw stage.
2. Add stage-level output existence checks before accepting checkpoint reuse.
3. Split teaching pipeline into section units and produce section clips.
4. Add final assembly stage that concatenates section clips.
5. Add landscape profile selection contract and examples.
6. Add a focused rebuild entrypoint (same run context) that reconciles missing/outdated artifacts.

## 9. Non-goals (for this draft)

- changing core sentence grammar,
- introducing unspeakable template tokens,
- replacing refinery with a separate orchestration system.
