# Rust VLIW Verification Ledger

Use this file as the lookup record for Rust VLIW CPU/GPU conformance runs. Each
entry records the repository revision, deployed artifact, host/device, route,
and exact test outcome. A queued or timed-out job is not a passing test.

## 2026-11-23: Softmax and Two-Key Attention on Mriczo CUDA

The full Housekeeper-routed CUDA conformance matrix passed on Mriczo's RTX 3090.
It included **58 value cases and 3 expected-error cases**, with the 21 independent
programlet sections executed as one GPU batch. New examples verify stable softmax
in float32 and float64 and a smallest attention composition: two query/key dot
products, softmax weights, scaling two value vectors, and adding them. The
attention fixture returns `[3, 5]`; the equal logits produce weights `[0.5, 0.5]`.

| Field | Evidence |
| --- | --- |
| Source revision | `7ada05f988e74de156a7fedadbbf3d2cbec6b968` plus tracked patch SHA-256 `3c01b68ae502e4747c1765a42f16e191c757c75ea2e2621710241e2cd8b6301f` at test time |
| Host and route | Mriczo, Pyash GPU Housekeeper -> Rust NVPTX CUDA runtime |
| GPU and driver | NVIDIA GeForce RTX 3090, `sm_86`, driver `550.163.01`, 24,576 MiB VRAM |
| CUDA image | `sha256:9a3631ec3b885c1b89f4cff218848d228a3bb2894b1b127abd2ddce95144de59` |
| Runtime executable | 9,247,536 bytes; SHA-256 `fca78f5f840e0a2c278d197c8891b037bf568eae86272246a938bf8eb9f5df67` |
| Cubin | 3,015,896 bytes; SHA-256 `ea534211ca141421a90beee3cbf0bfe8b17547e809b2c47cf1e85969291f505b` |
| CPU reference executable | 15,281,000 bytes; SHA-256 `82e2a8a7e2dbaa699aff19113fe75abfd7e9424906a48b6160bab732a87d960a` |
| Runtime initialization | Compiled cubin load and GPU initialization: 0.09 s; worker ready in 585 ms |
| Full run | 6,446.583 ms; 58 value cases passed and all 3 expected errors matched |
| CPU request batches | 37 codelet cases: 59.901 ms; 21 programlet sections: 66.676 ms |
| GPU execution batches | 37 codelet cases: 4.013 ms CUDA event time; 21 programlet sections: 120.582 ms CUDA event time |
| Housekeeper client round trip | Codelet batch: 1,089.965 ms; section batch: 659.905 ms |
| Run record | `artifacts/20261123-0006-rust-vliw-conformance/result.pya` |

The client round trips include transport and Housekeeper overhead and should not
be compared directly with the CUDA-event timings. The sectioned batch includes
all 21 sections, not just the new attention cases. A first attempt exposed a
scalar-only worker result decoder for vector-valued programlets; the decoder was
fixed, unit-tested, rebuilt, and the complete matrix then passed. The canary
restored the previous Mriczo CUDA container and resumed the VLIW route.

## 2026-11-23: Full CUDA Cubin Conformance on SWAC

The temporary deployment canary ran the full configured conformance suite, not
a reduced smoke test. The prebuilt Rust NVPTX worker executed the same typed
VLIW core through SWAC Housekeeper. Three standalone typed-dispatch results
passed: numeric overload `41`, reversed-case boolean overload `true`, and
nested overloaded call `41`. The missing overload returned shared error `1`.
All **55** batched matrix cases and both other expected errors passed.

