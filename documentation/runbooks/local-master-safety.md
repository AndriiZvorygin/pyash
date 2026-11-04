# Local Master Safety Check

GitHub CI runs the focused checks on `dev` and `master`. The full CI-tier suite
runs locally from cron against a freshly fetched `github/master` snapshot.

## Install and operate

From this checkout:

```bash
command/install_local_master_safety_cron.sh
command/run_local_master_safety.sh
crontab -l
command/uninstall_local_master_safety_cron.sh
```

The installer replaces only its marked crontab block and preserves unrelated
jobs. The schedule is daily at 04:00 in the host's local timezone. The runner
uses `flock` to prevent overlapping runs.

## What it does

Each run fetches `github/master`, creates a disposable Git worktree beside the
repository, runs `npm ci`, then runs `npm run test:ci`. If tests fail, Codex
`gpt-6-luna` at `xhigh` gets at most two repair attempts in that worktree. Each
attempt is followed by a complete `npm run test:ci` run. Tests are not weakened
to make the check green.

Codex uses `danger-full-access` because this host's workspace sandbox cannot
start bubblewrap network namespaces. The separate worktree, bounded prompt,
no-secret/no-push instructions, test reruns, and local-only candidate commits
reduce accidental impact; full-access Codex still has the host's filesystem
and network permissions, so review candidate changes before integrating them.

When a repair passes the entire suite, the runner records a commit on a local
`local-master-safety/*` branch. It does not push or merge automatically. A
failed or unsafe-to-commit repair remains in its isolated worktree for
inspection. The main `master` and `dev` worktrees are not modified.

## Evidence

Artifacts are written to:

```text
artifacts/local-master-safety/<UTC-run-id>/
```

Each run contains `run.log`, per-attempt full-suite logs, Codex JSONL/stderr
traces and final messages, and `result.pya`. A verified repair also includes
`verified-repair.patch` and `candidate-commit.txt`. A preserved failed worktree
path and candidate branch are recorded in `result.pya` and `run.log`.

Optional environment overrides include `PYA_MASTER_SAFETY_REMOTE`,
`PYA_MASTER_SAFETY_BRANCH`, `PYA_MASTER_SAFETY_MODEL`,
`PYA_MASTER_SAFETY_REASONING`, `PYA_MASTER_SAFETY_MAX_REPAIRS` (0–2),
`PYA_MASTER_SAFETY_REPOSITORY`, and `PYA_MASTER_SAFETY_CODEX_BIN`.
