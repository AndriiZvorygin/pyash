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
- serialize submitted jobs,
- execute real Ollama, ComfyUI, and KataGo jobs,
- expose job status and results over HTTP.

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
7. writes terminal handle status,
8. acks success/fail in the durable queue.

The worker currently talks to one configured housekeeper URL at a time. It does not choose among multiple remote hosts.

### 2.3 GPU Housekeeper

`container/gpu-housekeeper/service/server.py` exposes the remote HTTP surface:

- `GET /health`
- `GET /snapshot`
- `GET /queue`
- `GET /runtime`
- `GET /runtime/<runtimeName>`
- `POST /submit`
- `GET /job/<remoteJobId>`
- `POST /discharge`
- `POST /runtime/begin`
- `POST /runtime/stop`
- `POST /runtime/restart`

The housekeeper has an in-memory local queue and one active running job slot. This means one housekeeper process serializes execution even if the host has multiple GPUs.

The default managed runtimes are:

- `ollama`
- `comfyui`
- `katago`

Runtime configuration can be overridden with `GPU_HOUSEKEEPER_RUNTIME_REGISTRY`.

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

### 3.2 ComfyUI

ComfyUI jobs use:

- `comfyui-draw`
- `comfyui-say`
- `comfyui-hear`
- `comfyui-prompt`

The housekeeper submits a prompt to ComfyUI, polls history, and returns the prompt history result.

### 3.3 KataGo

KataGo jobs use:

- `katago-analyze`
- `katago-begin`
- `katago-discharge`
- `katago-restart`
- `katago-status`

KataGo analysis accepts an already-normalized query. Pyash helper code converts SGF points into KataGo board coordinates before enqueueing.

KataGo is currently deployed as a managed container on `mriczo`. The housekeeper runs it with `APPIMAGE_EXTRACT_AND_RUN=1` so the KataGo AppImage works without FUSE inside the container.

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

- one configured housekeeper URL per local worker,
- one active running job per housekeeper process,
- no automatic peer forwarding,
- no automatic host selection,
- no per-device runtime containers,
- no per-GPU `CUDA_VISIBLE_DEVICES` assignment per runtime,
- warm residency is tracked lightly as profile state, not as a full scheduling model.

The queue envelope already has useful fields for future routing, but the executor does not yet use them as a real load-balancing policy.

## 6. Residency-Aware Federation Direction

The desired next architecture is a federation of housekeepers.

Each GPU machine runs its own housekeeper. A housekeeper may know peers such as:

- `mriczo`
- `swac`
- future GPU hosts

On `/submit`, a housekeeper should decide whether to:

1. accept and run locally,
2. queue locally,
3. forward once to a better peer,
4. reject if no local or peer capacity is suitable.

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

The housekeeper should choose the highest scoring target above a minimum threshold. If no peer is better than local, local should keep ownership.

## 7. Operational Notes

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

