# Refinery Watchdog

This house monitors the Andrii YouTube, Owen Sound, and Grey County nightly reporters. A completed nightly run today is healthy even when older backlog remains, because each scheduled run intentionally publishes at most one item. When today's run is missing or failed, the watchdog uses the same remote-aware candidate probe as the reporter: an eligible unpublished candidate or a failed probe is then an incident, while `no candidate` is healthy.

## Entry points

- `node world/house/refinery-watchdog/program/check-refineries.mjs` performs a non-publishing health inspection.
- `node world/house/refinery-watchdog/program/run-watchdog.mjs` checks health and may start authorized Codex recovery.
- `node world/house/refinery-watchdog/program/run-nightly-refinery.mjs <andrii|owen|grey>` runs one scheduled reporter with status artifacts and overlap protection.
- `node world/house/refinery-watchdog/program/install-cron.mjs` idempotently installs the managed cron block.

Artifacts are written beneath `artifacts/nightly/<date>/` and `artifacts/watchdog/<date>/`. The watchdog deduplicates Codex launches with `artifacts/state/<date>.recovery.pya` and sends executive Matrix DMs for recovery starts, verified fixes, unresolved incidents, and work still active at 06:00.

The reporter pipelines already serialize GPU-heavy execution with `/tmp/municipal-reporter-pipeline.lock`. The watchdog also respects each reporter's cron lock and never interrupts an active job.

## Operating policy

The 05:00 check defers if reporter work is active. The 06:00 check tries again; if work remains active it alerts and exits without overlap. Multiple failures are sent to one Codex session. A Codex success is not accepted until the affected reporter has a successful nightly status for today (or an independent remote-aware probe confirms that no eligible candidate remains).

The unattended Codex process uses `danger-full-access` with approval policy `never` so it can reach the LAN Ollama service and HelpOS. The prompt and recovery skill narrowly constrain its scope. A `running` or `fixed` daily recovery is deduplicated; a failed or `needs_human` 05:00 attempt remains eligible for the 06:00 retry.

See [the recovery runbook](../../../documentation/runbooks/reporter-refinery-recovery.md) for diagnosis, repair, publishing, and escalation rules.
