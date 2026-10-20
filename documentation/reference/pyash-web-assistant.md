# Pyash Web Assistant

The Pyash web assistant is a private browser gateway over the existing Pyash runtime. It is an application surface, not a second model server or GPU scheduler.

The gateway provides:

- durable Pyash-backed chat sessions, with history selectable from the browser;
- a model selector populated by the GPU Housekeeper's runtime model catalogs;
- a `duty` surface for durable coding conversations assigned to online host workers and configured repository directories;
- allowlisted web search, download, read, listing, and existence tools;
- a read-only `runtime status` tool that reports the effective model and turn settings to the assistant;
- status for the existing GPU queue;
- safe submission of prepared image and transcription jobs through the existing `gpu draw` and `gpu hear` queue paths.

Models remain external. Ollama is configured with `OLLAMA_HOST` (the deployment default is the remote Ollama service), and GPU jobs are handled by the existing queue, workers, leases, residency, discharge, and housekeeper machinery.

## Local development

Run the gateway from the repository root:

```sh
node command/pyash_web_server.mjs --root . --host 127.0.0.1 --port 8787
```

Open `http://127.0.0.1:8787/`. The chat endpoint is serialized because the Pyash interpreter and remembered runtime facts are process state. This does not serialize the GPU queue itself; queued media work remains durable and is handled by the normal workers.

## Deployment

The Caddy host builds `Dockerfile.web` directly from `/home/htaf/pyash`. The service binds only to loopback and Caddy publishes `https://pyash.zvorygin.ca` with the host's existing Basic Auth boundary. The DNS updater includes the hostname in its public web records.

```sh
cd /home/htaf/hven/caddy
docker compose up -d --build pyash-web
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose restart caddy
```

The deployment mounts only the Pyash `world` directory for durable sessions, queue state, duty records, and the web assistant workspace at `world/house/web-assistant/workspace`. It does not mount worker checkouts into the web container. Ordinary Assistant chat exposes only the existing read/search tool subset. Duty turns run in a separate host worker, and only in a directory explicitly configured on that worker; the existing `saddle_tools.pya` command and file policy still applies. See [Pyash Coding Saddle](pyash-coding-saddle.md) for worker and allowlist setup.

## HTTP surface

- `GET /healthz` checks the gateway process.
- `GET /api/tools` lists the public read/search tool subset.
- `GET /api/models` lists installed/allowed Ollama tags and Strata model IDs reported by the GPU Housekeeper. Non-Ollama targets use an explicit `strata::model` value so the browser cannot accidentally route them through Ollama.
- `GET /api/sessions` lists dated Pyash session records.
- `GET /api/sessions/<id>` reads one session's persisted conversation history.
- `POST /api/chat` accepts `{ "message": "...", "session": "...", "model": "..." }` and returns the answer, tool event names, and discovered source URLs.
- `GET /api/duty-workers` and `GET /api/duties` list online workers and durable duties for the authenticated UI.
- `POST /api/duties` assigns a new duty to one worker and one advertised directory; `/api/duties/<id>` reads it, `/messages` queues another instruction, and `/accept` records operator acceptance when idle.
- `POST /api/duty-workers/{heartbeat,claim,result,failure}` is the HTTPS worker protocol, authenticated with a per-worker bearer token.
- `GET /api/gpu` reports queue depth.
- `POST /api/jobs` accepts a validated prepared `comfyui-draw` or `comfyui-hear` job specification and returns a durable handle.
- `GET /api/jobs/<handle>` reads an existing Pyash GPU handle status.

The browser never receives the full agent tool map. Search results and downloaded evidence are accessed through the normal Pyash tool contract, and the assistant is instructed to distinguish retrieved evidence from synthesis.

Media jobs are intentionally narrow in this first release. Their `jobSpec` must use the existing ComfyUI queue contract, and fields resembling shell execution or arbitrary file operations are rejected. The GPU housekeeper remains the authority for capacity, model residency, and discharge.

## Configuration

Useful environment values are:

- `OLLAMA_HOST`: provider endpoint carried as backend configuration; the web assistant does not call it directly;
- `PYA_WEB_MODEL`: optional model override for the web assistant;
- `PYA_WEB_MODELS`: optional comma-separated allowlist of Ollama tags exposed by the model selector; when absent, installed tags reported by the GPU Housekeeper's `/runtime/ollama/models` catalog are offered;
- `PYA_WEB_BACKEND`: optional default web backend (`ollama` or `strata`);
- `PYA_WEB_HOST` and `PYA_WEB_PORT`: local listener settings;
- `PYA_DUTY_WORKER_TOKENS`: semicolon-separated `worker-id=token` credentials accepted by the worker protocol; keep them in the deployment's secret environment;
- `PYA_GPU_HOUSEKEEPER_URL`: existing Housekeeper control-plane URL used for model catalogs, runtime availability, queued inference, capacity, residency, and discharge.

The GPU Housekeeper is the authority for model availability. It reads Ollama tags from Ollama and Strata model IDs from Strata, then exposes those catalogs to the web gateway through `/runtime/ollama/models` and `/runtime/strata/models`. The web application does not probe either model provider or maintain a second Strata model list. A reported Strata target can be queued while its model is unloaded; the Housekeeper owns loading and capacity decisions. The web deployment sets `PYA_GPU_MANAGER_REQUIRED=true`, so an unavailable manager fails closed rather than falling back to direct provider HTTP. Authentication, TLS, and public exposure belong to Caddy. Rotate the existing Basic Auth credential through the host's normal Caddy configuration process rather than adding credentials to this repository.

Session history is stored in the existing dated `.pya` files under the web assistant's Pyash house. Selecting another session changes the `session name` supplied to the normal mind path; it does not create a browser-only transcript store. The selected model is passed as an explicit per-request model override and must be present in the discovered/allowed Ollama catalog.

The persistent working sandbox is `world/house/web-assistant/workspace` (inside the container, `/app/world/house/web-assistant/workspace`). It is the intended location for search downloads, input files, and generated intermediate artifacts. The web image intentionally does not include the full development checkout, so paths such as `caterer` are not assumed to exist there.

## Runtime status

The agent tool map includes this Pyash-native capability:

```pya
su name runtime status be status as wo runtime can
```

When called, it returns the effective model tag, backend, runtime host label, thinking mode, sampling settings, output limit, tool map, and agent name for the current turn. For Ollama, it also reads the selected model's `/api/show` metadata and reports model defaults, advertised context length, parameter size, quantization, and capabilities. A request override is distinguished from an Ollama model default; an output limit is reported as `provider default` when no `num_predict` override is configured. It is read-only and does not expose credentials, raw memory, or arbitrary host paths.
