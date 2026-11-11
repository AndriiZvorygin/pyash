# Local Dev-to-Master Maintainer

The local maintainer promotes `dev` into `master` only after the exact proposed
merge passes Pyash's full CI-tier test suite. It also synchronizes accepted
`master` revisions back into `dev`, so the two branches converge after a green
run.

## Install and operate

From the development checkout:

```bash
command/install_local_master_safety_cron.sh
command/run_local_master_safety.sh
crontab -l
command/uninstall_local_master_safety_cron.sh
```

The installer replaces only its marked crontab block and preserves unrelated
jobs. The schedule is daily at 04:00 in the host's local timezone. The runner
acquires its own `flock` lock to prevent overlapping cron and manual runs; the
crontab calls the runner directly so it does not contend with itself.

## Promotion gate

Each run fetches `master` and `dev` from the configured push remotes (by
default, `origin` and `github`). It stops if those remotes disagree. In a
disposable Git worktree it merges `dev` into `master`, installs dependencies,
and runs `npm run test:ci` against that exact candidate. Existing checkouts,
including a dirty local `master` worktree, are not checked out or modified.

If the full suite fails, Codex `gpt-6-luna` at `xhigh` gets at most two repair
attempts in that isolated candidate. Each attempt is followed by a complete
suite run. Tests are not weakened to make the check green. A conflict, failed
suite, unsafe repair, or stale push leaves the branches unpromoted and records
the candidate for inspection.

After a green suite, the tested commit is pushed atomically to both `master`
and `dev` on each configured remote. This promotes development work and
incorporates any intervening master history into dev. Pushes are never forced.
Atomicity applies per remote; if a later remote rejects the push after an
earlier remote accepted it, the run records which remote moved and stops so
the refs can be reconciled before the next run.

Codex uses `danger-full-access` because this host's workspace sandbox cannot
start bubblewrap network namespaces. The separate worktree, bounded prompt,
no-secret/no-push instructions for the repair agent, test reruns, and
path-protected candidate commit reduce accidental impact. Full-access Codex
still has the host's filesystem and network permissions, so review artifacts
after any automated repair.

## Evidence

Artifacts are written to:

```text
artifacts/local-master-safety/<UTC-run-id>/
```

Each run contains `run.log`, per-attempt full-suite logs, Codex JSONL/stderr
traces and final messages, and `result.pya`. A verified repair includes
`verified-repair.patch` and `candidate-commit.txt`; a successful promotion
includes `promoted-commit.txt`. The result records source master/dev commits,
promoted commit, pushed remotes, and any preserved worktree.

Optional environment overrides include `PYA_MASTER_SAFETY_REMOTE`,
`PYA_MASTER_SAFETY_BRANCH`, `PYA_MASTER_SAFETY_DEV_BRANCH`,
`PYA_MASTER_SAFETY_PUSH_REMOTES`, `PYA_MASTER_SAFETY_MODEL`,
`PYA_MASTER_SAFETY_REASONING`, `PYA_MASTER_SAFETY_MAX_REPAIRS` (0–2),
`PYA_MASTER_SAFETY_REPOSITORY`, and `PYA_MASTER_SAFETY_CODEX_BIN`.
