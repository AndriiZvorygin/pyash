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
