# 23. Configure

Purpose: define deterministic configure flows for orchestrator, channels, mind relay, and agents.

## 1. Command routes

Canonical families:
- `pyash configure`
- `pyash configure intro`
- `pyash configure orchestrator`
- `pyash configure channel [list|<caterer>|<caterer> test|<caterer> doctor]`
- `pyash configure mind`
- `pyash configure agent [list|establish|improve|delete]`

## 2. Onboarding order

Recommended order:
1. orchestrator
2. channel
3. mind
4. agent

`configure intro` should report configured/pending status.

## 3. Interactive UX baseline

Each step should provide:
- why it matters
- how to obtain value
- example
- prompt

Flow should support quickstart and advanced modes.

## 4. Caterer plugin contract

Each caterer must provide deterministic:
- collect
- verification
- test
- doctor
- managed block rendering
- secret redaction

## 5. Managed writes

Primary store:
- `configure/secret.pya`

Rules:
- managed markers for idempotent replacement
- no raw secret echo in console/json output
- preserve unrelated user content

## 6. Channel-specific note

Channel runtime contract is normative in `24-channel-contract.md`.

Configure may also write:
- agent conduct channel/calendar files
- global channel input schedule for push mode

## 7. Output modes

Should support:
- `--dry-run`
- `--print`
- `--json`
- `--non-interactive`
- optional post-config live test flag

## 8. Conformance

Configure implementation conforms when it performs deterministic validation, safe managed writes, redacted reporting, and repeatable test/doctor behavior.

## 9. Full draft reference

Detailed flow and matrix profile notes are preserved at:
`documentation/recipes/spec-archive/23-configure.full.md`
