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
- Use deterministic filenames under one run folder so replay and checkpoint reuse stay safe.
- Artifact subfolders are for stage-local intermediates only.
- Final user-facing outputs for the run belong in the root of `artifacts/<run-id>/`.
- Keep expensive stages isolated:
  - transcription
  - wise-chip generation
  - chapter generation
  - summary/title generation
  - html render
  - remote upload

## Output Contract
For an input media file with filestem `<stem>`, let `<run-root>` be `artifacts/<run-id>/`.

Intermediates live under stage-local subfolders:
- `<run-root>/transcript-stage-1/`
- `<run-root>/transcript-stage-2/`
- `<run-root>/transcript-stage-3/`
- additional stage folders only as needed for later summary/html/publish work

Final run outputs are promoted to the run root:
- `<run-root>/<stem>.srt`
- `<run-root>/<stem>_wise_chips.series.pya`
- `<run-root>/<stem>_chapters.txt`
- `<run-root>/<stem>_summary.txt`
- `<run-root>/<stem>_title.txt`
- `<run-root>/<stem>.html`

`know/produce/` is not a scratch area. Copy only the requested durable deliverables there after the relevant stage succeeds.

## Promotion Rule
- Each stage may write whatever local working files it needs in its own stage folder.
- A stage is not considered complete until its canonical output is also written to the run root.
- Later stages should read prior canonical outputs from the run root, not from buried stage-local scratch paths.

## Hardening Work Remaining
- Add richer wise-chip boundary selection using LLM classifier prompt stage.
- Add chapter title quality pass (rewrite/verify) while preserving timestamps.
- Add idempotent remote publish with explicit success artifact.
- Add smoke examples and quiz coverage for helper command parsers.