| Field | Evidence |
| --- | --- |
| Build source | CUDA implementation on top of `54c274e34`; build metadata records the dirty checkout at canary build time |
| Build host and tools | Mriczo; Rust nightly `2026-08-15`; NVIDIA `ptxas 12.8.93` |
| Device and driver | SWAC, NVIDIA GeForce RTX 3060, `sm_86`, driver `535.247.01` |
| Rust-to-PTX / offline assembly | 5.81 s with cached dependencies / 33.36 s |
| Cubin | 2,741,208 bytes; SHA-256 `21651098503d4cf7cf9ae7e984078cde9cfbff0b2056a8af3b7e77f509ad86d3` |
| Runtime executable | 9,247,912 bytes; SHA-256 `01b77418be221a6d84580e86ed7a3867b36d311e6702d7908b42085a3c6783b2` |
| Image | `sha256:c2db10e15c334cc0e8fc2d9221d1914aa6909b6366eb5ee4d0078635208b0298` |
| Cold readiness | 1.092 s measured from before container start; runtime initialization 0.11 s |
| GPU kernel events | Codelet pack 3.758 ms; section batch 101.297 ms; nested overload 0.413 ms |
| Client round trips | Codelet pack 678.516 ms; section batch 672.471 ms |
| Container host memory | 39.93 MiB sampled; 1 GiB enforced limit |

`ptxas` reported 255 registers per entry point. Pack, standalone programlet,
and section stack frames were 7,072, 3,856, and 3,816 bytes, respectively.
Their entry-point spill stores/loads were 4/4, 16/0, and 12/8 bytes. Terminal
Housekeeper timestamps had one-second resolution, so their queue and active
deltas should not be interpreted as subsecond measurements.

The conformance result is `artifacts/20261123-0002-rust-vliw-conformance/result.pya`.
Its case and request timings are valid; its environment sweep sampled the
client host, not SWAC. The CUDA report collector now queries the pinned GPU
host. Build logs are under `rust/pyac-gpu/cuda-kernel/target/cuda-build-yXfwwfUm/`.

Rollback restored SWAC's prior Vulkan container, but that container was
already exited and its required pipeline cache was absent. Its historical
build log shows a Vulkan adapter initialization failure. The VLIW route
remained held; other runtimes and Housekeeper were not restarted. Mriczo was
not attempted during that first SWAC recovery because rollback could not be
verified. The canary now checks for the saved rollback cache before changing
a route; the later Mriczo result is recorded below.

## 2026-11-23: Full CUDA Dispatcher Verification on Mriczo

This was the **full configured conformance run**, not a reduced smoke test. The
temporary CUDA deployment used the Mriczo Housekeeper and RTX 3090, then
restored the original Vulkan container and verified that it was ready again.

| Field | Evidence |
| --- | --- |
| Source revision | `91af375eb6a4ff06c752919dd8f17f1ba436390f`; no tracked working-tree patch |
| Host and route | Mriczo, Pyash GPU Housekeeper -> `pyac-vliw-runtime` -> Rust NVPTX cubin |
| GPU and driver | NVIDIA GeForce RTX 3090, `sm_86`, driver `550.163.01`, 24,576 MiB VRAM |
| CUDA image | `sha256:d81383ed7b9998c8231c0e8e0b9f849708f380305a611ef9b95f0518513088cb` |
| CUDA runtime executable | 9,248,560 bytes; SHA-256 `2cfdebfef9bb488a0c5f6493eec1aa18da27c553064cb2ee415017dc78a6f7a1` |
| Cubin | 2,741,208 bytes; SHA-256 `21651098503d4cf7cf9ae7e984078cde9cfbff0b2056a8af3b7e77f509ad86d3` |
| Runtime initialization | Cubin load and GPU initialization: 0.09 seconds; ready in 722 ms from container start |
| Full run | 6,421.989 ms; **58 value cases passed and 3 expected-error cases matched** |
| Typed dispatcher checks | Numeric overload `41`; reversed-case boolean overload `true`; nested overloaded call `41`; missing overload returned shared error `1` |
| Batched GPU work | 37 codelet cases in 4.147 ms GPU time; 18 independent programlet sections in 111.077 ms GPU time |
| CPU reference batches | 37 cases in 81.653 ms; 18 sections in 83.541 ms |
| Housekeeper round trips | Codelet pack 659 ms; section pack 719 ms; these include client/queue overhead, not GPU time |
| Restored runtime | Original Vulkan image `sha256:8b0f3303b03d726ba3969d408dd25c2ccbdc250da3d201d93feb1c4c08432ecd`; Housekeeper reported it ready after restoration |
| Run record | `artifacts/20261123-0003-rust-vliw-conformance/result.pya` |

