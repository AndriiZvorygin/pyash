---
name: pyash-gpu-management
description: "Diagnose and reduce GPU/model thrashing in Pyash refinery runs using stage-first checks, explicit manual discharge policy, and minimal probes."
---

# Pyash GPU Management

Use this skill when video/refinery runs show repeated GPU model load/unload churn, high `load_duration` spikes, or slow oscillation between providers.

## Goals

- Keep model/provider transitions intentional and stage-bounded.
- Verify mind path behavior with a minimal probe before full refinery runs.
- Ensure discharges happen only where explicitly declared.

## Canonical policy

- Prefer manual discharge stages in refinery wiring.
- Avoid hidden/implicit discharge in verb internals or provider modules.
- Use one canonical mind model for run-level consistency.
- Validate with minimal probes before running full multi-paragraph refinery.

## Quick probes

Mind-only probe (three sequential mind writes):

```bash
./run examples/pyash/mind-three-calls-probe.pya --verbose --run-id 20260225-mind-three-probe --again
```

Extract model/load facts:

```bash
rg -n "mind request [0-9]+ be json map def|model ob text|load_duration ob num|keep_alive ob num" /tmp/mind_three_probe.log -S
```

Ollama residency check between calls:

```bash
curl -sS http://host.docker.internal:11434/api/ps
```

## Triage order

1. Run mind-only probe first.
2. Confirm one model name is used.
3. Confirm no auto-discharge emissions in logs.
4. Confirm no hidden module-level `be discharge do` in active path.
5. Confirm refinery has explicit stage discharges at intended boundaries.
6. Only then run wide/3-paragraph refinery.

## High-signal log patterns

Good signals:
- stable `model ob text` across requests
- `keep_alive ob num 300` present
- no `provider auto discharge` lines when manual-only mode is intended

Risk signals:
- repeated discharges without explicit discharge stages
- retries/timeout errors around mind requests
- alternating provider calls within a section mapper loop

## Known repo commands

Wide 3-paragraph run:

```bash
./run examples/pyash/wide-teaching-video-from-filename.pya know/input/wide-smoke-3para.txt --verbose --run-id 20260225-wide-debug --again
```

Single-sentence quick run:

```bash
./run examples/pyash/teaching-video-from-filename.pya know/input/wide-one-sentence.txt --verbose --run-id 20260225-quick-debug --again
```

## Remediation checklist

- Remove auto discharge hooks from verbs if manual-only policy is required.
- Remove module-level hidden discharges in draw/say/hear wrappers.
- Keep discharge stages explicit in refinery source.
- Keep stage discharges outside inner per-item loops unless intentional.
- Increase mind runner request timeout if premature abort fallback is occurring.
