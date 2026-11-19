#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
kernel="$root/shader"
out="$root/target/generated"

if ! cargo gpu --version >/dev/null 2>&1; then
  echo "cargo-gpu 0.11.0 is required; install the official Rust-GPU tool with cargo install --git https://github.com/rust-gpu/rust-gpu --tag v0.11.0 cargo-gpu --locked" >&2
  exit 1
fi

cargo gpu build --auto-install-rust-toolchain --shader-crate "$kernel" \
  --target spirv-unknown-spv1.5 --features vulkan-device-atomics,shader-f64 \
  --capabilities Float64 --capabilities Int64 \
  --output-dir "$out/vulkan"
cargo gpu build --auto-install-rust-toolchain --shader-crate "$kernel" \
  --target spirv-unknown-naga-wgsl \
  --output-dir "$out/wgsl"

wgsl="$out/wgsl/pyac_vliw_gpu_kernel.wgsl"
node --input-type=module - "$wgsl" <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(process.argv[2], "utf8");
assert.doesNotMatch(source, /\b(?:f64|u64)\b/, "WebGPU WGSL must not require native shader-f64");
console.log("WGSL contains no native f64/u64 shader types.");
NODE

spirv="$out/vulkan/pyac_vliw_gpu_kernel.spv"
node --input-type=module - "$spirv" <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";

const bytes = fs.readFileSync(process.argv[2]);
assert.equal(bytes.byteLength % 4, 0, "SPIR-V byte length must be word aligned");
const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
assert.equal(words[0], 0x07230203, "shader output must be SPIR-V");
const memoryModels = [];
for (let cursor = 5; cursor < words.length;) {
  const word = words[cursor];
  const count = word >>> 16;
  const opcode = word & 0xffff;
  assert.ok(count > 0 && cursor + count <= words.length, "SPIR-V instruction is truncated");
  if (opcode === 14) memoryModels.push([words[cursor + 1], words[cursor + 2]]);
  cursor += count;
}
assert.deepEqual(memoryModels, [[0, 0]], "Vulkan worker shader must use Logical Simple memory model");
console.log("SPIR-V memory model is Vulkan-compatible Logical Simple.");
NODE

if command -v spirv-val >/dev/null 2>&1; then
  spirv-val --target-env vulkan1.2 "$spirv"
fi

browser_shader="$root/../pyac-browser/src/vliw_kernel.wgsl"
{
  printf '// Generated from pyac-vliw-core via the Rust-GPU WGSL target. Do not edit.\n'
  sed 's/[[:blank:]]*$//' "$wgsl"
} > "$browser_shader"

printf 'SPIR-V: %s\n' "$spirv"
printf 'WGSL:   %s\n' "$out/wgsl/pyac_vliw_gpu_kernel.wgsl"
printf 'Browser WGSL: %s\n' "$browser_shader"
