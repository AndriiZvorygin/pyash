# `08-tools-and-mcp.md` (merged)

Merged specification sources (legacy IDs):
- 16-mind-and-tools
- 17-tool-abi
- 22-mcp-integration

---

# Chapter map

This chapter is ordered for first-read clarity:
1. Mind (how `be write` is configured and invoked).
2. Mind tool calling (adapter rules and payload shapes).
3. Tool envelope (canonical tool event + request/response records).
4. Tool ABI (minimal event schema and invariants).
5. MCP integration (transport + runner expectations).

## Mind (draft v0.2)

Define the **mind** verb as implemented today (interpreter + compiled JS), plus the
persistent dialogue history shape used by Pyash memory.

This spec aligns with `quiz/mind.test.mjs` and defines deterministic replay when
newspaper and again mode are enabled.

---

## Mind event schema v0.1

This section freezes the event schema for mind calls as recorded in the
newspaper. Each event is a json map def block with a stable name:

```
<mind-name> <label> <count>
```

where:

- `<label>` is one of `request`, `response`, `empty-response`, `error`
- `<count>` is a per-mind 1-based integer

### Required fields

**Request**

Required keys:

- `mode` (text)
- `model` (text)
- `prompt` (text)
- `host` (text)
- `stream` (bool)

Optional keys:

- `tools` (text, serialized JSON array)
- `options` (json map, if supported)

**Response**

Required keys:

- `model` (text)
- `response` (text, may be empty)
- `done` (bool)

Optional keys:

- `done_reason` (text)
- `created_at` (text)
- `context` (vec)
- `total_duration`, `load_duration`, `prompt_eval_count`,
  `prompt_eval_duration`, `eval_count`, `eval_duration` (num)

### Canonical encoding

Each event is emitted as:

```
su name <mind-name> <label> <count> be json map def
su name <field> ob <value> ya
...
su name <mind-name> <label> <count> prah
```

The field order is not semantically important, but implementations SHOULD emit
fields in a stable order to aid diffing.

## 1. Purpose

`be write` invokes a language-model backend and returns a text response.

`be write ... for name <mind> to name <output>` is the preferred invocation form.
`be mind do` is deprecated and reserved for future use.

Canonical examples live in `documentation/examples/examples-list.md` (see `examples/pyash/mind-tool-call.pya` and `examples/pyash/mind-stream-fixture.pya`).

---

## 2. Registration (config) sentence

A mind is configured by storing a fact (surface `via` is stored as `as`):

```pyash
su name <mind> be mind
from space <host>
via state <model>
from discourse <prompt>
accordingto name <session>
ya
```

Current interpreter behavior:

* `from space` is stored; HTTP host comes from `OLLAMA_HOST`.
* `via state` stores the default model as `as name <model>`.
* `from discourse` stores the system prompt as `fromtext name <prompt>`.
* `accordingto name <session>` (optional) attaches a **series** used as history.
* `by num` or `ob window num` sets the history window size.

Registration updates memory for `<mind>`.

---

## 3. Invocation

Invocation uses `be write ... for name <mind> to name <output>`:

```pyash
su name <result>
ob text <text>
for name <mind>
to name <output>
be write do
```
`ob discourse <text>` is accepted in source and parsed as `ob name <text>`.

Legacy compatibility:

```pyash
ob text <text>
to name <mind>
totext name <output>
be write do
```

### 3.1 Invocation cases (normative)

The mind call understands these cases:

* `ob text <prompt>` / `ob name text <prompt>` — user prompt content.
* `for name <mind>` — target mind configuration.
* `to name text <output>` — output variable for the response text.
* `by num <N>` — history window override (pairs, user+assistant).
* `from discourse <prompt>` — **system prompt override** for this call.
* `accordingto name <session>` — **series-backed history** override for this call.
* `with name <map>` — tool schema map (enables tool calling).
* `vyah stream` — stream output (where supported).

### 3.2 Model resolution

* `ob model` on the call, if present
* else config model (`via state`)
* else default `qwen3-vl:8b-instruct`

