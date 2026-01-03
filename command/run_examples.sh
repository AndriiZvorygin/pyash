#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

include_mind=false
include_say=false
include_command=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-mind)
      include_mind=true
      shift
      ;;
    --include-say)
      include_say=true
      shift
      ;;
    --include-command)
      include_command=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

declare -A skip=()

if [[ "$include_mind" != "true" ]]; then
  skip["examples/pyash/mind-config-call.pya"]=1
  skip["examples/pyash/mind-parity.pya"]=1
  skip["examples/pyash/mind-tool-call.pya"]=1
  skip["examples/pyash/mind-tools.pya"]=1
fi

if [[ "$include_say" != "true" ]]; then
  skip["examples/pyash/say-default.pya"]=1
  skip["examples/pyash/say-espeak.pya"]=1
fi

if [[ "$include_command" != "true" ]]; then
  skip["examples/pyash/command-espeak.pya"]=1
fi

if [[ "$include_say" == "true" || "$include_command" == "true" ]]; then
  if ! command -v espeak-ng >/dev/null 2>&1; then
    echo "espeak-ng not found; skipping say/command espeak examples." >&2
    skip["examples/pyash/say-default.pya"]=1
    skip["examples/pyash/say-espeak.pya"]=1
    skip["examples/pyash/command-espeak.pya"]=1
  fi
fi

files=$(rg --files -g "*.pya" examples/pyash | rg -v "^examples/pyash/modules/")

failures=()
for file in $files; do
  if [[ -n "${skip[$file]:-}" ]]; then
    echo "==> $file (skipped)"
    continue
  fi
  echo "==> $file"
  if ! ./run "$file" >/tmp/run_example_output.txt 2>&1; then
    echo "FAILED: $file"
    failures+=("$file")
    tail -n 8 /tmp/run_example_output.txt || true
  fi
done

if [[ ${#failures[@]} -gt 0 ]]; then
  echo "" >&2
  echo "Failures:" >&2
  printf '%s\n' "${failures[@]}" >&2
  exit 1
fi
