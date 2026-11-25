# Rust VLIW Verification Ledger

Use this file as the lookup record for Rust VLIW CPU/GPU conformance runs. Each
entry records the repository revision, deployed artifact, host/device, route,
and exact test outcome. A queued or timed-out job is not a passing test. Entries
are historical: compare the recorded source revision with `git rev-parse HEAD`
before assuming the deployed artifact matches the checkout.

## 2026-11-25: Combined build-and-deploy command

Exercised the documented one-command path from the committed tree:
`bash container/pyac-vliw-runtime/command/build.sh mriczo deploy`. The build was
cache-warm (the worker stage finished in 8 s) and produced the same cubin hash;
the canary ran the full matrix and retained the new image. This confirms the
script path end to end, not just the build and canary separately.

| Field | Evidence |
| --- | --- |
| Run record | `artifacts/20261125-0012-rust-vliw-conformance/result.pya` |
| Source revision / checkout | `531e01bd240b9f4128cbbdb19d8e3bb120ef44ca`; tracked tree dirty during build (unrelated untracked files) |
| Host and route | Mriczo client -> Mriczo Housekeeper -> `rust-cuda-cubin` |
| GPU | NVIDIA GeForce RTX 3090 |
| Runtime image | `sha256:755f9531b0451a6e59a86b2b3bdce4fdf1852d1a8b5d00c3a0216644f8c1f90f` (`liberit/pyac-vliw-runtime:cuda-sm86-a99e5a3a2bcaf400`) |
| Cubin | 3,866,952 bytes; SHA-256 `a99e5a3a2bcaf40011409ad217df2c54919e466000eff8b0051c3263f329b820` |
| Runtime executable | 9,312,752 bytes; SHA-256 `f3b06fbd5db36ee4d152c672c8b772786245f2e2594316e2ce179ae983ba3966` |
| Runtime initialization | Cubin load and GPU initialization 0.09 s; ready in 1,013 ms |
| Full verification | 79/79 value cases passed (45 codelet, 34 programlet); 3 typed-dispatch probes; 5/5 expected errors matched |
| CPU batches | Codelet batch: 62.771 ms; programlet sections: 67.939 ms |
| CUDA event batches | Codelet batch: 12.464 ms; programlet sections: 88.107 ms |
| Housekeeper client round trips | Codelet batch: 1,133.131 ms; section batch: 1,133.750 ms |
| Total run wall | 13,692.524 ms |
| Deployment | Retained on Mriczo; prior image `sha256:4cda8d9404573b5705e9e9d203de25a5c410dae4e054ad0b954f206a6034e0e2` is the rollback target |
| Rollback | `bash container/pyac-vliw-runtime/command/cuda-canary.sh mriczo liberit/pyac-vliw-runtime:cuda-sm86-a99e5a3a2bcaf400 rollback` |

## 2026-11-25: Dockerized cubin build and redeploy

The CUDA cubin and worker binary are now built inside the image build rather
than by a host pre-step. `container/pyac-vliw-runtime/Dockerfile.cuda` has a
`kernel-builder` stage (pinned nightly, `rust-src`, `llvm-tools`,
`llvm-bitcode-linker`, host `ptxas` through a named build context) and a minimal
runtime stage that copies only the artifacts. The build script
`container/pyac-vliw-runtime/command/build.sh` builds, tags by cubin hash, and
optionally runs the canary. The worker build receives
`PYAC_VLIW_BUILD_CUBIN_SHA256`, which it requires at startup.

| Field | Evidence |
| --- | --- |
| Run record | `artifacts/20261125-0011-rust-vliw-conformance/result.pya` |
| Source revision / checkout | `8f2df2afb788dbff991e321feb923a31c575dd6a`; tracked tree dirty during build |
| Tracked patch SHA-256 | `59e0cb3e2bf53370d9faae0e41e75fe34feb777851404a1174cd0a4891291981` |
| Host and route | Mriczo client -> Mriczo Housekeeper -> `rust-cuda-cubin` |
| GPU | NVIDIA GeForce RTX 3090 |
| Runtime image | `sha256:4cda8d9404573b5705e9e9d203de25a5c410dae4e054ad0b954f206a6034e0e2` (`liberit/pyac-vliw-runtime:cuda-sm86-a99e5a3a2bcaf400`) |
| Cubin | 3,866,952 bytes; SHA-256 `a99e5a3a2bcaf40011409ad217df2c54919e466000eff8b0051c3263f329b820` |
| Runtime executable | 9,312,752 bytes; SHA-256 `f3b06fbd5db36ee4d152c672c8b772786245f2e2594316e2ce179ae983ba3966` |
| CPU reference executable | 16,700,120 bytes; SHA-256 `006a9b0f25559460ef6293ed088464cc0b9fe8a86193d9654cb93672cdb5f443` |
| Runtime initialization | Cubin load and GPU initialization 0.09 s; ready in 529 ms |
| Full verification | 79/79 value cases passed (45 codelet, 34 programlet); 3 typed-dispatch probes; 5/5 expected errors matched |
| CPU batches | Codelet batch: 64.144 ms; programlet sections: 68.905 ms |
| CUDA event batches | Codelet batch: 12.327 ms; programlet sections: 88.038 ms |
| Housekeeper client round trips | Codelet batch: 1,139.148 ms; section batch: 1,140.302 ms |
| Total run wall | 13,713.187 ms |
| Deployment | Retained on Mriczo; prior image `sha256:fcf8808f70e71cb8d8678c1c6a60743ed7f4bd3f9476c8eaf55e9b20d50b68bf` is the rollback target |
| Rollback | `bash container/pyac-vliw-runtime/command/cuda-canary.sh mriczo liberit/pyac-vliw-runtime:cuda-sm86-a99e5a3a2bcaf400 rollback` |

