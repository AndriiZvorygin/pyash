# Local fact-evaluation data

Place downloaded OmniCSEval packages, private annotations, judge responses, and
other fact-audit inputs under this directory or an external cache. The contents
are ignored by Git. The runner records hashes and source metadata in the durable
Criterion run instead of committing the data.

The exact MeetingBank lane expects the released OmniCSEval Meeting annotations
passed with `--annotations`. The repository clone currently contains the scorer
scripts but no annotation archive, so no private or downloaded annotation data
is checked in here.
