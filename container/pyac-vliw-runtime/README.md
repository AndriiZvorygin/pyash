# Rust PyAC VLIW Runtime

This service owns the Rust/WGPU Vulkan interpreter process and its shader. The
Python GPU Housekeeper remains the scheduler: it performs normal GPU admission,
starts this container on demand, submits canonical `pyac-pack-execute` packs,
and stops the service after its idle grace. VLIW runtime updates do not rebuild
or restart Housekeeper.

## CUDA validation and deployment

The CUDA image runs the same Rust semantics core, including typed dispatch,
from an offline-assembled `sm_86` cubin. The standard image still defaults to
Vulkan; Mriczo's Housekeeper-managed VLIW runtime is now persistently using the
validated CUDA image. SWAC's VLIW route remains held pending a verified
rollback target there. Housekeeper uses the same `pyac-pack-execute` protocol
for both backends. The CUDA image includes only the runtime, cubin, and build
metadata: there is no PTX, compiler, or fallback to Vulkan or CPU.

PyAC v1 codelet inputs stay 16-bit through CPU and CUDA execution. The shared
semantics core reads either `u16` or `u32` sources and widens one word only when
accessing its semantic value; dispatch directories and result records remain
`u32`. CUDA validates a borrowed pack view and uploads the original codelet
payload bytes directly, without a pack-sized `u32` expansion. The WebGPU/WGSL
path converts at its own `u32` storage-buffer boundary and keeps the same pack
format and runtime behavior.

Build on Mriczo, not SWAC. The pinned nightly must have `rust-src`,
`llvm-tools`, and `llvm-bitcode-linker`; `ptxas` 12.8 and Docker are used on
the build host. Then run:

```sh
bash rust/pyac-gpu/build-cuda-image.sh
bash container/pyac-vliw-runtime/command/cuda-canary.sh swac <CUDA_IMAGE>
# RTX 3090 full-suite verification; restores the original runtime afterward:
bash container/pyac-vliw-runtime/command/cuda-canary.sh mriczo <CUDA_IMAGE>
# After verification, persist CUDA on Mriczo and retain Vulkan for rollback:
bash container/pyac-vliw-runtime/command/cuda-canary.sh mriczo <CUDA_IMAGE> deploy
# Restore the retained Vulkan container if needed:
bash container/pyac-vliw-runtime/command/cuda-canary.sh mriczo <CUDA_IMAGE> rollback
```

The build prints the image tag and evidence directory. This controlled
deployment test requires a prior Vulkan container and saved cache on the
destination. It changes only the VLIW route, caps the temporary CUDA container
at 1 GiB of host memory, validates readiness within 60 seconds, and submits
host-pinned jobs with discharge disabled. It runs the **full configured VLIW
conformance matrix**, including typed dispatch and expected errors; “canary”
describes the temporary deployment/rollback, not a reduced test subset. The
default `verify` mode restores the prior container and verifies readiness. The
`deploy` mode keeps CUDA selected only after the full suite passes and retains
the previous Vulkan container as a stopped rollback target. `rollback` restores
that retained container and verifies readiness. If a transition fails,
Housekeeper keeps only VLIW held for recovery. Do not compile a cache during
startup or reuse an artifact from a different GPU architecture.

CUDA cubin is the validated route for current full-signature dispatcher work.
The prior Vulkan source/cache checkpoint is `fc77719f6`; canonical typed
signature dispatch was added in `a72c6bcf2`. Vulkan remains a legacy route for
already-built artifacts until a post-dispatch Vulkan artifact passes the same
conformance matrix. The latest RTX 3090 CUDA result and exact artifact hashes
are in `documentation/reference/rust-vliw-verification-ledger.md`. Use `deploy`
to persist the verified backend; the default verification mode restores the
previous runtime.

The internal HTTP contract is protocol version 1. The framed pack's uint32
`total_bytes` field is the wire-format ceiling; the former 16 MiB software cap
has been removed. Practical host/GPU memory or storage-binding limits can
still reject a particular allocation with an explicit error.

- `GET /health` returns `ready`, `protocolVersion`, and available worker slots.
- `POST /v1/execute` accepts `{protocolVersion, jobId, jobSpec}` where
  `jobSpec.kind` is `pyac-pack-execute` and `jobSpec.payload.packBase64` is the
  canonical PyAC pack. Housekeeper uses the raw pack endpoint to avoid base64
  expansion. Immutable storage descriptors and payload bytes are bound as
  separate read-only GPU inputs; named rank-one float32/float64 storage vectors
  participate in dot products beyond the inline lane limit. Independent
  `myocpfun` sections are dispatched as
  separate workgroups.
- The response includes `ok`, `backend`, `device`, and typed `values`. For a
  sectioned pack it also includes named `sections` and `completionOrder`; those
  are in actual completion order, and each record retains its source
  `sectionIndex` and HNUC name. Raw shaders, arbitrary source code, and
  arbitrary commands are not accepted.

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
VLIW jobs, compiles all three Vulkan pipelines into a persistent, GPU-specific
artifact file, and only then recreates `pyac-vliw-runtime`. The artifact is
stored at `~/.local/share/pyash/pyac-vliw/pyac_vliw_pipeline_cache.bin` and
mounted read-only by the service. This file is the GPU driver's compiled
pipeline data; the `.spv` file in the image is an input to that compilation,
not the final GPU artifact. The service requires the saved artifact and will
fail startup if it is missing or rejected. It must not silently create an
empty cache or fall back to compilation. The new service must become ready
within 60 seconds. There is no longer a long startup wait or timeout override.

The deploy helper retains the latest pipeline compiler output at
`~/.local/share/pyash/pyac-vliw/pipeline-cache-build.log`. The conformance
command extracts per-pipeline build times from that log when available;
otherwise it records cached pipeline-load times from runtime logs. Each run
also writes a dated `.pya` metrics record under
`artifacts/YYYYMMDD-NNNN-rust-vliw-conformance/result.pya`, including separate
CPU request wall times, local worker queue/wall and separately timestamped
Housekeeper queue/active/round-trip GPU timings, remote job identity, service
pack decode and slot/lock waits, GPU buffer/command setup, submit-to-
readback wait, result decode, and Vulkan timestamp-query compute-pass duration
when the adapter supports it. Runtime timings are preserved for expected-error
responses too. It also records executable and shader sizes/hashes,
pipeline-cache identity, device, and test outcomes. The report is written on
both pass and failure. `kernelGpuMs` is the GPU timestamp interval around the
compute pass; `submitWaitReadbackMs` is host-observed submit, synchronization,
and map/readback time, not kernel execution time.
`Housekeeper active` measures the remote job interval, while `worker wall`
includes local dispatch and waiting for the remote terminal result. Neither is
a substitute for the Vulkan kernel timestamp.

After readiness, Housekeeper resumes queued VLIW work. Ollama, ComfyUI, Strata,
and the Housekeeper process are not restarted. If artifact generation or the
runtime update fails, the helper restores the prior runtime when available;
dispatch remains held if rollback cannot be verified.

This contract follows the November 18, 2026 startup incident: Rust-GPU had
already emitted SPIR-V to disk, but runtime `create_compute_pipeline` calls
still invoked the NVIDIA driver compiler before binding the HTTP listener. A
30-minute readiness allowance hid that build/runtime boundary error. The
required deliverable is now the persisted GPU pipeline artifact, generated
before service replacement and loaded by the service.

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