This verifies the same shared Rust semantics and full-signature dispatcher on
CUDA, including typed overload selection, case-order canonicalization, nested
calls, and dispatcher errors. It is a full semantic conformance result, not a
claim that these small workloads are faster on GPU than CPU.

### Vulkan Compatibility Boundary

The latest recorded source checkpoint with successful Vulkan pipeline-cache
generation is **`fc77719f6157d7068044d56beff94ab95487bfc1`** (`add vector
maximum reduction`). The following commit, **`a72c6bcf225df639e511c63b37e240e143d8972a`**,
introduced canonical Rust programlet signature dispatch. The current full
signature-dispatch matrix is verified on the prebuilt CUDA cubin; this ledger
has no equivalent current-source Vulkan cache-generation/conformance record.
Treat `fc77719f6` as the last known Vulkan cache checkpoint, not proof that
Vulkan hardware cannot implement dispatch.

The pre-existing Mriczo Vulkan container did restart successfully from its
saved artifacts after this CUDA test, but that only verifies the older
deployed Vulkan artifact and its startup. It does not establish that artifact
has the newer full-signature dispatch behavior. Keep Vulkan as a legacy
compatibility path for its already-built artifacts; use the validated CUDA
cubin path for current dispatcher work until Vulkan is rebuilt and passes the
same matrix. Run `20261123-0003` was verification-only and restored Vulkan.

### Persistent Mriczo Deployment

After that full pass, `deploy` mode ran the same matrix again and retained the
prebuilt CUDA runtime on Mriczo. The previous Vulkan container remains stopped
as the rollback target.

| Field | Evidence |
| --- | --- |
| Deployment verification | `artifacts/20261123-0004-rust-vliw-conformance/result.pya`; 58 value cases passed, 3 expected errors matched |
| Runtime artifact | Same tested CUDA image and cubin hashes above; cubin initialization 0.10 seconds |
| Run duration | 14,569.242 ms, including CPU checks, Housekeeper requests, and recording |
| Active image | `sha256:d81383ed7b9998c8231c0e8e0b9f849708f380305a611ef9b95f0518513088cb` |
| Retained rollback container | `pyac-vliw-runtime-cuda-canary-previous`, prior image `sha256:8b0f3303b03d726ba3969d408dd25c2ccbdc250da3d201d93feb1c4c08432ecd` |
| Post-deploy state | Housekeeper reported VLIW ready on Mriczo; queue depth 0 |
| Rollback command | `bash container/pyac-vliw-runtime/command/cuda-canary.sh mriczo liberit/pyac-vliw-runtime:cuda-sm86-21651098503d4cf7 rollback` |

The conformance harness checkout was `d5ac63d159140e490c65e2a4b43ef596853d63e4`
with a tracked patch limited to the deployment script and documentation; the
prebuilt runtime image remains the exact, hashed artifact identified above.
Housekeeper may stop the idle container, but it retains this CUDA image and
will restart it on demand. SWAC's VLIW route remains held pending a verified
rollback target there; other runtime routes were not changed.

## 2026-11-19: Live GPU Refresh

**Test target:** Rust VLIW shared core and Rust-GPU Vulkan pack runtime, including batched codelets and sectioned programlets.

