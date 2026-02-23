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
cp examples/agent-packages/parity-coder/house/program/parity-skill-cycle.sh "world/house/parity coder/program/parity-skill-cycle.sh"
chmod +x "world/house/parity coder/program/parity-skill-cycle.sh"
cp examples/agent-packages/parity-coder/house/identity/IDENTITY.md "world/house/parity coder/identity/IDENTITY.md"
```

## Run once

```bash
bash "./world/house/parity coder/program/parity-skill-cycle.sh" --agent "parity coder" --repo-root . --world-root ./world
```

## Run quick smoke

```bash
bash "./world/house/parity coder/program/parity-skill-cycle.sh" --agent "parity coder" --repo-root . --world-root ./world --skip-codex
# Or skip parity too for wiring smoke:
bash "./world/house/parity coder/program/parity-skill-cycle.sh" --agent "parity coder" --repo-root . --world-root ./world --skip-parity --skip-codex --skip-notify
```

## Run full cycle

```bash
bash "./world/house/parity coder/program/parity-skill-cycle.sh" --agent "parity coder" --repo-root . --world-root ./world
```

Artifacts go to:

- `world/house/parity coder/artifacts/<run-id>/`
