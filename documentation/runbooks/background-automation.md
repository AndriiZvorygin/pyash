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
