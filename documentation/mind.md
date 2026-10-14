# mind.md — Pyash Mind Integration

This document defines how a **mind** (an LLM endpoint) is configured, how Pyash calls it, how replies are represented, and how conversational context flows across supported backends.

## Concepts

- A **mind** is an LLM endpoint plus configuration.
- Configure once with `be mind ya` (host/model/system prompt).
- Invoke with `be write ... for name <mind> to name <output> do`.
- The selected backend module calls its provider adapter.
- The compiler (JS) emits a call into a small JS HTTP helper instead of shelling out to `curl`.

The default backend remains Ollama. Optional OpenAI-compatible backends use the same conversation and tool-call payloads through the OpenAI Chat Completions API.

## Optional Local Strata Backend

Pyash can use Strata as a selectable local backend without changing the default Ollama profile. Configure it with the backend key `strata`; its default host is `http://127.0.0.1:8081` and its OpenAI-compatible model alias is `strata`.

```sh
./run pyash configure mind --backend strata --host http://127.0.0.1:8081 --model strata
```

Pyash sends requests to `http://127.0.0.1:8081/v1/chat/completions`. The Strata runner uses a local placeholder bearer token by default so it never falls through to Codex OAuth; if Strata API-key auth is enabled, provide that key through `STRATA_API_KEY` outside the repository.

### GPU manager handoff

Strata must be installed outside this repository. Strata eagerly loads the model on its initial server start, before its `before_load` hook applies, so start it through the Pyash admission helper:

```sh
PYASH_ROOT=/path/to/pyash
STRATA_ROOT="$HOME/Strata"
python3 "$PYASH_ROOT/command/strata_prepare_gpu.py" 20000 -- "$STRATA_ROOT/run-iq2_xs.sh"
```

The helper starts Strata only after the GPU Housekeeper grants capacity. It retries the manager's specific post-discharge VRAM-settling refusal; all other refusals fail closed. In Strata's `strata-<model>.json`, also point `before_load` at the tracked Pyash capacity hook for future unload/reload cycles and set the same free-VRAM threshold. Replace `<pyash-root>` with this checkout's absolute path:

```json
{
  "host": "127.0.0.1",
  "port": 8081,
  "before_load": ["python3", "<pyash-root>/command/strata_prepare_gpu.py", "20000"],
  "before_load_timeout_s": 120,
  "before_load_strict": true,
  "min_free_vram_mib": 20000
}
```

Before startup and before later model reloads, the helper/hook asks the local GPU Housekeeper to admit the requested VRAM. The manager refuses while its execution gate is busy, and only unloads a managed runtime when its provider-specific activity probe confirms it is safe. For Ollama this means no queued/running Housekeeper job, no inference request in the configured idle-log window, `keep_alive: 0` for each resident model, and a verified empty `/api/ps` response. Unknown activity or failed telemetry prevents loading. Strata's `min_free_vram_mib` checks the free-VRAM floor again, closing the short race between manager admission and allocation.

For reverse handoff, register this host's loopback Strata API with the Housekeeper by adding the following to `container/gpu-housekeeper/service/.env`, then restart the Housekeeper:

```sh
GPU_HOUSEKEEPER_STRATA_RUNTIME_URL=http://127.0.0.1:8081
```

The manager then checks Strata before admitting another managed GPU runtime. It unloads Strata only after its status API confirms zero in-flight requests and the configured 300-second idle grace has elapsed; it verifies `loaded:false` and rechecks actual free VRAM before admitting the next runtime. The Housekeeper uses a short-lived host-network helper container to reach Strata's loopback API, so Strata itself remains bound to `127.0.0.1`. If Strata API-key authentication is enabled, put the same key in the Housekeeper environment as `STRATA_API_KEY`; never commit it.

Non-streaming Strata mind calls are submitted as `strata-chat` jobs through the
Pyash GPU Housekeeper. The Housekeeper owns the device gate, capacity check,
safe discharge of idle managed runtimes, Strata load/reload, and the provider
request. The caller receives the completed response after the queued job
finishes. This keeps web chat and ordinary mind calls on the same GPU control
plane instead of letting a caller race a resident model directly.

The Housekeeper's Strata activity probe uses Strata's own in-flight and
last-request status, and refuses to discharge it when those fields are absent
or invalid. Streaming compatibility remains available for the legacy direct
runner path; the web assistant uses the non-streaming queued path.

Keep Strata bound to loopback. The Housekeeper endpoint is on the host-local `http://127.0.0.1:8090`; do not point the Strata hook at a remote or federated manager.

---

## Configure once

Example:

