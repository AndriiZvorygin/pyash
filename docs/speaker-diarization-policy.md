# Speaker diarization policy

The Owen Sound, Grey County, and Andrii YouTube transcript pipelines all use
the root `command/diarize_sentence_srt_from_transcript_folder.mjs` command.
The shared policy is `sentence-cue-anonymous-v1`:

- Every recognition request is a sentence/cue, never an aggregate speaker
  block.
- Aggregate turn relabeling and small-panel smoothing are disabled.
- Bad-sample protection is enabled and boundary refinement is off by default.
- Rendered labels are `SPEAKER_###` (or `SPEAKER_UNKNOWN`) by default. The
  internal voice key may remain in the JSON artifact for continuity, but it is
  not a public identity.
- Name linking is an explicit verification mode. Set
  `PYA_SPEAKER_NAME_LINKING=1` only when a separate evidence-backed roster
  pass has been reviewed; ordinary meeting runs must leave it unset or `0`.

The Owen and Grey pipelines skip automatic callout assignment and relabeling
unless that verification flag is enabled. Checkpoints also reject speaker
artifacts whose rendered labels are not anonymous, so a previously named
artifact cannot be reused silently after the policy change.

Do not add a meeting-specific speaker map to a pipeline. If a panel needs
names, add a separate, reusable verification stage and enable it explicitly
for that source profile.
