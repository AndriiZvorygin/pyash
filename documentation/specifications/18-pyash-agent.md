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

Completed agent turns use an append-only typed ledger:

```pyash
su name user ob text "<request>" fromtext text "<request hash>" accordingto text "<turn id>" by num <ordinal> be write ya
su name agent ob text "<response>" fromtext text "<request hash>" accordingto text "<turn id>" by num <ordinal> be write ya
su name checkpoint ob text "<response>" fromtext text "<request hash>" accordingto text "<turn id>" by num <ordinal> vyah success be checkpoint ya
```

The same `accordingto` turn id identifies all three records. Payload ids and
exchange sentence ids are preferred; otherwise the id combines a session-local
ordinal with a canonical request hash. Timestamps are audit fields only and do
not participate in identity or snapshot hashes. A user record is appended before
mind invocation. Pending tails remain auditable but are omitted from resumed
history; a successful checkpoint is required before a pair enters prompt history.
Completed turns replay from their recorded response without appending a second
pair. Conflicting evidence for one id is defective. Older adjacent user/agent
pairs receive deterministic synthetic ids during read-only projection and are
never rewritten.

## 3. Prompt context assembly

Include:
- active identity/config prompt,
- bounded recent session tail,
- bounded memory injection,
- valid tool explainer/signatures.

Avoid duplicating non-essential runtime metadata in prompt body. When explicit
accepted generator/verifier evidence exists, compact context keeps the immutable
original duty plus the latest accepted generator and verifier evidence. Ordinary
completed answers are not treated as accepted evidence. Failed retries remain in
the session/newspaper/artifact audit trail.

For recorded runs, each completed turn also gets an immutable hash-addressed
session snapshot through the artifact recorder. The newspaper carries a typed
checkpoint linkage to that snapshot, so `command/replay_newspaper.mjs` can verify
the bytes and surface tampering.

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

Channel runtime scheduler rules:
- shared channel services are declared globally in `world/conduct/calendar.pya`.
- channel polling is channel-scoped (one `channel poll` job per channel type), then fans out in runtime.
- channel spool/runtime artifacts are stored under `world/holding/channel/*` and are not conduct policy files.

## 7. Channels and sub-agents

Channels route through `24-channel-contract.md` with dedup and auditable produce paths.

Sub-agents may run as servant/tool-like workers with explicit boundaries.

## 7.1 Channel outcome newspaper records

Channel runtime MUST append human-readable Pyash outcome sentences to channel newspapers for critical auth/bootstrap paths.

Required shape:

```pyash
su name matrix credentials
as name <stage>
vyah success|fail
ob text "<short outcome text>"
during date <timestamp>
be channel outcome ya
```

Rules:
- `vyah success` means the runtime can continue (including degraded fallback paths).
- `vyah fail` means the step is defective and may block intake/produce.
- Outcome lines MUST be sentence-shaped (not JSON-only blobs).
- Outcome lines MUST be written to `world/newspaper/YYYYMMDD-channel-<channel>-<agent>.pya`.

## 8. Conformance

Implementation conforms when it provides deterministic session/memory behavior, valid tool exposure, scheduler-managed recurring runs, and channel routing via canonical contract.

## 8.1 External TUI projection rule

When Pyash invokes an external interactive shell (for example Codex TUI), canonical run history remains Pyash-native.

Rules:
- `.codex` (or equivalent external runtime state) is treated as backend/tool cache, not canonical memory.
- Session continuity for Pyash features (`session`, `memory`, `gold`) MUST be projected into agent-house `.pya` records.
- Projection details are implementation-specific and documented in reference docs, not in this spec.

## 9. References

- `documentation/recipes/spec-archive/18-pyash-agent.full.md`
- `documentation/recipes/spec-archive/22-memory-and-remember.full.md`
- `documentation/reference/agent-tui-session-projection.md`
