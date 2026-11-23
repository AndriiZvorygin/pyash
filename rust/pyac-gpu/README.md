# Rust-GPU VLIW Targets

The VLIW GPU targets share the semantic implementation in
`rust/pyac-vliw-core/src/semantics_runtime.rs`. Rust-GPU compiles it into one
SPIR-V 1.5 module validated for Vulkan 1.2 for the native Housekeeper worker,
and generated WGSL for the browser pack runtime. The independently scheduled
`myocpfun` section entry point is Vulkan-only because it uses a device-scope
atomic completion ticket. The browser WGSL target intentionally omits that
entry point; it does not claim section execution or completion-order results.
Keep behavior changes in the shared semantics runtime. The optional Rust
CUDA target also builds this core; its adapter only loads a prebuilt cubin
and launches kernels. See the [CUDA canary runbook](../../container/pyac-vliw-runtime/README.md#cuda-canary).

The native shader intentionally uses SPIR-V's `Logical Simple` memory model.
The Vulkan-specific Rust-GPU target emits `VulkanMemoryModel`, which requires a
device feature the default wgpu device request does not enable. The build script
guards the memory-model operands, and the container build runs `spirv-val` with
the Vulkan 1.2 target environment before packaging the shader.

## Build and smoke-test

See [`vliw-gpu-pipeline-cache.md`](../../documentation/reference/vliw-gpu-pipeline-cache.md)
for the production cache destination, low-scratch diagnostic workflow, and
the current cache-generation failure evidence.

Install the repository's pinned Rust toolchain, the official `cargo-gpu`
0.11.0 release, and its matching nightly/Rust source component. Then run:

```sh
./rust/pyac-gpu/build-kernels.sh
rust/pyac-gpu/smoke.sh
```

Before a GPU test, `./rust/pyac-gpu/probe-vulkan-device.sh` performs a
low-memory inventory of the NVIDIA Vulkan adapter and compute queue. It has a
10-second timeout and does not build shaders, create pipelines, or dispatch
GPU work. Install `vulkan-tools` if `vulkaninfo` is not present. This check
confirms driver/device visibility only; it is not a pipeline compilation test.

To profile the final Vulkan driver pipeline-build stage using existing binaries,
run `node rust/pyac-gpu/profile-pipeline-build.mjs --run`. It does not run
Cargo or rebuild SPIR-V. Preflight requires 16 GiB available RAM for the full
shader, or 8 GiB for diagnostic SPIR-V up to 1 MiB; live available RAM must
remain above 8 GiB. The process is capped at 16 GiB RSS and ten minutes.
Pipeline creation is host-side driver compilation and dispatches no shader
work, so GPU compute utilization is not a success signal; free VRAM is recorded
as device context but is not an idle-device gate. Set
`PYAC_VLIW_PROFILE_DIR` to colocate its cache, log, and report beside an
existing SPIR-V under ignored `target/diagnostics/`; outputs are never
overwritten. This is an explicit
diagnostic, not part of service startup. `PYAC_VLIW_PROFILE_TIMEOUT_SEC` can
shorten the wall limit (never raise it above ten minutes), and
`PYAC_VLIW_PIPELINE_COMPILER` selects an alternate prebuilt compiler for A/B
experiments such as a temporary Vulkan-HAL optimization-flag patch.

To isolate source-level pipeline cost, list candidates with
`node rust/pyac-gpu/profile-function-reduction.mjs --list`, then run exactly
one diagnostic variant, for example:
`node rust/pyac-gpu/profile-function-reduction.mjs --run --function execute_numeric_programlet_at`.
For `collect_sentence_at`, compare its loop-eliding, input-dependent variant with
`--run --function collect_sentence_at --variant minimal`; unlike the default
error stub, this retains a successful downstream path for attribution.
`--variant baseline` builds the unmodified source and is useful for profiling a
code-generation change without pruning any interpreter path. Add
`--repo-source` to reuse the shader crate's existing Cargo target cache; this
reads the working source directly, puts the SPIR-V and reports under ignored
`target/diagnostics/`, and reuses Cargo intermediates under `shader/target/`.
The tool copies the shader and VLIW core under ignored `target/diagnostics/`
unless `--repo-source` is selected. It supports an unchanged `baseline`, an
early-error `error` stub, and the collector-specific success-shaped `minimal`
variant. `--build-only` stops after SPIR-V generation, which is useful when the
GPU is occupied; otherwise the tool also probes Vulkan pipeline creation. The
Rust-GPU build has a five-minute default and maximum with a 10-GiB RSS cap.
Build-only profiling requires 15 GiB available RAM at launch and stops if it
falls below 8 GiB, preserving headroom while tolerating normal host-memory
fluctuations during the measured Rust-GPU build. Runs that also probe Vulkan
retain a 20-GiB launch requirement; the Vulkan diagnostic has a ten-minute
default and maximum with a 16-GiB RSS cap and 12-GiB available-RAM floor.
Each run records source hashes, build logs, SPIR-V, and resource/timing
reports, and exits nonzero if either stage fails. Stub variants intentionally
change behavior; they are for compiler attribution only and must never be
deployed. Set `PYAC_VLIW_REDUCE_BUILD_TIMEOUT_SEC` (up to 300) or
`PYAC_VLIW_REDUCE_PIPELINE_TIMEOUT_SEC` (up to 600; ten minutes) to adjust the
diagnostic caps. The pipeline probe defaults to ten minutes so it can finish
the current full shader pipeline build; this does not change the production
service's 60-second readiness ceiling. Each run updates
`target/diagnostics/function-reduction/index.md`.
NVIDIA's persistent shader cache is not cleared by the tool, so repeated runs
of the same variant may be warm; compare and label first-run stage timings.
The source-level inliner profiler defaults to a 120-second bounded sample;
set `PYAC_RUSTGPU_INLINE_TIMEOUT_SEC` from 1 to 900 when a longer attribution
window is justified. Its partial report includes the active function and edge
at stop, so a full 15-minute compiler run is not required for a useful sample.

The smoke command lowers a small Pyash programlet to a canonical `.pyac` pack,
runs it on a discrete Vulkan GPU, and asserts the typed result plus rejection
of a constant write. It also checks the ordinary codelet-pack path. It requires
an NVIDIA device visible to Vulkan. The browser build consumes the WGSL
generated by the same script.

After deploying the matching Rust VLIW runtime, run
`node command/vliw_gpu_conformance.mjs` from the repository root. The command
submits all 44 independent packs through the durable Housekeeper queue before
waiting for results, then checks every exact typed output and reports every
failure. Expected values come from the Pyash execution specification, not the
JavaScript reference backend. The run requires the `rust-gpu-vulkan` backend,
reports each device, and has no CPU fallback. Set
`PYA_VLIW_CONFORMANCE_TIMEOUT_MS` to bound the wait for each queued case.

The HTTP runtime creates one Vulkan instance, device, shader module, and both
compute pipelines at service startup, then reuses them across requests. It
does not spawn a short-lived GPU worker per pack. Dispatches on a device are
serialized inside the resident service because WGPU error scopes are
device-global; Housekeeper still receives the full independent test batch and
queues/admit jobs according to its normal policy.
By default it requests device `gpu0`, keeping this Vulkan/discrete-GPU
verification away from incompatible unified-memory peers; set
`PYA_VLIW_CONFORMANCE_DEVICE_ID` only when intentionally testing another
compatible discrete device. `PYA_WORLD_ROOT` can point a dev checkout at the
active Housekeeper spool.

## Housekeeper jobs

The `vliw` runtime accepts only `pyac-pack-execute`: a canonical `.pyac` pack
transported as base64 and returned as typed sentence values. The Housekeeper
performs GPU admission and routing before the worker dispatches Vulkan compute.
Pack limits are validated before device buffer allocation. A missing or
non-discrete GPU is a hard failure; the worker does not silently switch to a
second semantics implementation. Named-slot candidate evaluation is not part
of the Rust VLIW interpreter or its Housekeeper runtime.

The CPU pack executor and native Vulkan shader use the same bounded scalar
programlet runtime: typed numeric/boolean locals and
arguments, nested calls, scalar operators, local comparisons/branches, bounded
`fromindex`/`toindex` loops, and typed returns. Limits are 64 codelets, 64
locals per frame, 8 arguments, call depth 8, and the 65,536-step default
budget. Date/vector literals remain supported as ordinary codelet groups, not
as programlet-local values. Text values and general effects are outside this
programlet slice. Native Vulkan also dispatches independent named programlet
sections concurrently; each result carries its source `sectionIndex` and HNUC
name, while the response list and `completionOrder` follow GPU completion
order. Source order is not imposed on independent results. The JavaScript
reference interpreter is serial and naturally completes sections in source
order; the Rust CPU executor schedules independent sections across available
CPU threads and returns results as each finishes.

The standalone smoke script verifies ordinary pack execution, one local-number
programlet return, and rejection of a write to a constant quantity on the
discrete GPU. The earlier 39-case Housekeeper matrix passed on the NVIDIA
GeForce RTX 3090 with the resident runtime. Six additional cases now exercise
16-lane numeric, boolean, float32, and float64 vectors plus an explicit
six-lane count and dot-product collection into a mutable prediction vector.
Those additions require a matching rebuilt runtime and a fresh Housekeeper run
before they can be claimed as GPU-verified.
This establishes conformance for those cases only; it does not claim parity for
the currently unsupported programlet value families or control-flow forms.

The GPU Housekeeper Compose service builds the worker into its image and mounts
the host NVIDIA Vulkan ICD manifest read-only. The default manifest path is
`/usr/share/vulkan/icd.d/nvidia_icd.json`; set `NVIDIA_VULKAN_ICD_PATH` when the
host stores it elsewhere. The image includes `libegl1`, `libvulkan1`, and the
X11 runtime libraries required by NVIDIA's Vulkan ICD.

## Current boundary

This is a shared implementation for the supported VLIW slice, not full Pyash
interpreter parity. The `.pyac` path covers the Rust core's currently decoded
scalar numeric and boolean values, dates, numeric/bool/float32/float64 vectors,
and bounded numeric-comparison conditionals. Text-vector handling and broader Pyash
control flow remain outside this GPU slice. The browser WGSL target is
generated from the same core, but its current module exceeds Chromium/Naga's
127-level nesting limit; the browser GPU path is therefore pending, while
WASM CPU remains available. See
[`pyash-vliw-compiler-architecture.md`](../../documentation/reference/pyash-vliw-compiler-architecture.md)
for the broader compiler/runtime boundaries.
