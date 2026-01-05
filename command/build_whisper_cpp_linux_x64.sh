#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$root_dir/caterer/whisper.cpp"
build_dir="$source_dir/build"
output_dir="$root_dir/caterer/hear/binary/linux-x64"
license_dir="$root_dir/caterer/hear/license"
whisper_sdl2="OFF"
stream_target=""

if command -v pkg-config >/dev/null 2>&1 && pkg-config --exists sdl2; then
  whisper_sdl2="ON"
  stream_target="whisper-stream"
fi

CCACHE_DISABLE=1 cmake -S "$source_dir" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release -DGGML_CCACHE=OFF -DWHISPER_SDL2="$whisper_sdl2"
CCACHE_DISABLE=1 cmake --build "$build_dir" --target whisper-cli $stream_target -j

mkdir -p "$output_dir" "$license_dir"

install -m 755 "$build_dir/bin/whisper-cli" "$output_dir/whisper-main"

if [[ -f "$build_dir/bin/whisper-stream" ]]; then
  install -m 755 "$build_dir/bin/whisper-stream" "$output_dir/whisper-stream"
else
  echo "Skipping whisper-stream; SDL2 not available."
fi

cp "$source_dir/LICENSE" "$license_dir/whisper.cpp.LICENSE.txt"

echo "Built whisper.cpp and staged binaries in $output_dir"
