# Rust PyAC VLIW Runtime

This service owns the Rust/WGPU Vulkan interpreter process and its shader. The
Python GPU Housekeeper remains the scheduler: it performs normal GPU admission,
starts this container on demand, submits canonical `pyac-pack-execute` packs,
and stops the service after its idle grace. VLIW runtime updates do not rebuild
or restart Housekeeper.

The internal HTTP contract is protocol version 1:

- `GET /health` returns `ready`, `protocolVersion`, and available worker slots.
- `POST /v1/execute` accepts `{protocolVersion, jobId, jobSpec}` where
  `jobSpec.kind` is `pyac-pack-execute` and `jobSpec.payload.packBase64` is the
  canonical PyAC pack.
- The response is the existing Rust worker result (`ok`, `backend`, `device`,
  and typed `values`). Raw shaders, arbitrary source code, and arbitrary
  commands are not accepted.

The service binds inside Docker only. It publishes no host port and joins the
Housekeeper's private Docker network. The Housekeeper's API remains the only
job admission path. GPU access is granted to this container, while per-device
execution admission remains in Housekeeper.

## Install or update on an NVIDIA Housekeeper host

The first rollout has two steps so Housekeeper never points at a missing
container:

1. From the repository root, run
   `container/pyac-vliw-runtime/command/deploy.sh`. It builds the separate
   image and creates the
   stopped runtime container if absent. If Housekeeper does not advertise
   `pyacVliwRuntimeProtocol: 1` in `/snapshot`, the script stops there without
   changing the running service.
2. Deploy the updated Housekeeper image once in a planned maintenance window.
   Rerun `container/pyac-vliw-runtime/command/deploy.sh` after the snapshot
   advertises protocol v1.

On later code or shader updates, rerunning
`container/pyac-vliw-runtime/command/deploy.sh` builds the
runtime image first, asks Housekeeper to hold new VLIW duties and drain active
VLIW jobs, recreates only `pyac-vliw-runtime`, waits for API readiness, and
resumes queued VLIW work. Ollama, ComfyUI, Strata, and the Housekeeper process
are not restarted. If the runtime update fails after the drain, the helper
restores and health-checks the prior image when one exists, then resumes queued
VLIW work. If no prior image exists or rollback cannot be verified, dispatch
remains held for operator recovery instead of silently resuming against an
unhealthy runtime.

Useful checks:

```sh
curl -fsS http://127.0.0.1:18886/runtime/vliw
curl -fsS http://127.0.0.1:18886/queue
docker inspect pyac-vliw-runtime --format '{{.State.Status}}'
```

The host must already have the `gpu-housekeeper_default` Docker network, the
NVIDIA Container Toolkit, Vulkan loader support, and the host NVIDIA Vulkan
ICD JSON at `/usr/share/vulkan/icd.d/nvidia_icd.json` (or set
`NVIDIA_VULKAN_ICD_PATH`). The HTTP API is unauthenticated and must remain on
this trusted internal network; do not publish port `18887` to the host or
internet.

The runtime stage uses Ubuntu 24.04's Vulkan loader. The older Ubuntu 22.04
loader could not initialize the host's NVIDIA Vulkan ICD on Mriczo, even
though CUDA devices and the ICD libraries were visible inside the container.
