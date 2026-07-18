---
name: reporter-refinery-recovery
description: Diagnose and repair failed Andrii YouTube, Owen Sound, or Grey County scheduled reporter pipelines from refinery-watchdog incidents, then verify publication without meeting-specific or deterministic prose fallbacks.
---

# Reporter Refinery Recovery

Use this skill only for incidents produced by `world/house/refinery-watchdog/` or an explicit request to repair one of its reporter pipelines.

1. Read `/home/htaf/pyash/AGENTS.md` and `documentation/runbooks/reporter-refinery-recovery.md` completely.
2. Read the incident JSON and logs named by the task before running or editing anything.
3. Check `/tmp/municipal-reporter-pipeline.lock` and the three reporter cron locks. Never overlap GPU-heavy work.
4. Reproduce the narrow failure, implement a general fix, run targeted tests, and rerun only affected reporters.
5. Verify the HelpOS or stream publication independently. Return the structured recovery result requested by the caller.

Local reporter LLM work must use only `qwen3.5:9b`. Do not introduce another local model, deterministic content-generation fallbacks, or meeting-specific exceptions.
