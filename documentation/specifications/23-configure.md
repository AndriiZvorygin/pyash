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

Rules:
- managed replacement blocks,
- idempotent repeated runs,
- no secret echo in terminal/json output,
- preserve unrelated content.

## 6. Channel integration note

Channel runtime behavior is normative in `24-channel-contract.md`.

Configure may also write agent conduct/channel/calendar bindings and global channel input schedule.

## 7. Output modes

Supported modes:
- `--dry-run`
- `--print`
- `--json`
- `--non-interactive`
- optional post-config live test flag

## 8. Conformance

Implementation conforms when validation/write/test/doctor paths are deterministic, redacted, and repeatable.

## 9. Full draft reference

`documentation/recipes/spec-archive/23-configure.full.md`