### 3.3 Prompt assembly

The runtime constructs the model request from:

1. system prompt from config (`from discourse`)
2. tool capability block (if provided, see §7)
3. recent history messages from the resolved dialogue or series (see §4)
4. current user prompt from the invocation (`ob text <text>`)
5. upstream `inputs` passed by the bridge (implementation-defined)

---

## 4. Dialogue histories

Pyash supports two history sources:

1. **Series history** via `accordingto name <session>` (preferred for cross-mind sharing).
2. **Internal per-mind history** (default) keyed by `<mind> story`.

### 4.1 Series history (explicit)

If a `be mind` config or call includes `accordingto name <session>`, the runtime:

* reads `<session>` as a **series** (`be series`)
* converts entries into `{ role, content }` pairs
* uses that list as history (bounded by the window in §4.3)
* appends new user/assistant entries back into the same series

Series entries are sentences with:

* `su name <role>` (e.g. `user`, `assistant`, `tool`)
* `ob text <content>`

### 4.2 Internal history (default)

If no series is attached, history is stored as memory facts keyed by a dialogue
name. The default dialogue is `<mind> story`.

### 4.3 History window

The window is:

* `by num` or `ob window num` on the call, else
* config window, else
* `8`

Each window holds `window * 2` messages (user + assistant pairs).

### 4.4 Internal history fact shapes

For each invocation the runtime appends two facts to the selected dialogue:

**Question (user message):**

```pyash
su name <mind> <dialogue> question <n>
from name user
ob text <prompt>
be write ya
```

**Answer (assistant message):**

```pyash
su name <mind> <dialogue> answer <n>
from name <mind>
ob text <response>
be answer ya
```

`<n>` is a zero-padded decimal counter with fixed width (recommended: 5 digits).

### 4.5 Counter rule

`<n>` comes from:

* newspaper sequence id, when newspaper is enabled (see §6), else
* a per-dialogue runtime counter (in-memory, not necessarily persisted).

The runtime increments this counter exactly once per successful mind call.

---

## 5. Result value

After a successful call, the runtime returns an answer sentence:

```pyash
su name <mind> answer <n>
from name <mind>
ob text <response>
be answer ya
```
The returned answer sentence may share bytes with the dialogue `answer <n>` fact.

### 5.1 Result echo (run output)

For CLI runs (`run`, `runjs`, `runc`) the runtime also emits a write fact to
print the response:

```pyash
su name result ob text <response> be write ya
```

This sentence is intended for human output. It does not replace the answer fact.

---

## 6. Newspaper and again mode

When newspaper and again mode are enabled, each mind invocation is recorded using the
tool envelope specs (`08-tools-and-mcp.md`, `05-run-recording-and-artifacts.md`).

Request/response payloads are recorded as `be json map def … prah` chains
using the `<mind> request <n>` and `<mind> response <n>` names.

### 6.1 Required recorded inputs

The call record MUST include:

* resolved `<mind>` name
* resolved `<dialogue>` name
* resolved model id
* prompt bytes (inline text or artifact ref + sha256)
* tool capability block hash (when tools are enabled)

### 6.2 Required recorded outputs

The result record MUST include:

* response bytes (inline text or artifact ref + sha256)
* the surfaced `<result>` sentence form used to update memory

### 6.3 Replay rule

In again replay, the runtime performs zero backend calls for `be mind`. It consumes
the next recorded mind tool event, verifies structural equality for the evoked
sentence, then applies the surfaced result and appends the same `question <n>` and
`answer <n>` facts to memory.

---

## 7. Tool capabilities and model adapters

From Pyash, tool capabilities are expressed as ordinary `can` sentences. The runtime
may expose those capabilities to the model in two ways:

1. **Native tool calling (preferred)**: pass tools using the backend’s structured
   tool schema fields (when supported).
2. **Capability description block (recommended supplement, and fallback)**:
   include a canonical capability description in the system prompt so the model
   understands what is enabled for this run.

Rationale: some models will refuse a capability unless it is described explicitly,
even when the runtime has enabled it (example: image generation toggles in UI
frontends).

