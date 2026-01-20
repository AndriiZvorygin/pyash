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
- Each server is referenced by a logical name (e.g., `mcp:files`).
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
  su name server ob text "mcp:files" ya
  su name tool read_file ob text "..." with name schema ti name "<canonical json>" with name output_schema ti name "<canonical json>" with name tool_id ti name "sha256:..." ya
prah
```

## 13. Deferred items

- MCP transport beyond stdio
- Server restart policies
- Tool capability negotiation beyond schema
