---
name: pyash-channel-debug
description: "Diagnose and verify Matrix channel wiring end-to-end, including configure flow, agent creation flow, mention-gate behavior, and executive DM delivery."
---

# Pyash Channel Debug

Use this skill when Matrix channel behavior is broken or uncertain, especially for:
- `configure channel matrix` regressions
- agent home/license/runtime creation issues
- mention-gate not respected in public rooms
- DM delivery not working for executive user
- repeated `mind defective` / sandbox defects from channel traffic

## Quick smoke commands

Matrix configure + channel behavior smoke (from-scratch for one agent):

```bash
node command/matrix_configure_smoke.mjs --json
```

Agent creation smoke (wraps matrix smoke and asserts creation artifacts):

```bash
node command/agent_creation_smoke.mjs --json
```

## Defaults

- Matrix smoke default agent: `mricge`
- Agent-creation smoke default agent: `agent-creation-smoke`
- Default executive user: `@mricge-smoke:matrix.liberit.ca`

Both scripts support:
- `--root <path>`
- `--agent <name>`
- `--executive <@user:server>`
- `--wipe <truth|lie>`
- `--restart-calendar <truth|lie>`
- `--restore-room <truth|lie>`

## Expected pass criteria

`matrix_configure_smoke.mjs` should report:
- `checks.untaggedPublicReply: false`
- `checks.taggedPublicReply: true`
- `checks.dmReply: true`
- `steps.houseReady: true`
- `steps.configureChannel.liveOk: true`

`agent_creation_smoke.mjs` should additionally report:
- house files present under `world/house/<agent>/`
- runtime backend/model written
- directory license block present in `world/conduct/agent.pya`
- agent visible in `pyash configure agent list --json`

## Triage sequence when smoke fails

1. Check live channel config:
   - `node command/pyash.mjs configure channel matrix doctor --json`
   - `node command/pyash.mjs configure channel matrix test --json`
2. Check scheduler health:
   - `node command/pyash.mjs calendar health --json`
3. Check per-agent matrix telemetry:
   - `node command/pyash.mjs channel log --agent <agent> --channel matrix --tail 120 --json`
4. Check agent house creation:
   - `find world/house/<agent> -maxdepth 3 -type f | sort`
5. Check directory license:
   - `rg -n "<agent> directory license" world/conduct/agent.pya`

## Notes

- Smoke scripts intentionally use real Matrix calls for end-to-end validation.
- `matrix_configure_smoke.mjs` restores the original configured room by default.
- If Matrix homeserver rate-limits (`429`) appear intermittently, rerun smoke once before concluding regression.
