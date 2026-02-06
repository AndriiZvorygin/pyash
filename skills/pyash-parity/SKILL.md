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

## Status check (no new runs)

Use this when you must not execute the examples yourself.

1. Read the latest report:
   - `documentation/parity/status.json`
2. Summarize pass/fail counts:
   - `node -e "const s=require('./documentation/parity/status.json'); const c=o=>o.length; console.log('run',c(s.run.successes),c(s.run.failures),c(s.run.missing),c(s.run.timeouts),c(s.run.skipped)); console.log('runjs',c(s.runjs.successes),c(s.runjs.failures),c(s.runjs.timeouts)); console.log('runc',c(s.runc.successes),c(s.runc.failures),c(s.runc.timeouts));"`
3. Identify parity deltas (runjs/runc failing while run passes):
   - `node -e "const s=require('./documentation/parity/status.json'); const run=new Set(s.run.successes); const runjs=s.runjs.failures.filter(f=>run.has(f)); const runc=s.runc.failures.filter(f=>run.has(f)); console.log('runjs parity fails', runjs.length); console.log(runjs.join('\\n')); console.log('runc parity fails', runc.length); console.log(runc.join('\\n'));"`
4. If you have evidence that the report is stale (e.g., a runjs/runc test now passes locally but is still listed as failing), do not re-run. Ask the user to re-run the parity sweep and stop.

## Running examples (individual only)

When the user asks you to run examples, do NOT use `command/run_examples.sh` or `command/run_examples.mjs`.
Instead, run individual examples directly with:

- `./run <file>`
- `./runjs <file>`
- `./runc <file>`

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
