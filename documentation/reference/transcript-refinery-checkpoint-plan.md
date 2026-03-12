# Transcript Refinery Checkpoint Plan

This note captures the remaining work after the urgent stage split.

## Goal
Build a full transcript refinery with checkpointed stages, using Pyash-first flow and wise-chip driven chapters.

## Planned End-to-End Flow
1. Input normalization and run metadata.
2. Speaker-aware transcription to SRT.
3. Wise-chip generation from SRT-derived transcript text.
4. Chapter timestamp generation from wise chips.
5. Summary and title generation from wise chips/chapters.
6. SRT to HTML render with chapter anchors.
7. Remote publish (year-based path) and upload report.

## Checkpoint Structure
- Keep each stage as its own platform sentence in a `be refinery` block.
- Use deterministic filenames under one run folder so `--again` can reuse outputs safely.
- Keep expensive stages isolated:
  - transcription
  - wise-chip generation
  - chapter generation
  - summary/title generation
  - html render
  - remote upload

## Output Contract
For an input media file with filestem `<stem>`:
- `<root>/<stem>/<stem>.srt`
- `<root>/<stem>/<stem>_wise_chips.series.pya`
- `<root>/<stem>/<stem>_chapters.txt`
- `<root>/<stem>/<stem>_summary.txt`
- `<root>/<stem>/<stem>_title.txt`
- `<root>/<stem>/<stem>.html`

## Hardening Work Remaining
- Add richer wise-chip boundary selection using LLM classifier prompt stage.
- Add chapter title quality pass (rewrite/verify) while preserving timestamps.
- Add idempotent remote publish with explicit success artifact.
- Add smoke examples and quiz coverage for helper command parsers.