### 7.1 Tool capability map

Tool capabilities may be grouped in a map:

```pyash
su name tools be map def
su name say audio be say ob text become audio can
su name hear audio be hear ob text from state audio can
prah
```

Tool maps use `su name <key>` entries; each entry value is a full sentence.

The runtime MUST preserve a stable ordering of tool sentences by UTF-8 key order,
and print each entry using `sentenceToPyash`.

### 7.2 Adapter responsibility

The adapter is chosen based on the resolved model (mind config `via state <model>`
or call override).

Adapter duties:

* convert Pyash `can` sentences into the backend’s tool schema representation when
  supported
* decide whether a capability description block is included
* ensure deterministic ordering and stable bytes across backends when enabled

### 7.3 Native tool calling (preferred)

When the backend supports structured tool calling, the runtime SHOULD pass the tool
schemas out-of-band (outside the prompt text) using the backend’s standard
mechanism.

The runtime MAY still include the capability description block (see §7.4) to
improve model reliability and reduce “I can not do that” refusals.

### 7.4 Capability description block (supplement and fallback)

When enabled, the runtime constructs a system prompt block describing the tool
capabilities available for this invocation. This block MAY be used:

* **in addition to** native tool calling (supplement), or
* **instead of** native tool calling (fallback) when the backend lacks structured
  tool fields or they are disabled by policy.

Deterministic construction rule (canonical bytes):

* prefix line: `TOOLS:`
* then one tool sentence per line, in canonical printed order
* newline policy: lines separated by `\n`, and the block ends with a final `\n`

Example block:

```
TOOLS:
be say ob text become audio can
be hear from state audio to text can
```

### 7.5 Invocation using a tool map

```pyash
be write
ob text "say hello world out loud"
to name qwenbot
with name tools
do
```

### 7.6 Agent CWD binding

When a mind call includes `at filename <path>`, the runtime MUST record the value
as the **agent CWD** (`su name agent cwd`) and use it to constrain destructive tool
effects. Relative output paths MUST be resolved under this directory, and attempts
to write outside it MUST error.

Example:

```pyash
ob text "summarize"
for name qwenbot
to name text out
with name tools
at filename "artifacts/agent"
be write do
```

---

## 8. Errors

Backend failures surface as `be error ya` per `02-core-execution.md`.

Replay divergence errors for mind calls use the tool envelope error names.

---

## 9. Current limitations

* Interpreter host selection uses `OLLAMA_HOST`; `from space` is stored only.
* Compiled C mind uses libcurl for `/api/chat` and requires libcurl at link time.
* Some model families use template parsing for tool calling; the adapter owns that.

---


---

## Mind tool calling (draft v0.1)

Define **API-native tool calling** for `be mind` backends, including adapter selection, wire formats, and determinism rules.

Pyash programs express capabilities as ordinary `can` sentences. The runtime adapter handles backend-specific tool calling protocols and is abstracted away from Pyash code.

---

## 1. Purpose

This specification defines:

* how the runtime provides a tool set to a mind backend
* how the backend emits tool requests
* how the runtime returns tool results to the backend
* how the runtime selects a model-specific adapter
* determinism rules for stable parity tests and again verification

Tool request/response logging MUST follow `08-tools-and-mcp.md` and appear as
`be tool ya` events in the run newspaper (`05-run-recording-and-artifacts.md`).

---

## 2. Terms

* **mind**: an LLM backend invoked via `be mind`
* **tool calling**: backend-native function/tool calling protocol (example: Ollama `/api/chat` with `tools`)
* **capability**: a Pyash sentence in mood `can`
* **adapter**: runtime component that converts between Pyash capabilities and a backend tool calling protocol
* **tool schema**: a JSON schema-like declaration of a callable function and its parameters
* **tool request**: a structured request emitted by the backend to invoke a named tool with arguments
* **tool result message**: a structured message carrying tool output back to the backend

---

## 3. Abstraction boundary

### 3.1 Pyash-facing contract

