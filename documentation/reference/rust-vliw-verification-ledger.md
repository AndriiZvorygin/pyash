# Rust VLIW Verification Ledger

Use this file as the lookup record for Rust VLIW CPU/GPU conformance runs. Each
entry records the repository revision, deployed artifact, host/device, route,
and exact test outcome. A queued or timed-out job is not a passing test.

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
