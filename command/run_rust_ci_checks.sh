#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

run_step() {
  local label=$1
  shift
  printf '\n== %s ==\n' "$label"
  "$@"
}

printf '\n== install the repository Rust toolchain ==\n'
if ! rustup show active-toolchain; then
  rustup toolchain install
fi
rustup component add rustfmt

run_step "format rust/pyac" cargo fmt --manifest-path rust/pyac/Cargo.toml -- --check
run_step "format rust/pyac-vliw-core" cargo fmt --manifest-path rust/pyac-vliw-core/Cargo.toml -- --check
run_step "format rust/pyac-riscv" cargo fmt --manifest-path rust/pyac-riscv/Cargo.toml -- --check
run_step "format rust/pyac-browser" cargo fmt --manifest-path rust/pyac-browser/Cargo.toml -- --check

run_step "test rust/pyac" cargo test --manifest-path rust/pyac/Cargo.toml
run_step "test rust/pyac-vliw-core" cargo test --manifest-path rust/pyac-vliw-core/Cargo.toml
run_step "test rust/pyac-browser" cargo test --manifest-path rust/pyac-browser/Cargo.toml

run_step "install Rust cross-compilation targets" rustup target add riscv64gc-unknown-none-elf wasm32-unknown-unknown
run_step "check browser WebAssembly build" cargo check --manifest-path rust/pyac-browser/Cargo.toml --target wasm32-unknown-unknown
run_step "build RISC-V image" cargo build --manifest-path rust/pyac-riscv/Cargo.toml --release --target riscv64gc-unknown-none-elf
