# Reporter Refinery Recovery Runbook

## Goal

Restore missing Andrii YouTube, Owen Sound, or Grey County publications by fixing the reusable pipeline defect, rerunning only affected work, and verifying the remote result.

## Diagnose

1. Read the watchdog incident, status, candidate metadata, and sanitized logs.
2. Check `git status --short`; preserve all unrelated worktree changes.
3. Check `/tmp/municipal-reporter-pipeline.lock` and each reporter cron lock. Wait rather than overlap active GPU work.
4. Reproduce the smallest failing stage and identify whether the fault is discovery, download, transcription, segmentation, summarization, rendering, validation, or publishing.
5. Add a fixture or targeted test that fails for the general defect before changing behavior when practical.

## Repair constraints

- Local reporter LLM work uses only `qwen3.5:9b`.
- Never add meeting-, date-, page-, title-, speaker-, or agenda-code-specific exceptions.
- Deterministic logic may classify operational state, validate ownership, or enforce gates. It must not replace LLM transcript segmentation, prose generation, whole-meeting synthesis, or substantive summaries with regex matching, opening fragments, first sentences, or copied source text.
- Structured eScribe HTML is authoritative for agenda item identity, order, title, description, and attachment ownership. Direct attachments outrank overlapping combined-package ranges.
- Transcript sections follow the complete meeting chronology. Deputations, public forum speakers, council discussion, and revisited items must remain distinct even when they discuss related subjects.
- Whole-meeting and one-sentence summaries must cover the complete meeting without repeatedly stating the date or overrepresenting an early item.
- Substantive attachment-backed items require non-empty Stage 3 summaries. Long items require titled child summaries unless explicitly procedural or empty. Timeout or empty generation remains retryable and cannot publish a fragment fallback.
- Do not commit, push, reset, discard unrelated changes, print secrets, alter the watchdog schedule, or broaden the incident scope.

## Verify and publish

1. Run targeted tests for the repaired subsystem.
2. Run the affected reporter through `node world/house/refinery-watchdog/program/run-nightly-refinery.mjs <reporter>` so normal locks and artifacts apply.
3. Check the generated report and publish response, then confirm the public URL directly.
4. For meeting content, inspect agenda/transcript section ownership, table of contents, full-meeting recap balance, one-sentence summary, and any required timestamps or chapters.
5. If verification fails, keep the incident retryable. Do not claim success from local files alone.

Return `needs_human` when credentials, external authority, ambiguous editorial judgment, or an active job prevents safe completion.

The scheduled recovery launcher intentionally provides host network and filesystem access because the reporter pipeline requires the LAN Ollama service and HelpOS. Treat that authority as limited to the incident and the constraints above.
