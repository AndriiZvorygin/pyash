# VLIW GPU Pipeline Cache Workflow

This note is the runbook for producing and diagnosing the Rust-GPU Vulkan
pipeline cache. Keep shader compilation, Vulkan driver pipeline creation, and
production service startup as separate measured stages.

## Artifact flow

The production SPIR-V is built before deployment by the runtime image build and
is installed at `/service/pyac_vliw_gpu_kernel.spv`. The production cache is
`$HOME/.local/share/pyash/pyac-vliw/pyac_vliw_pipeline_cache.bin` on the host,
mounted at `/service/artifacts/pyac_vliw_pipeline_cache.bin` in the compiler
and runtime containers.

`container/pyac-vliw-runtime/command/deploy.sh` builds the image, holds only
Housekeeper's VLIW route while replacing its worker, runs the separate pipeline
compiler, checks for a nonempty cache, starts the runtime, and requires
readiness within 60 seconds. The running service reads the SPIR-V and cache
from disk. It does not compile shaders or pipelines at startup. The cache
writer writes a temporary sibling of the requested destination and atomically
renames it into place, so a partial cache is never installed as the live file.

Use the production artifact directory as the destination for deployment. Do
not generate a cache in a second tree and copy it over afterward. Diagnostic
runs are intentionally isolated under the ignored
`rust/pyac-gpu/target/diagnostics/` directory; their report, log, SPIR-V, and
successful cache are evidence, not production inputs.

## Low-scratch profiling

1. Reuse the checkout's Cargo target cache. For an unchanged baseline, pass
   `--repo-source --build-only` to `profile-function-reduction.mjs`; this
   avoids copying the source tree and writes the resulting SPIR-V once under
   that run's diagnostics directory.
2. Pass that exact SPIR-V path through `PYAC_VLIW_SPIRV_PATH` and set
   `PYAC_VLIW_PROFILE_DIR` to the existing run directory. The profiler does
   not rebuild, copy, or duplicate the SPIR-V.
3. The pipeline compiler writes `pipeline-cache.bin` directly into that same
   directory; logs and report are colocated. Existing outputs are never
   overwritten. A failed partial cache is removed.
4. For a source reduction variant, the reducer copies only the Rust core and
   shader source into one reusable ignored workspace; it excludes `.git` and
   all `target` directories. Do not create another checkout or copy Cargo
   build outputs for each candidate.
5. Compare the same entry point and source snapshot. Record host, GPU, driver,
   free VRAM, available RAM, SPIR-V size, each pipeline-stage time, process
   peak RSS, and whether the cache file was actually written. A successful
   SPIR-V build alone does not mean pipeline-cache generation succeeded.

The profiler has host-RAM, process-RSS, and wall-time guards. Pipeline-cache
generation invokes the host-side Vulkan driver compiler to create pipeline
objects; it dispatches no VLIW shader work, so GPU compute utilization is not a
success signal. Free VRAM is recorded only as device context, not as an idle
GPU requirement. The driver can still report a device-allocation error; that
is recorded as a failed stage, not hidden by CPU fallback. Do not unload
models, stop Housekeeper jobs, or wait for unrelated inference to drain just
to run this host-CPU-heavy driver compilation probe. Do not run two
pipeline-profile processes against the same device simultaneously.

## Generator outline

The production deployment already follows this sequence. A future standalone
cache-generation command should preserve the same ordering and direct-output
contract:

```sh
run_dir=/absolute/path/to/rust/pyac-gpu/target/diagnostics/cache-recovery-run
PYAC_VLIW_SPIRV_PATH="$run_dir/shader/pyac_vliw_gpu_kernel.spv" \
PYAC_VLIW_PROFILE_DIR="$run_dir" \
PYAC_VLIW_PROFILE_LABEL=cache-recovery \
node rust/pyac-gpu/profile-pipeline-build.mjs --run
```

Equivalent future-script pseudocode:

```text
require prebuilt compiler and SPIR-V files; fail if either is missing
check host RAM and record Vulkan device identity/free VRAM as context
validate SPIR-V magic, target, and source/build manifest
choose one unique diagnostics run directory; do not make a second source copy
run pipeline-compiler(SPIR-V path, run-directory/pipeline-cache.bin)
  create adapter, device, shader module, then pack/programlet/sections pipelines
  collect cache only after all required pipelines succeed
  write destination.tmp beside destination; fsync if required; atomic rename
write host CPU/RSS samples, timings, hashes, and report in the same directory
verify cache exists and is nonempty; delete partial cache after failure
for deployment, compile directly to the production cache destination
start runtime with the saved SPIR-V and cache paths
require readiness within 60 seconds; run a typed live-GPU smoke request
if deployment fails, restore the previous cache and worker image
```

Do not put compilation, driver pipeline creation, or a long readiness wait in
the serving process. A cache miss is a deployment/build failure, not a reason
to JIT, silently select another backend, or fall back to CPU.

## Structures to avoid