* Pyash programs express tool availability using ordinary `can` sentences.
* Pyash programs do not mention backend-specific fields such as `tool_calls` or `tool_use`.
* Model-specific details are a runtime concern.
* Tool invocations are interpreted as **normal Pyash sentences** using the same parser
  and canonicalization rules; the only difference is that the runtime sets the mood to `do`.

### 3.2 Runtime-facing contract

* The runtime selects an adapter based on the resolved mind model id.
* The adapter owns:

  * tool schema generation
  * tool request parsing
  * tool result message formatting
  * any prompt-level capability description that improves reliability

---

## 4. Adapter inputs and outputs

### 4.1 Adapter input

Adapter receives:

* `mindName`
* `modelId`
* ordered list of capability sentences (`canList`)
* request messages (system + conversation)
* policy flags: streaming, max tool calls, allowlist, timeouts

### 4.2 Adapter output

Adapter returns one of:

* final assistant content (no tool request), or
* one or more tool requests plus continuation state for the next turn

---

## 5. Adapter selection

### 5.1 Selection rule

The runtime selects an adapter using the resolved model id from:

1. call override (`ob model` on the invocation), else
2. mind config (`via state`), else
3. runtime default

Adapter choice is not visible to Pyash programs.

### 5.2 Example selection table (informative)

| Model family / id prefix | Adapter id                                        |
| ------------------------ | ------------------------------------------------- |
| `qwen*`                  | `ollama-tools` (primary) with Qwen guidance in §9 |
| `llama*`                 | `ollama-tools`                                    |
| `*`                      | `ollama-tools`                                    |

The runtime may record the adapter id for diagnostics.

---

## 6. Common rules across adapters

### 6.1 Stable tool ordering

Adapter emits tools in a stable order derived from canonical printed bytes of the corresponding Pyash `can` sentence.

### 6.2 Argument encoding

Adapter emits arguments as JSON objects with stable key order when serialising.

### 6.3 Limits

Runtime may enforce:

* maximum tool requests per model turn
* maximum tool requests per Pyash run
* allowlist of tool names

---

## 7. Adapter: Ollama native tools (`ollama-tools`)

This adapter uses Ollama `/api/chat` with the `tools` request field and `message.tool_calls` response field.

### 7.1 Tool schema format

Each tool uses:

* `type: "function"`
* `function.name`
* `function.description` (recommended)
* `function.parameters` (JSON Schema)

#### 7.1.1 Pyash `can` -> tool schema (normative)

Adapter generates a tool schema from the canonical Pyash sentence bytes.
Example capability:

```pyash
su name say ob text "" be say can
```

Adapter output:

```json
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
```

Name is derived by joining signature words with underscores (`be_say_ob_text`).
Description MUST be the canonical printed `can` sentence.

### 7.2 Request: provide tools to the model

Example request with one tool:

```json
{
  "model": "qwen3",
  "stream": false,
  "messages": [
    { "role": "user", "content": "What is the temperature in New York?" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_temperature",
        "description": "Get the current temperature for a city",
        "parameters": {
          "type": "object",
          "required": ["city"],
          "properties": {
            "city": { "type": "string", "description": "City name" }
          }
        }
      }
    }
  ]
}
```

The adapter MUST also include a system prompt line describing tools so the model
can see the capability list in plain text:

```
TOOLS:
su name say ob text "" be say can
```

---

## 8. Canonical golden path example (normative)

```pyash
su name tools be map def
su name say ob text "" be say can
prah
su name helper request 000001 be json map def
su name model ob text "qwen3-vl:8b-instruct" ya
su name stream ob bool lie ya
prah
su name helper response 000001 be json map def
su name model ob text "qwen3-vl:8b-instruct" ya
su name done ob bool truth ya
prah
su name tool event 000001 ob la ob text "use the say tool to say hello world" for name helper to name text helper-out with name tools be write do ko to la su name helper answer 1 from name helper ob text "say hello world" be answer ya ko be tool ya
su name artifact-0 ob name evoke-0 to filename "out.txt" accordingto name sha256 fromtext text "3a0b...ff" by num 6 from name exchange be artifact ya
```

