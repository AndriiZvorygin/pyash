# Rust PyAC VLIW Runtime

This service owns the Rust/WGPU Vulkan interpreter process and its shader. The
Python GPU Housekeeper remains the scheduler: it performs normal GPU admission,
starts this container on demand, submits canonical `pyac-pack-execute` packs,
and stops the service after its idle grace. VLIW runtime updates do not rebuild
or restart Housekeeper.

## CUDA canary

The optional CUDA image runs the same Rust semantics core, including typed
dispatch, from an offline-assembled `sm_86` cubin. The standard image still
defaults to Vulkan. Housekeeper uses the same `pyac-pack-execute` protocol for
both. The CUDA image includes only the runtime, cubin, and build metadata:
there is no PTX, compiler, or fallback to Vulkan or CPU.

Build on Mriczo, not SWAC. The pinned nightly must have `rust-src`,
`llvm-tools`, and `llvm-bitcode-linker`; `ptxas` 12.8 and Docker are used on
the build host. Then run:

```sh
bash rust/pyac-gpu/build-cuda-image.sh
bash container/pyac-vliw-runtime/command/cuda-canary.sh swac <CUDA_IMAGE>
# Only after SWAC conformance and rollback are verified:
bash container/pyac-vliw-runtime/command/cuda-canary.sh mriczo <CUDA_IMAGE>
```

The build prints the image tag and evidence directory. The canary requires a
prior Vulkan container and saved cache on the destination. It changes only
the VLIW route, caps the canary container at 1 GiB of host memory, validates
readiness within 60 seconds, and submits host-pinned jobs with discharge
disabled. It restores the prior container afterward. If that container
cannot regain readiness, only VLIW remains held for recovery. Do not compile
a cache during startup or reuse a cache from a different GPU/driver.

The internal HTTP contract is protocol version 1:

- `GET /health` returns `ready`, `protocolVersion`, and available worker slots.
- `POST /v1/execute` accepts `{protocolVersion, jobId, jobSpec}` where
  `jobSpec.kind` is `pyac-pack-execute` and `jobSpec.payload.packBase64` is the
  canonical PyAC pack. Independent `myocpfun` sections are dispatched as
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