Build note: the first image from this Dockerfile started but exited with "CUDA
worker was not built with a packaged cubin hash"; the canary restored the prior
runtime, and the worker step now exports the cubin digest from the builder
stage. The build also requires `--network=host` on Mriczo because the builder's
embedded DNS cannot resolve the package archive.

## 2026-11-25: Programlet-Local Embedding Attention

The programlet `tsoc hsat` action now selects a row from the file-backed
embedding table using a token ID read from an immutable rank-one sequence, then
copies that row into a declared local float vector. The Pyash programlet uses
those local vectors for explicit query/key/value projections, stable softmax,
and weighted value addition. Changing one embedding-table value changes the
final result, proving the computation consumes the payload rather than a baked
constant. This is a small feature-based attention proof, not a trained WSD
model or benchmark score.

| Field | Evidence |
| --- | --- |
| Run record | `artifacts/20261125-0007-rust-vliw-conformance/result.pya` |
| Example | `examples/vliw/iwsp-embedding-attention.pya`; baseline output `[0.5, 0.5]`; changed table output `[0.5, 1.5]` |
| Source revision / checkout | `09d93b93165fb63ebeee27d7ab43e90ea355dbe7`; tracked tree was dirty during build |
| Tracked patch SHA-256 | `f7b8e042e3bb02817e40811cdb6570437f2a4c5640e1ec4140fe1ce7bbe0b51e` |
| Host and route | Mriczo -> Mriczo Housekeeper -> temporary Rust CUDA VLIW runtime |
| GPU / driver | NVIDIA GeForce RTX 3090, driver `550.163.01`, 24,576 MiB |
| Candidate CUDA image | `sha256:cf27b3e4d10cd055b302979a198aa15b2712279034b00272117f255195b5c600` |
| Live conformance | 79 matrix cases and 3 positive typed-dispatch probes passed; all 6 expected errors matched |
| Full run wall | 14,532.415 ms |
| CPU reference batches | 45 codelet cases: 65.962 ms; 34 programlet sections: 68.074 ms |
| CUDA event batches | Codelets: 12.358 ms; programlet sections: 135.071 ms |
| Housekeeper client round trip | Codelets: 1,137.658 ms; programlet sections: 1,133.678 ms |
| Build time | Rust-GPU compile: 9.14 s; `ptxas`: 47.48 s, 584,120 KiB peak RSS |
| GPU runtime executable | 9,320,760 bytes; SHA-256 `d53932f03b736f619dbcef05639b9603d1e5c36ab18e4d41d922bd8088b37017` |
| CUDA cubin | 3,700,808 bytes; SHA-256 `75e2d616e78cc6c7c0f7b82d0ad178099d972664dfd95c779c3725d5eabc1a66` |
| CPU reference executable | 16,696,136 bytes; SHA-256 `a31ccc9eeca2fa9227e574d37020f393c091169d7839042dbbce4f52fc580da8` |
| CUDA initialization / readiness | Cubin initialization: 0.12 s; canary ready: 763 ms |
| Runtime after verification | Prior image `sha256:9889f729ae7906a324915dac8b25c0c5c78b2f6db708f5b6d675866381dbb940` restored and running; Housekeeper queue empty |

The candidate image was tested with the full conformance matrix and then
restored; it was not retained as Mriczo's active image. The build and run
artifacts remain in ignored `rust/pyac-gpu/cuda-kernel/target/` and `artifacts/`
paths. The matrix's two embedding-attention cases share the single programlet
section batch with all other section cases.

## 2026-11-25: Bitmap-derived sentence decode

The shared Rust decoder now derives sentence fields from the codelet head
bitmap. A clause-free sentence is decoded by enumerating boundary slots and
classifying only those tokens; a sentence with nested-clause markers takes the
clause-aware pass. The previous token-by-token state machine is retained only as
a test oracle. A differential test compares error code, field spans, verb span,
and mood over fixtures, deterministic corruptions, and a fixed-seed random
corpus.

The previously deployed CUDA cubin (`sha256:9889f729...`) failed programlet
section 15 (`iwsp-file-backed-embedding-attention-perturbed-values`) on the
current 34-section matrix with shared error 3. Rebuilding from the current source
and redeploying passes that section and the whole matrix, so the failure was a
stale deployed artifact, not a semantic regression.

| Field | Evidence |
| --- | --- |
| Run record | `artifacts/20261125-0010-rust-vliw-conformance/result.pya` |
| Source revision / checkout | `8b470488d49cf1198dbc50629ef8aa6829afa9fc`; tracked tree dirty during build |
| Tracked patch SHA-256 | `37ac7ca68b4ed9aeafde744866c390559890197bedab607588346201d82cd954` |
| Host and route | Mriczo client -> Mriczo Housekeeper -> `rust-cuda-cubin` |
| GPU | NVIDIA GeForce RTX 3090 |
| Runtime image | `sha256:fcf8808f70e71cb8d8678c1c6a60743ed7f4bd3f9476c8eaf55e9b20d50b68bf` (`liberit/pyac-vliw-runtime:cuda-sm86-c711501a97da5319`) |
| Cubin | 3,878,216 bytes; SHA-256 `c711501a97da53193c7fd33456c1476a236615192b3c8a9720861fb99ee54848` |
| Runtime executable | 9,309,760 bytes; SHA-256 `4bb59c760194018ec13085e278fdea255d218debdeefad8348fe407abdacec37` |
| CPU reference executable | 16,699,368 bytes; SHA-256 `77d3e1858d7611035884104897316cce7c501fcf9ef350747fb80216e990d62a` |
| Runtime initialization | Cubin load and GPU initialization 0.09 s; ready in 513 ms |
| Full verification | 79/79 value cases passed (45 codelet, 34 programlet); 3 typed-dispatch probes; 5/5 expected errors matched |
| CPU batches | Codelet batch: 63.833 ms; programlet sections: 67.110 ms |
| CUDA event batches | Codelet batch: 12.288 ms; programlet sections: 91.685 ms |
| Housekeeper client round trips | Codelet batch: 1,129.571 ms; section batch: 1,130.997 ms |
| Deployment | Retained on Mriczo; prior image `sha256:9889f729ae7906a324915dac8b25c0c5c78b2f6db708f5b6d675866381dbb940` is the rollback target |
| Rollback | `bash container/pyac-vliw-runtime/command/cuda-canary.sh mriczo liberit/pyac-vliw-runtime:cuda-sm86-c711501a97da5319 rollback` |

