# GPU Housekeeper Architecture (Reference)

Purpose: describe the current Pyash GPU duty queue and `gpu-housekeeper` runtime architecture, plus the intended direction for residency-aware multi-host routing. This document is reference guidance, not a frozen protocol spec.

## 1. Current Shape

Pyash separates GPU work into two layers:

1. local durable queue and handle tracking in the Pyash world,
2. remote GPU runtime management in `gpu-housekeeper`.

The local Pyash process does not run GPU-heavy jobs directly. It enqueues a GPU duty envelope, waits on a durable handle, and lets `command/gpu_worker.mjs` submit the work to a configured housekeeper.

The housekeeper owns host-local GPU runtime control:

- inspect runtime containers,
- start/restart/discharge managed runtimes,
- serialize active execution,
- execute real Ollama, ComfyUI, and KataGo jobs,
- expose job status and results over HTTP.

It should not duplicate the durable queue. The Pyash holding spool is the
system of record for queued duties and final handles; housekeeper job state is
only a transient execution projection used by the worker while a submitted job
is running or has just completed.

## 2. Main Components

### 2.1 Pyash GPU Duty Queue

GPU duties live under the normal world holding layout, using `world/holding/gpu/`.

The public Pyash surface includes:

- `vyah start` to enqueue work and return a handle,
- `vyah status` to read handle state,
- `vyah await` to wait for terminal success/fail.

GPU envelopes carry routing and residency fields, including:

- `gpuId`,
- `hostId`,
- `deviceId`,
- `serviceName`,
- `residencyName`,
- `residencyRequired`,
- `beginRequired`,
- `dischargeAllowed`,
- `jobSpec`.

In the current implementation, `serviceName` maps to the housekeeper runtime, such as `ollama`, `comfyui`, or `katago`. `residencyName` is the profile/model/workflow that should stay warm when possible.

### 2.2 Local GPU Worker

`command/gpu_worker.mjs` is the bridge from durable local queue state to a remote housekeeper.

It:

1. loads Pyash config,
2. resolves `PYA_GPU_HOUSEKEEPER_URL` or `gpu housekeeper url`,
3. claims the oldest eligible GPU envelope,
4. acquires a local GPU lease keyed by `gpuId`,
5. submits the job to the housekeeper,
6. polls `/job/<remoteJobId>`,
7. writes terminal handle status back to Pyash holding,
8. acks success/fail in the durable queue.

The worker currently talks to one configured housekeeper URL at a time. It does not choose among multiple remote hosts.

### 2.3 GPU Housekeeper

`container/gpu-housekeeper/service/server.py` exposes the remote HTTP surface:

- `GET /health`
- `GET /snapshot`
- `GET /queue`
- `GET /runtime`
- `GET /runtime/<runtimeName>`
- `POST /capacity/preview`
- `POST /submit`
- `GET /job/<remoteJobId>`
- `POST /discharge`
- `POST /runtime/begin`
- `POST /runtime/stop`
- `POST /runtime/restart`

The housekeeper has one active execution slot. It does not own a durable job
queue; `world/holding/gpu/` owns that. `/submit` registers an execution record,
runs it under the housekeeper execution lock, and `/job/<remoteJobId>` exposes
that transient status so `gpu_worker` can copy the final result back into the
Pyash handle.

The default managed runtimes are:

- `ollama`
- `comfyui`
- `katago`
- `huggingface` (the Criterion sequence-to-sequence service)

Runtime configuration can be overridden with `GPU_HOUSEKEEPER_RUNTIME_REGISTRY`.

The runtime registry is also the safety boundary for automatic memory
reclamation. A runtime being present in the registry means that the
housekeeper is allowed to inspect and manage its configured container; it does
not mean that the housekeeper may terminate arbitrary host processes. Automatic
reclamation requires both a runtime-specific `activityProbe` and a supported
`dischargeKind`. The default ComfyUI entry uses the empty-queue probe and the
provider's `/interrupt`, queue-clear, and `/free` hooks. Unknown processes and
managed runtimes without a safe hook remain untouched.

## 3. Runtime Behavior

### 3.1 Ollama

Ollama jobs use:

- `ollama-generate`
- `ollama-chat`

Before execution, the housekeeper:

1. checks the `ollama` container status,
2. starts it if stopped,
3. restarts it if GPU is expected but not observed,
4. checks warm models via `/api/ps`,
5. discharges non-target warm models with `keep_alive: 0`,
6. runs the requested model with default `keep_alive: 300`.

