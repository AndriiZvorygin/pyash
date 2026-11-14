#!/usr/bin/env bash
set -euo pipefail
echo "cleaning"
bash "clean.sh"
echo "building"
bash "build.sh"
echo "testing"
bash "test.sh"