Batch timings cover the complete case sets, not per-operation latency. This run
establishes semantic conformance and hardware parity; it is not a speedup claim.

## 2026-11-25: Payload-Selected Embedding Row

The embedding-row operation now accepts either its existing literal uint16
row or `at name lwat txik`, which reads one token ID from an immutable,
one-element rank-one `number_` storage section. The conformance fixture supplies
index `1`, selects row 1 of a 3x20 float32 table, and the existing dot-product
sentence returns `40` on both the Rust CPU reference and the live CUDA worker.
The selector is payload data; no runtime index map or tensor copy is built.

| Field | Evidence |
| --- | --- |
| Run record | `artifacts/20261125-0004-rust-vliw-conformance/result.pya` |
| Source revision / checkout | `4f2ed0eaf15ec9aca3c9f71ea37f26cc05edd481`; tracked tree was dirty during build |
| Tracked patch SHA-256 | `b8a1c4d7764e9a104bf65392e771ea324c82e93980d74f21b8f3a26250630a96` |
| Host and route | Mriczo client -> Mriczo Housekeeper -> temporary Rust CUDA VLIW canary |
| GPU / driver | NVIDIA GeForce RTX 3090, driver `550.163.01`, 24,576 MiB |
| Runtime image | `sha256:e9d22dc233e795b35a3606d1cd7f09e78d89e2c071738ba5b7fe2a4b0c331653` |
| Runtime executable | 9,315,920 bytes; SHA-256 `2f5a4daadc640d897b9513bf19a33bb24c0d175768d420fad540fab99037148f` |
| Cubin | 3,448,520 bytes; SHA-256 `1fc07d52d141910c736e9c2ba38084a0598f8f30506edd70afd9caac3f00e66a` |
| CPU reference executable | 16,580,848 bytes; SHA-256 `f5dc1f4f7b4ca2887dd0539dab2907afeca9111aa4edd1f8c92f8abb5375da3d` |
| Runtime initialization / readiness | Cubin load 0.09 s; worker ready in 615 ms |
| Full verification | 77/77 ordinary cases passed (45 codelet, 32 programlet), 3 typed-dispatch positive probes passed, and 6/6 expected errors matched; 13,442.304 ms total |
| CPU request batches | Codelet batch: 62.032 ms; programlet batch: 63.535 ms |
| CUDA event batches | Codelet batch: 12.344 ms; programlet batch: 121.301 ms |
| Housekeeper client round trips | Codelet batch: 1,129.052 ms; programlet batch: 1,126.719 ms |
| New dynamic result | `number_` payload index `1` -> embedding row `1` -> dot product `40` on CPU and RTX 3090 |
| Deployment verification | `artifacts/20261125-0005-rust-vliw-conformance/result.pya`; source revision `87a1d0f5516cdf240f7b92c634168ad4321c1c69`; 80/80 value/dispatch cases and 6/6 expected errors passed in 13,537.143 ms |
| Persistent deployment | Retained on Mriczo as `rust-cuda-cubin`; same image and cubin as above, cubin load 0.09 s, worker ready in 594 ms; post-run Housekeeper queue depth 0 |
| Rollback | Prior runtime image `sha256:97268cf465fa3af513478bf72a608f0799340882d85a36d7104fbb06e9fe58fa`; use `bash container/pyac-vliw-runtime/command/cuda-canary.sh mriczo liberit/pyac-vliw-runtime:cuda-sm86-1fc07d52d141910c rollback` |

Batch timings include the complete listed case sets; they are not per-operation
latencies. The six expected errors comprise one absent overload and five
programlet/runtime guard cases. The final image and evidence are kept in the
ignored CUDA build target and local `artifacts/` directory respectively. The
first verification was a restoring canary; the follow-up deployment verification
above retained the tested image as the active Mriczo runtime.

## 2026-11-25: Payload-backed Matrix-Vector Dot Product

Rank-two immutable float storage now feeds the existing Pyash `kl6m psas`
sentence. Three indexed sentences selected rows 0, 1, and 2 from a 3x4
row-major matrix and returned `[1, 2, 7]`, matching the Rust CPU reference.
This verifies the matrix-vector primitive and storage-shape descriptor on the
GPU; it is not a BERT-WSD inference or Criterion score.

