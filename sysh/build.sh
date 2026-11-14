#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$root_dir/variable.sh"
mkdir -p "$root_dir/bin"

for name in $files; do
  (cd "$root_dir/src" && nasm -g -f elf -o "$root_dir/bin/$name.o" "$name.asm")
  ld -m elf_i386 -o "$root_dir/bin/$name" "$root_dir/bin/$name.o"
  printf 'built %s\n' "$name"
done
