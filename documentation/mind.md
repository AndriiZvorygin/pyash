# mind.md — Pyash Mind Integration

This document defines how a **mind** (an LLM endpoint) is configured, how Pyash calls it, how replies are represented, and how conversational context flows across supported backends.

## Concepts

- A **mind** is an LLM endpoint plus configuration.
- Configure once with `be mind ya` (host/model/system prompt).
- Invoke with `be write ... for name <mind> to name <output> do`.
- The selected backend module calls its provider adapter.
- The compiler (JS) emits a call into a small JS HTTP helper instead of shelling out to `curl`.

The default backend remains Ollama. Optional OpenAI-compatible backends use the same conversation and tool-call payloads through the OpenAI Chat Completions API.

## Optional MiniMax Mind

MiniMax is selectable per mind and does not change Pyash's Ollama default. Put a MiniMax API or M Plan key in the ignored `configure/secret.pya` file (mode `600`):

```pya
exists su name minimax api key ob text "<MiniMax API key>" be default ya
```

`configure/default.pya` provides the named `minimax` mind using `https://api.minimax.io/v1` and `MiniMax-M3.1-Flash`. The shared Chat Completions adapter calls `/v1/chat/completions`; streaming, tools, and image inputs use Pyash's existing OpenAI-compatible request shape. The model picker queries `/v1/models` with the same key. The key can instead be supplied through `MINIMAX_API_KEY`.

The equivalent Pyash mind declaration is:

```pya
exists su name minimax be mind
  from state "minimax"
  from space "https://api.minimax.io/v1"
  via state "MiniMax-M3.1-Flash"
ya
```

Select it in the coding saddle with `/mind minimax`; use `/model` to choose from the account's model catalog. MiniMax M3.1 Flash always uses reasoning; `/think low|medium|high|xhigh|max` selects its reasoning effort rather than disabling thinking. `pyash configure mind --backend minimax` also offers those levels and saves the chosen setting.

