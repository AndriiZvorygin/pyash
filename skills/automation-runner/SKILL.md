---
name: automation-runner
description: Build, update, or review reusable automation for the Pyash ecosystem. Prefer agent-house workflows, Pyash scheduler/calendar/service definitions, and deterministic artifacts/newspaper outputs over ad hoc cron-only scripts.
---

# Automation Runner

## Overview
Create safe, repeatable automation that is native to Pyash:
- Agent house rooted at `world/house/<agent>/`
- Schedule declared in `conduct/calendar.pya`
- Optional service definition in `world/conduct/service/<service>.pya`
- Deterministic artifacts under `world/house/<agent>/artifacts/<run-id>/`
- Logs/newspaper outside agent control under `world/newspaper/` when applicable

## Quick Start
1. Establish or reconcile the agent house:
   - `node command/agent_admin.mjs --action establish --agent "<agent>" --purpose "<purpose>" --interval-minutes <n>`
2. Put agent-specific automation code in:
   - `world/house/<agent>/program/`
3. Store run artifacts in:
   - `world/house/<agent>/artifacts/<run-id>/`
4. Use scheduler/calendar control instead of ad hoc timers:
   - `from wo calendar su name scheduler be begin do`
   - `from wo calendar su name scheduler be health do`
5. If shell automation is still needed, start from `scripts/automation_template.sh` and keep it house-scoped.

## Workflow

### 1. Define inputs and outputs
- Identify target program(s), files, and service/job name.
- Define artifact and report locations first:
  - `world/house/<agent>/artifacts/<run-id>/...`
- Define deterministic status outputs (json and/or Pyash sentence records).

### 2. Add safety rails
- Enforce overlap protection (presence/lock).
- Add preflight checks (required commands, expected files).
- Prefer deterministic retry boundaries.
- Keep writes inside house root plus explicit shared roots.

### 3. Implement the job
- For parity-style loops, use existing project commands where possible:
  - `node command/run_parity_examples.mjs --status <path>`
  - `npm test`
- Keep each stage explicit:
  - measure baseline
  - attempt fixes
  - remeasure
  - emit delta summary

### 4. Add alerting
- Aggregate failure/regression reasons into one message.
- Prefer existing channel/news pathways (for example Matrix through existing runtime) instead of bespoke notifier code.
- Alert only on regressions, no-improvement cycles, or hard failures.

### 5. Test locally
- Run once manually and verify artifacts land in the agent house.
- Verify scheduler behavior:
  - begin/list/health/stop
- Verify idempotence:
  - repeated establish/reconcile should return unchanged when inputs are unchanged.
- Verify parity-safe behavior:
  - fix attempt should not regress unrelated tests.

## Pyash-first conventions
- Keep automation code in the agent house unless explicitly shared.
- Keep run outputs isolated per run id.
- Reuse existing verbs/commands before adding new ad hoc shell glue.
- Preserve deterministic, replayable records.
- For Matrix-enabled automation, prefer the `matrix channel` config map in `configure/secret.pya` over scattered scalar facts.

Matrix map example:

```pyash
su name matrix channel be map def
su name homeserver ob text "https://matrix.liberit.ca" ya
su name room ob text "!roomid:matrix.liberit.ca" ya
su name executive username ob text "@andrii:matrix.liberit.ca" ya
su name token ob text "<access-token>" ya
prah
```

## Parity agent pattern
When building a parity automation agent, use this staged contract:
1. Run parity baseline and save status json.
2. Determine candidate mismatches (`run` green, `runjs` or `runc` red).
3. Run fixing stage (for now may invoke `codex --full-auto ...` through command).
4. Re-run parity and compute delta.
5. Notify:
   - improvement -> matrix/update channel
   - no improvement/regression -> alert channel + artifact link

## Resources

### scripts/
- `automation_template.sh`: House-scoped fallback shell template (lock, run-id artifacts, alert aggregation).

### references/
- `automation-checklist.md`: Pyash-oriented checklist for reliable scheduled automation.
