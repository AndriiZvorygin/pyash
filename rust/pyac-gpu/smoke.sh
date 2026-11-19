#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
worker="$root/rust/pyac-gpu/worker/target/release/pyac-vliw-gpu-worker"
runtime="$root/rust/pyac-gpu/worker/target/release/pyac-vliw-runtime"
pipeline_compiler="$root/rust/pyac-gpu/worker/target/release/pyac-vliw-pipeline-compiler"
shader="$root/rust/pyac-gpu/target/generated/vulkan/pyac_vliw_gpu_kernel.spv"
tmp=$(mktemp -d)
runtime_pid=""
stop_runtime() {
  if [[ -n "$runtime_pid" ]]; then
    kill "$runtime_pid" 2>/dev/null || true
    wait "$runtime_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp"
}
trap stop_runtime EXIT

"$root/rust/pyac-gpu/build-kernels.sh"
cargo build --release --manifest-path "$root/rust/pyac-gpu/worker/Cargo.toml" \
  --bin pyac-vliw-gpu-worker --bin pyac-vliw-runtime \
  --bin pyac-vliw-pipeline-compiler
"$pipeline_compiler" "$shader" "$tmp/pyac_vliw_pipeline_cache.bin"

export PYAC_VLIW_SPIRV_PATH="$shader"
export PYAC_VLIW_PIPELINE_CACHE_PATH="$tmp/pyac_vliw_pipeline_cache.bin"

cargo run --quiet --manifest-path "$root/rust/pyac-gpu/worker/Cargo.toml" \
  --example pack_smoke > "$tmp/pack.pyac"
"$worker" < "$tmp/pack.pyac" > "$tmp/pack-result.json"

node --input-type=module - "$tmp/pack-result.json" <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";

const pack = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.equal(pack.ok, true);
assert.equal(pack.backend, "rust-gpu-vulkan");
assert.match(pack.device, /NVIDIA/u);
assert.deepEqual(pack.values, [
  { type: "unsigned", value: 2 },
  { type: "unsigned", value: 5 },
  { type: "unsigned", value: 4 },
  { type: "unsigned", value: 81 },
  { type: "unsigned", value: 1 },
  { type: "signed", value: -5 },
  { type: "date-epoch-ms", value: 1746057600000 },
  { type: "vector", elementType: "unsigned-16", values: [1, 2, 3] },
  { type: "vector", elementType: "unsigned-16", values: [3, 4, 5, 6] },
  { type: "boolean", value: true },
  { type: "boolean", value: false },
  { type: "unsigned", value: 7 },
  { type: "unsigned", value: 7 },
  { type: "unsigned", value: 9 },
  { type: "boolean", value: true }
]);

console.log(`Rust-GPU smoke passed on ${pack.device}: canonical PyAC pack execution.`);
NODE

compile_programlet() {
  local output_path="$1"
  local constant_write="$2"
  node --input-type=module - "$root" \
    "$root/examples/pyash/vliw-programlet-gpu-smoke.pya" \
    "$output_path" "$constant_write" <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, sourcePath, outputPath, constantWrite] = process.argv.slice(2);
const { buildProgram } = await import(pathToFileURL(path.join(root, "program/program.mjs")));
const { encodePyacPack, lowerPyashProgram } = await import(
  pathToFileURL(path.join(root, "program/library/vliw/index.mjs"))
);
let source = fs.readFileSync(sourcePath, "utf8");
if (constantWrite === "true") {
  assert.equal(source.split("as name variable").length - 1, 1);
  source = source.replace("as name variable", "as name permanently number");
}
const vectors = lowerPyashProgram(buildProgram(source).sentences).vectors;
assert.equal(vectors.length, 6, "smoke source should lower to six canonical sentences");
fs.writeFileSync(outputPath, encodePyacPack(vectors));
NODE
}

compile_programlet "$tmp/programlet.pyac" false
"$worker" < "$tmp/programlet.pyac" > "$tmp/programlet-result.json"

node --input-type=module - "$tmp/programlet-result.json" <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";

const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.equal(result.ok, true);
assert.equal(result.backend, "rust-gpu-vulkan");
assert.match(result.device, /NVIDIA/u);
assert.deepEqual(result.values, [{ type: "unsigned", value: 1 }]);

console.log(`Rust-GPU smoke passed on ${result.device}: numeric local programlet execution.`);
NODE

compile_programlet "$tmp/constant-write.pyac" true
if "$worker" < "$tmp/constant-write.pyac" > "$tmp/constant-write-result.json" \
  2> "$tmp/constant-write-error.txt"; then
  echo "GPU programlet unexpectedly allowed a write to a constant" >&2
  exit 1
fi
grep -Fq "programlet: shared VLIW runtime error 7" "$tmp/constant-write-error.txt"
echo "Rust-GPU smoke rejected writes to a constant quantity."

port=28887
PYAC_VLIW_RUNTIME_HOST=127.0.0.1 PYAC_VLIW_RUNTIME_PORT="$port" \
  "$runtime" > "$tmp/runtime.log" 2>&1 &
runtime_pid=$!
start_seconds=$SECONDS
deadline=$((SECONDS + 60))
until curl -fsS "http://127.0.0.1:$port/health" > "$tmp/health.json" 2>/dev/null; do
  if (( SECONDS >= deadline )) || ! kill -0 "$runtime_pid" 2>/dev/null; then
    cat "$tmp/runtime.log" >&2
    echo "VLIW service did not load the on-disk GPU artifact and become ready within 60s." >&2
    exit 1
  fi
  sleep 1
done
node --input-type=module - "$tmp/health.json" <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";

const health = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.equal(health.ready, true);
assert.equal(health.protocolVersion, 1);
assert.equal(health.gpuReady, true);
assert.match(health.device, /NVIDIA/u);
NODE
echo "VLIW service loaded its saved GPU artifact and became ready in $((SECONDS - start_seconds))s."

node --input-type=module - "$tmp/pack.pyac" "$tmp/execute-request.json" <<'NODE'
import fs from "node:fs";

const packBase64 = fs.readFileSync(process.argv[2]).toString("base64");
fs.writeFileSync(process.argv[3], JSON.stringify({
  protocolVersion: 1,
  jobId: "pipeline-cache-smoke",
  jobSpec: { kind: "pyac-pack-execute", payload: { packBase64 } },
}));
NODE
curl -fsS -H 'Content-Type: application/json' \
  --data-binary "@$tmp/execute-request.json" \
  "http://127.0.0.1:$port/v1/execute" > "$tmp/service-result.json"
node --input-type=module - "$tmp/service-result.json" <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";

const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.equal(result.ok, true);
assert.deepEqual(result.values[0], { type: "unsigned", value: 2 });
NODE
echo "VLIW service executed a PyAC pack using its loaded GPU artifact."