| Field | Evidence |
| --- | --- |
| Source revision | `cb41ad40da7e77254575044d91a6693c2e515f6d` plus the batched-conformance and section-scanner changes recorded in this entry (working tree at verification time) |
| Host and route | Mriczo, Pyash GPU Housekeeper -> `pyac-vliw-runtime` -> Rust-GPU Vulkan |
| GPU | NVIDIA GeForce RTX 3090, `gpu0`, 24,576 MiB VRAM |
| Driver | NVIDIA `550.163.01` |
| Runtime image | `sha256:844a7ada006001088db02868f2a85dc8b90e570ad360da385eb05ffeb2f5d97a` |
| Runtime executable | 9,028,048 bytes; SHA-256 `56e6a7fc39d4ba27ad36c36d809e1e497ceedf60199135d4ae94330813fca4a1` |
| GPU worker executable | 7,354,440 bytes; SHA-256 `5f52d858890bd1687217b6ca39f4361a166fbe5994e70959a68e6e4a5ee47bb0` |
| SPIR-V shader | 2,678,260 bytes; SHA-256 `2de5a97441d3c938284b8afa3a9251465619467aa7446091a74dd2bc37475d61` |
| Saved Vulkan pipeline cache | 9,855,807 bytes; SHA-256 `ca957cf6566ccf6e44590570597cc396d6bda1a53f27b9ca7d2f6b4a077f8aac` |
| Pipeline cache generation | 42.31 seconds total on RTX 3090; pack 5.82 s, programlet 18.69 s, sections 17.64 s |
| Runtime start | Container started at `2026-11-19T17:48:08.449961746Z`; deployed runtime reports ready with GPU observed |
| Runtime memory observed | 89.65 MiB container memory |
| Full conformance command wall time | 62.12 seconds, from log creation `2026-11-19 12:48:33.162 -0500` to final result `12:49:35.286 -0500`; includes CPU reference checks, both batched GPU requests, and both expected-error requests |
| Per-request latency | Not recorded by this runner; the 62.12-second figure is end-to-end, not GPU execution time alone |

The service update used `container/pyac-vliw-runtime/command/deploy.sh`. It held
only VLIW dispatch, preserved queued jobs, generated the GPU-specific pipeline
cache before replacement, then resumed queued work. SWAC was not used and no
compilation was performed there. Pipeline-cache generation is a deployment/build
step; it is not performed during service startup.

### Results

- Live RTX 3090 conformance: **44/44 passed** through Housekeeper.
- Submission count for those 44 success cases: **2 GPU pack requests**, not 44
  individual requests. One combined codelet pack covered 26 cases; one
  sectioned programlet pack covered 18 independent sections. The sectioned
  pack's completions arrived out of source order and were correctly matched by
  section index.
- Expected-error conformance: **2/2 passed** through Housekeeper, as two
  separate requests. These remain separate because an error terminates a pack
  request, so combining them would prevent independently verifying both errors.
- Run log: `/tmp/vliw-gpu-conformance-20261119-batched-final.log` (10,197
  bytes; local ephemeral log, not committed).
- This is not one physical dispatch for the entire matrix: codelet and
  sectioned-programlet packs follow distinct runtime paths. Current total is
  four Housekeeper submissions including the two isolated error checks.
- Batching exposed and fixed section scanning that rejected inline conditional
  body sentences, plus a decoder limit incorrectly applied to the aggregate
  sectioned packet instead of per section. Regression coverage is included.

### Stale Artifact Diagnosis

The preceding full GPU attempt returned 39/44 successes. Its five failures were
the multi-codelet vector cases, all returning shared-core error 5. The deployed
shader had been generated at 05:46 local time, before the bounded typed-vector
implementation (`8cc78171d`, 10:36 local time). The running container and local
generated shader had the same old hash, so this was stale deployed SPIR-V, not
a CPU/GPU semantic disagreement. After rebuilding and deploying the current
shader, the eight live vector cases above passed exactly.

## Repeatable Checks

- Full CPU + live Housekeeper GPU matrix:
  `PYA_VLIW_CONFORMANCE_TIMEOUT_MS=1800000 node command/vliw_gpu_conformance.mjs`
- Targeted batching and programlet regression tests:
  `node --test quiz/vliw_gpu_conformance.test.mjs quiz/vliw_programlet_local_slots.test.mjs`
- Rust core tests:
  `cargo test --manifest-path rust/pyac-vliw-core/Cargo.toml`
- Focused Rust CPU vector tests:
  `cargo test --manifest-path rust/pyac-vliw-core/Cargo.toml executes_max_width_float_vectors_across_indexed_codelets`
  and
  `cargo test --manifest-path rust/pyac-vliw-core/Cargo.toml executes_explicit_six_lane_float_vector_from_its_length_word`

Run live GPU checks through Housekeeper. A non-empty queue is normal; preserve
the queue and report queued work separately from terminal test results. The
SWAC RTX 3060 was not used for this entry; no compilation or GPU test was run
there.

## 2026-11-19: Instrumented CPU/GPU Timing and Artifact Record

