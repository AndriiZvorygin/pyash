---
name: pyash-agent-admin
description: "Configure, reconcile, and debug Pyash agents, channel relays, mind relays, and calendar runtime; use for onboarding and for fixing agent/channel runtime issues."
---

# Pyash Agent Admin

Use this skill when working on `pyash configure`, channel/mind wiring, agent setup, and scheduler/runtime health.

Companion recipe: `documentation/recipes/pyash-agent-admin.md`.

## Scope

- Agent onboarding: `intro -> channel -> mind -> agent`
- Agent runtime health: calendar/channel logs
- Channel identity fixes (agent name vs channel username)
- Safe reconfigure/restart loops
- Agent configure runtime selection: backend first, then model, then optional relay match

## Baseline flow

1. `pyash configure intro`
2. `pyash configure channel matrix`
3. `pyash configure mind`
4. `pyash configure agent`
5. `pyash calendar begin`
6. `pyash calendar health`

## High-signal checks

- Channel doctor/test:
  - `pyash configure channel matrix doctor --json`
  - `pyash configure channel matrix test --json`
- Scheduler:
  - `pyash calendar health`
  - `pyash calendar list`
- Channel telemetry:
  - `pyash channel log --agent pyash-agent --tail 120`

## Identity model (important)

- Internal identity: agent house name (`world/house/<agent>/`)
- External identity: per-channel username (for example Matrix user id)
- Keep them separate; do not rename houses to satisfy channel username rules.

For Matrix appservice mode:
- Source of sender identity: `configure/secret/matrix.yaml` (`sender_localpart`)
- Materialized runtime user:
  - `configure/secret.pya` map `matrix channel -> user`
  - `world/house/<agent>/conduct/channels.pya` sentence `su name matrix user ...`

## Sender switch procedure (Matrix)

When changing appservice sender:

1. Edit `configure/secret/matrix.yaml` (`sender_localpart`)
2. Apply:
   - `pyash configure channel matrix --non-interactive --json`
3. Restart runtime:
   - `pyash calendar restart`
4. Verify:
   - `pyash configure channel matrix test --json`
   - ensure `whoami.userId` is expected sender

## Common failures and fixes

- `ENOENT ... configure/secret/configure/secret/matrix.yaml`
  - Cause: wrong root detection from nested cwd.
  - Fix: run from repo root or pass `--root <repo>`.

- `matrix send failed ... M_FORBIDDEN ... not in room`
  - Run `pyash configure channel matrix test --json` to refresh DM mapping/join state.
  - Reconfigure + restart if sender changed.

- Agent replying to itself in loops
  - Check `pyash channel log ...` for self events.
  - Ensure per-agent channel user matches actual sender identity.
  - Re-run channel configure and restart calendar.

- `no mind configured yet`
  - Configure relay:
    - `pyash configure mind`
  - Then restart:
    - `pyash calendar restart`

## Agent management commands

- List:
  - `pyash configure agent list`
- Create/update:
  - `pyash configure agent`
  - In interactive flow: select backend first, then model.
  - Keep `Start agent services now` enabled unless intentionally staging-only.
- Delete:
  - `pyash configure agent delete --agent "<name>"`

Non-interactive relay + activation pattern:
- `pyash configure agent improve --agent "<name>" --relay "<relay>" --bind-channel truth --start-now truth --smoke-test lie --non-interactive --json`

## Notes

- Prefer `.pya` managed files; avoid introducing ad hoc JSON config/state.
- Treat `pyash configure ... --non-interactive --json` as idempotent reconciliation.
- Channel bind now also writes managed per-agent channel schedule (`matrix poll`, minute 1).
