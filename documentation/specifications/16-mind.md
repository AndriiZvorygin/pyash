# `16-mind.md` (draft v0.2)

Define the **mind** verb as implemented today (interpreter + compiled JS), plus the
persistent dialogue history shape used by Pyash memory.

This spec aligns with `quiz/mind.test.mjs` and defines deterministic replay when
newspaper and again mode are enabled.

---

## 1. Purpose

`be mind` invokes a language-model backend and returns a text response.

`be write ... to name <mind>` is an alias for invoking that mind.

---

## 2. Registration (config) sentence

A mind is configured by storing a fact (surface `via` is stored as `as` and
`accordingto`):

```pyash
su name <mind> be mind
from space <host>
via state <model>
via discourse <prompt>
ya
```

Current interpreter behavior:

* `from space` is stored; HTTP host comes from `OLLAMA_HOST`.
* `via state` stores the default model as `as name <model>`.
* `via discourse` stores the system prompt as `accordingto name <prompt>`.
* `by num` or `ob window num` sets the history window size.

Registration updates memory for `<mind>`.

---

## 3. Invocation

Invocation uses `be mind` or `be write ... to name <mind>`:

```pyash
su name <result>
ob text <text>
to name <mind>
be mind do
```
`ob discourse <text>` is accepted in source and parsed as `ob name <text>`.

### 3.1 Model resolution

* `ob model` on the call, if present
* else config model (`via state`)
* else default `qwen3-vl:8b-instruct`

### 3.2 Prompt assembly

The runtime constructs the model request from:

1. system prompt from config (`via discourse`)
2. tool capability block (if provided, see §7)
3. recent history messages from the resolved dialogue (see §4)
4. current user prompt from the invocation (`ob text <text>`)
5. upstream `inputs` passed by the bridge (implementation-defined)

---

## 4. Dialogue histories

History is stored as memory facts keyed by a dialogue name.

### 4.1 Dialogue selection

Priority (first match wins):

1. `from text` on the call
2. `fromtext name` or `fromtext text` on the call
3. `from text` or `fromtext` on the config sentence
4. `<mind> story` (default)

### 4.2 History window

The window is:

* `by num` or `ob window num` on the call, else
* config window, else
* `8`

Each window holds `window * 2` messages (user + assistant pairs).

### 4.3 History fact shapes

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

### 4.4 Counter rule

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
tool envelope specs (`15-tool-envelope.md`, `11-run-newspaper.md`).

Request/response JSON is recorded as `be write ya` sentences with `quoted.json`
payloads (see `15-tool-envelope.md`).

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

---

## 8. Errors

Backend failures surface as `be error ya` per `06-errors.md`.

Replay divergence errors for mind calls use the tool envelope error names.

---

## 9. Current limitations

* Interpreter host selection uses `OLLAMA_HOST`; `from space` is stored only.
* Compiled C mind uses libcurl for `/api/chat` and requires libcurl at link time.
* Some model families use template parsing for tool calling; the adapter owns that.

---
