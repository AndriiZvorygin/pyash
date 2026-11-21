# Local Dev-to-Master Maintainer

The local maintainer promotes the configured development branches into
`master` only after the exact proposed merge passes Pyash's full CI-tier test
suite. It also synchronizes accepted `master` revisions back into `dev`, so
the mainline branches converge after a green run.

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

Each run fetches `master`, `dev`, `dev-vocab`, and `dev-vliw-backend` from the
source remote and every configured push remote (by default, `origin` and
`github`). The development source branches are configurable with
`PYA_MASTER_SAFETY_DEV_BRANCH` and `PYA_MASTER_SAFETY_ADDITIONAL_SOURCE_BRANCHES`.
It records every branch tip, then merges all fetched `master` tips followed by
all fetched development branch tips into a disposable candidate worktree. This
joins commits that arrived on different remotes and promotes one tested
history to `master` and `dev` on every configured remote; it leaves the source
feature branch unchanged. If the only merge conflict is the generated Kwon
Chinese Pinyin index, the runner rebuilds that projection from the merged
vocabulary and grammar inputs, then completes the merge. For other conflicts,
Codex is asked to resolve only the conflicted paths in the isolated candidate.
The runner checks that no unrelated paths or candidate history changed, stages
the resolved paths, rejects remaining conflict markers, and completes the merge
before testing. An unsafe or incomplete resolution leaves the candidate for
review. The runner installs dependencies and runs
`npm run test:ci` against that exact candidate. Existing checkouts, including
a dirty local `master` worktree, are not checked out or modified.
The CI-tier runner uses at most four concurrent test workers to reduce host
contention; it uses fewer when the resource-based limit is lower.
The runner adds `$HOME/.cargo/bin` to `PATH` when present so cron can build
Rust-backed test prerequisites with the installed toolchain.
After a green suite, it fetches the branch inputs again. If a source advances
during testing, the runner merges the new tip and reruns the suite, up to two
refreshes; continued movement preserves the candidate without promotion.

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
traces and final messages, and `result.pya`. The result records every fetched
branch tip in `remote branch inputs`. A verified repair includes
`verified-repair.patch` and `candidate-commit.txt`; a successful promotion
includes `promoted-commit.txt`. The result records source master/dev commits,
promoted commit, pushed remotes, and any preserved worktree.

Optional environment overrides include `PYA_MASTER_SAFETY_REMOTE`,
`PYA_MASTER_SAFETY_BRANCH`, `PYA_MASTER_SAFETY_DEV_BRANCH`,
`PYA_MASTER_SAFETY_ADDITIONAL_SOURCE_BRANCHES`,
`PYA_MASTER_SAFETY_PUSH_REMOTES`, `PYA_MASTER_SAFETY_MODEL`,
`PYA_MASTER_SAFETY_REASONING`, `PYA_MASTER_SAFETY_MAX_REPAIRS` (0–2),
`PYA_MASTER_SAFETY_REPOSITORY`, and `PYA_MASTER_SAFETY_CODEX_BIN`.