| Field | Evidence |
| --- | --- |
| Run record | `artifacts/20261125-0002-rust-vliw-conformance/result.pya` |
| Source revision / checkout | `07fac6cbc4bd45e5aea9571560d6433808dcf065`; tracked tree was dirty during build |
| Tracked patch SHA-256 | `f6aa630236d981a3dd426c3807a20697e123e707349526cfdda62db0f6d19f00` |
| Host and route | Mriczo client -> Mriczo Housekeeper -> Rust CUDA VLIW runtime |
| GPU / driver | NVIDIA GeForce RTX 3090, driver `550.163.01`, 24,576 MiB |
| CUDA image | `sha256:97268cf465fa3af513478bf72a608f0799340882d85a36d7104fbb06e9fe58fa` |
| Runtime executable | 9,321,128 bytes; SHA-256 `73c455f08098407ae9772ce2a4e939d317db26b531bbb14f88ff23549dd2da19` |
| Cubin | 3,347,144 bytes; SHA-256 `3f1f4a6befadb4007364f2dc5c27fcfe6f9fff823e3e0c011ce3cd7fffbef83d` |
| Build timing | Rust-GPU compile 7.91 s; `ptxas` 40.07 s wall, 503,552 KiB peak RSS |
| Runtime initialization | Cubin/GPU initialization 0.09 s; ready in 561 ms |
| Full verification | 76/76 value cases and 5/5 expected errors passed; 13,433.372 ms total |
| CPU request batches | 44 codelet cases: 57.374 ms; 32 programlet sections: 64.739 ms |
| CUDA event batches | 44 codelet cases: 4.364 ms; 32 programlet sections: 121.093 ms |
| Housekeeper client round trips | Codelet batch: 1,129.983 ms; section batch: 1,124.937 ms |
| New matrix-vector result | f32 input `[1,2,3,4]` and row-major 3x4 matrix -> `[1,2,7]` on CPU and RTX 3090 |
| Route after run | New CUDA worker retained on Mriczo; Housekeeper queue depth 0, dispatch active |

The two CUDA batch timings cover all codelet and section cases respectively;
they are not isolated per-case matrix-vector latency. Housekeeper round trips
include its request and polling overhead. No WSD prediction files were scored
against the five Raganato datasets in this run.

## 2026-11-25: Minimal Feature-Based Bank-Sense Selection

The Stage 9 example performs prototype-based selection from explicit
float32 context features. It scores two named prototypes with the Pyash dot
product, stores those scores in a prediction vector, and selects the maximum
index. Financial context selects WordNet 2025 `n:08437235-n`; river context
selects `n:09438462-n`; the tie case selects the first prototype. The exact
example was lowered and run through the Rust CPU reference, and the corresponding
three cases were included in the complete CUDA matrix. This demonstrates the
VLIW operations needed for a tiny WSD-style classifier; it is not a raw-text
encoder or a trained WSD network.

| Field | Evidence |
| --- | --- |
| Run record | `artifacts/20261125-0001-rust-vliw-conformance/result.pya` |
| Source revision / checkout | `0ef2c26a979f0c56a40abe0fd02d4dfc7ccd46ab`; working tree was dirty during run |
| Tracked patch SHA-256 | `7ae3ebc33796b10e2bc66fc8f04f33296b5267a65988816ec52e4662cd3b73d8` |
| Host and route | Mriczo client -> Mriczo Housekeeper -> Rust CUDA VLIW runtime |
| GPU / driver | NVIDIA GeForce RTX 3090, driver `550.163.01`, 24,576 MiB |
| CUDA image | `sha256:178b01c665acda2ccc0a1b98451a88590862e1ccbef1d541ee3a22a01bf9d776` |
| Runtime executable | 9,318,808 bytes; SHA-256 `842161492eaf571b4a48a06343cdf57ad4dd72e61f4163da7a34800df7925c0f` |
| Cubin | 3,341,128 bytes; SHA-256 `671d89f3e45fede729d064cd5f56960ec407ea86da7e59dfeb6dfb631e8eb167` |
| CPU reference executable | 16,528,720 bytes; SHA-256 `28b62c2aba3a535318d855215f19e2b05d43262fd37f060ca196210f690032a8` |
| Runtime readiness | CUDA cubin load and GPU initialization: 0.09 s; worker ready in 603 ms |
| Full verification | 78 successful value/dispatch results and 6 expected errors; 13,442.122 ms total |
| CPU request batches | 43 codelet cases: 58.339 ms; 32 programlet sections: 65.659 ms |
| CUDA event batches | 43 codelet cases: 4.302 ms; 32 programlet sections: 121.096 ms |
| Housekeeper client round trips | Codelet batch: 1,132.205 ms; section batch: 1,129.534 ms |
| WSD case outputs | Financial `[1, 0.25]` -> scores `[1, 0.25]` -> index `0`; river `[0.25, 1]` -> `[0.25, 1]` -> index `1`; tie `[1, 1]` -> `[1, 1]` -> index `0` |
| Route after run | New CUDA worker retained on Mriczo; Housekeeper queue drained to zero and dispatch resumed |
| Idle restart check | After idle shutdown (container exit `137`, `OOMKilled=false`), Housekeeper restarted the worker for river-context job `job-6a0e0e58b76a`; it returned index `1` on the RTX 3090 (CUDA event 2.735 ms, client round trip 1,184.338 ms) |

The CPU/GPU event batches cover the full conformance workloads, not isolated
WSD latency. Client round trips include Housekeeper and transport overhead;
these numbers establish correctness and artifact provenance, not a speedup claim.

## 2026-11-24: Minimal Role-Projected Transformer Block

Stage 8 of the IWSP roadmap now has an executable Pyash-level block. It composes
the existing role-projected attention with residual addition, population
LayerNorm, ReLU, a two-neuron feed-forward projection, a second residual, and a
second LayerNorm. The block is intentionally only two features wide; this is a
correctness/conformance milestone, not a performance claim.