---

## 9. Implementation pointers

- Tool schema generation: `program/verbs/mind/mind.mjs` (`buildToolSchemas`, `toolFunctionNameFromSignature`, `toolSchemaType`).
- Tool sentence reconstruction: `program/verbs/mind/mind.mjs` (`buildToolSentence`).
- Mind invocation: `program/verbs/mind/mind.mjs` (`mind_to_name_text`).
- Compiled JS/C runtime helpers: `program/verbs/exchange/compile/js/mind_runtime_helper.mjs` (mind runtime JS), `program/verbs/exchange/compile/c/helpers_c.mjs` (`MIND_RUNTIME_HELPER`).

---

## 10. Conformance checks

- Tool schema payloads: `node --test quiz/mind_tools_payload.test.mjs`
- Tool call execution: `node --test quiz/mind_tool_call.test.mjs`
- Tool events in newspaper: `node --test quiz/run_newspaper_command*.test.mjs`

### 7.3 Response: tool request emitted by the model

Example response containing `message.tool_calls`:

```json
{
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      {
        "type": "function",
        "function": {
          "index": 0,
          "name": "get_temperature",
          "arguments": { "city": "New York" }
        }
      }
    ]
  },
  "done": true
}
```

Adapter behaviour:

* treat `message.tool_calls` as the tool request channel
* extract `function.name` and `function.arguments`
* dispatch execution to the runtime tool implementation bound to `function.name`

### 7.4 Follow-up: return tool result to the model

After tool execution, runtime sends a follow-up `/api/chat` call that includes:

* original user message
* assistant message containing the tool request
* tool result message with `role: "tool"`

Example follow-up request:

```json
{
  "model": "qwen3",
  "stream": false,
  "messages": [
    { "role": "user", "content": "What is the temperature in New York?" },
    {
      "role": "assistant",
      "content": "",
      "tool_calls": [
        {
          "type": "function",
          "function": {
            "index": 0,
            "name": "get_temperature",
            "arguments": { "city": "New York" }
          }
        }
      ]
    },
    { "role": "tool", "tool_name": "get_temperature", "content": "22°C" }
  ]
}
```

The model may then return final assistant content in a subsequent response.

### 7.5 Streaming mode

In streaming mode, adapter accumulates tool request fields until complete, then:

1. execute tool(s)
2. send tool result message(s)
3. continue the chat loop

Streaming accumulation strategy belongs in code and tests.

---

## 8. Capability description block (supplement and fallback)

Some models behave more reliably when enabled capabilities are also described in prompt text, even while native tool calling is active.

### 8.1 When enabled

The runtime may include a capability description block in the system prompt:

* as a supplement alongside native tool calling, or
* as a fallback for serving stacks that lack native tool calling

### 8.2 Canonical bytes

When enabled, block bytes follow:

* first line: `TOOLS:`
* one capability per line, in canonical printed order
* line separator: `\n`
* block ends with a final `\n`

Example:

```
TOOLS:
be say ob text become audio can
be image generate from text to image can
```

---

## 9. Model family guidance: Qwen (informative)

### 9.1 Capability awareness

Qwen-family models may deny a capability unless the prompt explicitly names it. When a UI toggle enables a capability (example: image generation), include the capability description block (§8) so the model receives explicit context.

### 9.2 Argument shapes

Prefer simple JSON objects for tool arguments. Avoid ambiguous argument types (example: string-or-object unions) unless required.

### 9.3 Multiple tool requests

Define a policy for multiple tool requests in one assistant message:

* allow a bounded list, or
* allow only the first tool request

Record the chosen policy in tests.

---

## 10. Logging hooks (informative)

This document defines backend tool calling. Recording and replay belong to:

* `05-run-recording-and-artifacts.md`
* `08-tools-and-mcp.md`
* `05-run-recording-and-artifacts.md`

Adapter integration points:

* on tool request receipt: emit a tool call record
* on tool result production: emit a tool result record
* store large request or result payloads as artifacts with sha256

---

## 11. Errors