This is the instrumented rerun of the live matrix above. It writes a complete,
parser-valid Pyash record automatically, including per-request timings and
artifact fingerprints, whether the test passes or fails.

**Run record:** `artifacts/20261119-0002-rust-vliw-conformance/result.pya`

| Measurement | CPU reference | GPU / Housekeeper |
| --- | ---: | ---: |
| Codelet batch, 26 cases | 68.258 ms | 30,057.372 ms client round trip; 102 ms queued; 28,875 ms active |
| Sectioned programlet batch, 18 cases | 63.630 ms | 13,017.561 ms client round trip; 301 ms queued; 11,618 ms active |
| Division-by-zero expected error | 64.089 ms | 10,017.997 ms client round trip; 24 ms queued; 8,800 ms active |
| Constant-write expected error | 58.374 ms | 5,010.881 ms client round trip; 115 ms queued; 3,633 ms active |
| Total conformance run | - | 58,796.957 ms wall time |

CPU timings are the individual reference-process request durations. GPU client
round trip includes submission and Housekeeper polling; queued time and active
time come from the durable Housekeeper job record. Active time is not a
kernel-only measurement, so these values should not be presented as raw GPU
compute latency.

### Executable and Pipeline Artifacts

| Artifact | Size | SHA-256 / detail |
| --- | ---: | --- |
| CPU reference executable, `rust/pyac/target/debug/examples/vliw_reference` | 10,080,696 bytes (9.61 MiB) | `65aa18cee93137887139673c5bc96efa289fd32b596e2fd5f723153eab193896` |
| Deployed GPU runtime executable | 9,028,048 bytes (8.61 MiB) | `56e6a7fc39d4ba27ad36c36d809e1e497ceedf60199135d4ae94330813fca4a1` |
| Deployed GPU worker executable | 7,354,440 bytes (7.01 MiB) | `5f52d858890bd1687217b6ca39f4361a166fbe5994e70959a68e6e4a5ee47bb0` |
| SPIR-V compute shader | 2,678,260 bytes (2.55 MiB) | `2de5a97441d3c938284b8afa3a9251465619467aa7446091a74dd2bc37475d61` |
| Vulkan pipeline cache | 9,855,807 bytes (9.40 MiB) | `ca957cf6566ccf6e44590570597cc396d6bda1a53f27b9ca7d2f6b4a077f8aac` |

The pipeline-cache build took 42.31 seconds (pack 5.82 s, programlet 18.69 s,
sections 17.64 s) during deployment. The measured runtime pipeline-cache load
and initialization for this run took 0.87 s total: pack 0.23 s, programlet
0.25 s, sections 0.23 s. These are separate phases: cache generation is a
deployment build step, while the 0.87-second measurement is cached runtime
initialization.

The report also records the source revision and dirty-tree patch hash, GPU and
driver, runtime image/container identity, request timestamps and queue handles,
case outcomes, and artifact sizes/hashes. Future invocations of
`node command/vliw_gpu_conformance.mjs` write a new dated `.pya` record under
`artifacts/`; see `container/pyac-vliw-runtime/README.md` for the record
contract and deployment build log location.

### Timing Interpretation: Run `20261119-0003`

The GPU's apparent 67-second and 175-second request times are not GPU execution
times. The instrumented Vulkan service reports:

| Work | CPU reference wall | Vulkan compute pass | GPU service total | Housekeeper client round trip |
| --- | ---: | ---: | ---: | ---: |
| Codelet batch, 26 cases | 66.117 ms | 0.142 ms | 21.952 ms | 67,118.597 ms |
| Sectioned programlet batch, 18 cases | 66.207 ms | 61.089 ms | 62.177 ms | 175,259.228 ms |
| Division-by-zero error | 68.850 ms | 0.245 ms | 0.876 ms | 17,030.798 ms |
| Constant-write error | 73.454 ms | 0.246 ms | 1.056 ms | 18,032.661 ms |

The measurements show that the small codelet workload is inexpensive on GPU,
while the sectioned programlet workload's GPU pass is roughly the same scale as
the complete CPU reference request. These are not perfectly equivalent timing
boundaries: CPU values include process/runtime overhead; Vulkan values separate
GPU pass time from service setup/readback. This run does not establish a broad
GPU speedup for small workloads.

