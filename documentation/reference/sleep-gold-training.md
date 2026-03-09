# Sleep, Gold, and LoRA/SFT Training (Consolidated Reference)

This document consolidates the current contract for:

- `be sleep do`
- training gold collection
- LoRA/SFT dataset preparation intent and current implementation status

## Canonical intent

`be sleep do` is not a short delay. It is the consolidation lifecycle entry.

Use:

- `be wait do` for short synchronization pause
- `be sleep do` for review, memory compaction, and optional training preparation

Primary spec source:

- `documentation/specifications/15-world.md` (`Sleep, review, learning`)

## What sleep is expected to drive

During sleep/review, the world requests:

- summary
- failures
- lessons
- next practice
- training gold (high-signal facts, mistakes, corrections)
- LoRA/SFT preparation inputs derived from reviewed artifacts

## Gold location contract

Session gold is emitted per agent house, under:

- `world/house/<agent>/gold/accepted/`
- `world/house/<agent>/gold/rejected/`

Runtime helper and emission logic:

- `program/agent/gold.mjs`
- `program/verbs/verify_loop.mjs`

## Current implementation status (March 2026)

- Sleep verb exists and is wired as consolidation signal:
  - `program/verbs/sleep.mjs`
- Gold emission exists and is deterministic in verify loop path:
  - `quiz/review_loop.test.mjs`
- Dataset export and automated LoRA/SFT training are roadmap work:
  - `documentation/roadmap.md` (`Session gold emission/export pipeline`, `Sleep-mode pipeline`)

## Practical guidance

If you are building runtime flows:

1. Do not use `sleep` as a timing primitive.
2. Use `wait` for pauses.
3. Treat `sleep` outputs as training/review inputs and archive them under agent house artifacts and gold roots.

If you are planning training jobs:

1. Source accepted/rejected examples from `world/house/<agent>/gold/`.
2. Keep export deterministic (dedup + stable ordering) before LoRA/SFT conversion.
3. Run export/training as explicit background jobs (roadmap), not inline with active turn timing.
