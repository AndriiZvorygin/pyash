# 26. Android Control Surface

Purpose: define the normative contract for remote Android orchestration via a dedicated holding lane.

## 1. Scope

This spec covers:
- lane ownership and queue lifecycle for Android orchestration,
- public async control contract (`vyah start` / `vyah status` / `vyah await`),
- device lease rules to avoid conflicting command execution,
- adapter/runtime boundaries for ADB-facing execution.

This spec does not cover:
- UI design for operators,
- long-term artifact retention policies,
- non-Android device families.

Implementation lifecycle guidance is documented in the non-normative reference:
- `documentation/reference/android-executive-lifecycle.md`

## 2. Holding lane ownership (normative)

Android runtime MUST use `world/holding/android/` and MUST NOT write queue state to `world/holding/channel/`.

Required lifecycle directories:
1. `input/`
2. `runtime/`
3. `produce/waiting/`
4. `produce/success/`
5. `produce/fail/`
6. `artifacts/`
7. `tmp/`

Queue records MUST be `.pya` envelopes and stage transitions MUST use atomic same-filesystem operations.

## 3. Queue lifecycle (normative)

Required flow:
1. inbound command envelopes are written to `input/`,
2. claimed envelopes move to `runtime/`,
3. completion emits result envelopes to `produce/waiting/`,
4. delivery/dispatch acks move runtime files to `produce/success/` or `produce/fail/`.

Retry behavior:
1. retries are bounded and explicit,
2. retry count is envelope metadata,
3. terminal failures MUST preserve auditable failure envelopes.

## 4. Public async contract (normative)

Android orchestration surface is aspect-first and MUST expose:
1. `vyah start` — submit command work and return a command handle,
2. `vyah status` — return current state for a handle,
3. `vyah await` — block/poll until terminal success/fail.

Terminal states:
1. `success`
2. `fail`
3. `cancel` (optional, if cancellation is supported)

Status payload SHOULD include:
1. `device id`,
2. `queued at`,
3. `started at` (if running),
4. `finished at` (if terminal),
5. short operator-readable summary text.

## 5. Command envelope contract (v0)

Minimum envelope fields:
1. `phase` (`input` or `produce`),
2. `queued at` (ISO date-time),
3. `device id` (target device serial/logical id),
4. `agent name` (owner identity),
5. `payload` (sentence payload),
6. one stable command identity (`command id` or `payload id`).

Command payload SHOULD remain sentence-shaped (`be command do` style) and MUST NOT require ad hoc JSON blobs for core routing.

## 6. Device lease and concurrency (normative)

To prevent conflicting orchestration on one ADB target:
1. runtime MUST enforce a single active lease per `device id` by default,
2. leases MUST be heartbeat/TTL-based so stale workers can be reclaimed,
3. claim scope MUST include both `device id` and `agent name`,
4. concurrent execution on one device is allowed only when explicitly configured and lane-safe.

Recommended default:
- one worker slot per device (`max in-flight per device = 1`).

## 7. Adapter/runtime boundary (normative)

Android runtime is split into:
1. queue/runtime core (lane ownership, retries, audit records),
2. adapter layer (ADB or broker execution, external IO).

Rules:
1. adapter MAY execute commands and return sentence-shaped results,
2. adapter errors MUST map to typed failure outcomes without crashing scheduler loop,
3. runtime MUST be able to operate with a mock adapter for tests.

## 8. Scheduler topology (normative)

Android lane scheduling SHOULD mirror channel phase decomposition:
1. `android poll` (ingest),
2. `android input` (claim + execute),
3. `android produce` (dispatch/ack).

Implementations MAY also provide `android probe` as an alias of `android poll`.

## 9. Error classes

Implementations should emit sentence-shaped defect names:
- `android queue defective`
- `android device lease defective`
- `android command defective`
- `android produce defective`

## 10. Conformance

Implementation conforms when:
1. queue files and transitions are lane-isolated under `world/holding/android/`,
2. `start/status/await` semantics are externally available,
3. claim and execution respect `device id` lease rules,
4. success/failure outcomes are auditable as `.pya` records,
5. adapter failures are contained and observable.