Adapter-level error cases:

* malformed tool request structure
* unknown tool name
* invalid arguments (schema mismatch)
* tool execution failure
* backend transport failure

Error surface format follows `02-core-execution.md`.

---

## 12. Tests

### 12.1 Fixture tests

* given a fixed `canList`, generated `tools[]` JSON remains stable
* given a fixed `tool_calls` payload, parsing yields stable tool dispatch

### 12.2 Integration tests (Ollama)

* enable one tool, verify:

  * model emits `message.tool_calls`
  * runtime executes tool
  * runtime returns a `role: "tool"` message
  * model continues with final content

### 12.3 Qwen regression tests

* capability denial regression: verify capability description block present when policy enables it

---

## Appendix A. Ecosystem comparison table (informative)

| LLM ecosystem                                              | How tools are declared                                            | Tool schema language                           | How a tool request appears in model output                                        | How tool results are returned to the model                         | Interface quirks that vary                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Qwen API (Alibaba Cloud Model Studio, OpenAI-compatible)   | `tools` parameter; service applies a model template               | JSON Schema in an OpenAI-compatible shape      | OpenAI-style tool or function calls                                               | tool output supplied in the next turn in an OpenAI-compatible loop | server-side template adaptation reduces client prompt-template work |
| Qwen open models (Qwen2.5, Qwen3) via libraries and agents | tools passed via tools or functions formats; agent libraries vary | JSON Schema                                    | either structured tool-call objects or JSON tool calls embedded in assistant text | depends on serving stack; often mirrors OpenAI loops               | behaviour depends strongly on chat templates and serving layer      |
| OpenAI (Responses API)                                     | `tools` array plus tool choice control                            | JSON Schema in `parameters`                    | tool calls returned in response output items                                      | tool output sent in a follow-up request keyed to call id           | tool choice supports auto, required, or forcing a tool              |
| Anthropic Claude (tool use)                                | `tools` list in request                                           | JSON-schema style `input_schema`               | assistant emits `tool_use` content blocks with an id                              | user message carries `tool_result` blocks tied to id               | strict sequencing and placement rules                               |
| Google Gemini API                                          | function declarations; also offers managed tools                  | function parameter schema in declaration       | model returns a function call with parameters                                     | app supplies function response back into conversation              | custom function calling plus built-in tools                         |
| Amazon Bedrock (Converse API tool use)                     | tools supplied via Bedrock Runtime request                        | Bedrock-specific wrapper objects               | model produces a tool request                                                     | client supplies tool results back, then model completes            | uniform interface across many hosted models, Bedrock request shapes |
| Mistral API                                                | `tools` in Conversations API or Agents                            | JSON schema tool specs                         | model emits tool calls with JSON inputs                                           | tool results returned into conversation loop                       | function calling as common pattern                                  |
| Cohere Chat API (tool use)                                 | `tools` parameter; optional strict enforcement                    | parameter typing rules plus structured tooling | model emits tool calls aligned to tool names and types                            | tool results returned to chat flow                                 | strict mode tightens schema adherence                               |
| Ollama (local runtime)                                     | `tools` field in chat request                                     | JSON schema-like tool specs                    | `message.tool_calls` when model supports tools                                    | tool results supplied via `role: "tool"` messages                  | tool support varies by model family; streaming plus tools           |
| vLLM (serving layer)                                       | `tools` plus a chat template                                      | JSON tool schema                               | tool calls follow declared schema and template                                    | results supplied back via server protocol                          | template quality drives reliability                                 |
| llama.cpp (local inference)                                | function calling via server formats                               | multiple native formats per template           | tool calls follow chosen native format                                            | results fed back through chat loop                                 | multiple model-family formats                                       |

---

## Appendix B. Contrasting wire examples (informative)

### B.1 OpenAI Chat Completions style (tool_call_id)

