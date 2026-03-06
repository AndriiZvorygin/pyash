# Android Executive Lifecycle (Reference)

Purpose: describe a practical lifecycle blueprint for the Android executive module that manages `world/holding/android/` and performs ADB-side execution. This document is non-normative reference guidance.

## 1. Role

The Android executive is the runtime manager that:
- watches Android lane queues,
- leases devices,
- runs ADB commands through an adapter or broker,
- records auditable queue transitions and outcomes.

## 2. Lifecycle phases

### 2.1 Bootstrap

1. Load runtime config and policy allowlists.
2. Discover reachable devices (`adb devices` or broker inventory).
3. Prime lane directories and lease registry.
4. Emit startup health outcome (`ready` or `degraded`).

### 2.2 Poll

1. Read pending work from `world/holding/android/input/`.
2. Filter by target `device id`, `agent name`, and policy scope.
3. Select oldest eligible envelopes first.

### 2.3 Claim

1. Attempt atomic claim from `input/` to `runtime/`.
2. Acquire per-device lease (default one active command per device).
3. On lease failure, requeue with bounded retry/backoff.

### 2.4 Execute

1. Validate command against allowlist profile.
2. Execute via adapter (`adb -s <device> ...`) or broker endpoint.
3. Capture exit code, stdout/stderr summary, timing, and transport defects.

### 2.5 Produce

1. Write result envelope to `produce/waiting/`.
2. Include `vyah success|fail`, operator-readable summary, and handle ids.
3. Move runtime file to `produce/success/` or `produce/fail/`.

### 2.6 Release

1. Release device lease on terminal completion.
2. If worker dies, lease TTL/heartbeat reclamation returns capacity.

## 3. Handle state model (for `start/status/await`)

Suggested states:
1. `queued`
2. `leased`
3. `running`
4. `success`
5. `fail`
6. `cancel` (optional)

Suggested timestamps:
- `queued at`
- `started at`
- `finished at`

`status` should be monotonic (no backward transition from terminal states).

## 4. Failure handling profile

Recommended defect classes:
- `android device offline`
- `android adb timeout`
- `android command rejected`
- `android adapter defective`
- `android lease timeout`

Recommended behavior:
1. transient transport defects retry with bounded exponential backoff,
2. policy or syntax defects fail fast (no retries),
3. repeated device-offline defects mark device as temporarily degraded.

## 5. Safety profile

1. Prefer explicit command allowlists.
2. Deny shell expansion patterns by default unless explicitly permitted.
3. Redact sensitive output segments before newspaper logging.
4. Keep per-device concurrency default at `1`.

## 6. Observability profile

Emit sentence outcomes for:
1. startup/health,
2. lease acquire/release,
3. command start/finish/fail,
4. retry and terminal failure.

Recommended metrics:
- queue depth by phase,
- lease contention count,
- per-device success/fail rates,
- p50/p95 command duration.

## 7. Recovery profile

On executive restart:
1. scan stale `runtime/` claims,
2. reconcile with active leases,
3. requeue or fail stale items deterministically,
4. resume normal `poll -> claim -> execute -> produce` loop.

Warm-start should avoid replaying already terminalized commands.

## 8. Relationship to normative specs

Normative behavior remains in:
- `documentation/specifications/26-android-control-surface.md`
- `documentation/specifications/15-world.md`
- `documentation/specifications/04-runtime-primitives.md` (`vyah` lifecycle terms)

This reference is an implementation guide for module authors and operators.
