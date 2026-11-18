# PyAC Browser Runtime

This small browser host runs the codelet families currently supported by the
Rust `pyac` crate. The WASM CPU executor handles mixed supported packs. The
WebGPU path is intended to accelerate supported codelet packs and bounded
scalar programlets; until the generated module passes browser validation, the
GPU action reports the failure and falls back to WASM CPU.

```bash
cd rust/pyac-browser
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version "$(awk '/name = "wasm-bindgen"/{f=1;next} f && /version =/{gsub(/"/, "", $3); print $3; exit}' Cargo.lock)" --locked
./build.sh
cd web
python3 -m http.server 8000
```

Open <http://127.0.0.1:8000>, run the built-in one-plus-one fixture, or select
a `.pyac` file. The numeric-batch buttons and “Run equality branch on WebGPU”
exercise those operation families. The GPU button reports the adapter when
available and visibly returns the CPU result on failure. “Try selected pack on
WebGPU” similarly falls back for unsupported pack shapes.
The browser needs a secure context; localhost qualifies.

After building, `node smoke.mjs` runs the CPU demo, compares CPU and WebGPU
batch results when a browser adapter is available, forces and verifies the
no-WebGPU CPU fallback, and checks malformed input. It uses the repository's
Playwright dependency and headless Chromium; set `PYA_CHROMIUM_PATH` if
Chromium is installed elsewhere. A local WebGPU adapter is optional for this
smoke: actual GPU execution is reported when available, otherwise parity is
still verified through the forced CPU fallback. When available, the smoke also
prints warmed end-to-end CPU/WebGPU medians from seven alternating samples for
batches from 1,024 to 131,072 codelets, including pack decode,
transfer/dispatch/readback, and result JSON.

The generated GPU implementation is intended to execute bounded scalar
numeric/boolean programlets through the shared semantic runtime and
whole-program WGSL entry point used by native Vulkan. That admitted subset
includes typed arguments and local values, typed genitive resolution, nested
calls, scalar arithmetic, local comparisons, single-level branch selection,
and bounded `fromindex`/`toindex` loops. Limits are 64 codelets, 64 locals per
frame, 8 arguments, call depth 8, and 65,536 steps. The browser smoke uses the
same spec-derived 15-case matrix against WASM CPU and WebGPU and asserts both
against fixed expected values, not the JavaScript interpreter.

Current browser limitation: Chromium/Naga rejects the generated WGSL module at
its 127-level statement-nesting/chaining limit before creating either GPU
pipeline. This also prevents the ordinary WebGPU codelet pipeline from
starting because both entry points share one shader module. The checked-in
pre-change shader has the same failure. WASM CPU execution remains available;
WebGPU browser parity is pending the bounded/shader-structure slice and is not
claimed as working until `node smoke.mjs` completes with actual WebGPU results.

The ordinary pack path additionally supports scalar numeric arithmetic and
elementwise arithmetic over unsigned-16 numeric vectors with scalar or
same-width vector operands: saturating add/subtract, uint16-operand multiply,
nonzero division/remainder, XOR, and saturating exponentiation. Scalar-right
vector widths two through eight fit the sentence's 16-word codelet;
vector-right operations fit widths two through four. Multiplication returns
unsigned-32 vector elements to preserve the full product. Each vector element
is dispatched as one GPU work item, then reconstructed in source codelet
order. Bounded conditional groups support inline unsigned-number `equally`,
`tiny`, or `giant` predicates and return unsigned-number or scalar boolean
values. Mixed packs preserve result order. Nested/compound conditions,
multi-action branch bodies, general side effects, text/date/vector programlet
locals, and recursion remain outside the admitted programlet subset. There is
no automatic dispatch threshold; use the explicit GPU action for eligible
batches. On the current host/browser run, no tested batch size beat WASM CPU,
so automatic dispatch is intentionally withheld. Rerun the smoke on a target
device before making a device-specific dispatch decision.

`build.sh` writes generated bindings under `web/pkg/` and the compiled WASM
under Cargo's ignored `target/` directory. Neither is source-controlled.
