# Refinery Watchdog

This house monitors the Andrii YouTube, Owen Sound, and Grey County nightly reporters. A completed nightly run today is healthy even when older backlog remains, because each scheduled run intentionally publishes at most one item. When today's run is missing or failed, the watchdog uses the same remote-aware candidate probe as the reporter: an eligible unpublished candidate or a failed probe is then an incident, while `no candidate` is healthy.

It also monitors the active WordNet compound sweep on the cadence configured in
`conduct/calendar.pya` (currently every 10 minutes). The watchdog reads the
stable run's lock, remaining-work metadata, and durable artifact timestamps.
Healthy runs are left alone. For a stopped or stalled run, it sends one bounded
JSON decision request to the configured recovery model through GPU Housekeeper.
It resumes only the same incomplete run after deterministic lock, process, and
Housekeeper checks pass, then verifies the resumed process owns the lock. A
later watchdog invocation waits for a newly appended completed batch before
asking the recovery model for a separate failure review and focused fix/test
plan. Each review attempt keeps its own prompt and response, uses a distinct
Housekeeper identity, and remains retryable after malformed output; only a
single missing outer JSON brace can be recovered, and only when the completed
contents parse. The review result is recorded for a separate coding turn; the
recovery model does not edit code or sweep artifacts.

Kwon lookup indexes refresh hourly from `conduct/calendar.pya`. Normal `kwon` queries use the most recently built index snapshot and never scan or update source catalogs. Change `kwon lookup index refresh schedule` there and rerun `install-cron.mjs` to adjust the refresh; use `disabled` to turn it off.

## Entry points

- `node world/house/refinery-watchdog/program/check-refineries.mjs` performs a non-publishing health inspection.
- `node world/house/refinery-watchdog/program/run-watchdog.mjs` checks health and may start the existing authorized reporter recovery.
- `node world/house/refinery-watchdog/program/run-wordnet-sweep-watchdog.mjs` checks the WordNet compound sweep and submits a Spark-X recovery decision through GPU Housekeeper only when the run is stopped, stalled, or has a conflicting live lock.
- `node world/house/refinery-watchdog/program/resume-wordnet-sweep.mjs` resumes the configured sweep through the existing refinery API with its explicit stable run id.
- `node world/house/refinery-watchdog/program/run-nightly-refinery.mjs <andrii|owen|grey>` runs one scheduled reporter with status artifacts and overlap protection.
- `node world/house/refinery-watchdog/program/install-cron.mjs` idempotently installs the managed cron block.

Artifacts are written beneath `artifacts/nightly/<date>/`, `artifacts/watchdog/<date>/`, and `artifacts/wordnet-sweep-watchdog/`. A WordNet recovery incident stores `incident.pya`, `failure-evidence.txt`, the exact Spark-X prompt and response, a `recovery-decision.pya`, and a status record. After a verified restart and fresh completed batch, the later review stores its own prompt, response, and `post-restart-review.pya` fix/test plan. The durable model, context, safe resume procedure, and follow-up policy are in `conduct/wordnet-sweep-recovery.pya`.

`check-refineries.mjs` checks the three reporter pipelines; it does not report
WordNet sweep health. For read-only WordNet status, import
`inspectWordnetSweep()` from `run-wordnet-sweep-watchdog.mjs`. Running the
watchdog itself may submit a recovery decision and resume the configured sweep.

The reporter pipelines already serialize GPU-heavy execution with `/tmp/municipal-reporter-pipeline.lock`. The watchdog also respects each reporter's cron lock and never interrupts an active job.

## Operating policy

The 05:00 check defers if reporter work is active. The 06:00 check tries again; if work remains active it alerts and exits without overlap. Multiple reporter failures are sent to one Codex session. A Codex success is not accepted until the affected reporter has a successful nightly status for today (or an independent remote-aware probe confirms that no eligible candidate remains). The WordNet check follows the schedule in `conduct/calendar.pya` (currently every 10 minutes) and does not overlap a live sweep. The cron installer reads that calendar; `conduct/managed.pya` is not the source of the installed WordNet schedule. Its inference uses Housekeeper queue admission; a non-empty queue is expected and is not itself a reason to stall recovery.

The unattended reporter Codex process uses `danger-full-access` with approval policy `never` so it can reach HelpOS. The prompt and recovery skill narrowly constrain its scope. A `running` or `fixed` daily recovery is deduplicated; a failed or `needs_human` 05:00 attempt remains eligible for the 06:00 retry. WordNet recovery model calls use the configured GPU Housekeeper path described above.

See [the recovery runbook](../../../documentation/runbooks/reporter-refinery-recovery.md) for diagnosis, repair, publishing, and escalation rules.
