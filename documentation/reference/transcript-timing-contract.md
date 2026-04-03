# Transcript Timing Contract (Regression Guard)

This note defines the transcript timing rules to prevent merge regressions.

## Scope Separation

- `normalize-transcript` is text-only.
- Normalization may fix words/names/acronyms/punctuation.
- Normalization must never invent or shift timestamps.

## Timing Source of Truth

- Timing comes from source audio via `<prefix>.timing.srt`.
- Sentence transcript rows must align to that source timeline.
- Post-merge logic must not rescale/compress sentence timelines.

## Sentence-Cue Rules

- In `--sentence-cues` mode, preserve matched source-anchored times.
- Do not apply global timeline rescale in sentence mode.
- Do not force cursor-based shifts that rewrite matched source times.

## Hard Failure Rule

- If aligned sentence rows drift more than `1.5s` from matched source anchors, fail merge.
- On failure, pipeline must stop before publish.

Environment override:

- `PYA_SRT_MAX_DRIFT_SECONDS` (default `1.5`)

## Operational Expectation

- A run is valid only if merge passes the drift gate.
- If drift gate fails, fix merge/alignment logic first; do not publish.
