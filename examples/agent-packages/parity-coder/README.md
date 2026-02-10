# Parity Coder Package

Tracked package for deploying the parity automation agent.

## Install into world

From repo root:

```bash
mkdir -p world/conduct/service
mkdir -p "world/house/parity coder/conduct" "world/house/parity coder/program" "world/house/parity coder/identity"
cp examples/agent-packages/parity-coder/conduct/calendar.pya world/conduct/calendar.pya
cp examples/agent-packages/parity-coder/conduct/service/parity_cycle.pya world/conduct/service/parity_cycle.pya
cp examples/agent-packages/parity-coder/house/conduct/channels.pya "world/house/parity coder/conduct/channels.pya"
cp examples/agent-packages/parity-coder/house/program/parity-cycle-once.txt "world/house/parity coder/program/parity-cycle-once.txt"
cp examples/agent-packages/parity-coder/house/identity/IDENTITY.md "world/house/parity coder/identity/IDENTITY.md"
```

## Run once

```bash
node command/run_parity_agent_cycle.mjs --agent "parity coder" --skip-fix
```

## Run quick smoke

```bash
node command/run_parity_agent_cycle.mjs --agent "parity coder" --skip-fix --skip-tests
```

## Run full cycle

```bash
node command/run_parity_agent_cycle.mjs --agent "parity coder"
```

Artifacts go to:

- `world/house/parity coder/artifacts/<run-id>/`
