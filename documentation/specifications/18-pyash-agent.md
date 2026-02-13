# 18. Pyash Agent

Purpose: define agent loop, prompt context assembly, memory/session storage, scheduler hooks, and channel integration points.

## 1. Agent house layout

Each agent house should contain at least:
- `identity/` (role/config prompt source files)
- `session/` (active session series files)
- `memory/` (long-memory + dated reminders)
- `conduct/` (calendar/ratify/channel conduct)

Session files remain in agent house. Global operational logs belong to world newspaper.

## 2. Session model

Session key format:
- `yyyymmdd-<name>`
- `<name>` sanitized: alphanumeric + underscore

Session series header:

```pyash
su name <session key> since date <yyyy-mm-dd> be series def
```

Entries append one sentence per line (no per-append file rewrite requirement).

Required session entry facts:
- `during date <timestamp>` append time
- system prompt captured at session start as `su name system ob text ...`
- model case recorded, and model change facts appended when model changes

Default behavior:
- reuse today's session for same session lane/name
- window expansion may read previous day with same session name when needed

## 3. Prompt context assembly

Prompt assembly should include:
- active config prompt from identity
- relevant session tail (bounded window)
- short memory injection (daily + always memories)
- tool explainer (valid signatures only)

Non-essential runtime metadata should not be duplicated in prompt text.

## 4. Memory model (`be memory` / `be remember`)

Memory is file-backed and append-only.

Retention semantics:
- `during wo always` -> core long memory
- `during date today|tomorrow|<future date>` -> dated reminders

Retrieval (`be remember do`) should:
- filter by retention validity
- rank deterministically
- inject bounded top-k items

## 5. Loop behavior

Agent session loop must:
- read user input
- evoke mind with selected tools/context
- execute tool calls
- append session facts
- return final response

On tool defects, loop should emit typed error facts and continue unless fatal policy requires stop.

## 6. Scheduler and heartbeat

Scheduler supports calendar-driven services (for example heartbeat, channel probe).

Heartbeat default interval profile: 24 minutes unless overridden.

Control surfaces should support begin/stop/restart/health/list for scheduler and individual services.

## 7. Channels

Channel adapters should route through canonical channel contract (`24-channel-contract.md`) and scheduler-driven intake.

Matrix MVP requirements:
- deterministic input normalization
- mention/reply routing
- dedup by channel/event id
- auditable produce results

## 8. Subprocess agents

Sub-agents may be invoked as tool-like servants with explicit boundaries and auditable handoff.

## 9. Conformance

Agent implementation conforms when it provides:
- reproducible session files
- deterministic memory injection
- valid tool signature exposure
- scheduler-managed recurring runs
- channel I/O through canonical contract

## 10. Full draft reference

Detailed parity and integration notes are preserved at:
- `documentation/recipes/spec-archive/18-pyash-agent.full.md`
- `documentation/recipes/spec-archive/22-memory-and-remember.full.md`