```pyash
su generator be mind
  from space "http://localhost:11434"
  via  state "qwen3.5:9b"
  from discourse "pyash_orchestrator"
  accordingto name session
  by   num 6
ya
````

Fields:

* `from space` → host (default: `http://localhost:11434` if `OLLAMA_HOST` is unset).
* `from state` (`fromstate`) → backend/provider, using a short name such as `ollama`, `strata`, `openrouter`, or `vllm`.
* `via state` (`as`) → model.

  * If omitted, the interpreter loads `mind model` from `configure/default.pya`
    (or `model` from the nearest house `conduct/runtime.pya`). The current
    repository default is `qwen3.5:9b`.
* `from discourse` (`fromtext`) → system prompt string for the mind.
* `accordingto name <session>` → series-backed session history (optional).
* `by num N` (quantity/way case) → history window for that mind (keeps ~N user+assistant pairs). Using the existing quantity axis avoids adding a new case; defaults to ~8 if omitted. Per-call override via `by num` is accepted too.

For example, configure one mind to use Strata while leaving the global Ollama default unchanged:

```pyash
exists su stratahelper be mind
  from state "strata"
  from space "http://127.0.0.1:8081"
  via state "qwen3.8-flash-next-iq2_xs"
ya
```

The backend and endpoint are selected per mind. Resolution precedence is agent runtime configuration, then this mind declaration, then the global `mind backend` and host settings. Minds without `from state` keep the existing global backend behaviour.

Internally, the runtime stores at least:

```jsonc
{
  "name": "generator",
  "host": "http://localhost:11434",
  "model": "qwen3.5:9b",
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

### Vision Inputs From Channel Files

When channel delivery includes image attachments, Pyash stores them in the target agent house under:

`world/house/<agent>/artifacts/YYYYMMDD/`

Then the runtime does two things:

1. Adds file location/tool hints to the prompt so the agent can use file tools directly.
2. If the selected model looks vision-capable (`vl`, `vision`, `llava`, `minicpm-v`, etc.), the image file paths are passed to the mind backend as native image inputs (not pre-digested text).

Current transport behavior:

- `ollama command mind` (`command/mind_ollama_runner.mjs`) converts image file paths into base64 `messages[].images` for `/api/chat`.

Tool guidance for file attachments:

- `be read from filename <path> ...` for extraction/transformation.
- `be see from filename <image> ...` for explicit image interpretation.
- `be command ...` and `be repair ...` for inspection and code/file edits.

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
      "model": "qwen3.5:9b"
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

## Ollama usage ledger

`command/mind_ollama_runner.mjs` emits one immutable Pyash usage artifact for
each Ollama call, including failed calls. By default the records are written
under the run's artifact directory:

```text
artifacts/<run-id>/ollama/usage/call-<call-id>-<record-hash>.pya
```

The record captures the requested and resolved model, endpoint without
credentials or query parameters, host, call mode, stream/queue status, request
and response hashes, timestamps, status/failure kind, and Ollama's token and
duration metadata. `PYA_OLLAMA_USAGE_DIR` may override the destination for
managed integrations or isolated audits. The records are content-addressed by
their canonical record hash and are created with exclusive file creation, so
retries do not overwrite an existing call record.

Streaming calls retain the terminal Ollama frame before writing the ledger
entry. This preserves `prompt_eval_count`, `eval_count`, and duration fields
that Ollama reports only in that final frame. Queue-managed calls are recorded
by the local runner after the existing GPU queue/housekeeper returns; the
ledger does not create a second model or GPU lifecycle.

Use `listOllamaUsageRecords` and `summarizeOllamaUsage` from
`program/library/ollama_usage.mjs` to inspect records and aggregate totals by
model. A failure to write the ledger is reported on stderr and never changes
the model-call result.

---

## Provider substitution

Use one caller shape and swap provider by helper config:

```pyash
exists su name helper be mind ya
ob text "Task." for name helper to name text output be write do
```

```pyash
exists su name helper be mind as name "verify loop" ya
ob text "Task." for name helper to name text output be write do
```

When `as name` points to a registered refinery, `be write for name <helper>` routes to refinery execution through normal signature dispatch.

---

## Discharge (module-specific)

Some mind backends expose a module-level discharge ceremony. For Ollama:

```pyash
from filename "./module/mind_ollama.pya" ob name discharge to name mind discharge be import do
ob text "qwen3.5:9b" be mind discharge do
```

This sends `keep_alive: 0` to Ollama to unload the model after a run.

For refinery teardown (provider-level), use:

```pyash
be discharge as wo refinery ob text "verify loop" do
```

This removes the refinery from the runtime registry and invalidates helper aliases bound to that provider.

The same module exposes `begin` and `restart` so you can warm or cycle the model:

```pyash
ob text "qwen3.5:9b" be mind begin do
ob text "qwen3.5:9b" be mind restart do
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
    "model": "qwen3.5:9b"
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
    "model": "qwen3.5:9b"
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
