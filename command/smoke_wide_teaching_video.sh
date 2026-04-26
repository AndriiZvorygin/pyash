#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

INPUT_FILE="know/input/wide-one-sentence.txt"

if [[ ! -f "$INPUT_FILE" ]]; then
  echo "smoke defective: missing input file $INPUT_FILE" >&2
  exit 1
fi

echo "[smoke] running focused quizzes"
node --test quiz/thumbnail_checkpoint_from_metadata.test.mjs quiz/wide_teaching_video_wrapper.test.mjs

echo "[smoke] default/off mode"
./run examples/pyash/wide-teaching-video-from-filename.pya "$INPUT_FILE"

echo "[smoke] checkpoint mode"
./run examples/pyash/wide-teaching-video-from-filename.pya "$INPUT_FILE" baseline checkpoint

case "${PYA_SMOKE_RENDER:-}" in
  1|true|truth|yes)
    echo "[smoke] render mode enabled"
    ./run examples/pyash/wide-teaching-video-from-filename.pya "$INPUT_FILE" baseline render
    ;;
  *)
    echo "[smoke] render mode skipped (set PYA_SMOKE_RENDER=truth to enable)"
    ;;
esac

echo "[smoke] complete"
