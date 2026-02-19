# Agent TUI Session Projection (Reference)

This document explains implementation details for running external agent TUIs (current target: Codex TUI) while keeping Pyash world state canonical.

Normative requirement is in `documentation/specifications/18-pyash-agent.md` (external TUI projection rule).

## Goal

Use external TUI runtimes without splitting history/memory ownership:

- External runtime state (for example `~/.codex`) remains backend runtime/cache.
- Pyash `.pya` files remain canonical for agent sessions, newspaper outcomes, memory, and gold collection inputs.

## Canonical ownership model

1. User launches TUI through Pyash command surface (for example `pyash agent <name> --codex ...`).
2. Pyash resolves `world/house/<agent>/` as the active house.
3. Pyash preserves stable session lane/name semantics in house session files.
4. External runtime session/thread ids are recorded as metadata only.

## Projection targets

- Session conversation: `world/house/<agent>/session/YYYYMMDD-<session>.pya`
- Run/event chronicle: `world/newspaper/YYYYMMDD-agent-<agent>-codex.pya` (or equivalent scoped newspaper)
- Optional operational traces remain in external runtime files; Pyash stores summarized/projected outcomes.

## Projection envelope

Recommended per-turn projection fields:

- user content
- assistant content
- timestamp
- external runtime metadata:
  - provider/tool (`codex`)
  - thread/session id
  - model
  - execution mode (`tui`, `exec --json`, etc.)

In Pyash storage these stay sentence-shaped records, not ad hoc JSON state files.

## Resume semantics

Resume should be Pyash-first:

1. Resolve latest session for `world/house/<agent>/session/`.
2. Use stored external thread/session metadata when available.
3. If external state is missing but Pyash session exists, keep Pyash continuity and start a new external thread while preserving the same Pyash session lane.

## Why this matters

This keeps downstream systems consistent:

- memory extraction reads the same session source regardless of runtime backend
- gold collection and run audits remain in world model
- future TUI backends can reuse one projection contract

## Implementation notes (non-normative)

- `command/pyash/codex_cli.mjs` handles Codex launch + MCP wiring.
- `command/pyash/agent_command.mjs` should resolve agent house and call Codex wrapper with agent context.
- Projection writer should live in Pyash runtime modules (not in backend-specific shell scripts) so additional TUIs can share it.