This is the first real GPU-managed mind path for non-streaming Pyash Ollama calls.

### 3.2 Hugging Face Criterion

Criterion's fine-tuned sequence-to-sequence lane uses the same durable GPU duty
queue and housekeeper lock. `huggingface-generate` jobs are sent to the
`criterion-huggingface` container, which keeps one requested Transformers model
warm and exposes a small `/generate` endpoint. Criterion remains responsible
for sample checkpoints, scoring and reports; the container only performs model
inference. Lead-3 is deterministic CPU work and does not use this runtime.

### 3.3 ComfyUI

ComfyUI jobs use:

- `comfyui-draw`
- `comfyui-say`
- `comfyui-hear`
- `comfyui-prompt`

The housekeeper submits a prompt to ComfyUI, polls history, and returns the prompt history result.

### 3.4 KataGo

KataGo jobs use:

- `katago-analyze`
- `katago-begin`
- `katago-discharge`
- `katago-restart`
- `katago-status`

KataGo analysis accepts an already-normalized query. Pyash helper code converts SGF points into KataGo board coordinates before enqueueing.

KataGo is currently deployed as a managed container on `mriczo`. The housekeeper runs it with `APPIMAGE_EXTRACT_AND_RUN=1` so the KataGo AppImage works without FUSE inside the container.

### 3.5 Demand-driven residency reclamation

Jobs may declare an optional memory request in their `jobSpec`:

```json
{
  "kind": "ollama-generate",
  "resourceRequest": {
    "vramRequiredMb": 22000,
    "deviceId": "gpu0"
  },
  "payload": {
    "model": "qwen3.5:9b",
    "prompt": "..."
  }
}
```

`gpu-housekeeper` compares that request with live `nvidia-smi` memory data. A
request that already fits is admitted without a provider probe. If it does not
fit, the housekeeper considers only managed runtimes with an explicit safe
discharge hook and a provider-specific idle result. The default idle grace is
300 seconds and can be set with `GPU_HOUSEKEEPER_IDLE_GRACE_SEC`. ComfyUI is
discharged without stopping its container, using its existing API hooks. The
housekeeper rechecks memory after each successful discharge and fails closed if
the request still does not fit. Its dry-run response also includes candidate
diagnostics when a managed runtime is active, still inside idle grace,
unavailable, or lacks a safe hook, so an operator can distinguish "not yet
reclaimable" from "not managed" without starting a job.

The caller's `dischargeAllowed` envelope field is honored. Setting it to false
prevents reclamation even when a safe idle runtime is available. Jobs without a
VRAM request preserve the existing behavior and do not cause implicit
reclamation. `/capacity/preview` accepts the same runtime/profile/jobSpec shape
and reports the decision, available memory, eligible idle candidates, and skipped
candidate diagnostics without performing a discharge or starting a job.

All reporter text-generation callers resolve the model through
`program/runtime/gpu/text-model.mjs`. The resolver reads the house's
`conduct/runtime.pya` first and falls back to `configure/default.pya`; callers
do not carry separate model literals. Image/vision requests use the separate
`see default mind` setting from the same declarative configuration.

The snapshot also includes GPU compute-process telemetry split into managed
runtime processes and unmanaged processes. This is diagnostic evidence only;
unmanaged processes are never discharged by the housekeeper.

## 4. Configuration

Local Pyash can point at a remote housekeeper using either:

```sh
PYA_GPU_HOUSEKEEPER_URL=http://mriczo:8090
```

or a local, git-ignored Pyash config sentence in `configure/secret.pya`:

```pya
exists su name gpu housekeeper url ob text "http://mriczo:8090" be default ya
```

Do not commit host-local URLs or secrets unless they are portable defaults.

The current known-good remote deployment is `mriczo`, where:

- `gpu-housekeeper` is reachable on port `8090`,
- `/health` returns `ok`,
- `/runtime` reports `ollama`, `comfyui`, and `katago`,
- `/queue` is empty when idle.

## 5. Current Limitations

The current architecture is intentionally conservative.

Limitations:

- one configured entry housekeeper URL per local worker,
- one active running job per housekeeper process,
- no per-device runtime containers,
- no per-GPU `CUDA_VISIBLE_DEVICES` assignment per runtime,
- warm residency is tracked lightly as profile state, not as a full scheduling model.

The entry housekeeper now performs bounded, residency-aware peer routing when
`GPU_HOUSEKEEPER_PEERS` is configured. Pyash still has one durable queue and
one entry URL; the housekeeper may execute locally or forward one hop to a
configured peer. The queue envelope remains the source of truth and does not
become a second distributed queue.

