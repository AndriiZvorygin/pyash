# Android Control Surface and Executive Lifecycle (Reference)

Purpose: describe a practical control-surface contract and lifecycle blueprint for the Android executive module that manages `world/holding/android/` and performs ADB-side execution. This document is non-normative reference guidance.

## 1. Scope

This reference covers:
- lane ownership and queue lifecycle for Android orchestration,
- public async control contract (`vyah start` / `vyah status` / `vyah await`),
- device lease rules to avoid conflicting command execution,
- adapter/runtime boundaries for ADB-facing execution.

This reference does not cover:
- UI design for operators,
- long-term artifact retention policies,
- non-Android device families.

## 2. Control-Surface Contract (Reference Profile)

### 2.1 Holding lane ownership

Android runtime should use `world/holding/android/` and should not write queue state to `world/holding/channel/`.

Recommended lifecycle directories:
1. `input/`
2. `runtime/`
3. `produce/waiting/`
4. `produce/success/`
5. `produce/fail/`
6. `artifacts/`
7. `tmp/`

Queue records should be `.pya` envelopes and stage transitions should use atomic same-filesystem operations.

### 2.2 Queue lifecycle

Recommended flow:
1. inbound command envelopes are written to `input/`,
2. claimed envelopes move to `runtime/`,
3. completion emits result envelopes to `produce/waiting/`,
4. delivery/dispatch acks move runtime files to `produce/success/` or `produce/fail/`.

Retry profile:
1. retries are bounded and explicit,
2. retry count is envelope metadata,
3. terminal failures preserve auditable failure envelopes.

### 2.3 Public async contract

Android orchestration should expose:
1. `vyah start` — submit command work and return a command handle,
2. `vyah status` — return current state for a handle,
3. `vyah await` — block/poll until terminal success/fail.

Terminal states:
1. `success`
2. `fail`
3. `cancel` (optional, if cancellation is supported)

Status payload should include:
1. `device id`,
2. `queued at`,
3. `started at` (if running),
4. `finished at` (if terminal),
5. short operator-readable summary text.

### 2.4 Command envelope contract (v0)

Minimum envelope fields:
1. `phase` (`input` or `produce`),
2. `queued at` (ISO date-time),
3. `device id` (target device serial/logical id),
4. `agent name` (owner identity),
5. `payload` (sentence payload),
6. one stable command identity (`command id` or `payload id`).

Command payload should remain sentence-shaped (`be command do` style) and avoid ad hoc JSON blobs for core routing.

### 2.5 Device lease and concurrency

To prevent conflicting orchestration on one ADB target:
1. enforce a single active lease per `device id` by default,
2. keep leases heartbeat/TTL-based so stale workers can be reclaimed,
3. scope claims by both `device id` and `agent name`,
4. allow concurrent execution on one device only when explicitly configured.

Recommended default:
- one worker slot per device (`max in-flight per device = 1`).

### 2.6 Adapter/runtime boundary

Android runtime is split into:
1. queue/runtime core (lane ownership, retries, audit records),
2. adapter layer (ADB or broker execution, external IO).

Reference rules:
1. adapter may execute commands and return sentence-shaped results,
2. adapter errors should map to typed failure outcomes without crashing scheduler loop,
3. runtime should operate with a mock adapter for tests.

### 2.7 Scheduler topology

Recommended phase decomposition:
1. `android poll` (ingest),
2. `android input` (claim + execute),
3. `android produce` (dispatch/ack).

`android probe` may be used as an alias of `android poll`.

### 2.8 Suggested error names

- `android queue defective`
- `android device lease defective`
- `android command defective`
- `android produce defective`

## 3. Role

The Android executive is the runtime manager that:
- watches Android lane queues,
- leases devices,
- runs ADB commands through an adapter or broker,
- records auditable queue transitions and outcomes.

## 4. Lifecycle phases

### 4.1 Bootstrap

1. Load runtime config and policy allowlists.
2. Discover reachable devices (`adb devices` or broker inventory).
3. Prime lane directories and lease registry.
4. Emit startup health outcome (`ready` or `degraded`).

### 4.2 Poll

1. Read pending work from `world/holding/android/input/`.
2. Filter by target `device id`, `agent name`, and policy scope.
3. Select oldest eligible envelopes first.

### 4.3 Claim

1. Attempt atomic claim from `input/` to `runtime/`.
2. Acquire per-device lease (default one active command per device).
3. On lease failure, requeue with bounded retry/backoff.

### 4.4 Execute

1. Validate command against allowlist profile.
2. Execute via adapter (`adb -s <device> ...`) or broker endpoint.
3. Capture exit code, stdout/stderr summary, timing, and transport defects.

### 4.5 Produce

1. Write result envelope to `produce/waiting/`.
2. Include `vyah success|fail`, operator-readable summary, and handle ids.
3. Move runtime file to `produce/success/` or `produce/fail/`.

### 4.6 Release

1. Release device lease on terminal completion.
2. If worker dies, lease TTL/heartbeat reclamation returns capacity.

## 5. Handle state model (for `start/status/await`)

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

## 6. Failure handling profile

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

## 7. Safety profile

1. Prefer explicit command allowlists.
2. Deny shell expansion patterns by default unless explicitly permitted.
3. Redact sensitive output segments before newspaper logging.
4. Keep per-device concurrency default at `1`.

