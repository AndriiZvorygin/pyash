#!/usr/bin/env bash
set -euo pipefail

INPUT="${PYA_GARDENER_INPUT:-know/input/gardner-pt1.txt}"
STYLE_PROMPT="${PYA_GARDENER_STYLE_PROMPT:-Keep one clear male gardener in every image: long hair, full beard, gardener hat. Modest work clothes. Same character continuity across scenes. Eyes must show clear white sclera and distinct visible irises.}"

./run \
  examples/pyash/teaching-video-from-filename.pya \
  "$INPUT" \
  "$STYLE_PROMPT" \
  --verbose \
  "$@"
