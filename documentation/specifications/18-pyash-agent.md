# 18. Pyash Agent

Purpose: define agent loop, session/memory storage, scheduler hooks, and channel integration.

## 1. Agent house keyword table

| Path | Meaning | Application |
| --- | --- | --- |
| `identity/` | role/config prompt sources | stable agent behavior seed |
| `session/` | active session lines | conversation continuity |
| `memory/` | long + dated memories | retrieval injection |
| `conduct/` | policy/calendar/ratify/channel | run controls and approvals |

Session files stay in agent house; operational logs go to world newspaper.

## 2. Session model

Session key: `yyyymmdd-<name>` (name sanitized to alnum + underscore).

Header:
```pyash
su name <session key> since date <yyyy-mm-dd> be series def
```

Per-append line should include:
- `during date <timestamp>`
- system prompt start record (`su name system ob text ...`)
- model marker and model-change records when model changes

## 3. Prompt context assembly

Include:
- active identity/config prompt,
- bounded recent session tail,
- bounded memory injection,
- valid tool explainer/signatures.

Avoid duplicating non-essential runtime metadata in prompt body.

## 4. Memory (`be memory` / `be remember`)

Retention semantics:
- `during wo always` -> core long memory
- `during date today|tomorrow|<future date>` -> dated reminders

Retrieval should filter validity and return deterministic top-k.

## 5. Loop behavior

Session loop cycle:
1. read user input
2. evoke mind with tools/context
3. execute tool calls
4. append session records
5. surface response or typed error

## 6. Scheduler and heartbeat

Scheduler controls recurring services.

Default heartbeat profile: every 24 minutes unless overridden.

Expected controls: begin / stop / restart / health / list.

## 7. Channels and sub-agents

Channels route through `24-channel-contract.md` with dedup and auditable produce paths.

Sub-agents may run as servant/tool-like workers with explicit boundaries.

## 8. Conformance

Implementation conforms when it provides deterministic session/memory behavior, valid tool exposure, scheduler-managed recurring runs, and channel routing via canonical contract.

## 9. References

- `documentation/recipes/spec-archive/18-pyash-agent.full.md`
- `documentation/recipes/spec-archive/22-memory-and-remember.full.md`
