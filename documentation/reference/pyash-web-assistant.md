# Pyash Web Assistant

The Pyash web assistant is a private browser gateway over the existing Pyash runtime. It is an application surface, not a second model server or GPU scheduler.

The gateway provides:

- durable Pyash-backed chat sessions, with history selectable from the browser;
- an explicit model selector populated from the configured Ollama host;
- allowlisted web search, download, read, listing, and existence tools;
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

The deployment mounts only the Pyash `world` directory for durable sessions and queue state. It does not mount the host filesystem or expose arbitrary shell, JavaScript interpretation, write, compile, repair, or model-management tools to the browser.

## HTTP surface

- `GET /healthz` checks the gateway process.
- `GET /api/tools` lists the public read/search tool subset.
- `GET /api/models` lists the installed/allowed Ollama model tags.
- `GET /api/sessions` lists dated Pyash session records.
- `GET /api/sessions/<id>` reads one session's persisted conversation history.
- `POST /api/chat` accepts `{ "message": "...", "session": "...", "model": "..." }` and returns the answer, tool event names, and discovered source URLs.
- `GET /api/gpu` reports queue depth.
- `POST /api/jobs` accepts a validated prepared `comfyui-draw` or `comfyui-hear` job specification and returns a durable handle.
- `GET /api/jobs/<handle>` reads an existing Pyash GPU handle status.

The browser never receives the full agent tool map. Search results and downloaded evidence are accessed through the normal Pyash tool contract, and the assistant is instructed to distinguish retrieved evidence from synthesis.

Media jobs are intentionally narrow in this first release. Their `jobSpec` must use the existing ComfyUI queue contract, and fields resembling shell execution or arbitrary file operations are rejected. The GPU housekeeper remains the authority for capacity, model residency, and discharge.

## Configuration

Useful environment values are:

- `OLLAMA_HOST`: Ollama endpoint used by the configured Pyash mind backend;
- `PYA_WEB_MODEL`: optional model override for the web assistant;
- `PYA_WEB_MODELS`: optional comma-separated allowlist of Ollama tags exposed by the model selector; when absent, installed tags from `/api/tags` are offered;
- `PYA_WEB_HOST` and `PYA_WEB_PORT`: local listener settings;
- `PYA_GPU_HOUSEKEEPER_URL`: existing housekeeper configuration used by Pyash workers.

Authentication, TLS, and public exposure belong to Caddy. Rotate the existing Basic Auth credential through the host's normal Caddy configuration process rather than adding credentials to this repository.

Session history is stored in the existing dated `.pya` files under the web assistant's Pyash house. Selecting another session changes the `session name` supplied to the normal mind path; it does not create a browser-only transcript store. The selected model is passed as an explicit per-request model override and must be present in the discovered/allowed Ollama catalog.
