# mind.md — Pyash Mind Integration

This document defines how a **mind** (an LLM endpoint) is configured, how Pyash calls it, how replies are represented, and how conversational context flows to Ollama.

## Concepts

- A **mind** is an LLM endpoint plus configuration.
- Configure once with `be mind ya` (host/model/system prompt).
- Invoke with `be mind do` or `be say ... to <mind> do`.
- The interpreter calls `motor/ollama.mjs`.
- The compiler (JS) emits a call into a small JS HTTP helper instead of shelling out to `curl`.

All calls use Ollama’s `/api/chat` endpoint with a `messages[]` array so the model receives previous turns as context.

---

## Configure once

Example:

```pyash
su generator be mind
  from space "http://localhost:11434"
  via  state "qwen3-vl:8b-instruct"
  via  discourse "pyash_orchestrator"
ya
````

Fields:

* `from space` → host (default: `http://localhost:11434` if `OLLAMA_HOST` is unset).
* `via state` (`as`) → model

  * interpreter default: `qwen3-vl:8b-instruct` if missing.
* `via discourse` (`accordingto`) → system prompt string for the mind.

Internally, the runtime stores at least:

```jsonc
{
  "name": "generator",
  "host": "http://localhost:11434",
  "model": "qwen3-vl:8b-instruct",
  "system": "pyash_orchestrator"
}
```

---

## Calling a mind

### Pyash source

Direct call:

```pyash
su question obj discourse "Hello" to generator be mind do
```

Via `say`:

```pyash
be say obj text "Hello" to generator do
```

### Runtime behaviour (high level)

1. Resolve mind config:

   * host, model, system prompt for `generator`.
2. Collect conversation history from `memory` for this mind. (Implemented: bounded last N turns; window is per mind via `obj window num N` on the config sentence, default ~8.)
3. Build `messages[]` for Ollama:

   * optional `system` message from `via discourse`.
   * interleaved `user` / `assistant` messages from history.
   * current `user` message from `obj` text.
4. Send a `POST /api/chat` to Ollama with `stream: false`.
5. Store the reply into `memory` as new facts.
6. Return `{ obj: { text: <reply>, model: <model_name> } }` to the caller.

---

## Context (conversation history)

### Source of history

The runtime derives context from `memory`. For each mind `<M>`:

* **User messages** for `<M>`:

  ```jsonc
  {
    "mood": "do",
    "be": "say",
    "obj": { "name": "<user text>" },
    "to":  { "name": "<M>" }
  }
  ```

* **Assistant messages** from `<M>`:

  Primary form:

  ```jsonc
  {
    "mood": "ya",
    "subj": { "name": "<M>" },
    "be": "mind",
    "obj": {
      "text": "<llm reply>",
      "model": "qwen3-vl:8b-instruct"
    }
  }
  ```

  A secondary form uses `subj: "result"` with `be: "say"` and the same `obj.text`. Both map to `role: "assistant"` for context building.

### History stitching

**Status:** implemented for interpreter (prompts include last N turns) and compiled JS (per-mind history map). Window remains configurable-to-be in code (defaults ~8 turns).

Before each mind call, the runtime:

1. Scans `memory` in order for facts belonging to that mind.

2. Projects them into a chat-style sequence:

   ```js
   [
     { role: "user",      content: "<previous prompt 1>" },
     { role: "assistant", content: "<previous reply 1>" },
     { role: "user",      content: "<previous prompt 2>" },
     { role: "assistant", content: "<previous reply 2>" },
     // ...
   ]
   ```

3. Trims to a bounded window, for example the last `N` user+assistant pairs:

   * default window: about 8 turns (16 messages).
   * mind configs may override this with a `historyWindow` field.

When implemented, this `historyMessages[]` array feeds directly into `messages[]` for Ollama.

### Caller-provided context

Callers may also embed their own context inside the current `obj` text or other fields. The automatic history stitching runs in addition to any explicit context the caller supplies.

---

## Ollama call shape

Both interpreter and compiled JS paths aim for the same JSON call to Ollama:

