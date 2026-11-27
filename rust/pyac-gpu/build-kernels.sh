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
  --target spirv-unknown-vulkan1.2 --output-dir "$out/vulkan"
cargo gpu build --auto-install-rust-toolchain --shader-crate "$kernel" \
  --target spirv-unknown-naga-wgsl --output-dir "$out/wgsl"

browser_shader="$root/../pyac-browser/src/vliw_kernel.wgsl"
{
  printf '// Generated from pyac-vliw-core via the Rust-GPU WGSL target. Do not edit.\n'
  sed 's/[[:blank:]]*$//' "$out/wgsl/pyac_vliw_gpu_kernel.wgsl"
} > "$browser_shader"

printf 'SPIR-V: %s\n' "$out/vulkan/pyac_vliw_gpu_kernel.spv"
printf 'WGSL:   %s\n' "$out/wgsl/pyac_vliw_gpu_kernel.wgsl"
printf 'Browser WGSL: %s\n' "$browser_shader"
