# `20-command-safety.md`

Status: draft v0.1

Purpose: define command/tool execution safety requirements for agent and refinery workloads.

---

## 1. Scope

This chapter covers:
- sandbox scope
- approval modes
- command/tool classification
- approval interaction surface
- audit logs
- tool/MCP permissions

It applies to:
- `be command`
- mind tool calls (`with name <map>` / `with wo tools`)
- MCP-backed tools
- scheduler/channel-triggered agent runs

---

## 2. Safety model (v0.1 baseline)

1. Default deny for privileged actions.
2. Deterministic policy resolution.
3. Explicit approval for risky actions.
4. Append-only audit evidence in run records.
5. Least-privilege path and capability scopes.

---

## 3. Sandbox scope

### 3.1 Required controls

- A command execution context MUST define:
  - working directory
  - writable roots
  - network allowance (`truth`/`lie`)
  - environment allowlist
  - time/memory limits

### 3.2 Current parity

- Agent path scoping exists for filesystem verbs via `agent sandbox` + `agent cwd`.
- World-root scoping exists via `world tools` + `world root`.
- `be command` currently has no OS-level sandbox boundary.

### 3.3 Required upgrade

- `be command` MUST support an isolated runtime profile:
  - read-only root by default
  - explicit writable roots
  - optional network deny
  - bounded resources

---

## 4. Approval modes

### 4.1 Policy modes

Define policy mode at global/agent/session scope:

- `deny` — never execute restricted actions.
- `ask` — require explicit ratify decision.
- `allow` — execute automatically.

### 4.2 Tool mood integration

- `can` remains auto-executable unless overridden by stricter policy.
- `propose` always requires ratification.
- If unresolved, decision defaults to `lie`.

---

## 5. Classification rules

Each command/tool call MUST be classified before execution:

- `read_only`
- `write_local`
- `network`
- `process_control`
- `destructive`
- `unknown`

Classification MUST be deterministic for identical input.

Policy resolution may use class + subject + signature keys.

---

## 6. Approval surface

### 6.1 Required decision payload

An approval request MUST include:
- normalized command/tool sentence
- classifier class
- cwd and scope roots
- risk notes
- resume token

### 6.2 Response

Decision sentence shape:
- `be ratify ya`
- `ob bool truth|lie`
- resume token binding
- optional rationale text

---

## 7. Audit logs

### 7.1 Minimum audit record

For each restricted action, record:
- request id
- classifier class
- decision source (policy key / interactive)
- decision value
- invoked sentence
- surfaced result sentence
- timestamp

### 7.2 Storage

- MUST be append-only.
- MUST be emitted to run newspaper when enabled.
- SHOULD support a dedicated security lane (`world/newspaper/...-security.pya`).

---

## 8. Tool and MCP permissions

### 8.1 Local tool permissions

Tool definitions SHOULD declare:
- allowed paths
- network domains
- env exposure
- timeout limits

### 8.2 MCP permissions

- Existing allowlist/denylist remains required.
- Schema validation remains required.
- Denials MUST surface stable error sentences and tool events.

---

## 9. Error names

Recommended stable names:
- `command policy defective`
- `command sandbox defective`
- `command approval defective`
- `command classification defective`
- `tool permission defective`
- `mcp tool denied`

---

## 10. Conformance (v0.1)

An implementation conforms when it:

1. enforces filesystem scope for non-command file verbs,
2. enforces ratify behavior for proposed tools,
3. records tool/ratify events in newspaper,
4. applies MCP allowlist/denylist and schema checks.

Full v0.2 conformance additionally requires:

1. OS-level sandbox for `be command`,
2. centralized approval mode hierarchy,
3. deterministic classifier with policy binding,
4. structured security audit stream.

---

## 11. Implementation plan

### Phase 1 (hardening now)

1. Add command classifier helper (`read_only/write_local/network/destructive/unknown`).
2. Add policy resolution (`deny/ask/allow`) with agent/session overrides.
3. Route `be command` through ratify when policy requires `ask`.
4. Emit explicit approval audit sentences into newspaper.

### Phase 2 (sandbox)

1. Add sandbox runner for command execution.
2. Enforce writable roots + optional network deny.
3. Add resource limits and timeout defaults.

### Phase 3 (tool permissions)

1. Extend tool map entries with optional permission map.
2. Validate tool execution context against declared limits.
3. Add parity quizzes for deny/ask/allow + audit records.