```jsonc
POST /api/chat
Content-Type: application/json

{
  "model": "<mind.model>",
  "messages": [
    {
      "role": "system",
      "content": "<mind.system prompt, if present>"
    },
    // historyMessages from memory:
    { "role": "user",      "content": "earlier user message 1" },
    { "role": "assistant", "content": "earlier assistant reply 1" },
    // ...
    // current call:
    { "role": "user",      "content": "<current obj text>" }
  ],
  "options": {
    "num_ctx": 8192
  },
  "stream": false
}
```

The runtime then reads:

```jsonc
{
  "message": {
    "role": "assistant",
    "content": "<generated text>"
  },
  // other metadata omitted
}
```

and uses `message.content` as the reply text.

---

## Reply facts

The runtime records each call–reply pair in `memory` so that future calls see a continuous conversation.

Example:

```jsonc
// User → mind
{
  "mood": "do",
  "be": "say",
  "to":  { "name": "generator" },
  "obj": { "name": "<current obj text>" }
}

// Mind → user (main record)
{
  "mood": "ya",
  "subj": { "name": "generator" },
  "be": "mind",
  "obj": {
    "text":  "<llm reply text>",
    "model": "qwen3-vl:8b-instruct"
  }
}
```

A secondary “result” fact may mirror the reply for downstream use:

```jsonc
{
  "mood": "ya",
  "subj": { "name": "result" },
  "be": "say",
  "obj": {
    "text":  "<llm reply text>",
    "model": "qwen3-vl:8b-instruct"
  }
}
```

These facts serve both as a queryable log and as the source for automatic context.

---

## Interpreter vs compiled behaviour

### Interpreter

* Uses `motor/ollama.mjs`.
* Builds `messages[]` as described above.
* Uses `fetch` or an equivalent HTTP client to call `POST /api/chat`.
* Stores reply facts and returns `{ obj: { text, model } }` to the REPL.

### Compiled JS

* Emits code that calls a small helper, for example `ollama_chat.mjs`, rather than calling `curl` directly.
* The helper receives:

  * `host`, `model`, `systemPrompt`,
  * `historyMessages[]` (already built),
  * `currentText`,
  * `numCtx` (optional).
* The helper assembles the JSON payload and calls `POST /api/chat` using `fetch` or a minimal HTTP client.

This gives parity between interpreter and compiled paths and avoids shelling out.

---

## Notes / TODO

* Streaming responses: future work.
* C codegen for minds: future work.
* Extra tooling for summarising very long histories: future work.

````

---

## About replacing `curl`

For the compiled JS path you have three realistic options that stay light:

1. **Use Node’s built-in `fetch`** (Node 18+):

   - No extra dependency.
   - The helper module looks like:

     ```js
     // ollama_chat.mjs
     export async function ollamaChat({ host, model, messages, numCtx = 8192 }) {
       const res = await fetch(`${host}/api/chat`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           model,
           messages,
           options: { num_ctx: numCtx },
           stream: false,
         }),
       });

       if (!res.ok) {
         throw new Error(`ollama chat failed: ${res.status} ${res.statusText}`);
       }

       const data = await res.json();
       return data.message?.content ?? "";
     }
     ```

   - The compiler then emits:

     ```js
     import { ollamaChat } from "./ollama_chat.mjs";

     const reply = await ollamaChat({ host, model, messages, numCtx });
     ```

2. **Use `undici` in older Node**:

   - Still very small.
   - Same interface, just swap `fetch` with `undici.fetch`.

3. **Ollama CLI** as a shell tool (fallback only):

   - `ollama chat` can handle context on its own, although with less structured control.
   - For a Pyash mind that already builds `messages[]`, the HTTP path is a better fit.

If you want Codex to refactor away from `curl`, you can say:

> “Replace the compiled JS `curl` call with a small `ollama_chat.mjs` helper that calls `POST /api/chat` via Node’s built-in `fetch`. The helper should accept `{ host, model, messages, numCtx }`, where `messages` already includes system, history, and current user message. Both interpreter and compiled code should call this helper so they share the same context behaviour.”

Then open `mind.md` with `vim mind.md` and paste the updated version.
::contentReference[oaicite:0]{index=0}
````
