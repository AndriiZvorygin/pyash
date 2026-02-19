---
name: pyash-parity
description: "Iterate on true parity gaps only (run passes, runjs/runc fail), track progress in a dedicated report file, and stop on parity plateau or high-churn risk."
---

# Pyash Parity Gap Loop

Use this skill when parity status already exists and the task is to improve parity with targeted, low-noise iterations.

## Scope

- Work only on files where `run=success` and (`runjs=failed` or `runc=failed`).
- Never run a full parity sweep in this workflow.
  - Do not run `./parity-run-and-report.sh`.
  - Do not run `./parity-run.sh`.
  - Do not run `command/run_examples.sh` or `command/run_examples.mjs` for parity iteration.
- Do not spend iteration time on:
  - `run` failures
  - `missing`, `skipped`, or `timeouts`
  - environment-only prerequisites unless user asked to provision them

## Required artifacts

Generate and maintain both files on each parity-improvement session:

- `documentation/parity/gap-targets.json`
  - Machine-readable parity-gap target set.
- `documentation/parity/gap-iteration-report.md`
  - Human-readable iteration log, decisions, and remaining gaps.

## Build parity-gap target file

Run from repo root:

```bash
node - <<'NODE'
const fs = require("node:fs");
const s = require("./documentation/parity/status.json");
const details = s.details || {};
const red = s.parity?.red || [];
const targets = red
  .map((file) => ({ file, info: details[file] || {} }))
  .filter(({ info }) =>
    info?.run?.status === "success" &&
    (info?.runjs?.status === "failed" || info?.runc?.status === "failed")
  )
  .map(({ file, info }) => ({
    file,
    runjsFailed: info?.runjs?.status === "failed",
    runcFailed: info?.runc?.status === "failed",
    runjsTail: info?.runjs?.tail || "",
    runcTail: info?.runc?.tail || ""
  }));
const out = {
  generatedAt: new Date().toISOString(),
  source: "documentation/parity/status.json",
  count: targets.length,
  targets
};
fs.mkdirSync("documentation/parity", { recursive: true });
fs.writeFileSync("documentation/parity/gap-targets.json", JSON.stringify(out, null, 2));
console.log(`wrote documentation/parity/gap-targets.json (${targets.length} targets)`);
NODE
```

## Iteration loop (targeted only)

Repeat until stop criteria are met:

1. Pick a coherent failure cluster from `gap-targets.json` (shared error signature or module).
2. Implement minimal code/test change for that cluster.
3. Re-run only affected targets:
   - `./run "<file>"` (sanity check baseline still passes)
   - `./runjs "<file>"` only if `runjsFailed` is true
   - `./runc "<file>"` only if `runcFailed` is true
   - Optional batch form (targeted only):

```bash
node - <<'NODE'
const fs = require("node:fs");
const cp = require("node:child_process");
const targets = JSON.parse(fs.readFileSync("documentation/parity/gap-targets.json", "utf8")).targets || [];
for (const t of targets) {
  const file = t.file;
  cp.spawnSync("./run", [file], { stdio: "inherit" });
  if (t.runjsFailed) cp.spawnSync("./runjs", [file], { stdio: "inherit" });
  if (t.runcFailed) cp.spawnSync("./runc", [file], { stdio: "inherit" });
}
NODE
```
4. Update `documentation/parity/gap-iteration-report.md` with:
   - iteration number
   - files attempted
   - before/after counts for targeted failures
   - what changed
   - why this change should reduce parity gaps
5. Regenerate `gap-targets.json` from the current `documentation/parity/status.json` snapshot when needed.
   - If the snapshot is stale, ask the user before any full parity rerun.

## Stop criteria

Stop iterating when either condition is true:

1. **Parity plateau**
   - No net decrease in parity-gap failures after one full iteration cycle.
   - Or failure count regresses and root cause is not from the latest patch.
2. **Massive churn risk**
   - Fix clearly requires broad architecture churn (for example, cross-cutting compiler/runtime redesign, heavy refactor across many modules, or external dependency migration).

When stopping, explicitly document why in `gap-iteration-report.md`.

## Required gap explanation quality

For every remaining gap, include:

- failing file
- failing runner(s): `runjs`, `runc`, or both
- concise root-cause hypothesis from error tails
- confidence level (`high`, `medium`, `low`)
- remediation path:
  - code fix in existing module, or
  - new/shared module extraction, or
  - external library/tool recommendation (with why it reduces churn/risk)

## Report template (minimum sections)

`documentation/parity/gap-iteration-report.md` must include:

1. Baseline parity gap count and timestamp
2. Iteration history table
3. Remaining gaps grouped by root cause
4. Plateau/churn stop decision
5. Recommended next actions (smallest-first ordering)