Rust-GPU's SPIR-V ABI cannot pass all Rust pointer/reference arguments as
ordinary calls. Its compiler reports `inlining was required due to illegal
(pointer) argument`; a `#[inline(never)]` annotation does not prevent that
forced inline. Avoid building the hot GPU call graph from nested generic
helpers that repeatedly take references to arrays or fields inside large
structs, especially mutable references to fixed arrays. The current
`FixedArrayAccess` helpers still force inline across the shader call graph when
their pointer arguments violate the SPIR-V ABI; replacing unchecked indexing
with explicit bounds checks plus `spirv_std::arch::IndexUnchecked` removes the
custom abort path but does not remove this ABI-driven expansion. Measure the
call-graph growth instead of assuming `#[inline(never)]` is honored. Also avoid
unchecked Rust slice indexing in shared helpers: Rust-GPU lowers its
bounds-failure path to a custom abort, and the linker forces every caller that
may abort to inline. Check bounds before `IndexUnchecked`; parser validation
must still reject malformed input.

The previous inline diagnostic attributed 664,940 scans and 12,621,577
instruction-growth units to `execute_numeric_programlet_at`. Its largest
expanded paths included `programlet_branch`, boolean-expression evaluation,
number actions, return handling, sentence parsing, and repeated
`write_chunk_960` accessors. Keep execution boundaries small, avoid passing
whole frame/directory structs through pointer-heavy helper chains, and prefer
bounded local values with explicit write-back at control-flow boundaries.
This is a compiler constraint, not a reason to remove specified semantics.

After local-copy refactors, the 2026-11-21 baseline shader built successfully
in 204.7 seconds with 3.10 GiB peak process-tree RSS, producing a 7,589,920-byte
SPIR-V file. On the Mriczo RTX 3090 (driver 550.163.01), shader-module creation
took 0.03 seconds, pack-pipeline creation took 235.36 seconds, and the
programlet pipeline had not completed when the 300-second profile limit
stopped the run. Peak pipeline-compiler process-tree RSS was 8.29 GiB and no
cache was saved. This is evidence that the cache failure remains unresolved;
do not describe this artifact as deployable or claim GPU conformance from it.

The 2026-11-22 indexing repair produced a valid 6,452,920-byte SPIR-V 1.5
module in 154 seconds; `spirv-val --target-env vulkan1.2` passed. SHA-256:
`374bd9396c834ccbecc959b7188cdfa61ceda5396b522614128896cb0fb2c526`. The
inliner still reports large ABI-forced expansions. Profiling this exact module
with a 600-second cap completed pack in 117.71 seconds and programlet in 458.51
seconds; at 576.38 seconds the NVIDIA driver returned `ERROR_UNKNOWN` and
WGPU marked the device lost. Pipeline-cache retrieval then failed because the
device was invalid. This was not a wall-time timeout, and no cache was saved.
Shader size and Rust compile time alone cannot identify the driver's slow
path. Do not infer cache success from SPIR-V alone.
For source attribution, `diagnose-inline.mjs` now defaults to a 120-second
sample and reports the active function/edge when stopped. Set
`PYAC_RUSTGPU_INLINE_TIMEOUT_SEC=90` for a short diagnostic sample; extend it
only when the partial evidence shows the compiler is near useful output.

The 866,420-byte `call-local-return-stubs` diagnostic variant was also profiled
with the same 600-second maximum. It replaces ten programlet/vector functions
with error returns, so it is not a behavior-preserving smaller build. Pack
creation took 0.19 seconds; the driver reported the programlet pipeline ready
after 33.31 seconds, then returned `ERROR_UNKNOWN`; cache retrieval found the
device invalid. The process exited after 33.8 seconds with 1.20 GiB peak RSS,
not because the profiler timed out. Giving this reduced variant more wall time
would not address that driver/device failure.

## Four-Commit Baseline Check

The nearest four-commit ancestor at the time of this investigation was
`fc77719f6157d7068044d56beff94ab95487bfc1` (`add vector maximum reduction`).
Its shader and shared-core sources were archived under ignored diagnostics,
then built using the existing Cargo target cache. The resulting 4,627,572-byte
SPIR-V passed `spirv-val --target-env vulkan1.2`; SHA-256:
`0c6104d7d430e5e241cb11c2bf442c145b5513f98258f698a90cd373b5c1d185`.
The current prebuilt Vulkan compiler created all three pipelines and returned
a complete 16,677,394-byte cache in 267.9 seconds, with 8.35 GiB peak process
RSS. Pipeline times were pack 220.82 seconds, programlet 26.59 seconds, and
sections 19.24 seconds. Cache SHA-256:
`dbd2780980fa891adc9d6703b7fde847328724c9c6f939e86904f5087733b59f`.
The exact logs, SPIR-V, cache, and report are in
`rust/pyac-gpu/target/diagnostics/baseline-fc77719f/`.

This verifies cache generation for that archived shader with the current
compiler. It is not a runtime cache-load or live-conformance test, and it is
not a fast baseline: the pack pipeline alone took 220.82 seconds. The four
commits between that revision and the current branch add softmax/programlet
vector work and canonical programlet signature dispatch; the current working
SPIR-V is 6,452,920 bytes and its programlet pipeline ends in a Vulkan driver
`ERROR_UNKNOWN`/device-lost error before cache data can be retrieved. Recent
successful diagnostic caches came from intentionally reduced/stubbed shaders;
they are not substitutes for a complete production cache. Use `fc77719f` as a
reproducible comparison point, not as proof that the current feature set is
ready to roll back or deploy.
