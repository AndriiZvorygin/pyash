# MCP Integration Spec v0.1 (draft)

This spec defines the MCP client integration for Pyash. It is written to be
compatible with existing tooling contracts:
- Tool ABI v0.1: `documentation/specifications/17-tool-abi.md`
- Tool events + artifacts: `documentation/specifications/11-run-recording-and-artifacts.md`
- Mind + tool calling rules: `documentation/specifications/16-mind-and-tools.md`

It introduces **no new runtime behavior** beyond MCP transport and snapshotting.

## 1. Scope

This spec covers:
- MCP client transport (stdio first)
- discovery + snapshotting of tool schemas
- mapping MCP tools to Pyash-callable signatures
- deterministic recording for replay
- failure policy and cancellation/deadline propagation

Out of scope:
- non-stdio transports (HTTP/WebSocket)
- server packaging/distribution
- model-specific tool calling policies (see `16-mind-and-tools.md`)

## 2. Terms

- **MCP server**: external process that exposes tools via MCP.
- **tool snapshot**: deterministic record of discovered MCP tools for a run.
- **facade**: Pyash module generated from MCP tools (stable naming).
- **tool identity**: stable hash derived from tool schema and naming metadata.

## 3. Transport (stdio)

### 3.1 Launch

- The runtime launches MCP servers as subprocesses using stdio pipes.
- MCP configs are `be mcp` sentences keyed by `su name <handle>` (e.g., `files`).
- Server start/stop MUST be journaled in the run record.

### 3.2 Supervision

- The client MUST detect clean exit vs crash.
- Restarts are **not** automatic unless explicitly configured.
- If a server is unavailable, tool discovery MUST fail deterministically.

## 4. Discovery + snapshotting (normative)

### 4.1 Discovery

- On first access in a run, the client requests the tool list from the MCP server.
- The response is normalized into a **tool snapshot**.

### 4.2 Snapshot content

The snapshot MUST include:
- server name
- tool name
- tool description
- tool input schema (canonical JSON)
- tool output schema (if provided)
- computed `tool identity` hash

### 4.3 Snapshot recording

- The tool snapshot MUST be recorded as a Pyash sentence payload (not raw JSON).
- The snapshot sentence MUST be written as an artifact with a sha256 hash.
- The artifact MUST be referenced from the run record (see `11-run-recording-and-artifacts.md`).
- The snapshot is **read-only** for the remainder of the run.

### 4.4 Determinism rules

- Snapshot order is UTF-8 key order by tool name.
- Canonical JSON bytes are used for schema hashing.
- The same server response MUST yield the same snapshot bytes across backends.

## 5. Tool identity (normative)

Tool identity is a deterministic hash of:
- server name
- tool name
- canonicalized tool schema JSON

Hash algorithm: sha256 over UTF-8 bytes of the canonical JSON record.

## 5.1 Schema definition (normative)

In this spec, **schema** means the MCP tool input/output schema represented as
a Pyash **json map**. The schema is canonicalized to JSON bytes using the
existing JSON map canonicalization rules (`30-data-formats.md`) before hashing.

Example input schema (JSON reference + Pyash equivalent):

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 },
    "tags": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

```pyash
be object ob text atleast 1 atmost 50 among ve text array string ya
be require ob ve text "ob" ya
be excess ob bool lie ya
```

## 6. Schema → Pyash facade mapping

### 6.1 Facade generation

- Each MCP tool is mapped to a Pyash callable form (`be <tool> ... do`).
- The facade sentence signature is derived from the schema’s parameter keys.
- Mapping MUST be stable for a given snapshot.

### 6.2 Naming rules

- Tool names are normalized to safe Pyash identifiers:
  - lowercase
  - non-alphanumeric replaced with `_`
- Collisions MUST error deterministically.

### 6.3 Facade module

- The runtime generates a facade module (virtual or file-backed) for the snapshot.
- The facade module name is `mcp <server name>`.
- The facade module MUST be importable via standard module rules (`50-modules.md`).

## 7. Invocation contract

- Tool invocation is a normal Pyash `do` call against the facade name.
- Arguments are encoded into a JSON object and sent to MCP.
- Tool results are converted to Pyash sentences using the Tool ABI rules.
- Tool events MUST be recorded (see Tool ABI v0.1).

## 8. Deadlines + cancellation (normative)

- If a sentence has `by num <seconds>` or `qa` constraints, the client MUST map
  them into MCP request timeouts where supported.
- When the runtime cancels a tool call, it MUST record the cancellation in the
  run record and surface a deterministic error sentence.

## 9. Permission gating (normative)

- The runtime MAY apply an allowlist of MCP tools per run.
- Denied tool calls MUST surface `be error ya` sentences with `from name tool`.
- Denials are recorded in the run record (tool event with error result).

Allowlist config (example):

```pyash
su name mcp allowlist ob ve text "mcp files list_directory" "mcp files read_file" ya
```

Denylist config (example):

```pyash
su name mcp denylist ob ve text "mcp files write_file" ya
```

## 10. Failure policy (normative)

The runtime MUST surface deterministic errors for:
- server unavailable / connection failure
- tool not found (missing from snapshot)
- schema mismatch between invocation and snapshot
- timeout or cancellation

Errors MUST be surfaced as `be error ya` sentences using existing error rules.

## 11. Replay rules (normative)

- Replay MUST load the recorded snapshot and disallow live discovery.
- Tool identity hashes MUST match the recorded snapshot.
- Tool calls MUST verify against snapshot identities and schemas.

## 12. Implementation notes (non-normative)

Suggested artifact path:

```
artifacts/mcp/<server-name>-tools.json
```

Suggested snapshot record shape (Pyash):

