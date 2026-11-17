#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
target="$root/target/wasm32-unknown-unknown/release/pyac_browser.wasm"

"$root/../pyac-gpu/build-kernels.sh"

if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo "wasm-bindgen CLI is missing; follow rust/pyac-browser/README.md to install the lockfile-matched version" >&2
  exit 1
fi

cargo build --manifest-path "$root/Cargo.toml" --release --target wasm32-unknown-unknown
rm -rf "$root/web/pkg"
wasm-bindgen "$target" --target web --out-dir "$root/web/pkg" --out-name pyac_browser