| Field | Evidence |
| --- | --- |
| Run record | `artifacts/20261124-0011-rust-vliw-conformance/result.pya` |
| Source revision / checkout | `18bd03d6a7c5ca2a740c5f5ce8058243bdc8819c`; working tree was dirty during build |
| Build-time patch SHA-256 | `1d75b5e76844ac63ba25542f0ab2e279cb851f85e54dccae0a204d344866c9a5` |
| Conformance-time patch SHA-256 | `31d38dfdcb661f2a85c512b3c262bc979a38a8af758912972bf78cd2b9fa2b58` |
| Host and route | Mriczo client -> Mriczo Housekeeper -> Rust CUDA VLIW runtime |
| GPU / driver | NVIDIA GeForce RTX 3090, driver `550.163.01`, 24,576 MiB |
| CUDA image | `sha256:a73bae1de284227dc32813edbb808f4c52836786a1934bce40c404cc0202f31a` |
| Runtime executable | 9,318,864 bytes; SHA-256 `fa8db546ec349de0a2d5ae0616d56ec552a815273bb04db20e4a97ec99a05fce` |
| Cubin | 3,283,400 bytes; SHA-256 `c478d27bd9478c6a1c67de96b0a21f2faf440cad578b7f0c79cbb07cc2b35acb` |
| CPU reference executable | 16,515,512 bytes; SHA-256 `44f7403eec0a1355fedf14979510e5ffa1704a49979bf5d1f5d80fce71ea3e04` |
| Build time | Rust-to-PTX succeeded; `ptxas` took 77.37 s wall and peaked at 503,424 KiB RSS |
| Runtime readiness | Cubin/GPU initialization 0.11 s; worker ready in 771 ms |
| Full verification | 72 value cases, 3 typed-dispatch successes, 1 missing-overload error, and 5 expected programlet errors passed; 13,443.653 ms total |
| CPU request batches | 40 codelet cases: 55.915 ms; 32 programlet sections: 64.684 ms |
| CUDA event batches | 40 codelet cases: 1.322 ms; 32 programlet sections: 121.603 ms |
| New block outputs | Ordinary input `[-1, 1]`; zero-variance input `[0, 0]`; CPU and RTX 3090 agreed |
| Float64 primitive | Dot product of `[3,4]` with `[3,4]`, then `dwic kwap`, returned `5` on CPU and RTX 3090 |
| Route after run | Updated CUDA worker retained on Mriczo; Housekeeper queue empty and VLIW route ready |

The block's small workload runs slower as one GPU programlet batch than on the
CPU reference (121.603 ms versus 64.684 ms). The result validates semantics and
hardware parity only; it does not establish a GPU speedup for tiny workloads.

## 2026-11-24: Borrowed `u16` Input and CUDA Pack Upload

The PyAC pack format remains v1: codelet payloads are sixteen `u16` words.
The CPU interpreter now reads those words directly, the shared core accepts
both `u16` and `u32` sources while widening only an individual word at
semantic access, and CUDA uploads the original pack payload bytes without a
pack-sized `u32` expansion. Dispatch metadata and result buffers remain
`u32`; WebGPU converts at its existing `u32` storage-buffer boundary.

| Field | Evidence |
| --- | --- |
| Run record | `artifacts/20261124-0003-rust-vliw-conformance/result.pya` |
| Source revision | `e63ad0f1a052fa9bf61abba60dbb8c67850a9388` plus tracked patch SHA-256 `75f310856e1917b544a49bd1bee83d1ab5e20e37231f6c9f0d1330048e0965fd` at canary build time |
| Build host / GPU host | Mriczo build and client -> SWAC Housekeeper -> Rust CUDA runtime |
| GPU | NVIDIA GeForce RTX 3060, driver `535.247.01`, 12,288 MiB |
| Runtime image | `sha256:28aaaf032af869b410ecca82a1e213b6c72bb2a413fcd67f48ad6468714da79b` |
| Cubin | 3,201,880 bytes; SHA-256 `e37447150fb9140a5c417baf13b4a7349925d9a9b36b0a94e8a8dcca4ba44938` |
| Runtime executable | 9,277,288 bytes; SHA-256 `317e898f34defb7044396520e0aca3f281350a2e92f812df88440100553cc674` |
| CPU reference executable | 16,019,616 bytes; SHA-256 `9495d84c78bd7a77dd2398439eb279bac30d651916f2053c55efec0f081cbad7` |
| Full run | 7,525.010 ms; 67 matrix cases and 3 standalone dispatch probes passed; both expected errors matched |
| CPU batches | 38 codelet cases: 58.217 ms; 29 sections: 65.578 ms |
| CUDA event batches | 38 codelet cases: 3.549 ms; 29 sections: 108.637 ms |
| CUDA client round trips | Codelet batch: 659.086 ms; section batch: 669.290 ms |
| Cold runtime | CUDA artifact loaded; runtime initialization 0.11 s; ready in 1.044 s |
| Container memory | 1 GiB limit; post-run sample 28.77 MiB |
| Route after verification | Prior CUDA runtime restored and ready; Housekeeper resumed dispatch |

This run covers the configured VLIW matrix, including float vectors, nested
dispatch, and attention. Targeted tests verify the borrowed pack view and exact
CUDA payload bytes; unaligned host packets use a host-side decoding copy only,
while the GPU still receives the original bytes. The `.pya` run record holds
per-request timings and Housekeeper job IDs.

## 2026-11-23: Pyash Role-Projected Attention

**Run record:** `artifacts/20261123-0013-rust-vliw-conformance/result.pya`

