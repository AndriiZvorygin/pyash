# Operating Recipe: Pyash Agent Administration

This recipe is practical operations guidance for configuring and running Pyash agents.
Normative behavior stays in specifications.

## 1. Onboard a fresh runtime

```bash
pyash configure intro
pyash configure channel
pyash configure mind
pyash configure agent
pyash calendar begin
pyash calendar health
```

Expected outcome:
- Channel relay configured
- At least one mind relay configured
- Default agent configured
- Scheduler running

## 2. Daily health checks

```bash
pyash calendar health
pyash calendar list
pyash channel log --agent pyash-agent --tail 120
```

If Matrix is configured:

```bash
pyash configure channel matrix test --json
pyash configure channel matrix doctor --json
```

## 3. Reconcile config idempotently

Use non-interactive mode for stable reruns in scripts:

```bash
pyash configure channel matrix --non-interactive --json
pyash configure mind --non-interactive --json
pyash configure agent --agent "pyash-agent" --non-interactive --json
pyash calendar restart
```

## 4. Mind relay operations

```bash
pyash configure mind list
pyash configure mind
```

Guidance:
- Configure multiple relays if needed.
- Keep one clear default relay.
- Set per-agent override in `pyash configure agent` when an agent needs a different relay/model.

## 5. Agent operations

```bash
pyash configure agent list
pyash configure agent
pyash configure agent delete --agent "<name>"
```

Notes:
- Agent house name is internal identity (`world/house/<agent>/`).
- Channel username is external identity and can differ by platform.
- Agent configure runtime flow is backend-first:
  - choose backend
  - choose model (from matching relay models when available)
  - optional relay match is inferred from backend+model
- Keep `Start agent services now` enabled for normal use so the agent becomes active immediately.

Non-interactive example:

```bash
pyash configure agent improve \
  --agent "parity coder" \
  --relay codex5.3 \
  --bind-channel truth \
  --start-now truth \
  --smoke-test lie \
  --non-interactive --json
```

## 6. Common recovery flow

If the agent is online but not replying:

1. Validate channel auth and delivery.
2. Validate default mind relay.
3. Restart scheduler.
4. Re-check channel logs.

Commands:

```bash
pyash configure channel matrix test --json
pyash configure mind list
pyash calendar restart
pyash channel log --agent pyash-agent --tail 200
```

If channel test passes and logs show `no mind configured yet`, run `pyash configure mind`.

If the agent was configured with channel binding, verify its per-agent schedule exists:

```bash
cat world/house/<agent>/conduct/calendar.pya
```

Expected managed block includes `matrix poll` (minute 1).

## 7. Files to inspect

- `configure/secret.pya`
- `world/conduct/channels.pya`
- `world/house/pyash-agent/conduct/channels.pya`
- `world/house/pyash-agent/conduct/calendar.pya`
- `world/newspaper/`

Prefer `.pya` managed files. Avoid ad hoc JSON state/config files.