MiniMax setup references: [Chat Completions API](https://platform.minimax.io/docs/api-reference/text-chat-openai), [OpenAI-compatible Text API](https://platform.minimax.io/docs/api-reference/text-openai-api), and [List Models](https://platform.minimax.io/docs/api-reference/models/openai/list-models).

## Z.AI GLM Coding Plan

Pyash exposes `zai` as an optional coding mind using Z.AI's documented Codex CLI integration. Store credentials as local Pyash facts in the ignored `configure/secret.pya`, with file mode `600`:

```pya
exists su name zai api key ob text "<standard Z.AI API key>" be default ya
exists su name zai coding api key ob text "<GLM Coding Plan key>" be default ya
```

The standard API key is used for Chat Completions when a mind targets `api.z.ai`. The distinct Coding Plan key is used only by the Codex CLI Responses profile; it does not fall back to the standard API key.

On this host, the regular Codex CLI also has a separate `zai` profile. Start it with `codex --profile zai`; plain `codex` keeps using the existing OpenAI default. Its auth command reads the Coding Plan key from `configure/secret.pya`, so the credential is not duplicated in `~/.codex`. In the Pyash coding saddle, `/mind` lists configured Pyash minds and `/mind zai` or `/mind openai` selects one. `/model` then changes the model within that selected mind; the configured Z.AI and OpenAI mind facts are in `configure/default.pya`.

The runner launches the installed Codex CLI with an ephemeral, isolated `CODEX_HOME` configured for the OpenAI Responses protocol at `https://api.z.ai/api/v1`, model `glm-5.3-flash`, and the supplied Coding Plan key. The temporary profile is permission-restricted and deleted after each request; your existing `~/.codex` configuration is not changed. The coding saddle keeps its configured default mind unless you select another one with `/mind`. Z.AI's Coding Plan is limited to officially supported tools; this route uses Codex CLI rather than Pyash's direct Chat Completions client.

To add a named Z.AI mind relay without changing the global default:

```sh
node command/pyash.mjs configure mind --non-interactive --relay zai-coder --backend zai --host https://api.z.ai/api/v1 --model glm-5.3-flash --set-default lie --test-now lie
```

Select Z.AI for the coding saddle without changing Pyash's global default:

```sh
PYA_SADDLE_MIND=zai node command/pyash_saddle.mjs
```

This selects the Pyash mind named `zai`, whose default model is `glm-5.3-flash` and endpoint is `https://api.z.ai/api/v1`. Override the starting mind with `/mind` or `PYA_SADDLE_MIND`; `/model` queries the authenticated Coding Plan model catalog and offers the models returned for your account. Other minds continue using their existing configuration. After a successful refresh, Pyash also updates the local Codex `zai` profile catalog (`model_catalog_json`) from the same model IDs, so the regular Codex model selector stays in sync. Codex reads that local catalog rather than querying Z.AI itself; opening Pyash's `/model` picker refreshes it. If discovery is unavailable, the saddle keeps the configured model available and reports the lookup failure. Z.AI describes GLM-5.3-Flash as multimodal, but the current Codex profile declares text input only; Pyash tools remain available through the Codex MCP bridge.

Use `/context` in the Pyash saddle to choose a context for the active backend. Z.AI selections set the client-side context budget and save `model_context_window` for future Codex sessions. Ollama selections send request-level `num_ctx` for the current saddle session. Strata choices come from the GPU Housekeeper; selecting one updates the configured `--max-context` and restarts Strata under the Housekeeper's exclusive GPU gate. The Strata model remains unloaded after restart and loads lazily on its next request. `/context 64K` selects a size directly; `/context default` restores Strata's configured default when that size is available. A busy GPU or in-flight direct Strata request makes the change fail visibly without restarting the server.

The Codex route preserves the CLI's `turn.completed` token accounting. The
saddle prints that total after each reply and appends a durable usage map to the
coding-saddle usage newspaper. `/usage` aggregates those records by mind and
model; it is Pyash-local accounting and does not alter Codex's own `/usage`.

Durable `be gpu mind` jobs include a Housekeeper `resourceRequest.vramRequiredMb` by default (12,000 MiB). Set `PYA_OLLAMA_VRAM_REQUIRED_MB` or `PYA_GPU_VRAM_REQUIRED_MB` to adjust the default, or provide `resourceRequest.vramRequiredMb` in the job map. This declaration lets the Housekeeper safely reclaim idle managed runtimes before loading the requested model.

## Optional Local Strata Backend

Pyash can use Strata as a selectable local backend without changing the default Ollama profile. Configure it with the backend key `strata`; its default host is `http://127.0.0.1:8081` and its OpenAI-compatible model alias is `strata`.

```sh
node command/pyash.mjs configure mind --backend strata --host http://127.0.0.1:8081 --model strata
```

Pyash sends requests to `http://127.0.0.1:8081/v1/chat/completions`. The Strata runner uses a local placeholder bearer token by default so it never falls through to Codex OAuth; if Strata API-key auth is enabled, provide that key through `STRATA_API_KEY` outside the repository.

In the coding saddle, `/think none|low|medium|high` controls Strata's
per-request reasoning effort; `off` and `on` are aliases for `none` and
`high`. `/context` reads the supported Strata sizes from Housekeeper. Choosing
one updates only `--max-context` in the configured Strata launch profile, then
restarts the lazy server while holding the GPU gate. The model stays unloaded
until the next request. For Ollama, `/context` selects a request-level
`num_ctx` preset (4K through 64K), and `/think on|off` sends Ollama's boolean
thinking option. These saddle overrides apply for the current interactive
session only; no selection keeps the existing provider/model defaults.

### GPU manager handoff

Strata must be installed outside this repository. Keep its API process available but start it **lazy and loopback-only**; the Housekeeper loads the model only after admitting a Strata job, and unloads it for another managed runtime when needed. A host `systemd --user` service can supervise this lightweight, unloaded API process:

```sh
STRATA_ROOT="$HOME/Strata"
jq 'del(.before_load, .before_load_timeout_s, .before_load_strict) | .open_browser = false' \
  "$STRATA_ROOT/strata-iq2_xs.json" > "$STRATA_ROOT/strata-iq2_xs-housekeeper.json"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/strata-iq2-xs.service" <<'EOF'
[Unit]
Description=Strata API for GPU Housekeeper-managed inference
After=default.target

[Service]
Type=simple
WorkingDirectory=%h/Strata
ExecStart=%h/Strata/.venv/bin/python %h/Strata/serve/server.py --engine strata --config %h/Strata/strata-iq2_xs-housekeeper.json --port 8081 --lazy
Restart=on-failure
RestartSec=5
TimeoutStopSec=90

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now strata-iq2-xs.service
sudo loginctl enable-linger "$USER"
```

Do not configure Strata's `before_load` hook to call `/capacity/prepare` in this managed path. The Housekeeper already holds the GPU execution gate while it loads a Strata chat job, so a second admission request from the hook is correctly refused as busy. The Housekeeper admits capacity before calling `/v1/load`; Strata's `min_free_vram_mib` remains a final provider-side floor check:

```json
{
  "host": "127.0.0.1",
  "port": 8081,
  "min_free_vram_mib": 20000
}
```

Register the same loopback API with the Housekeeper in `container/gpu-housekeeper/service/.env`, then recreate only the Housekeeper container so the setting takes effect:

```dotenv
GPU_HOUSEKEEPER_STRATA_RUNTIME_URL=http://127.0.0.1:8081
GPU_HOUSEKEEPER_STRATA_CONTEXT_CONFIG_PATH=/path/to/Strata/strata-iq2_xs-housekeeper.json
GPU_HOUSEKEEPER_STRATA_CONTEXT_SYSTEMD_UNIT=strata-iq2-xs.service
GPU_HOUSEKEEPER_STRATA_CONTEXT_AGENT_SOCKET=/run/user/1000/pyash-strata-context-agent.sock
GPU_HOUSEKEEPER_STRATA_CONTEXT_OPTIONS=8192,16384,32768,65536
GPU_HOUSEKEEPER_STRATA_DEFAULT_CONTEXT_LENGTH=32768
GPU_HOUSEKEEPER_STRATA_DEVICE_ID=gpu0
```

Install the host-side user service once, then recreate the Housekeeper:

```sh
container/gpu-housekeeper/command/install-strata-context-agent.sh
cd container/gpu-housekeeper/service
docker compose -p gpu-housekeeper --env-file .env -f compose.gpu.yaml up -d --build --force-recreate gpu-housekeeper
```

The agent accepts requests only over its owner-only Unix socket. Housekeeper
holds the GPU execution gate, checks Strata has no in-flight work, and sends
the allowlisted context change through a short-lived helper container. The host
agent updates only `--max-context`, restarts the configured user unit, and
verifies the reported limit; rollback restores the previous profile if restart
or verification fails. Leave the context-control settings unset to disable
this operation. `GET /runtime/strata/context` reports the active size and
allowlist; `POST /runtime/strata/context` accepts only an allowlisted
`contextLength`. Requests fail as busy if the GPU gate or Strata API is active.

The manager then loads Strata for queued Strata jobs and checks its status before admitting another managed GPU runtime. It unloads Strata only after its status API confirms zero in-flight requests and the configured 300-second idle grace has elapsed; it verifies `loaded:false` and rechecks actual free VRAM before admitting the next runtime. The Housekeeper uses a short-lived host-network helper container to reach Strata's loopback API, so Strata itself remains bound to `127.0.0.1`. If Strata API-key authentication is enabled, put the same key in the Housekeeper environment as `STRATA_API_KEY`; never commit it.

Non-streaming Strata mind calls are submitted as `strata-chat` jobs through the
Pyash GPU Housekeeper. The Housekeeper owns the device gate, capacity check,
safe discharge of idle managed runtimes, Strata load/reload, and the provider
request. The caller receives the completed response after the queued job
finishes. This keeps web chat and ordinary mind calls on the same GPU control
plane instead of letting a caller race a resident model directly.
For a local Strata endpoint, the mind runner infers the co-located Housekeeper
at `http://localhost:18886`; remote GPU hosts should set
`PYA_GPU_HOUSEKEEPER_URL` explicitly.

The Housekeeper's Strata activity probe uses Strata's own in-flight and
last-request status, and refuses to discharge it when those fields are absent
or invalid. Streaming compatibility remains available for the legacy direct
runner path; the web assistant uses the non-streaming queued path.

Keep Strata bound to loopback. The Housekeeper endpoint is on the host-local `http://127.0.0.1:18886`; do not point the Strata hook at a remote or federated manager.

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

**Status:** implemented for interpreter (prompts include last N turns) and compiled JS (per-mind history map). Window and compact snapshot policy are configurable in the canonical Pyash `session configure` map (`history window`, default 8 turns; `snapshot enabled`, default truth).

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

When implemented, this `historyMessages[]` array feeds directly into `messages[]` for Ollama. Agent-house session files use a typed append-only user/agent/checkpoint ledger; pending tails are retained for audit but excluded from this array. If a turn has an explicit accepted generator/verifier checkpoint, the projected context is the original duty plus the latest accepted generator and verifier evidence. Ordinary completed replies are not semantic acceptance.

Recorded runs persist the compact projection as an immutable hash-addressed Pyash
snapshot through the artifact recorder. The run newspaper links the snapshot with
a typed checkpoint sentence, and `command/replay_newspaper.mjs` verifies its
content hash.

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
