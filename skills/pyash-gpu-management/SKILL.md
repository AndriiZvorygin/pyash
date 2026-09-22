---
name: pyash-gpu-management
description: "Diagnose and reduce GPU/model thrashing in Pyash refinery runs using demand-driven housekeeper admission, provider-safe discharge, and minimal probes."
---

# Pyash GPU Management

Use this skill when video/refinery runs show repeated GPU model load/unload churn, high `load_duration` spikes, or slow oscillation between providers.

## Goals

- Keep model/provider transitions intentional and stage-bounded.
- Verify mind path behavior with a minimal probe before full refinery runs.
- Ensure automatic discharges happen only for explicitly registered runtimes with a safe provider hook and verified idle state.

## Canonical policy

- Criterion and Pyash callers may declare a VRAM demand when a job needs
  capacity for a large model. The housekeeper owns admission and must compare
  that demand with live GPU telemetry before reclaiming residency.
- Automatic reclamation is demand-driven, not a general idle cleanup job.
- A provider is reclaimable only when its runtime is explicitly registered, its
  provider-specific activity probe says idle beyond the configured grace, and
  its safe discharge hook succeeds.
- ComfyUI discharge uses the existing API hooks and does not stop the container.
- Unknown host processes and registered runtimes without safe hooks are
  diagnostics only and are never touched.
- Manual discharge remains available for explicit lifecycle operations.
- Use one canonical mind model for run-level consistency and validate with
  minimal probes before full refinery runs.

### Explicit model provisioning

- Model availability is a queued `ollama-ensure-model` duty, not an implicit
  pull hidden inside generation. Preserve the exact provider tag, including
  `:` `/` and quantization suffixes.
- Require a realistic full-load `vramRequiredMb`; model pulls additionally
  require declared `ramRequiredMb` and `diskRequiredMb` and are denied unless
  the host allowlists the exact tag with `GPU_HOUSEKEEPER_ALLOW_MODEL_PULL`
  and `GPU_HOUSEKEEPER_MODEL_ALLOWLIST`.
- The host-local housekeeper starts the registered Ollama runtime and uses
  Ollama's catalog/pull API. Do not copy model files between GPU hosts or add
  a model registry to Criterion. A failed fit should be reported as
  insufficient capacity; unavailable telemetry should remain unknown.
- `keep_alive: 0` is a real discharge request for the target model. Verify
  `/api/ps`, `/runtime/ollama/models` and housekeeper snapshot state after
  provisioning or a smoke request.

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
3. Inspect housekeeper `/snapshot` and, for large jobs, `/capacity/preview`.
4. Confirm a discharge candidate has a verified provider-idle result.
5. Confirm no unmanaged host process is treated as reclaimable.
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

- Declare a realistic `resourceRequest.vramRequiredMb` for jobs that need
  additional model capacity.
- Inspect `/capacity/preview` before a large run when residency is uncertain.
- Keep automatic discharge limited to registered providers with a safe hook and
  verified idle state; do not add generic process-kill logic.
- Keep explicit Pyash discharge stages available at intended refinery
  boundaries.
- Keep stage discharges outside inner per-item loops unless intentional.
- Increase mind runner request timeout if premature abort fallback is occurring.
