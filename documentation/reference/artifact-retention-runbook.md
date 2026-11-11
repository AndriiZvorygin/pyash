# Artifact Retention Runbook

Pyash has two separate retention mechanisms. Newspaper size rotation runs when
a saddle shuts down; age-based artifact cleanup is an operator command and is
scheduled locally per checkout.

## Newspaper Size Rotation

`configure/default.pya` sets a combined newspaper budget of 500 MiB, a maximum
segment size of 4 MiB, and a 30-day age limit. When a saddle exits, it rotates
the repository-level `newspaper/`, `world/newspaper/`, and each
`world/coding-saddle-projects/*/newspaper/` directory together, retaining the
newest complete Pyash records within the size and segment limits. This is
automatic; the standalone command can preview or apply the same rotation:

```bash
node command/rotate_world_newspapers.mjs
node command/rotate_world_newspapers.mjs --apply
```

## Age-Based Cleanup

Preview first. This reports dated run directories, expired newspaper logs, and
unreferenced content-addressed files eligible under the configured 30-day
policy:

```bash
npm run artifacts:prune
```

Apply only after reviewing the preview:

```bash
npm run artifacts:prune -- --apply
```

The CLI defaults to the checkout containing the command. `--root` selects a
different Pyash workspace and, by default, reads its `configure/default.pya`:

```bash
node /path/to/pyash-dev/command/prune_artifacts.mjs --root /path/to/pyash --apply
```

Use `--config-root /path/to/pyash` only when the workspace and policy checkout
are intentionally different. This is useful during a staged dev-to-master
rollout; ordinary installations should keep workspace and config in the same
checkout.

The newspaper-pinned collector is a separate operation. `npm run artifacts:clean`
previews run directories and content-addressed objects that have no canonical
newspaper reference; it does not replace the age-based retention pass.

## Local Schedule

Install one scheduled age-cleanup job per checkout and host; a job only cleans
the selected checkout's workspace. A daily run is sufficient for the 30-day
policy. Use `flock` to prevent overlapping runs and send output to the system
journal rather than creating another log under `artifacts/`:

```cron
CRON_TZ=America/Toronto
0 5 * * * /usr/bin/flock -n /tmp/pyash-artifact-retention.lock /bin/bash -o pipefail -c '/path/to/node /path/to/pyash/command/prune_artifacts.mjs --root /path/to/pyash --apply 2>&1 | /usr/bin/logger -t pyash-artifact-retention'
```

Replace both paths for each installation. When using the dev checkout's cleaner
against another checkout, use the dev command path, set `--root` to the target,
and set `--config-root` to the checkout that currently carries the approved
retention policy. Inspect a preview before enabling `--apply`. On systems using
systemd-journald, review scheduled output with:

```bash
journalctl -t pyash-artifact-retention
```