It does establish that the multi-second client latency is outside measured
Vulkan service execution. The old report's `queue wait` was only the local Pyash
worker's queue interval, and its `active` interval mixed local worker start with
the remote Housekeeper completion timestamp. Those fields could not identify
Housekeeper queue delay separately from its active interval. The GPU handle
record now preserves the Housekeeper job ID and its own submitted/started/
finished timestamps; future reports emit local queue, worker wall, remote queue,
and remote active durations as distinct fields. Runtime timings nested inside
Housekeeper error messages are also extracted, so subsequent expected-error
records will include the kernel and service measurements already present in
this run's raw handle records.

The exact source of the long Housekeeper round trip remains unresolved by run
`20261119-0003`: the Rust service took at most 62.177 ms, but this run did not
retain the remote Housekeeper timestamps needed to attribute the remainder to
remote queueing versus Housekeeper dispatch/HTTP handling. Use the newly split
timestamps on the next conformance run before changing GPU execution or
scheduler behavior.

## 2026-11-19: `kl6m psas` Dot Product

**Run record:** `artifacts/20261119-0004-rust-vliw-conformance/result.pya`

| Field | Evidence |
| --- | --- |
| Source revision at run | `00b4843f68ad8c6f58a0a2a5ac42954183bad8df`, dirty working tree |
| Host and route | Mriczo, Pyash GPU Housekeeper -> `pyac-vliw-runtime` -> Rust-GPU Vulkan |
| GPU | NVIDIA GeForce RTX 3090, driver `550.163.01`, 24,576 MiB |
| Runtime image | `sha256:429523feea2bb62b2198ed7b05d808cdc2accfde61e5d6c08dba183e559a819f` |
| Live conformance | 46/46 cases passed; both isolated expected-error cases passed |
| Dot-product values | float32 `[1,2,3] · [4,5,6] = 32`; float64 `[0.1,2,-3] · [0.2,4,-5] = 23.02` |
| CPU batch wall | 111.518 ms for 28 codelet cases; 107.989 ms for 18 programlet sections |
| GPU compute pass | 0.144672 ms for the codelet batch; 60.949952 ms for programlet sections |
| GPU client round trip | 7,050.046 ms for codelets; 17,030.845 ms for programlet sections |
| Full run wall time | 54,372.145 ms, including two expected-error checks |
| Pipeline-cache generation | 120.05 s for all three pipelines; generated before runtime replacement |
| Runtime executable | 9,084,608 bytes; SHA-256 `ed69ba7d730001e88f79353d071a47eea775e3211ba25e53308b5419ba12ab42` |
| GPU worker executable | 7,393,288 bytes; SHA-256 `8f56b3334d7ff8b4bdabed9e70e0566eae496417a62bb20f986925b6c320ebbd` |
| SPIR-V shader | 2,732,480 bytes; SHA-256 `2e0a1a00a205e7272d6a9f2c88c852f2762f81e29686efc2bf20eb3472f8a3ca` |
| Pipeline cache | 10,061,392 bytes; SHA-256 `6c5ee31112bc9715fa130982fb24a75a32829cbee17663014ac76dc5f647abb5` |

The dot-product sentence was exercised through Pyash lowering, packed VLIW,
Rust CPU reference, and the live Vulkan worker. After separating the
`shader-f64` capability for native Vulkan from the WebGPU build, regenerating
the Vulkan shader produced the same SPIR-V hash recorded by this live run. The
WGSL build omits native 64-bit shader types and rejects float64 dot products;
float32 dot products remain supported there. Housekeeper idled the VLIW
container after the run; the next managed request starts it on demand.

## 2026-11-20: Mutable Prediction Vector

**Run record:** `artifacts/20261120-0002-rust-vliw-conformance/result.pya`