```pyash
su name tools snapshot be map def
  su name server ob text "files" ya
  su name tool read_file ob text "..." with name schema ti name "<canonical json>" with name output_schema ti name "<canonical json>" with name tool_id ti name "sha256:..." ya
prah
```

## 12.0 Restart policy (normative)

MCP servers MAY be configured with a restart policy by attaching a json map to the `be mcp` sentence via `with name <policy>`.
The policy applies to MCP server lifecycle only (not tool calls), and is evaluated on unexpected exit/crash.

Policy map keys (Pyash map fields):

- `policy` (`ob text`): `"on crash"` or `"never"` (default: `"never"`).
- `max` (`ob num`): maximum restarts within the rolling window (default: `0`).
- `window sec` (`ob num`): rolling window duration in seconds (default: `0`).
- `backoff` (`ob text`): `"exponential"` or `"linear"` (default: `"exponential"`).
- `base ms` (`ob num`): initial delay in milliseconds (default: `0`).
- `cap ms` (`ob num`): maximum delay in milliseconds (default: `0`).

Semantics:

- A restart policy triggers only on MCP server crash/exit (non-clean exit).
- The runtime tracks restart attempts per server and enforces `max` within `window sec`.
- Backoff delay for attempt `n` is:

  - exponential: `min(cap ms, base ms * 2^(n-1))`
  - linear: `min(cap ms, base ms * n)`
- If `policy` is `"never"` or `max` is `0`, no restart is attempted.
- When the policy refuses a restart, the run surfaces a deterministic `be error ya` sentence with `from name mcp`.

Run record notes:

- Each restart attempt MUST be recorded as a tool event with the server handle, policy name, and delay.
- A refusal (limit reached) MUST be recorded deterministically as a `mcp server restart denied` event.

## 12.1 Non-stdio transports (draft)

Non-stdio transports are configured on the same `be mcp` sentence using transport metadata
instead of a command. The transport is explicit so the same handle can target a remote MCP server.

Fields (draft):

- `from space` → endpoint URL (e.g., `http://localhost:3000/mcp`).
- `by wo <http|ws|sse>` → transport type.
- `with name headers` → optional json map of headers (e.g., auth), applied to transport requests.

Example:

```pyash
su name files
  from space "http://localhost:3000/mcp"
  by wo http
  be mcp
ya
```

Notes:

- If `ob text` is present, the transport is `stdio` and the command/args are used.
- Restart policy applies to reconnects for non-stdio transports.
- Stdio is still the default; `ws` is experimental and may be rejected.

## 12.2 Filesystem example (non-normative)

Example config (in `configure/default.pya` or `configure/secret.pya`):

```pyash
su name files ob text "npx" by ve text "-y" "@modelcontextprotocol/server-filesystem" "<allowed_path_1>" "<allowed_path_2>" be mcp ya
```

Optional restart policy attachment uses `with name` to reference a json map definition:

```pyash
su name policy restart conservative be json map def
  su name policy ob text "on crash" ya
  su name max ob num 3 ya
  su name window sec ob num 60 ya
  su name backoff ob text "exponential" ya
  su name base ms ob num 250 ya
  su name cap ms ob num 8000 ya
prah

su name files ob text "npx" by ve text "-y" "@modelcontextprotocol/server-filesystem" "<allowed_path_1>" "<allowed_path_2>" with name policy restart conservative be mcp ya
```

Example usage:

```pyash
from name mcp files to name mcp files be import do
ob text "<allowed_path_1>" be mcp files list_directory do
```

Snapshot artifacts are written under the run root at `artifacts/mcp/<server-name>-tools.json`.

Note: stdio is a transport only and does not sandbox the process.
Run risky MCP servers in a container or restricted user to avoid filesystem or process abuse.

## 12.2 Time server quickstart (non-normative)

Example config (in `configure/default.pya` or `configure/secret.pya`):

```pyash
su name time ob text "uvx" by ve text "mcp-server-time" be mcp ya
```

Expected tools:

- `get_current_time(timezone)`
- `convert_time(source_timezone, time, target_timezone)`

Snapshot artifact path:

```
artifacts/mcp/<server-name>-tools.json
```

Run once to generate the snapshot:

```pyash
from name mcp time to name mcp time be import do
```

Manual smoke example (no assertions):

```pyash
ob text "America/Toronto" be mcp time get_current_time do
```

## 13. Tool capabilities (beyond schema)

Some MCP servers expose metadata that is **not expressible in JSON Schema** (streaming, side effects, safety class, etc.).
When present, Pyash records a capability sentence per tool **alongside** the snapped schema, and uses it for
deterministic gating decisions.

### 13.1 Capability sentence shape

Capability is stored as a `json map` so ordering and hashing remain canonical:

```pyash
su name mcp capability <tool-id> be json map def
  su name tool ob text "<tool-name>" ya
  su name license ob text "read" ya
  su name stream ob bool lie ya
  su name idempotent ob bool truth ya
  su name domain ob ve text filesystem ya
  su name rhythm boundary per min ob num 60 ya
prah
```

Notes:

* `<tool-id>` is the tool identity hash used in snapshot records.
* All fields are optional. Missing fields mean “unknown”.
* `license` is one of `read`, `write`, `execute`, `network`, `mixed` (freeform allowed but should be stable).
* `domain` is a text vector describing required capabilities (for example `filesystem`, `network`, `process`).
* `rhythm boundary per min` is a numeric hint, not an enforcement contract.

### 13.2 Recording + replay

* If the server provides capability metadata, record it in the snapshot artifact and emit capability sentences.
* Replay uses the stored capability sentences; any mismatch in capability bytes for the same tool id is a deterministic error.
* Runtimes may refuse calls when `license` or `domain` conflict with run policies.

## 14. Deferred items

- MCP transport beyond stdio
- Server restart policies