| Field | Evidence |
| --- | --- |
| Source revision | `1353c70559fdef4005e53727d3ad182bc8c1e2a2` plus tracked working patch SHA-256 `8f53a6639c7e0eb383114fa657b2d689fcf2a4ef4aee5457835d2cc48484189e` |
| New example source | SHA-256 `d0b72be5467595bc874b4d68c58b68a787e544b2ae070b2518ade8f46fffde73` |
| Host and route | Mriczo client -> SWAC Housekeeper -> Rust CUDA VLIW runtime |
| GPU | NVIDIA GeForce RTX 3060, driver `535.247.01`, 12,288 MiB |
| Runtime image | `sha256:2d3c8b52363ab8dac197015e468fabd32a6b3392495347771b685621304c9326` |
| Live conformance | 65 passing records (62 semantic cases and 3 typed-dispatch probes); 3 expected errors passed |
| New role-attention case | `iwsp-pyash-projected-attention`: Rust CPU and RTX 3060 both returned float32 vector `[3,5]` |
| Full run wall | 7,118.452 ms |
| CPU batches | 38 codelet cases: 56.418 ms; 24 programlet sections: 63.565 ms |
| CUDA event batches | Codelet batch: 3.784704 ms; programlet sections: 109.886467 ms |
| CUDA client round trips | Codelet batch: 667.877 ms; programlet sections: 682.051 ms |
| Runtime initialization | 0.11 s; persisted cubin was loaded (no compilation during service startup) |
| Executables | CPU reference 15,729,000 bytes; GPU runtime 9,248,544 bytes |
| GPU artifact | Cubin 3,046,232 bytes; SHA-256 `e969de24a9d55527e4036eae2f9a5b1e07c7e3901e04370abbda52e298d57aa4` |
| Queue after run | SWAC Housekeeper: zero queued/running jobs; dispatch active |

The new programlet uses the Pyash role names `hwas`, `htis hsek`, and `hnuc gjat`.
It forms two-lane role vectors from explicit `kl6m psas` sentences, computes the
two attention scores and stable-softmax weights, scales the named value vectors
in place, and adds them. The in-place writes keep the sample within the runtime's
eight-vector local-frame capacity; this is an example-level storage choice, not a
runtime-capacity change. The full run and per-request records are preserved in the
`.pya` run artifact above.

## 2026-11-23: Q/K/V Row Projection and Maximum Index

Commit `c73ee1628` adds the minimal Pyash Q/K/V projection composition and
typed maximum-index behavior. The committed cubin is byte-identical to the
cubin used in the earlier passing full CUDA run below: **64 passing records**
(3 standalone dispatch probes plus 61 batched semantic cases) and **3 expected
errors**. The new cases `iwsp-qkv-row-projections`,
`iwsp-maximum-index-float32`, and `iwsp-maximum-index-float64` all passed on the
RTX 3090. The Q/K/V example returns `[1, 5, 4]`; both argmax widths return the
first maximum index `1`.

| Field | Evidence |
| --- | --- |
| Source revision | `c73ee1628e8f9268b0cc9de9a4b40192edae23b2` |
| Successful live GPU run | `artifacts/20261123-0009-rust-vliw-conformance/result.pya`; source tree was dirty, but the cubin hash matches the clean committed build below |
| Successful conformance | 64 passing records; 3 expected errors; total run 6,451.196 ms |
| GPU and route | Mriczo, Housekeeper -> CUDA runtime; NVIDIA RTX 3090, driver `550.163.01`, 24,576 MiB |
| Build initialization | Cubin/runtime initialization 0.14 s; service ready within the canary startup bound |
| CPU batches | 38 codelet cases: 93.294 ms; 23 programlet sections: 77.064 ms |
| CUDA event batches | Codelet batch: 3.744 ms; programlet sections: 120.560 ms |
| Clean committed runtime | 9,248,544 bytes; SHA-256 `47eddabc3a5a999df168c0efeb97dd58d06e79808a03005825b6081d6bfea0e6` |
| Clean committed cubin | 3,046,232 bytes; SHA-256 `e969de24a9d55527e4036eae2f9a5b1e07c7e3901e04370abbda52e298d57aa4` |
| Clean image | `sha256:2d3c8b52363ab8dac197015e468fabd32a6b3392495347771b685621304c9326`; metadata says clean source revision `c73ee1628` |

The clean-image deploy attempt is separately recorded at
`artifacts/20261123-0010-rust-vliw-conformance/result.pya`. Runtime startup
passed in 0.974 s, but the first CUDA batch failed with `CUresult 2`. At that
time the Mriczo GPU was at 23,954/24,576 MiB, with a Python process using
23,616 MiB; the Housekeeper queue was empty. The canary automatically restored
the previous Mriczo image and confirmed it healthy. Therefore the clean image
is built and its cubin has full live-GPU conformance evidence, but it was not
retained on Mriczo because available VRAM could not support the batch.

An attempted SWAC canary did not alter that host: the safe canary guard found
its existing named runtime was an exited Vulkan image with no persisted
pipeline cache, so it could not serve as a verified rollback target. The
previously verified SWAC CUDA image is cached locally, but Housekeeper's
`/runtime/stop` request did not return despite an empty queue; that request was
cancelled and the Housekeeper remained healthy and accepting work. No GPU
conformance run or runtime replacement was claimed on SWAC. Resolve its
Housekeeper lifecycle-control issue or establish a verified rollback target
before retrying there.

### Clean committed-source verification on SWAC

After restarting SWAC Housekeeper to clear the stale runtime pause, the clean
committed CUDA candidate was installed behind a verified CUDA rollback
container and tested through the SWAC Housekeeper queue. The full configured
matrix passed: **61 batched semantic cases**, three typed-dispatch probes, and
all **3 expected errors**. This includes the Q/K/V row projections and both
float32/float64 maximum-index cases. The Housekeeper queue drained to zero,
dispatch resumed, and the candidate remained selected. The earlier failed
handoff above is retained as historical evidence; this later run is the
successful SWAC deployment and conformance result.

