# PyAC Browser Runtime

This small browser host runs the codelet families currently supported by the
Rust `pyac` crate. The WASM CPU executor handles mixed supported packs. An
optional WebGPU path accelerates numeric arithmetic codelets and the bounded
equality conditional described below; unsupported or unavailable GPU work
falls back to WASM CPU.

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

The GPU implementation supports scalar numeric arithmetic and elementwise
arithmetic over unsigned-16 numeric vectors with scalar or same-width vector
operands: saturating add/subtract, uint16-operand multiply, nonzero
division/remainder, XOR, and saturating exponentiation. Scalar-right vector
widths two through eight fit the sentence's 16-word codelet; vector-right
operations fit widths two through four. Multiplication returns
unsigned-32 vector elements to preserve the full product. Each vector element
is dispatched as one GPU work item, then reconstructed in source codelet
order. It also supports one exact conditional shape: an inline unsigned-number
equality predicate with two inline unsigned-number result arms, encoded as one
two-codelet completion-marked group. Mixed packs can combine those groups with
supported arithmetic codelets, preserving result order. The Rust decoder
validates the branch's VLIW boundaries and shape; WGSL performs the equality
and selects the result arm. This is not general GPU control flow: nested
branches, other predicates, named values, loops, calls, and side-effecting
arms remain unsupported. Invert, dates, standalone literal vectors,
malformed codelets, and division by zero are handled or rejected by the CPU
dispatcher rather than sent to the shader. There is no automatic dispatch
threshold; use the explicit GPU action for eligible batches. On the current
host/browser run, no tested batch size beat WASM CPU, so automatic dispatch is
intentionally withheld. Rerun the smoke on a target device before making a
device-specific dispatch decision.

`build.sh` writes generated bindings under `web/pkg/` and the compiled WASM
under Cargo's ignored `target/` directory. Neither is source-controlled.