Tool request (assistant emits `tool_calls`, arguments as a JSON string):

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "call_001",
            "type": "function",
            "function": { "name": "plus", "arguments": "{\"a\":2,\"b\":3}" }
          }
        ]
      }
    }
  ]
}
```

Tool result message keyed by `tool_call_id`:

```json
{
  "messages": [
    { "role": "tool", "tool_call_id": "call_001", "content": "5" }
  ]
}
```

### B.2 Claude tool use blocks (tool_use_id)

Tool request:

```json
{
  "content": [
    { "type": "tool_use", "id": "toolu_001", "name": "plus", "input": { "a": 2, "b": 3 } }
  ],
  "stop_reason": "tool_use"
}
```

Tool result block:

```json
{
  "role": "user",
  "content": [
    { "type": "tool_result", "tool_use_id": "toolu_001", "content": "5" }
  ]
}
```

### B.3 “Arguments object” style (common in Ollama tool_calls)

Tool request:

```json
{
  "message": {
    "role": "assistant",
    "tool_calls": [
      {
        "type": "function",
        "function": { "index": 0, "name": "plus", "arguments": { "a": 2, "b": 3 } }
      }
    ]
  }
}
```

Tool result message:

```json
{
  "messages": [
    { "role": "tool", "tool_name": "plus", "content": "5" }
  ]
}
```

---

## References

(These are copy-paste URLs for the docs; keep them out of the normative sections if you prefer.)

* Alibaba Cloud Model Studio function calling: [https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling](https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling)
* Qwen function calling docs: [https://qwen.readthedocs.io/en/latest/framework/function_call.html](https://qwen.readthedocs.io/en/latest/framework/function_call.html)
* Ollama tool calling: [https://docs.ollama.com/capabilities/tool-calling](https://docs.ollama.com/capabilities/tool-calling)
* Ollama streaming tool calling blog: [https://ollama.com/blog/streaming-tool](https://ollama.com/blog/streaming-tool)
* OpenAI Responses API reference: [https://platform.openai.com/docs/api-reference/responses](https://platform.openai.com/docs/api-reference/responses)
* OpenAI function calling guide: [https://platform.openai.com/docs/guides/function-calling](https://platform.openai.com/docs/guides/function-calling)
* Claude tool use overview: [https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
* Claude tool use implementation: [https://platform.claude.com/docs/en/agents-and-tools/tool-use-implement-tool-use](https://platform.claude.com/docs/en/agents-and-tools/tool-use-implement-tool-use)
* Gemini function calling: [https://ai.google.dev/gemini-api/docs/function-calling](https://ai.google.dev/gemini-api/docs/function-calling)
* Gemini tools: [https://ai.google.dev/gemini-api/docs/tools](https://ai.google.dev/gemini-api/docs/tools)
* Bedrock tool use: [https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html)
* Bedrock tool use examples: [https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-examples.html](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-examples.html)
* Mistral function calling: [https://docs.mistral.ai/capabilities/function_calling](https://docs.mistral.ai/capabilities/function_calling)
* Cohere tool use overview: [https://docs.cohere.com/docs/tool-use-overview](https://docs.cohere.com/docs/tool-use-overview)
* vLLM tool calling: [https://docs.vllm.ai/en/latest/features/tool_calling/](https://docs.vllm.ai/en/latest/features/tool_calling/)
* llama.cpp function calling: [https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md)


---

## Tool envelope (v0.1)

## 1. Purpose

Define the **tool envelope**: the newspaper record format for tool-capable operations
(mind calls and command-backed verbs). This spec is about **recording** and
**determinism**, not tool selection.

This spec links to:

- `05-run-recording-and-artifacts.md` (where tool events live)
- `08-tools-and-mcp.md` (mind and tool adapter sections)
- `05-run-recording-and-artifacts.md` (artifact records)

---

## 2. Terms

- **tool event**: a newspaper record that pairs an evoked sentence with a surfaced result sentence.
- **request/response record**: `be json map def … prah` chains carrying mind request/response payloads.

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

Mind adapters MUST emit request/response payloads as json map definition chains:

```
su name <mind> request <n> be json map def
su name model ob text "<model>" ya
prah
su name <mind> response <n> be json map def
su name done ob bool truth|lie ya
prah
```

Rules:

- `<n>` is the per-dialogue mind counter.
- Records appear in the newspaper before the tool event.

---

## 4. Canonical golden path example (normative)

```pyash
su name tools be map def
su name say ob text "" be say can
prah
su name helper request 000001 be json map def
su name model ob text "qwen3-vl:8b-instruct" ya
su name stream ob bool lie ya
prah
su name helper response 000001 be json map def
su name model ob text "qwen3-vl:8b-instruct" ya
su name done ob bool truth ya
prah
su name tool event 000001 ob la ob text "use the say tool to say hello world" for name helper to name text helper-out with name tools be write do ko to la su name helper answer 1 from name helper ob text "say hello world" be answer ya ko be tool ya
su name artifact-0 ob name evoke-0 to filename "out.txt" accordingto name sha256 fromtext text "3a0b...ff" by num 6 from name exchange be artifact ya
```

---

## 5. Implementation pointers

- Tool event emission (interpreter): `program/command/run_pya_program.mjs` (`emitToolEvent`).
- Mind JSON records: `program/verbs/mind/mind.mjs` (`recordMindJson`).
- Compiled JS tool events: `program/verbs/exchange/compile/emit_mind.mjs`, `program/verbs/exchange/compile/emit_command.mjs`, `program/verbs/exchange/compile/emit_write.mjs` (tool event `pyaEmitNewspaper` emissions).
- Compiled C tool events: `program/verbs/exchange/compile/c/helpers_c.mjs` (`pya_emit_exchange`).

---

## 6. Conformance checks

- Tool event records exist: `node --test quiz/run_newspaper_command*.test.mjs`
- Tool schema payloads: `node --test quiz/mind_tools_payload.test.mjs`
- Tool call execution: `node --test quiz/mind_tool_call.test.mjs`
- Newspaper grep: `rg "be tool ya" newspaper/*.pya`


---

# Tool ABI v0.1 (minimal consolidation)

This file is a **consolidation** of existing tool-envelope rules already defined
in `08-tools-and-mcp.md` and `05-run-recording-and-artifacts.md`. It does **not**
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
- Tool events appear **after** any request/response `be json map def … prah` records.

Sources: `08-tools-and-mcp.md` §15, `05-run-recording-and-artifacts.md` §9.

## 3. Mind request/response records (normative)

Mind adapters must emit request/response payloads as json map definition chains:

```pyash
su name <mind> request <n> be json map def
su name model ob text "<model>" ya
prah
su name <mind> response <n> be json map def
su name done ob bool truth|lie ya
prah
```

Rules:
- `<n>` is the per-dialogue mind counter.
- Records appear before the corresponding tool event.

Sources: `08-tools-and-mcp.md` §15.

## 4. Determinism requirements (normative)

- Tool capability blocks and tool schema lists must be produced in **stable**
  canonical order derived from canonical printed bytes of `can` sentences.
- Tool events must remain stable across backends given the same evoked sentence.

Sources: `08-tools-and-mcp.md` §7, §15.

## 5. Deferred items (explicitly out of scope)

- MCP discovery, tool list snapshotting, schema identity hashing.
- Deadline/cancellation propagation (`qa`/timeouts).
- Permission gating/allowlists for MCP.

These remain in the MCP roadmap until a dedicated MCP spec is added.


---

# MCP Integration Spec v0.1 (draft)

This spec defines the MCP client integration for Pyash. It is written to be
compatible with existing tooling contracts:
- Tool ABI v0.1: `documentation/specifications/08-tools-and-mcp.md`
- Tool events + artifacts: `documentation/specifications/05-run-recording-and-artifacts.md`
- Mind + tool calling rules: `documentation/specifications/08-tools-and-mcp.md`

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
- model-specific tool calling policies (see `08-tools-and-mcp.md`)

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
- The artifact MUST be referenced from the run record (see `05-run-recording-and-artifacts.md`).
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
existing JSON map canonicalization rules (`06-data-formats.md`) before hashing.

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
- The facade module MUST be importable via standard module rules (`11-modules.md`).

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
