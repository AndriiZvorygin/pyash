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
  { type: "unsigned", value: 7 }
]);

console.log(`Rust-GPU smoke passed on ${pack.device}: canonical PyAC pack execution.`);
NODE
