#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$root_dir/bin"
nasm -g -f elf -o "$root_dir/bin/pyac-run.o" "$root_dir/src/pyac_interpreter.asm"
ld -m elf_i386 -o "$root_dir/bin/pyac-run" "$root_dir/bin/pyac-run.o"
printf 'built %s\n' "$root_dir/bin/pyac-run"
