# 23. Configure

Purpose: define deterministic configuration flow for orchestrator, channels, mind relays, and agents.

## 1. Route table

| Route | Meaning | Application |
| --- | --- | --- |
| `pyash configure` | entry menu | onboarding and status |
| `pyash configure orchestrator` | core runtime setup | baseline runtime wiring |
| `pyash configure channel ...` | channel setup/test/doctor | matrix or other adapters |
| `pyash configure mind` | relay/backend setup | model/provider selection |
| `pyash configure agent ...` | agent lifecycle management | list/establish/improve/delete |

## 2. Onboarding order

Recommended sequence:
1. orchestrator
2. channel
3. mind
4. agent

`configure intro` should show configured/pending state.

## 3. Interactive UX keywords

Each step should include:
- why it matters,
- how to obtain value,
- concrete example,
- prompt.

Support both quickstart and advanced modes.

## 4. Caterer plugin contract

Each caterer must implement deterministic:
- collect,
- verification,
- test,
- doctor,
- managed render,
- secret redaction.

## 5. Managed config application

Primary store: `configure/secret.pya`.
Default policy store: `configure/default.pya`.

Rules:
- managed replacement blocks,
- idempotent repeated runs,
- no secret echo in terminal/json output,
- preserve unrelated content.

## 6. Channel integration note

Channel runtime behavior is normative in `24-channel-contract.md`.

Configure may also write agent conduct/channel/calendar bindings and global channel input schedule.

## 7. Provider auto-discharge default

To support single-GPU systems, configure should expose provider auto-discharge policy in `configure/default.pya`.

Canonical default facts:
```pyash
exists su name provider auto discharge ob bool truth be default ya
exists su name gpu exclusive classes ob ve text "mind" "draw" ya
exists su name provider auto discharge settle ms ob num 1200 be default ya
exists su name newspaper enabled ob bool truth be default ya
exists su name draw workflow root ob filename "./draw/" be default ya
exists su name draw backend default ob text "comfyui" be default ya
exists su name draw workflow default ob la be draw fromstate wo text become wo photograph ko as text "teaching-text-to-photograph" be default ya
exists su name draw workflow default ob la be draw fromstate wo photograph become wo photograph ko as text "teaching-photograph-to-photograph" be default ya
exists su name draw workflow default ob la be draw fromstate wo text become wo video ko as text "teaching-text-to-video" be default ya
exists su name draw workflow default ob la be draw fromstate wo photograph become wo video ko as text "teaching-photograph-to-video" be default ya
```

Semantics:
- when `provider auto discharge` is `truth`, activating one class listed in `gpu exclusive classes` discharges active providers from other listed classes;
- when `provider auto discharge` is `lie`, no automatic discharge occurs.
- when switching between gpu-exclusive classes, runtime waits `provider auto discharge settle ms` before starting the next provider (set `0` to disable wait).
- workflow files for backend `<b>` resolve under `./draw/<b>/` unless an explicit `with filename` override is supplied.
- when `newspaper enabled` is `truth`, runtime should persist replayable artifacts in background even when stage surfaces use typed in-memory links such as `from name itinerary ...`.

## 8. Output modes

Supported modes:
- `--dry-run`
- `--print`
- `--json`
- `--non-interactive`
- optional post-config live test flag

## 9. Conformance

Implementation conforms when validation/write/test/doctor paths are deterministic, redacted, and repeatable.

## 10. Full draft reference

`documentation/recipes/spec-archive/23-configure.full.md`
