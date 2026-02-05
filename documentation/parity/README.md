# Parity Tracking

This folder stores the last known parity status across `./run`, `./runjs`, and `./runc`.

## Update

Run:

```bash
node command/run_parity_examples.mjs
```

Optional flags:

- `--status <path>`: write the status JSON elsewhere (default `documentation/parity/status.json`).
- `--timeout-ms <ms>`: override per-example timeout (default 30000).
- `--include-mind`, `--include-say`, `--include-command`, `--parallel`, `--parallel-all`: passed through to `command/run_examples.mjs`.

## Status File

`status.json` contains:

- `lastRun`: ISO timestamp.
- `run`: results from `command/run_examples.mjs` (successes, failures, missing, timeouts, skipped).
- `runjs`/`runc`: successes, failures, timeouts for compiled runners.
- `parity`: `green` for examples that passed all three, `red` for run-success cases that failed in runjs or runc.
- `details`: per-example run/runjs/runc status with tail text for failures.

## Run Report (Temp)

The parity runner streams the `./run` report to `/tmp/pyash-parity/run-report.json` while it runs.
