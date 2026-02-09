# Parity Checklist

This checklist tracks parity work with explicit gates.

## 1) Recurrence Grammar Lock

Status: done

Gate:
- Scheduler accepts canonical `per` recurrence declarations.
- Scheduler accepts `every` as alias of `per`.
- Scheduler keeps compatibility with legacy `during` recurrence declarations.
- Unit coverage includes minute/hour/day/week forms.

Verification:
- `node --test quiz/scheduler.test.mjs`

## 2) Matrix Mention/Reply Hardening

Status: done

Gate:
- Mention matching uses token boundaries (no substring false positives).
- Mention gate still allows replies to agent-authored thread/reply chains.
- Debug telemetry records receive/dispatch decisions.

Verification:
- `node --test quiz/channel_runtime.test.mjs`

## 3) Shared Channel Fanout Dispatcher

Status: done

Gate:
- One poll cycle can dispatch one event to multiple listener agents.
- Fanout runs from a single receive pass, with deterministic per-listener dispatch.
- Dedup runs before mind-loop invocation.

Verification:
- `node --test quiz/channel_runtime.test.mjs`

## 4) Scheduler Observability Expansion

Status: done

Gate:
- Scheduler status includes overlap/load signals (`overlapPct`, `utilizationPct`).
- Scheduler status includes error counters (`errorCount`, `consecutiveErrors`).
- Telemetry emits run/skip/error with these fields in `.pya`.

Verification:
- `node --test quiz/scheduler.test.mjs`

## 5) Scheduler + Channel Reliability Path (No Fixtures)

Status: done

Gate:
- A real scheduler instance can run repeated channel poll cycles.
- First cycle handles and fans out; repeated cycle dedups prior events.
- Scheduler and channel telemetry are emitted as `.pya` records.

Verification:
- `node --test quiz/scheduler_channel_reliability.test.mjs`

## 6) Parity Checklist Document

Status: done

Gate:
- This document exists and is updated with done/partial/missing style gates.
- Each gate links to concrete verification commands.
