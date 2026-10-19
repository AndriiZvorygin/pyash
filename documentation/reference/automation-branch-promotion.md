# Automation Branch Promotion

Pyash keeps autonomous accepted work on `automation/roadmap` while `master`
remains the human-controlled mainline. This is a deliberate review boundary,
not a second permanent product branch.

## Audit

Inspect both refs and their mergeability without changing either branch:

```text
node command/work_supervisor.mjs roadmap audit --json
```

The result records the merge base, ahead/behind counts, unique commits and
the durable WorkTask commit evidence available in the current world.

## Promotion

Promotion preserves both histories. It performs a normal merge of
`automation/roadmap` into `master` when the refs diverge, then aligns the
automation branch with the resulting mainline revision. It never resets,
rebases, force-pushes, or edits a task record to make history appear complete.

Run the local promotion after the audit and test review:

```text
node command/work_supervisor.mjs roadmap promote --json
```

To push the resulting normal commits to both configured remotes, use the
operator environment setting:

```text
PYA_AUTOMATION_PUSH_PROMOTION=truth \
node command/work_supervisor.mjs roadmap promote --json
```

The promotion event is recorded in the work-scheduler newspaper with the
source revision, mainline revision, merge base, resulting revision and push
status.

## Scheduler gate

The background runner synchronizes `automation/roadmap` with the current
`master` before curation and candidate selection. If synchronization cannot
complete, it records a baseline-control-plane blocker and does not start a new
ordinary model workflow on the stale baseline. Existing active work is left
alone, and the normal bounded blocker-repair lane may repair the synchronization
problem.

This keeps the roadmap projection, task base revision and integration branch
on one coherent baseline while preserving the separate human promotion step.
