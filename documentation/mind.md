# mind.md — Pyash Mind Integration

This document defines how a **mind** (an LLM endpoint) is configured, how Pyash calls it, how replies are represented, and how conversational context flows to Ollama.

## Concepts

- A **mind** is an LLM endpoint plus configuration.
- Configure once with `be mind ya` (host/model/system prompt).
- Invoke with `be write ... for name <mind> to name <output> do`.
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
  from discourse "pyash_orchestrator"
  accordingto name session
  by   num 6
ya
````

Fields:

* `from space` → host (default: `http://localhost:11434` if `OLLAMA_HOST` is unset).
* `via state` (`as`) → model

  * interpreter default: `qwen3-vl:8b-instruct` if missing.
* `from discourse` (`fromtext`) → system prompt string for the mind.
* `accordingto name <session>` → series-backed session history (optional).
* `by num N` (quantity/way case) → history window for that mind (keeps ~N user+assistant pairs). Using the existing quantity axis avoids adding a new case; defaults to ~8 if omitted. Per-call override via `by num` is accepted too.

Internally, the runtime stores at least:

```jsonc
{
  "name": "generator",
  "host": "http://localhost:11434",
  "model": "qwen3-vl:8b-instruct",
  "system": "pyash_orchestrator",
  "session": "session"
}
```

---

## Calling a mind

### Pyash source

Direct call:

```pyash
su question ob discourse "Hello" for name generator to name text generator-out be write do
```

Via `write`:

```pyash
be write ob text "Hello" to generator do
```

Relevant compositional cases at call time:
- `ob` holds the user text (`ob text` or `ob discourse`).
- `for name <mind>` selects which mind to call.
- `to name <output>` receives the response text.
- Optional `by num N` could override window per call (not yet wired; config-level `by num` is used).

### Runtime behaviour (high level)

1. Resolve mind config:

   * host, model, system prompt for `generator`.
2. Collect conversation history from `memory` for this mind. (Implemented: bounded last N turns; window is per mind via `by num N` on the config sentence, default ~8.)
3. Build `messages[]` for Ollama:

   * optional `system` message from `from discourse`.
   * interleaved `user` / `assistant` messages from history.
   * current `user` message from `ob` text.
4. Send a `POST /api/chat` to Ollama with `stream: false`.
5. Store the reply into `memory` as new facts.
6. Return `{ ob: { text: <reply>, model: <model_name> } }` to the caller.

---

## Context (conversation history)

### Source of history

The runtime supports two history sources:

1. **Series history**: `accordingto name <session>` points to a `be series` value.
2. **Internal history**: per-mind log stored under `<M> story`.

If a series is attached, it is used (and appended) instead of the internal log.

#### Internal history facts

For internal history, the runtime derives context from `memory`. For each mind `<M>`:

* **User messages** for `<M>`:

  ```jsonc
  {
    "mood": "do",
    "be": "write",
    "ob": { "name": "<user text>" },
    "to":  { "name": "<M>" }
  }
  ```

* **Assistant messages** from `<M>`:

  Primary form:

  ```jsonc
  {
    "mood": "ya",
    "su": { "name": "<M>" },
    "be": "mind",
    "ob": {
      "text": "<llm reply>",
      "model": "qwen3-vl:8b-instruct"
    }
  }
  ```

  A secondary form uses `su: "result"` with `be: "write"` and the same `ob.text`. Both map to `role: "assistant"` for context building.

### History stitching

**Status:** implemented for interpreter (prompts include last N turns) and compiled JS (per-mind history map). Window remains configurable-to-be in code (defaults ~8 turns).

Before each mind call, the runtime:

1. Uses series entries (if attached) or scans `memory` for facts belonging to that mind.

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

### Series entry shape

Series history expects entries shaped like:

```pyash
su name user ob text "Hello" be text ya
su name assistant ob text "Hi!" be text ya
```

`su` is the role, `ob text` is the content. Other fields are ignored.

### Mind session map

Interpreter builds a shared, read-only map that exposes session histories:

* `mind session map` is a pyash map.
* Each entry key is a dialogue name (e.g. `"helper story"`).
* Each entry value points at a **series** named `"<dialogue> session"`.

Example:

```pyash
ob name mind session map be write do
ob name helper story session be write do
```

### Caller-provided context

Callers may also embed their own context inside the current `ob` text or other fields. The automatic history stitching runs in addition to any explicit context the caller supplies.

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
    { "role": "user",      "content": "<current ob text>" }
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

## Discharge (module-specific)

Some mind backends expose a module-level discharge ceremony. For Ollama:

```pyash
from filename "./module/mind_ollama.pya" ob name discharge to name mind discharge be import do
ob text "qwen3-vl:8b-instruct" be mind discharge do
```

This sends `keep_alive: 0` to Ollama to unload the model after a run.

The same module exposes `begin` and `restart` so you can warm or cycle the model:

```pyash
ob text "qwen3-vl:8b-instruct" be mind begin do
ob text "qwen3-vl:8b-instruct" be mind restart do
```

---

## Reply facts

The runtime records each call–reply pair in `memory` so that future calls see a continuous conversation.

Example:

```jsonc
// User → mind
{
  "mood": "do",
  "be": "write",
  "to":  { "name": "generator" },
  "ob": { "name": "<current ob text>" }
}

// Mind → user (main record)
{
  "mood": "ya",
  "su": { "name": "generator" },
  "be": "mind",
  "ob": {
    "text":  "<llm reply text>",
    "model": "qwen3-vl:8b-instruct"
  }
}
```

A secondary “result” fact may mirror the reply for downstream use:

```jsonc
{
  "mood": "ya",
  "su": { "name": "result" },
  "be": "write",
  "ob": {
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
* Stores reply facts and returns `{ ob: { text, model } }` to the REPL.

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

If you want Codex to refactor away from `curl`, you can write:

> “Replace the compiled JS `curl` call with a small `ollama_chat.mjs` helper that calls `POST /api/chat` via Node’s built-in `fetch`. The helper should accept `{ host, model, messages, numCtx }`, where `messages` already includes system, history, and current user message. Both interpreter and compiled code should call this helper so they share the same context behaviour.”

Then open `mind.md` with `vim mind.md` and paste the updated version.
::contentReference[oaicite:0]{index=0}
````