## 8. Observability profile

Emit sentence outcomes for:
1. startup/health,
2. lease acquire/release,
3. command start/finish/fail,
4. retry and terminal failure.

Reference runtime now appends Android outcome lines to:
- `world/newspaper/YYYYMMDD-android-<agent>.pya`

Suggested outcome shape:
1. `su name <handle> ... vyah success queued ... be android outcome ya`
2. `su name <handle> ... vyah success running ... be android outcome ya`
3. `su name <handle> ... vyah success|fail ... be android outcome ya`

Recommended metrics:
- queue depth by phase,
- lease contention count,
- per-device success/fail rates,
- p50/p95 command duration.

## 9. Recovery profile

On executive restart:
1. scan stale `runtime/` claims,
2. reconcile with active leases,
3. requeue or fail stale items deterministically,
4. resume normal `poll -> claim -> execute -> produce` loop.

Warm-start should avoid replaying already terminalized commands.

## 10. Relationship to core specs

Core references:
- `documentation/specifications/15-world.md` (holding lane ownership)
- `documentation/specifications/04-runtime-primitives.md` (`vyah` lifecycle terms)

This reference is an implementation guide for module authors and operators.

## 11. Minimal ADB Primitive Profile

For an agent-controlled phone, the minimal capability set is:
1. observe the screen,
2. press/type,
3. launch apps or URLs,
4. transfer files,
5. know device state.

### 11.1 Device primitives

```bash
adb devices
adb shell getprop
adb shell getprop ro.product.model
adb shell getprop ro.build.version.release
```

### 11.2 Screen observation

```bash
adb shell screencap -p /sdcard/screen.png
adb pull /sdcard/screen.png
adb shell wm size
adb shell dumpsys input | grep SurfaceOrientation
```

### 11.3 UI structure observation (optional)

```bash
adb shell uiautomator dump /sdcard/ui.xml
adb pull /sdcard/ui.xml
```

### 11.4 Navigation and input

```bash
adb shell input keyevent KEYCODE_WAKEUP
adb shell input keyevent KEYCODE_HOME
adb shell input keyevent KEYCODE_BACK
adb shell input keyevent KEYCODE_APP_SWITCH
adb shell input tap X Y
adb shell input swipe X1 Y1 X2 Y2
adb shell input text "hello%sworld"
adb shell input keyevent KEYCODE_ENTER
```

### 11.5 App control and foreground activity

```bash
adb shell monkey -p PACKAGE -c android.intent.category.LAUNCHER 1
adb shell am start -a android.intent.action.VIEW -d "URL"
adb shell dumpsys window | grep mCurrentFocus
```

### 11.6 File transfer

```bash
adb push localfile /sdcard/path/file
adb pull /sdcard/path/file
```

### 11.7 Optional media interaction

```bash
adb shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE
```

### 11.8 Absolute minimal command set

```text
adb devices
adb shell screencap
adb pull
adb shell input tap
adb shell input swipe
adb shell input text
adb shell input keyevent
adb shell monkey
adb shell am start
adb push
adb shell wm size
adb shell dumpsys window
```

### 11.9 Typical agent loop

```text
screenshot
-> vision model
-> agent reasoning
-> tap / swipe / type
-> repeat
```

Optional enhancement:

```text
screenshot + uiautomator dump
-> agent reasoning
-> tap / swipe / type
```

## 12. Small Pyash Verb Surface (Reference Mapping)

A compact verb mapping that keeps agent control small:
1. `be android verify vyah start future do` -> durable queued verify (`adb devices`, `getprop`, `wm size`, foreground activity checks).
2. `be android observe vyah start future do` -> durable queued screenshot capture/pull and optional `uiautomator dump`.
3. `be android tap vyah start future do` -> durable queued `adb shell input tap`.
4. `be android glide vyah start future do` -> durable queued `adb shell input swipe`.
5. `be android scroll vyah start future do` -> durable queued scroll gesture profile (lowered to `adb shell input swipe ...`).
6. `be android type vyah start future do` -> durable queued `adb shell input text` and keyevents.
7. `be android begin vyah start future do` -> durable queued app launch (`monkey`) or URL open (`am start`).
8. `be android send vyah start future do` -> durable queued `adb push`.
9. `be android accept vyah start future do` -> durable queued `adb pull`.
10. `accordingto text "<handle>" vyah status be android do` -> query async handle status.
11. `accordingto text "<handle>" during num 8000 vyah await be android do` -> wait for terminal handle state.

Lane notes:
- `vyah ... future` selects durable spool/holding execution.
- `vyah ... soon` selects fast in-process execution.
- when tense is omitted, Android defaults to durable.

Implementations may keep these as adapter-level intents and lower to raw ADB commands inside the Android executive.

## 13. Default Device Configuration

To avoid hard-coding serials in examples, set a default device in local `configure/secret.pya`:

```pyash
exists su name android device id ob text "187a09d37d81" be default ya
```

When set, `be android ... do` calls can omit `from text <device id>`.

First-time helper:

```bash
node command/android_default_device.mjs
```

Behavior:
1. runs `adb devices -l`,
2. picks a ready (`device`) target (or prompts when multiple are attached),
3. asks confirmation,
4. writes/updates `exists su name android device id ob text "<serial>" be default ya` in `configure/secret.pya`.
