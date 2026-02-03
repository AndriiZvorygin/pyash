---
name: pyash-parity-run
description: "Run run/runjs/runc parity checks on examples; use when validating example parity or updating runner behavior."
---

# Pyash Parity Run

Use this skill to check parity across `./run`, `./runjs`, and `./runc` with examples.

## Quick check (interpreter only)

- `command/run_examples.sh` runs `./run` over examples with built-in skips.

## Full parity loop

1. List examples:
   - `rg --files -g "*.pya" examples/pyash | rg -v "^examples/pyash/modules/"`
2. For each runner, execute the same list and capture failures.
3. Skip examples that require external tools (ffmpeg, pdftotext/pandoc, ytdlp, whisper) unless those tools are installed.

## Known external dependencies

- `ffmpeg`, `pdftotext`, `pdftohtml`, `pandoc`, `ytdlp`, whisper binaries.

## What to report

- Per-runner failures with the last error lines.
- Whether skips were due to missing external dependencies vs. actual parity regressions.
