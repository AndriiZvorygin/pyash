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

cat > "$tmp/batch.json" <<'JSON'
{"schemaVersion":1,"slots":["left","right","value"],"inputSlots":["left","right"],"outputSlot":"value","cases":[{"values":{"left":5,"right":2},"expected":0},{"values":{"left":3,"right":4},"expected":0},{"values":{"left":9,"right":4},"expected":0}],"candidates":[{"id":"plus","instructions":[{"op":"plus","target":"value","left":"left","right":"right"}]},{"id":"subtract","instructions":[{"op":"subtract","target":"value","left":"left","right":"right"}]},{"id":"xor","instructions":[{"op":"xor","target":"value","left":"left","right":"right"}]},{"id":"multiply","instructions":[{"op":"multiply","target":"value","left":"left","right":"right"}]},{"id":"divide","instructions":[{"op":"divide","target":"value","left":"left","right":"right"}]},{"id":"remains","instructions":[{"op":"remains","target":"value","left":"left","right":"right"}]},{"id":"exponential","instructions":[{"op":"exponential","target":"value","left":"left","right":"right"}]},{"id":"equally","instructions":[{"op":"equally","target":"value","left":"left","right":"right"}]},{"id":"tiny","instructions":[{"op":"tiny","target":"value","left":"left","right":"right"}]},{"id":"giant","instructions":[{"op":"giant","target":"value","left":"left","right":"right"}]}]}
JSON
PYAC_VLIW_SPIRV_PATH="$shader" "$worker" < "$tmp/batch.json" > "$tmp/batch-result.json"

node --input-type=module - "$tmp/pack-result.json" "$tmp/batch-result.json" <<'NODE'
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
  { type: "unsigned", value: 7 }
]);

const batch = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
assert.equal(batch.backend, "rust-gpu-vulkan");
const outputs = Object.fromEntries(batch.scores.map(({ id, outputs }) => [id, outputs]));
assert.deepEqual(outputs, {
  plus: [7, 7, 13],
  subtract: [3, 0, 5],
  xor: [7, 7, 13],
  multiply: [10, 12, 36],
  divide: [2, 0, 2],
  remains: [1, 3, 1],
  exponential: [25, 81, 6561],
  equally: [0, 0, 0],
  tiny: [0, 1, 0],
  giant: [1, 0, 1]
});
console.log(`Rust-GPU smoke passed on ${pack.device}: PyAC pack plus all 10 named-slot operators.`);
NODE