| Field | Evidence |
| --- | --- |
| Run record | `artifacts/20261123-0012-rust-vliw-conformance/result.pya` |
| Source revision | `30db7a20246a9998db42f610d05f2729fc6c873e`; no tracked source patch |
| Client and GPU host | Mriczo client -> SWAC Housekeeper -> SWAC RTX 3060 |
| GPU and driver | NVIDIA GeForce RTX 3060, driver `535.247.01`, 12,288 MiB |
| CUDA image | `sha256:2d3c8b52363ab8dac197015e468fabd32a6b3392495347771b685621304c9326` |
| Runtime executable | 9,248,544 bytes; SHA-256 `47eddabc3a5a999df168c0efeb97dd58d06e79808a03005825b6081d6bfea0e6` |
| Cubin | 3,046,232 bytes; SHA-256 `e969de24a9d55527e4036eae2f9a5b1e07c7e3901e04370abbda52e298d57aa4` |
| CPU reference executable | 15,729,000 bytes; SHA-256 `020b269522e7ef16664746147393450d0b85c13767fd99cd658275bf10b1124a` |
| Runtime initialization | Cubin load and GPU initialization: 0.11 s |
| Full run | 6,199.526 ms; 61 matrix cases passed; 3 typed-dispatch probes passed; all 3 expected errors matched |
| CPU batches | 38 codelet cases: 59.440 ms; 23 programlet sections: 64.974 ms |
| CUDA event batches | 38 codelet cases: 3.806 ms; 23 programlet sections: 110.098 ms |
| Housekeeper client round trips | Codelet batch: 667.413 ms; section batch: 680.248 ms |
| Container memory limit / post-run GPU | 1 GiB limit; RTX 3060 returned to 466 MiB used and 0% utilization |

The CUDA-event values are GPU kernel intervals; the larger client round trips
include Housekeeper and transport overhead. This verifies the clean committed
artifact on SWAC hardware, not a general GPU speedup claim. SWAC's Housekeeper
was healthy and accepting work after the run, with an empty queue and dispatch
resumed.

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

## 2026-11-24: Parameterized Attention and Long Programlet Bodies on SWAC

This full configured CUDA run exercised the parameter-backed attention
composition and the removed fixed codelet-body ceiling through SWAC Housekeeper.
The 27-section batch included the baseline attention output `[3,5]`, changed
input output `[8.5,13.5]`, changed value-weight output `[4,6]`, and an 84-codelet
programlet returning `80`. All 65 batched matrix cases passed. Three additional
typed-dispatch successes and all three expected-error probes also matched. The
canary restored SWAC's prior CUDA runtime and resumed dispatch.

| Field | Evidence |
| --- | --- |
| Run record | `artifacts/20261124-0001-rust-vliw-conformance/result.pya` |
| Source revision | `bab793fafd9d7d6a810e90e2dc0f2174ee4382a5`; no tracked patch |
| Build host and tools | Mriczo; Rust nightly `2026-08-15`; NVIDIA `ptxas 12.8.93` |
| Client and GPU host | Mriczo client -> SWAC Housekeeper -> Rust CUDA cubin runtime |
| GPU and driver | NVIDIA GeForce RTX 3060, `sm_86`, driver `535.247.01`, 12,288 MiB |
| CUDA image | `sha256:0484aaf0575183169036a1cfd3ffd0d151f28e1811f4fa1675f0a53df79666de` |
| Cubin | 3,198,808 bytes; SHA-256 `1e8a65cc4c276c4fca76471d4645b01680f4227107d3c3557d7a72dad9fbd8cb` |
| CUDA runtime executable | 9,248,944 bytes; SHA-256 `dc3214dd11c4221963b96c260477c97e5b29175723966c0860303a83871363e4` |
| CPU reference executable | 15,728,032 bytes; SHA-256 `8a03501d243341afaae39355bbeec1f36eadfd326cf471eea06c9cd162ec2fc3` |
| Batched work | 38 codelet cases; 27 independent programlet sections; 65/65 matrix cases passed |
| CPU reference batch | 38 codelet cases: 54.594 ms; 27 sections: 61.427 ms |
| GPU kernel event | 38 codelet cases: 3.798 ms; 27 sections: 118.734 ms |
| GPU client round trip | 38 codelet cases: 666.628 ms; 27 sections: 683.082 ms |
| Runtime startup | CUDA artifact initialization 0.11 s; ready in 1.027 s |
| Full conformance wall | 6,091.769 ms |
| Runtime memory | 28.75 MiB sampled under the canary's 1 GiB host-memory limit |
| Rollback result | Prior SWAC CUDA image restored; Housekeeper ready, dispatch active, queue empty |

This demonstrates correctness for these small programlets, not a GPU speedup:
the entire 27-section attention/control-flow batch took 118.734 ms of CUDA-event
time versus 61.427 ms for the Rust CPU reference batch. The long-body case
specifically confirms that 84 codelets execute; the remaining 64-sized limits
are separate routine/section/local resources, not codelet-count ceilings. Build
logs and generated artifacts are under
`rust/pyac-gpu/cuda-kernel/target/cuda-build-8hIvwpwZ/`.

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

- Build and deploy the CUDA runtime:
  `bash container/pyac-vliw-runtime/command/build.sh mriczo deploy`
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

## 2026-11-24: Parameterized Non-Uniform Attention on SWAC CUDA

**Run record:** `artifacts/20261124-0002-rust-vliw-conformance/result.pya`

