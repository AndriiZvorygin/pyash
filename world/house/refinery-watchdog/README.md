# Refinery Watchdog

This house monitors the Andrii YouTube, Owen Sound, and Grey County nightly reporters. It checks the same remote-aware candidate state used by the reporters. A clean `no candidate` result is healthy; an eligible unpublished candidate or a failed probe is an incident.

## Entry points

- `node world/house/refinery-watchdog/program/check-refineries.mjs` performs a non-publishing health inspection.
- `node world/house/refinery-watchdog/program/run-watchdog.mjs` checks health and may start authorized Codex recovery.
- `node world/house/refinery-watchdog/program/run-nightly-refinery.mjs <andrii|owen|grey>` runs one scheduled reporter with status artifacts and overlap protection.
- `node world/house/refinery-watchdog/program/install-cron.mjs` idempotently installs the managed cron block.

Artifacts are written beneath `artifacts/nightly/<date>/` and `artifacts/watchdog/<date>/`. The watchdog deduplicates Codex launches with `artifacts/state/<date>.recovery.pya` and sends executive Matrix DMs for recovery starts, verified fixes, unresolved incidents, and work still active at 06:00.

The reporter pipelines already serialize GPU-heavy execution with `/tmp/municipal-reporter-pipeline.lock`. The watchdog also respects each reporter's cron lock and never interrupts an active job.

## Operating policy

The 05:00 check defers if reporter work is active. The 06:00 check tries again; if work remains active it alerts and exits without overlap. Multiple failures are sent to one Codex session. A Codex success is not accepted until an independent remote-aware candidate probe confirms that no affected candidate remains.

See [the recovery runbook](../../../documentation/runbooks/reporter-refinery-recovery.md) for diagnosis, repair, publishing, and escalation rules.
