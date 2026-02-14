# Agent Memory Model (Current Implementation)

This document describes how agent memory works today in the runtime.

## Scope

- Agent memory here means memory used by `mind` calls when `agent tools` are enabled.
- It includes in-memory dialogue state and file-backed agent state in each agent house.

## Agent House Resolution

- Agent house path is resolved from `world/conduct/agent.pya` via `program/library/agent_command_policy.mjs`.
- Preferred declaration is `su name <agent> house directory ob filename "<path>" ya`.
- Fallback is `world/house/<agent>` if no declaration exists.
- Resolver entrypoint is `resolveAgentHouse` in `program/agent/session.mjs`.

## Storage Layout

Per agent house, runtime ensures these directories exist:

- `identity/`
- `conduct/`
- `memory/`
- `session/`

Defined in `ensureAgentDirs` at `program/agent/session.mjs`.

## Memory Layers

There are two active memory layers.

1. In-memory runtime layer (`program/remember/index.mjs` + mind session cache)
- Mind turns are recorded as facts (`result`, `<mind> <dialogue> answer N`, etc.).
- Dialogue logs are mirrored into `mind session map` and `<dialogue> session` series facts.
- This layer drives immediate runtime behavior and backward-compatible mind history paths.

2. File-backed agent layer (agent house)
- `session/*.pya` stores structured chat transcripts for each session.
- `memory/SUMMARY.md` stores rolling compressed summary text.
- `memory/MEMORY.md` stores long-term notes (`during wo always`).
- `memory/YYYY-MM-DD.md` stores daily notes/reminders.

## Session File Format

Session files are Pyash sentence logs:

- Header includes `be series def` and a `system` sentence.
- Each turn appends `su name user ... ya` and `su name assistant ... ya`.
- System model changes append an updated `system` sentence.

Writers/readers:

- `appendSessionEntry` in `program/agent/session.mjs`
- `readSessionMessages` in `program/agent/session.mjs`
- `readSessionMessagesWithFallback` (today + yesterday merge for named sessions)

## Prompt Assembly

Agent system prompt is built by `buildAgentSystemPrompt` in `program/agent/context.mjs`.

Order:

- Identity block (time, agent name, agent house)
- Config prompt (`fromtext` from mind config, if set)
- Identity bootstrap docs from `identity/` (+ optional base identity merge)
- Roles docs from `roles/` (if present)
- `memory/SUMMARY.md` as `# Summary` (if present)
- `memory/MEMORY.md` and today’s daily note as `# Memory` (if present)
- Tool explainer block (remember usage hints)

## Turn Lifecycle (Agent-Enabled Mind)

Implemented in `program/verbs/mind/mind.mjs`.

1. Resolve agent house and ensure dirs exist.
2. Build full agent system prompt.
3. Resolve/create session file for the turn.
4. Load bounded history messages from session file.
5. Call backend/tool chat with system prompt + history + current user text.
6. Append user/assistant entries to session file.
7. Refresh `memory/SUMMARY.md` via a summary sub-call.
8. Record answer facts into in-memory runtime memory.

## Persistent Note Writes

`be remember ...` writes to file-backed memory via `program/verbs/remember.mjs`.

- `during wo always` -> `memory/MEMORY.md`
- `during date today|tomorrow|YYYY-MM-DD` -> `memory/<date>.md`
- Missing date defaults to today.

## Current Source of Truth

- Agent house path: `world/conduct/agent.pya`
- Session transcript: `world/house/<agent>/session/*.pya`
- Persistent memory notes: `world/house/<agent>/memory/*`
- Runtime conversational facts: in-process remember store

## Known Architectural Reality

- The runtime currently uses both in-memory conversation facts and file-backed session history.
- File-backed session history is the main durable context used for agent prompt history.
- In-memory mind session facts are still maintained for compatibility and inspection.
