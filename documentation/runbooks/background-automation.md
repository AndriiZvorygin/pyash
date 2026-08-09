# Background Roadmap Automation

Pyash's unattended roadmap lane is deliberately separate from `master`.
Hourly work starts from `automation/roadmap`, follows weekly Codex pacing, and
can advance only that branch after Sol accepts a task. The daily digest is the
only routine email.

## Private configuration

The cron wrappers source:

```text
/home/htaf/.config/pyash/background.env
```

Keep this file outside Git with directory mode `700` and file mode `600`. It
contains the automation branch, mail sender/recipient, Node/Codex paths, and
the Mailserver container name.

## Install

From the repository:

```bash
command/install_background_cron.sh
command/check_background_automation.sh
```

Installation is idempotent. It replaces only the marked Pyash block and
preserves unrelated crontab entries:

```cron
# BEGIN PYASH ROADMAP AUTOMATION
17 * * * * /home/htaf/pyash/command/run_background_roadmap.sh
30 7 * * * /home/htaf/pyash/command/send_background_digest.sh
# END PYASH ROADMAP AUTOMATION
```

The host timezone is America/Toronto. The wrappers use the normal isolated
Codex workspace settings and never set `danger-full-access`.

## Runtime

The hourly wrapper runs one opportunity and exits. It does not use
`--continuous` and does not send email. The digest wrapper runs once daily and
uses the durable report renderer plus the existing Docker Mailserver transport.
Both share `/tmp/pyash-roadmap.lock`; a concurrent invocation logs a skip and
exits successfully.

Logs are:

```text
/home/htaf/pyash/log/background-roadmap.log
/home/htaf/pyash/log/background-digest.log
```

`/etc/logrotate.d/pyash-background` rotates them weekly, keeps eight compressed
rotations, and leaves missing or empty logs alone.

## Autonomous roadmap

The durable roadmap is derived from the work queue and current repository planning inputs. Its canonical artifact is:

```text
world/holding/work/artifacts/autonomous-roadmap.pya
```

The generated review copy is `autonomous-roadmap.md`. Inspect it without using Codex:

```bash
node command/work_supervisor.mjs roadmap
node command/work_supervisor.mjs roadmap --json
```

Packages are grouped as `ACTIVE`, `QUEUED`, `CANDIDATE`, `BLOCKED / NEEDS DECISION`, or `COMPLETE`. The active package is enriched from its durable task checkpoint, including Sol's plan, Luna's pass count, worktree, commit, and blocker. The catalog is intentionally limited to substantial roadmap increments.

Sol roadmap review is explicit and occasional, not part of every hourly wake:

```bash
node command/work_supervisor.mjs roadmap refresh
node command/work_supervisor.mjs roadmap refresh --if-needed
```

Refresh is appropriate when fewer than three credible candidates remain, dependencies materially change, a blocker requires architecture input, or the roadmap/TODO changes materially. A refresh must return five to eight structured packages before replacing the durable package catalog; malformed or undersized output is rejected without discarding the previous roadmap.

## Automation baseline policy

`master` remains human-controlled. Before a new autonomous task is based, the runner synchronizes `automation/roadmap` with local `master`, preserving both histories. An active task is never rebased or restarted; its existing worktree and checkpoint continue untouched. If its accepted commit is based on the previous automation tip, integration safely cherry-picks it onto the synchronized branch. Merge or cherry-pick conflicts block the task for human attention.

Inspect or perform synchronization explicitly with:

```bash
node command/work_supervisor.mjs roadmap sync-baseline
```

The hourly runner skips baseline synchronization while a substantial task is already active and performs it before starting the next task. Set `PYA_AUTOMATION_PUSH_BASELINE=truth` in the private environment when synchronized automation-branch tips should also be pushed to both configured remotes.

The daily digest includes a compact roadmap section showing active work, the next queued packages, later candidates, and decisions requiring human input.

## Codex execution preflight

Before a background task is claimed, Pyash checks the selected repository/worktree, writable access, Git, Node, Codex App Server initialization, and the configured thread sandbox. The supervisor repeats the check against the task worktree before opening manager or worker turns. A failed check is recorded as an infrastructure deferral in scheduler health and newspaper history; it does not make a roadmap task defective or claim the next task.

Run the disposable smoke explicitly with:

```bash
node command/work_supervisor.mjs sandbox-smoke --repository /home/htaf/pyash --json
```

The normal `workspace-write`/`workspaceWrite` mode currently cannot execute shell operations on this host because its bubblewrap network namespace setup fails with `RTM_NEWADDR: Operation not permitted`, even though the repository and worktrees are writable. Until the host sandbox capability is repaired, the private cron environment uses `danger-full-access`/`dangerFullAccess` as an explicit fallback. Pyash still pins every task to its assigned worktree, limits the prompt/work order, integrates only onto `automation/roadmap`, and never updates `master` automatically. The fallback must be revalidated with `sandbox-smoke` after host or Codex changes.

Set `PYA_BACKGROUND_EXECUTION_BLOCKED=truth` to keep hourly implementation wakes globally deferred while preserving daily digest operation. Remove that gate only after the smoke passes.

## Verify and disable

The doctor checks permissions, executables, Codex weekly capacity, Docker
Mailserver, Git identity, clean checkout, automation branch, scheduler health,
recipient, cron block, and lock availability:

```bash
command/check_background_automation.sh
```

To disable scheduling without touching tasks, worktrees, checkpoints, reports,
or branches:

```bash
command/uninstall_background_cron.sh
```

The marked crontab block can also be removed manually. Re-running the install
script restores it without duplicating entries.

`master` remains human-controlled. Promotion from `automation/roadmap` to
`master` is an explicit human operation.
