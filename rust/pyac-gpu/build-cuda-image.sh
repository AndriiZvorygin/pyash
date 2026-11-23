#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

toolchain=nightly-2026-08-15
dir=rust/pyac-gpu/cuda-kernel
target="$dir/target/nvptx64-nvidia-cuda/release"
run="$(mktemp -d "$PWD/$dir/target/cuda-build-XXXXXXXX")"
mkdir "$run/image"
echo "CUDA build evidence: $run"

export RUSTFLAGS="-C target-cpu=sm_86"
/usr/bin/time -v timeout 300 cargo "+$toolchain" rustc --locked --release \
  --manifest-path "$dir/Cargo.toml" --target nvptx64-nvidia-cuda \
  -Z build-std=core -Z build-std-features=compiler-builtins-mem \
  >"$run/rust-build.log" 2>&1 || { cat "$run/rust-build.log" >&2; exit 1; }
unset RUSTFLAGS
/usr/bin/time -v timeout 300 ptxas -v -arch=sm_86 \
  "$target/pyac_vliw_cuda_kernel.ptx" -o "$run/image/pyac_vliw_gpu_kernel.cubin" \
  >"$run/ptxas.log" 2>&1 || { tail -80 "$run/ptxas.log" >&2; exit 1; }

digest="$(sha256sum "$run/image/pyac_vliw_gpu_kernel.cubin" | cut -d' ' -f1)"
export PYAC_VLIW_BUILD_CUBIN_SHA256="$digest"
timeout 300 cargo build --locked --release --features cuda --bin pyac-vliw-runtime \
  --manifest-path rust/pyac-gpu/worker/Cargo.toml
install -m 0755 rust/pyac-gpu/worker/target/release/pyac-vliw-runtime "$run/image/"
revision="$(git rev-parse HEAD)"
tracked_state=clean
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || tracked_state=dirty
compiler="$(rustc "+$toolchain" --version)"
assembler="$(ptxas --version | sed -n 's/^Cuda compilation tools, //p')"
cat >"$run/image/cubin.metadata.pya" <<EOF
su name source revision ob text "$revision" be text ya
su name source checkout ob text "$tracked_state" be text ya
su name kernel abi ob num 1 be number ya
su name device target ob text "sm_86" be text ya
su name cubin sha256 ob text "$digest" be text ya
su name rust compiler ob text "$compiler" be text ya
su name cuda assembler ob text "$assembler" be text ya
EOF
image="liberit/pyac-vliw-runtime:cuda-sm86-${digest:0:16}"
docker build --pull=false -f container/pyac-vliw-runtime/Dockerfile.cuda -t "$image" "$run/image"
docker image inspect --format '{{.Id}}' "$image"
printf 'CUDA_IMAGE=%s\nCUDA_BUILD_DIR=%s\n' "$image" "$run"
