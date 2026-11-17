#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
worker="$root/rust/pyac-gpu/worker/target/release/pyac-vliw-gpu-worker"
shader="$root/rust/pyac-gpu/target/generated/vulkan/pyac_vliw_gpu_kernel.spv"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

"$root/rust/pyac-gpu/build-kernels.sh"
cargo build --release --manifest-path "$root/rust/pyac-gpu/worker/Cargo.toml"

cargo run --quiet --manifest-path "$root/rust/pyac-gpu/worker/Cargo.toml" \
  --example pack_smoke > "$tmp/pack.pyac"
PYAC_VLIW_SPIRV_PATH="$shader" "$worker" < "$tmp/pack.pyac" > "$tmp/pack-result.json"

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
PYAC_VLIW_SPIRV_PATH="$shader" "$worker" \
  < "$tmp/programlet.pyac" > "$tmp/programlet-result.json"

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
if PYAC_VLIW_SPIRV_PATH="$shader" "$worker" \
  < "$tmp/constant-write.pyac" > "$tmp/constant-write-result.json" \
  2> "$tmp/constant-write-error.txt"; then
  echo "GPU programlet unexpectedly allowed a write to a constant" >&2
  exit 1
fi
grep -Fq "programlet: shared VLIW runtime error 7" "$tmp/constant-write-error.txt"
echo "Rust-GPU smoke rejected writes to a constant quantity."
