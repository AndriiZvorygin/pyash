# Tool ABI v0.1 (minimal consolidation)

This file is a **consolidation** of existing tool-envelope rules already defined
in `16-mind-and-tools.md` and `11-run-recording-and-artifacts.md`. It does **not**
introduce new behavior. Anything not explicitly covered here remains deferred.

## 1. Scope

Tool ABI describes:
- how tool calls are recorded in newspapers,
- how mind request/response payloads are recorded,
- determinism requirements for tool/event ordering.

It does **not** define MCP transport or discovery (see MCP spec, pending).

## 2. Tool event record (normative)

Tool invocations must emit a `be tool ya` record in the newspaper:

```pyash
su name tool event <counter>
ob la <evoked sentence> ko
to la <result sentence> ko
be tool ya
```

Rules:
- `<counter>` is zero-padded, 6-digit, monotonic per run (`000001`, `000002`, …).
- Embedded sentences use official ordering.
- The tool event is appended in execution order.
- Tool events appear **after** any request/response `be write ya` records.

Sources: `16-mind-and-tools.md` §15, `11-run-recording-and-artifacts.md` §9.

## 3. Mind request/response records (normative)

Mind adapters must emit request/response JSON as `be write ya` sentences:

```pyash
su name <mind> request <n> ob text quoted.json.<json>.json.quoted from name mind be write ya
su name <mind> response <n> ob text quoted.json.<json>.json.quoted from name mind be write ya
```

Rules:
- `<n>` is the per-dialogue mind counter.
- JSON bytes are recorded exactly as emitted (no rewriting).
- Records appear before the corresponding tool event.

Sources: `16-mind-and-tools.md` §15.

## 4. Determinism requirements (normative)

- Tool capability blocks and tool schema lists must be produced in **stable**
  canonical order derived from canonical printed bytes of `can` sentences.
- Tool events must remain stable across backends given the same evoked sentence.

Sources: `16-mind-and-tools.md` §7, §15.

## 5. Deferred items (explicitly out of scope)

- MCP discovery, tool list snapshotting, schema identity hashing.
- Deadline/cancellation propagation (`qa`/timeouts).
- Permission gating/allowlists for MCP.

These remain in the MCP roadmap until a dedicated MCP spec is added.
