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

extract_meta_block() {
  local file="$1"
  awk '
    NR<=120 {
      if ($0 ~ /^su name example meta be map def$/) { inblock=1; print; next }
      if (inblock) { print }
      if (inblock && $0 ~ /^prah$/) { exit }
    }
  ' "$file"
}

parse_meta_value() {
  local block="$1"
  local key="$2"
  printf '%s\n' "$block" | rg -m 1 "su name ${key} ob text" | sed -E 's/.*ob text \"(.*)\".*/\1/'
}

parse_meta_vector() {
  local block="$1"
  local key="$2"
  local line
  line=$(printf '%s\n' "$block" | rg -m 1 "su name ${key} ob ve text" || true)
  if [[ -z "$line" ]]; then
    return
  fi
  printf '%s\n' "$line" | rg -o "\"[^\"]*\"" | tr -d '"'
}

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

skip["examples/pyash/hear-stream.pya"]=1

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
  meta_block=$(extract_meta_block "$file")
  if [[ -n "$meta_block" ]]; then
    mode=$(parse_meta_value "$meta_block" "mode")
    requires=()
    while read -r req; do
      [[ -n "$req" ]] && requires+=("$req")
    done < <(parse_meta_vector "$meta_block" "requires" || true)
    if [[ ${#requires[@]} -gt 0 ]]; then
      missing=()
      for req in "${requires[@]}"; do
        if ! command -v "$req" >/dev/null 2>&1; then
          missing+=("$req")
        fi
      done
      if [[ ${#missing[@]} -gt 0 ]]; then
        echo "==> $file (skipped: missing ${missing[*]})"
        continue
      fi
    fi
    if [[ "$mode" == "session" ]]; then
      inputs=()
      while read -r inp; do
        [[ -n "$inp" ]] && inputs+=("$inp")
      done < <(parse_meta_vector "$meta_block" "inputs" || true)
      if [[ ${#inputs[@]} -gt 0 ]]; then
        if ! timeout 30 bash -c 'printf "%s\n" "$@" | ./run "$0"' "$file" "${inputs[@]}" >/tmp/run_example_output.txt 2>&1; then
          echo "FAILED: $file"
          failures+=("$file")
          tail -n 8 /tmp/run_example_output.txt || true
        fi
      else
        if ! timeout 30 ./run "$file" </dev/null >/tmp/run_example_output.txt 2>&1; then
          echo "FAILED: $file"
          failures+=("$file")
          tail -n 8 /tmp/run_example_output.txt || true
        fi
      fi
      continue
    fi
  fi
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
