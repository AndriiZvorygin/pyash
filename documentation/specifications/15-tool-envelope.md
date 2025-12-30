# `15-tool-envelope.md` (draft v0.1)

**Status:** draft v0.1 (tool call envelope)

---

## 1. Purpose

Define a **tool call envelope** for recording tool calls and tool results in the run newspaper.

This spec exists to make:

- tool calls replayable
- tool results diffable and auditable
- tool outputs verifiable via artifact hashes

This spec defines:

- tool call sentence form
- tool result sentence form
- linking tool outputs to artifacts
- how tool events appear in the run newspaper

---

## 2. Terms

- **tool** — an external adapter invoked by the runtime (filesystem, network, LLMs, CLI tools, etc.)
- **call id** — the run-scoped identifier for one tool invocation
- **call sentence** — the embedded sentence that describes the request
- **result sentence** — the embedded sentence that describes the result
- **tool event** — a sentence recorded in the run newspaper

---

## 3. Global invariants (normative)

1. Tool calls and results are recorded as sentences.
2. Tool call and tool result MUST share the same call id.
3. Tool calls and results MUST NOT embed raw bytes. Bytes are recorded as artifacts (`13-exchange-and-artifact.md`).
4. Tool events MUST use official sentence ordering and subordinate clause rules.

---

## 4. Tool call sentence (official)

### 4.1 Minimum required fields

```
su name <call-id> as name call from name <tool> ob la <call sentence> ko be tool ya
```

- `<call-id>` identifies this call within the run (`tool-0`, `tool-1`, … is a recommended default)
- `<tool>` is the tool identifier (for example `tool:web.fetch`, `tool:ollama`, `tool:fs.read`)
- `<call sentence>` is the embedded request sentence

### 4.2 Optional fields

- `to name <artifact>` or `from name <artifact>` if the tool is operating on a known artifact name
- `accordingto name <policy>` if a tool call is being invoked under a policy (retry, timeout, etc.)

---

## 5. Tool result sentence (official)

### 5.1 Minimum required fields

```
su name <call-id> as name result from name <tool> ob la <result sentence> ko be tool ya
```

### 5.2 Error results

If the tool fails, the result MUST surface a `be error ya` sentence:

```
su name <call-id> as name result from name <tool> ob la su name <err> ob text "<message>" be error ya ko be tool ya
```

---

## 6. Tool outputs and artifacts

If a tool returns or produces bytes, those bytes MUST be recorded as artifacts with sha256 (`13-exchange-and-artifact.md`).

The tool result sentence SHOULD reference artifact names rather than inlining bytes.

Example:

```
su name tool-0 as name result from name tool:web.fetch ob la su name artifact-0 be artifact ya ko be tool ya
```

---

## 7. Newspaper requirements

When newspaper emission is enabled, the runner SHOULD record:

- the tool call sentence
- the tool result sentence
- any artifacts produced by the tool
- any exchange events caused by the tool

The order MUST be:

1. tool call
2. artifacts (if any)
3. exchange events (if any)
4. tool result

---

## 8. Default call id policy (recommended)

If the tool adapter does not supply a call id, the runtime SHOULD assign one deterministically:

```
tool-0, tool-1, tool-2, ...
```

The counter increments on first declaration only (not per retry).

---

## 9. Errors

Tool envelope failures MUST follow `06-errors.md`:

- thrown as `be error do`
- surfaced as `be error ya`

Recommended error names:

- `tool defective`
- `tool result defective`

---

## 10. Conformance

An implementation conforms to this spec if it:

- emits tool call sentences using the official form (§4)
- emits tool result sentences using the official form (§5)
- records tool outputs as artifacts (§6)
- records tool events in the newspaper when enabled (§7)
