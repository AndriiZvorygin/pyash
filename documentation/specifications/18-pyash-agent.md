## Pyash-compatible spec: agent loop, prompt context, and memory

### 0. Purpose

Define a minimal, deterministic agent loop for Pyash that mirrors nanobot-style behavior:

1. Build prompt context from bootstrap files, memory, and history.
2. Call a mind backend with tools.
3. Execute tool calls and feed results back into the loop.
4. Record outputs and memory changes deterministically.

This spec focuses on loop, context, and memory first. It does not prescribe a specific UI channel.

---

## 1. Terms

* **agent loop**: the iterative cycle that builds context, calls a mind, executes tool calls, and returns a response.
* **bootstrap files**: identity files that always contribute to context, for example `AGENTS.md`.
* **prompt context**: the system + history + current input bundle sent to the mind backend.
* **session**: a named dialogue history used for context windows.
* **memory**: persistent, human-curated notes separate from ordinary Pyash facts.
* **tool call**: a structured request returned by the mind backend to invoke a tool.

---

## 2. Global invariants (normative)

1. Agent loop execution is deterministic for identical input, memory, and tool responses.
2. Prompt context is assembled in a stable order.
3. Memory files are append-only unless explicitly overwritten by a dedicated memory verb.
4. Tool calls are executed in the order returned by the mind backend.
5. Each mind call records request and response artifacts for inspection and replay.

---

## 3. Data shapes

### 3.1 Prompt context record (json map)

Required keys:

* `system` (text): the system prompt text.
* `messages` (series): ordered list of message entries.

Message entry fields:

* `role` (text): `"system" | "user" | "assistant" | "tool"`.
* `content` (text).
* `name` (text, optional): tool name for tool responses.
* `tool_call_id` (text, optional): id for tool response linkage.

### 3.2 Tool call record (json map)

Required keys:

* `id` (text)
* `name` (text)
* `arguments` (map) or `arguments_json` (text)

### 3.3 Memory context block (text)

The memory context is a formatted block inserted into the system prompt:

```
# Memory

## Long-term Memory
<contents of MEMORY.md>

## Today's Notes
<contents of YYYY-MM-DD.md>
```

If a section is missing, it is omitted entirely.

---

## 4. Prompt context assembly

### 4.1 Bootstrap files (ordered)

The following files are read from the agent house `identity/` directory, in order. Missing files are skipped:

* `AGENTS.md`
* `SOUL.md`
* `USER.md`
* `TOOLS.md`
* `IDENTITY.md`

Each file is injected as:

```
## <FILENAME>

<file contents>
```

### 4.2 System prompt order

The system prompt concatenates the following blocks in order, separated by `\n\n---\n\n`:

1. Agent identity block (runtime, workspace, guidance).
2. Bootstrap files block (combined).
3. Memory context block.
4. Skills summary block (optional).

### 4.3 History inclusion

History messages are appended after the system prompt. The maximum history window is configurable (default 50 messages). Only `role` and `content` are required in the prompt.

### 4.4 Current message

The current user input is appended last as a `user` role message.

---

## 5. Memory storage

### 5.1 Files

Memory is stored under `memory/` in the agent house:

* `memory/MEMORY.md` for long-term memory.
* `memory/YYYY-MM-DD.md` for daily notes.

### 5.2 Append rules

* Daily notes append to today’s file.
* Long-term memory is updated only by explicit write operations.
* The memory system does not automatically reflect Pyash facts.

### 5.3 Suggested Pyash verbs

The following verbs are recommended for managing memory:

* `be remember ob text "<note>" during date YYYY-MM-DD do` appends to daily notes.
* `be remember ob text "<note>" during date today do` appends to today's notes.
* `be remember ob text "<note>" during date tomorrow do` appends to tomorrow's notes.
* `be remember ob text "<note>" during wo always do` appends to long-term memory.

These verbs are not required for initial parity; they are future-facing hooks.

---

## 6. Session history

### 6.1 Session identifiers

A session name is generated on first prompt as:

* `YYYYMMDD-<name>`

`<name>` is produced by a short mind prompt and stored in the session file header.

