# `20-command-safety.md`

Status: draft v0.2

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

## 2. Safety model (current)

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

### 3.2 Implemented now

- `be command` reads `sandbox configure` map:
  - `network` (`bool`)
  - `cwd` (`filename|text`)
  - `writable roots` (`ve filename ...`)
  - `timeout ms` (`num`)
  - `max output bytes` (`num`)
  - `command env allowlist` (`ve text ...`) or `env allowlist`
- Command runtime uses:
  - subprocess `cwd` from map (default: process cwd)
  - allowlisted environment only
  - timeout kill
  - output-size kill (stdout+stderr bytes)
- Write-scope enforcement:
  - denies `to filename` writes outside writable roots
  - denies configured `cwd` outside writable roots
  - for `write_local`/`destructive` classes, denies absolute path tokens outside roots
- Network scope enforcement:
  - class `network` denied when `network` is `lie`

### 3.3 Remaining gaps

- No kernel/container OS sandbox is applied yet.
- Relative-path writes inside a permitted `cwd` are allowed.
- Shell-script internals are not fully statically analyzed.

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

Current class detector is pattern-based and deterministic over command text.

---

## 6. Approval surface

### 6.1 Decision payload

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

`be command` ask-gate emits:
- `from name "command"`
- `accordingto name "resume token"`
- `fromtext text "<json token>"`

---

## 7. Audit logs

### 7.1 Audit record

For each restricted action, record:
- request id (`to name "command request <id>"`)
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

Implemented sentence shape:
- `be command audit`
- `su name "command audit <id>"`
- `to name "command request <id>"`
- `as name <stage>`
- `from name <policy source>`
- `accordingto name <decision>`
- `by <class>`
- `ob text <evoked sentence>`
- `totext text <result sentence>` (when available)
- `fromtext text <iso time>`
- optional `at filename <lane>`

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

## 10. Conformance (v0.2 draft)

An implementation currently conforms when it:

1. enforces ratify behavior for command `ask`/`propose`,
2. enforces deterministic command classifier + policy binding,
3. enforces command sandbox map checks (network/cwd/writable roots/timeout/output limit/env allowlist),
4. emits structured command audit records.

Next-step conformance adds:

1. OS-level command sandbox backend,
2. fuller path analysis for shell writes,
3. tool/MCP permission maps bound through same policy hierarchy.

---

## 11. Implementation plan

### Phase 1 (done)

1. Add command classifier helper (`read_only/write_local/network/destructive/unknown`).
2. Add policy resolution (`deny/ask/allow`) with agent/session overrides.
3. Route `be command` through ratify when policy requires `ask`.
4. Emit explicit approval audit sentences into newspaper.

### Phase 2 (partial)

1. Add sandbox runner for command execution.
2. Enforce writable roots + optional network deny.
3. Add resource limits and timeout defaults.

### Phase 3 (next)

1. Extend tool map entries with optional permission map.
2. Validate tool execution context against declared limits.
3. Add parity quizzes for deny/ask/allow + audit records.

---

## 12. Pyash configuration shape

Command safety configuration SHOULD be grouped as two map subjects:

- `su name command configure be map def`
- `su name sandbox configure be map def`

Recommended `command configure` keys:

- `policy mode` (`wo deny|ask|allow`)
- `tool policy mode` (`wo deny|ask|allow`)
- `mcp policy mode` (`wo deny|ask|allow`)
- `classifier enabled` (`bool`)
- `audit security lane` (`filename`)

Recommended `sandbox configure` keys:

- `network` (`bool`)
- `cwd` (`filename|text`)
- `writable roots` (`ve filename ...`)
- `timeout ms` (`num`)
- `max output bytes` (`num`)
- `command env allowlist` (`ve text ...`)

Agent directory policy SHOULD be defined in:

- `world/conduct/agent.pya`

Supported policy map shape:

- `su name <agent> directory license be map def`
- map entries:
  - `su name "<path>" ob ve text "read" "write" "command" ya`
- `prah`

Notes:

- `<agent>` may be `default` for fallback.
- Capability words are `read`, `write`, `command`.
- When `su name agent sandbox` is truth, runtime MUST prioritize this world policy
  over agent-memory overrides for directory expansion.
- If no world policy file exists, sandbox may fallback to legacy house-local behavior.

Policy precedence for `policy mode` is:
- `session command configure`
- `agent command configure`
- `command configure`
- legacy single-subject keys (`session command policy mode`, `agent command policy mode`, `command policy mode`)

Container or local overrides MAY replace either map in later config files
(`configure/container.pya`, `configure/secret.pya`).