## 6. Residency-Aware Federation

Each GPU machine runs its own housekeeper. A housekeeper may know peers such as:

- `mriczo`
- `swac`
- future GPU hosts

When a local worker claims a Pyash holding duty and submits it, the entry
housekeeper decides whether to:

1. accept and run locally,
2. forward once to a better peer,
3. retain local queue behavior if no peer can execute immediately,
4. reject if neither local nor peer capacity is suitable.

The key scheduling goal is not even load distribution. The key scheduling goal is minimizing residency thrash.

Prefer the host/GPU where the requested runtime and profile are already warm. Avoid unloading useful warm services just to chase short-term utilization.

### 6.1 Forwarding Rule

Forwarding should be at most one hop in v1.

A forwarded request should include a guard such as:

- `forwardDepth`,
- `visitedHosts`,
- or an equivalent no-loop marker.

A peer that receives a forwarded job should either accept it locally or reject it. It should not forward again in v1.

The original housekeeper remains responsible to the caller. If it forwards a job, it should store:

- local job id,
- peer URL/host id,
- peer job id,
- forwarded/running state,
- final reflected result/error.

`GET /job/<id>` on the original housekeeper should transparently reflect the peer job status.

This forwarding state should remain a transient projection. The durable duty
and terminal outcome still belong in Pyash holding, written by `gpu_worker`.
If a future housekeeper directly claims remote Pyash duties, it should use the
same holding spool layout instead of introducing a new persistent queue format.

### 6.2 Suggested Snapshot Fields

Federation needs richer `/snapshot` data.

Useful fields:

- `hostId`,
- `queueDepth`,
- running job count,
- GPU memory totals/free/used,
- runtime statuses,
- warm profiles by runtime,
- known profile residency sizes when available,
- whether the housekeeper accepts forwarded jobs,
- optional soft capacity hints.

### 6.3 Suggested Routing Score

A simple first routing score could be:

```text
+100 exact runtime/profile already warm
+40 runtime container already running
+20 enough free VRAM without eviction
-60 would evict another warm profile
-30 per queued/running job
-20 health degraded
```

The housekeeper chooses the highest-scoring immediately executable target. A
busy local execution slot is skipped when a capable peer is available, so two
hosts can run independent jobs at the same time. If no peer can execute
immediately, the local housekeeper retains the existing queued-job behavior.
Equal scores prefer the local host.

## 7. Configuration and operational notes

Peer configuration is host-local deployment configuration, not durable Pyash
state. The value is a semicolon-separated allowlist of normalized host IDs and
URLs:

```sh
GPU_HOUSEKEEPER_HOST_ID=mriczo
GPU_HOUSEKEEPER_PEERS='swac=http://swac:8090'
GPU_HOUSEKEEPER_ACCEPT_FORWARDED=true
```

The first live pair is configured symmetrically:

```sh
# mriczo
GPU_HOUSEKEEPER_PEERS='swac=http://swac:8090'

# swac
GPU_HOUSEKEEPER_PEERS='mriczo=http://mriczo:8090'
```

Forwarded requests carry `forwardDepth` and `visitedHosts`. A peer executes a
forwarded request locally or rejects it; it never forwards again. Forwarded
job status is reflected through the original `/job/<id>` endpoint, and a peer
failure never triggers an unsafe duplicate submission.

Useful live checks:

```sh
curl -sS http://mriczo:8090/health
curl -sS http://mriczo:8090/runtime
curl -sS http://mriczo:8090/queue
curl -sS http://mriczo:8090/snapshot
```

Start a local worker against configured housekeeper:

```sh
node command/gpu_worker.mjs --world world
```

Start with explicit environment:

```sh
PYA_GPU_HOUSEKEEPER_URL=http://mriczo:8090 node command/gpu_worker.mjs --world world
```

KataGo lifecycle examples:

```pya
as wo katago be begin do
as wo katago be discharge do
as wo katago be restart do
```

Direct queued KataGo analysis can use `command/katago_runner.mjs`; Pyash mind-style usage can use `katago command mind`.

## 8. Design Preference

The housekeeper should be the federation boundary.

Pyash and `gpu_worker` should not need to know whether a job ran locally on the selected housekeeper or was forwarded to another host. That keeps the durable queue and handle contract stable while allowing housekeepers to grow smarter about residency, capacity, and peer routing.