Optional override (tool map config):

```
su name session name ob text "<name>" ya
```

When present, the session file name becomes `YYYYMMDD-<name>` for that day.

Default tools map:

```
with wo tools
```

Using `with wo tools` on a mind call uses the default `agent tools` map.

Example tool map:

```
su name tools be map def
su name agent ob bool truth ya
su name session name ob text "draft review" ya
su name read be read from filename input can
su name write be write ob text input to filename input can
prah
```

### 6.2 Storage

Sessions are stored as append-only Pyash series files under the agent house:

* `session/YYYYMMDD-<name>.pya`

Session files are series defs without a closing `prah` so new lines can be appended
without rewriting the full file.

Header line (required):

```
su name <session name> since date YYYY-MM-DD be series def
```

Entry lines (append-only):

```
su name system ob text "<config prompt>" ya
su name user ob text "<message>" ya
su name assistant ob text "<message>" ya
```

Optional timestamp:

```
su name system ob text "<config prompt>" during date <timestamp> ya
su name user ob text "<message>" during date <timestamp> ya
su name assistant ob text "<message>" during date <timestamp> ya
```

Optional model switches (as an additional case on system entries):

```
su name system ob text "<config prompt>" as name <model> during date <timestamp> ya
```

### 6.3 History selection

Only the most recent `N` messages are included in prompt context. Default `N = 50`.

If a `session name` override is present and today’s file does not provide enough
history, the previous day’s file with the same name may be used to fill the
window.

---

## 7. Agent loop

### 7.1 Core steps

1. Receive an inbound message with session key.
2. Load or create the session history.
3. Build prompt context from system + memory + history + current input.
4. Call the mind backend with tool definitions.
5. If tool calls are present, execute each tool and append tool results as `tool` role messages.
6. Continue the loop until a response without tool calls is returned, or a max iteration cap is reached.
7. Save the user message and final assistant response to session history.

### 7.2 Iteration cap

A hard limit prevents runaway loops. Default `max_iterations = 20`.

### 7.3 Tool execution order

Tool calls are executed in the order returned. Results are appended immediately after execution.

---

## 8. Tool registry

### 8.1 Minimum tool set

An initial agent loop SHOULD support these tool classes:

* File read/write/edit/list
* Shell exec
* Web search/fetch
* Message send
* Spawn subagent

### 8.2 Context propagation

If tools depend on channel or session context, the agent loop updates tool context before each call.

---

## 9. Artifacts and logging

### 9.1 Mind request/response artifacts

Every mind call records:

* request payload
* response payload

Storage location is implementation-defined, but defaults to `artifacts/mind/`.

### 9.2 Loop traces

A loop trace is a structured log of each iteration:

* iteration number
* tool calls executed
* final assistant content

---

## 10. Security and workspace limits

1. File tools can be restricted to the workspace root.
2. Shell execution can be disabled or sandboxed.
3. Web tools may require API keys.
4. Memory files must never contain secrets by default.

---

## 11. Integration points in Pyash

Recommended files to implement this spec:

* Prompt context builder: `program/agent/context.mjs`
* Memory storage helpers: `program/remember/persistent.mjs`
* Session persistence: `program/agent/session.mjs`
* Agent loop: `program/agent/loop.mjs`
* Mind integration: `program/verbs/mind/mind.mjs`

---

## 12. Minimal parity checklist

* Build system prompt with bootstrap + memory.
* Include session history in mind calls.
* Store sessions as append-only Pyash series files.
* Execute tool calls in a deterministic loop.
* Record request/response artifacts.

## 13. Agent house paths

Agent house directory (per `15-world.md`):

```
world/house/<agent>/
```

Agent subpaths:

```
world/house/<agent>/identity/
world/house/<agent>/memory/
world/house/<agent>/session/
```

Implementations MAY seed empty `identity/` directories from a template pack
such as `examples/agent-identity/agent-helper/identity/`.

* Build system prompt with bootstrap + memory.
* Include session history in mind calls.
* Execute tool calls in a deterministic loop.
* Record request/response artifacts.
* Persist session history and memory to disk.
