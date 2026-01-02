# `17-mind-tool-calling.md` (draft v0.1)

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

Tool request/response logging MUST follow `15-tool-envelope.md` and appear as
`be tool ya` events in the run newspaper (`11-run-newspaper.md`).

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

## 9. Implementation pointers

- Tool schema generation: `program/verbs/mind/mind.mjs` (`buildToolSchemas`, `toolFunctionNameFromSignature`, `toolSchemaType`).
- Tool sentence reconstruction: `program/verbs/mind/mind.mjs` (`buildToolSentence`).
- Mind invocation: `program/verbs/mind/mind.mjs` (`mind_to_name_text`).
- Compiled JS/C runtime helpers: `program/verbs/exchange/compile.mjs` (mind runtime JS), `program/verbs/exchange/helpers_c.mjs` (`MIND_RUNTIME_HELPER`).

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

* `11-run-newspaper.md`
* `15-tool-envelope.md`
* `13-exchange-and-artifact.md`

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

Error surface format follows `06-errors.md`.

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
            "function": { "name": "add", "arguments": "{\"a\":2,\"b\":3}" }
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
    { "type": "tool_use", "id": "toolu_001", "name": "add", "input": { "a": 2, "b": 3 } }
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
        "function": { "index": 0, "name": "add", "arguments": { "a": 2, "b": 3 } }
      }
    ]
  }
}
```

Tool result message:

```json
{
  "messages": [
    { "role": "tool", "tool_name": "add", "content": "5" }
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
