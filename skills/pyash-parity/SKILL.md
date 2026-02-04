---
name: pyash-parity
description: "Check parity across ./run, ./runjs, and ./runc using examples; use when validating runner consistency or investigating parity regressions."
---

# Pyash Parity

Use this skill to validate parity across the interpreter and compiled runners.

## Quick checklist

1. Run interpreter examples:
   - `command/run_examples.sh`
2. Run parity-focused quizzes:
   - `node --test \"quiz/*parity*.test.mjs\" \"quiz/*runjs*.test.mjs\" \"quiz/*runc*.test.mjs\"`
3. If failures occur, classify them:
   - Missing external tools (ffmpeg, pdftotext/pandoc, ytdlp, whisper)
   - Runner behavior differences
   - Example fixture issues

## Full example sweep

1. List examples:
   - `rg --files -g \"*.pya\" examples/pyash | rg -v \"^examples/pyash/modules/\"`
2. Run each file with:
   - `./run <file>`
   - `./runjs <file>`
   - `./runc <file>`
3. Skip examples that depend on external tools unless installed.

## Report format

- Runner name
- Failing example file
- Tail of error output
- Whether the failure is env/tooling vs. behavior regression