| Field | Evidence |
| --- | --- |
| Source revision | `bc90245687c63d77d5d3b07b075f8f6b0ca7b602`; no tracked source patch (untracked unrelated files remained in the worktree) |
| Example source | `examples/vliw/iwsp-parameterized-two-token-attention.pya`; SHA-256 `b5c5b584716c87b54bccbde8ca6a610d3672a98cf884ca152145c26246f7df87` |
| Client and GPU route | Mriczo -> SWAC Housekeeper -> SWAC RTX 3060 CUDA VLIW runtime |
| GPU | NVIDIA GeForce RTX 3060, driver `535.247.01`, 12,288 MiB |
| Candidate image | `sha256:b739397e8f13c4944c8910d9e97c0b52999126f340d3e323be0c674b7a21ae01`; source metadata records the clean revision above |
| Final SWAC runtime | Prior verified CUDA image restored: `sha256:2d3c8b52363ab8dac197015e468fabd32a6b3392495347771b685621304c9326`; Housekeeper healthy, queue empty, dispatch active |
| Live conformance | 67/67 batched cases passed (38 codelet cases and 29 programlet sections); 3 typed-dispatch probes passed; 2/2 expected runtime errors passed |
| Attention outputs | Baseline `[10,20]`; changed input `[12,24]`; changed query weights `[12,24]`; changed key weights `[12,24]`; changed value weights `[20,30]` |
| Full run wall | 6,353.149 ms |
| CPU reference batches | Codelets: 67.450 ms; sections: 72.646 ms |
| CUDA event batches | Codelets: 3.793 ms; sections: 118.560 ms |
| Housekeeper client round trip | Codelets: 676.596 ms; sections: 684.508 ms |
| Runtime initialization | 0.11 s, loading the precompiled cubin; no service-start compilation |
| CPU reference executable | 15,728,032 bytes; SHA-256 `8a03501d243341afaae39355bbeec1f36eadfd326cf471eea06c9cd162ec2fc3` |
| GPU runtime executable | 9,248,944 bytes; SHA-256 `dc3214dd11c4221963b96c260477c97e5b29175723966c0860303a83871363e4` |
| CUDA cubin | 3,198,808 bytes; SHA-256 `1e8a65cc4c276c4fca76471d4645b01680f4227107d3c3557d7a72dad9fbd8cb` |

The parameterized example uses query `[1,0]`, keys `[0,0]` and `[ln(2),0]`,
and values `[0,0]` and `[15,30]`. The unequal logits `[0,ln(2)]` produce
weights `[1/3,2/3]`, so the baseline is not the uninformative equal-weight
case. Independently perturbing the input, query projection, or key projection
changes the output to `[12,24]`; perturbing the value projection changes it
to `[20,30]`. CPU and live CUDA agree on all five outputs. The executable Pyash
role names remain `hwas`, `htis hsek`, and `hnuc gjat`; their readable
Pyash-English glosses are `attention-query`, `attention-key`, and
`attention-value`.

The candidate was built on Mriczo, transferred to SWAC, and tested entirely
through its Housekeeper queue. The canary then restored the original verified
CUDA image; the candidate was not retained as SWAC's active runtime.

## 2026-11-25: Sequence-Level Embedding Lookup on Mriczo CUDA

**Run record:** `artifacts/20261125-0006-rust-vliw-conformance/result.pya`

| Field | Evidence |
| --- | --- |
| Source revision | `856747bf5420cb0c2ca7cc0dff34eff6976fed44`; unrelated pre-existing `.gitignore` change left uncommitted |
| Client and GPU route | Mriczo -> Mriczo Housekeeper -> Mriczo RTX 3090 CUDA VLIW runtime |
| GPU | NVIDIA GeForce RTX 3090, driver `550.163.01`, 24,576 MiB |
| Runtime image | `sha256:9889f729ae7906a324915dac8b25c0c5c78b2f6db708f5b6d675866381dbb940` (90,990,604 bytes) |
| Final runtime | CUDA image retained on Mriczo; prior image `sha256:e9d22dc233e795b35a3606d1cd7f09e78d89e2c071738ba5b7fe2a4b0c331653` retained for rollback |
| Live conformance | 80 functional passes (77 matrix cases + 3 typed-dispatch probes); 6 expected errors passed |
| Sequence lookup output | IDs `[2,0]` selected rows 2 and 0; dot outputs `[60,20]` on CPU and CUDA |
| Full run wall | 62,086.375 ms |
| CPU request batches | 45 codelet cases: 67.610 ms; 32 programlet cases: 71.073 ms |
| Housekeeper GPU client round trip | 45 codelet cases: 4,556.087 ms; 32 programlet cases: 5,176.405 ms (each queued 4 s behind another admitted job) |
| CUDA event time | Codelet batch: 11.624 ms; programlet sections: 109.763 ms |
| Runtime initialization | 0.09 s loading the prebuilt cubin; no startup compilation |
| CPU reference executable | 16,586,464 bytes; SHA-256 `6297fd87fb5370f21c13f112f804bdd5e09052353a57f3f05785c2cadea0f813` |
| GPU runtime executable | 9,316,056 bytes; SHA-256 `f4b353f37e42324a8a625f55f455e803ed7dc708042d41de14de4de8e4078de5` |
| CUDA cubin | 3,469,384 bytes; SHA-256 `d980f25532a8305fe5367d141ba9c48e9185b7144b86d514d536aacf27cd1dd5` |

The example uses a rank-one uint16 token-ID sequence and `fromindex num
<position>` to select each ID. Each selected embedding row remains a zero-copy
view into the file-backed rank-two float table. Text tokenization and a WSD
benchmark are not part of this conformance result.
