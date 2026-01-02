# `15-tool-envelope.md` (v0.1)

## 1. Purpose

Define the **tool envelope**: the newspaper record format for tool-capable operations
(mind calls and command-backed verbs). This spec is about **recording** and
**determinism**, not tool selection.

This spec links to:

- `11-run-newspaper.md` (where tool events live)
- `16-mind.md` / `17-mind-tool-calling.md` (mind tool adapters)
- `13-exchange-and-artifact.md` (artifact records)

---

## 2. Terms

- **tool event**: a newspaper record that pairs an evoked sentence with a surfaced result sentence.
- **request/response record**: `be write ya` sentences carrying raw JSON for mind calls.

---

## 3. Rules (normative)

### 3.1 Tool event sentence

```
su name tool event <counter>
ob la <evoked sentence> ko
to la <result sentence> ko
be tool ya
```

Rules:

- `<counter>` is a zero-padded 6-digit monotonic counter (`000001`, `000002`, …).
- Embedded sentences MUST be emitted using official ordering.
- The tool event is appended to the newspaper in execution order.

### 3.2 Mind request/response records

Mind adapters MUST emit request/response JSON as write sentences:

```
su name <mind> request <n> ob text quoted.json.<json>.json.quoted from name mind be write ya
su name <mind> response <n> ob text quoted.json.<json>.json.quoted from name mind be write ya
```

Rules:

- `<n>` is the per-dialogue mind counter.
- JSON bytes are recorded exactly as emitted (newlines preserved).
- Records appear in the newspaper before the tool event.

---

## 4. Canonical golden path example (normative)

```pyash
su name tools be map def
su name say ob text "" be say can
prah
su name helper request 000001 ob text quoted.json.{
  "model": "qwen3-vl:8b-instruct",
  "messages": [
    {
      "role": "system",
      "content": "TOOLS:\nsu name say ob text \"\" be say can"
    },
    {
      "role": "user",
      "content": "use the say tool to say hello world"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "be_say_ob_text",
        "description": "su name say ob text \"\" be say can",
        "signature": "be say ob text",
        "parameters": {
          "type": "object",
          "properties": {
            "ob": { "type": "string" }
          },
          "required": ["ob"]
        }
      }
    }
  ],
  "stream": false
}.json.quoted from name mind be write ya
su name helper response 000001 ob text quoted.json.{
  "model": "qwen3-vl:8b-instruct",
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      { "function": { "name": "be_say_ob_text", "arguments": "{\"ob\":\"hello world\"}" } }
    ]
  },
  "done": true
}.json.quoted from name mind be write ya
su name tool event 000001 ob la ob text "use the say tool to say hello world" to name helper with name tools be write do ko to la su name helper answer 1 from name helper ob text "say hello world" be answer ya ko be tool ya
su name artifact-0 ob name evoke-0 to filename "out.txt" accordingto name sha256 fromtext text "3a0b...ff" by num 6 from name exchange be artifact ya
```

---

## 5. Implementation pointers

- Tool event emission (interpreter): `program/command/run_pya_program.mjs` (`emitToolEvent`).
- Mind JSON records: `program/verbs/mind/mind.mjs` (`recordMindJson`).
- Compiled JS tool events: `program/verbs/exchange/compile.mjs` (tool event `pyaEmitNewspaper` emissions).
- Compiled C tool events: `program/verbs/exchange/helpers_c.mjs` (`pya_emit_exchange`).

---

## 6. Conformance checks

- Tool event records exist: `node --test quiz/run_newspaper_command*.test.mjs`
- Tool schema payloads: `node --test quiz/mind_tools_payload.test.mjs`
- Tool call execution: `node --test quiz/mind_tool_call.test.mjs`
- Newspaper grep: `rg "be tool ya" newspaper/*.pya`