| Field | Evidence |
| --- | --- |
| Source revision | `616b6313a4ee03dc2926fed38da08bd8593c67d7`, dirty tree; run patch SHA-256 `c409c7fb7adba4d19ab544033b892d1d911fd17dcd3bbc1164aa0207ed226e9e` |
| Host and GPU | Mriczo; RTX 3090, driver `550.163.01`, 24,576 MiB |
| Runtime image | `sha256:47f1c4f9be0abc1c8020bd03efdfe0aec5830c1c534fad70a7a6d496b2a1d18a` |
| Live GPU results | 47/47 cases passed, including mutable-vector dot-product collection; 2/2 expected errors passed |
| Run wall time | 6,604.662 ms |
| CPU batches | 29 codelet cases: 60.532 ms; 18 sections: 55.366 ms |
| GPU kernel | Codelet batch: 0.609 ms; section batch: 67.285 ms |
| GPU client round trip | Codelet batch: 3,011.818 ms; section batch: 1,004.206 ms |
| Pipeline-cache generation | 74.05 s total: pack 37.22 s, programlet 18.85 s, sections 17.65 s |
| Executables | CPU reference 10,168,568 bytes; GPU runtime 9,086,432 bytes; GPU worker 7,394,016 bytes |
| GPU artifacts | SPIR-V 3,440,244 bytes; persisted pipeline cache 12,609,996 bytes |

The new case declares `prediction` as zero-initialized mutable float32 state,
writes three dot-product results to indexed lanes, then passes that vector to
`pluk tlas`. CPU and GPU both produce `[5,4,3]` and an exact-match count of 3.
The result vector is `[5,4,3]`, with exact-match count `3`. Complete hashes,
per-request queue/service/kernel timings, and the case list are in the `.pya`
run record.

## 2026-11-20: IWSP Linear Scorer CPU/GPU Slice

**Run record:** `artifacts/20261120-0005-rust-vliw-conformance/result.pya`

| Field | Evidence |
| --- | --- |
| Source revision | `c7a42a2f61d64474422274c2a34320b0bbae1090` plus dirty patch SHA-256 `2ec097e85060739d732d2e044a149d072f9ac5c4dc6b4db6d39c3614b69de61e` |
| Host and route | Mriczo, Pyash GPU Housekeeper -> `pyac-vliw-runtime` -> Rust-GPU Vulkan |
| GPU | NVIDIA GeForce RTX 3090, driver `550.163.01`, 24,576 MiB |
| Live conformance | 49/49 valid cases passed; 2/2 expected runtime errors passed |
| IWSP baseline | Prediction `[5,4,3]`; exact-match score `3/3` on Rust CPU and RTX 3090 |
| IWSP mutation | Changed third weight `[3,0]` to `[2,0]`; prediction `[5,4,2]`; score `2/3` on Rust CPU and RTX 3090 |
| Full conformance wall | 32,684.886 ms |
| CPU batch wall | 31 codelet cases: 57.891 ms; 18 programlet sections: 57.246 ms |
| Vulkan kernel time | Codelet batch: 2.398976 ms; section batch: 60.768576 ms |
| Client round trip | Codelet batch: 4,014.266 ms; section batch: 24,036.924 ms |
| Runtime startup | 1.27 s with the persisted cache loaded; below the 60-second ceiling |
| Pipeline-cache generation | 120.45 s total: pack 83.28 s, programlet 19.60 s, sections 17.27 s; deployment/build step only |
| Executables | CPU reference 10,181,624 bytes; GPU runtime 9,086,096 bytes; GPU worker 7,393,808 bytes |
| GPU artifacts | SPIR-V 4,015,496 bytes; pipeline cache 14,598,161 bytes |
| Runtime image | `sha256:8c165192ef7f0b951cd7bfb204fe2c03cd399d9818b96df8e43cbb9aa4936462` |

The scorer and deliberately degraded candidate were included in one GPU
codelet batch using distinct named bindings. The separate reference-answer
vector stayed `[5,4,3]`, so the `2/3` result demonstrates that the judge
distinguishes the changed candidate rather than changing its target along with
the candidate.

GPU compute is not a speed claim for this tiny scorer: the codelet batch took
2.399 ms in the Vulkan timestamp interval, while the CPU reference batch took
57.891 ms including process/runtime overhead. The section batch's 24.037-second
client round trip is also much larger than its 61 ms service/kernel interval;
this run records that latency but does not explain it. Evaluator isolation,
held-out data, and protected task scoring remain Stage 2 work.
