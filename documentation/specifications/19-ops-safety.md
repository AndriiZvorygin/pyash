# 19. Ops Safety

Purpose: define safety requirements for repair, command execution, and coding-harness operations.

## 1. Scope

This chapter covers:
- `be repair`
- `be command`
- approval gating (`propose` + ratify)
- command/tool classification and sandbox constraints
- coding saddle readiness baseline

## 2. `be repair`

Canonical forms:

```pyash
be repair ob text "<patch>" do
be repair ob text "<patch>" as wo check do
```

Rules:
- patch input must parse before apply
- `as wo check` validates without writes
- writes must remain inside active workspace
- apply mode is atomic: any invalid file aborts all writes

Recommended errors:
- `repair defective`
- `repair parse defective`
- `repair path defective`
- `repair hunk defective`
- `repair apply defective`

## 3. Command safety model

Command execution must enforce deterministic policy resolution.

Required controls:
- cwd
- writable roots
- network allow/deny
- timeout
- output-size limit
- environment allowlist

Classification classes:
- `read_only`
- `write_local`
- `network`
- `process_control`
- `destructive`
- `unknown`

## 4. Approvals

Modes:
- `deny`
- `ask`
- `allow`

Policy:
- `propose` always requires ratify
- unresolved decision defaults to deny (`lie`)
- decisions must be auditable and replayable

## 5. Audit requirements

Each restricted action must emit append-only audit facts containing:
- request id
- normalized sentence
- classifier class
- policy source
- decision
- timestamp
- surfaced result (if available)

Audit events must be eligible for newspaper output.

## 6. Coding saddle readiness

A coding profile should include at minimum:
- `command`
- `repair`

Recommended additions:
- `read`
- `write`
- `list files`
- `repair check`

Minimum acceptance checks:
- tool signatures are present
- one real run (non-fixture) executes command + repair path
- deterministic gate/guarantee can validate resulting output

## 7. Conformance

An implementation conforms to this chapter when it:
- enforces repair validation/apply semantics
- enforces command sandbox + classification + approval policy
- emits deterministic audit records
- supports a coding profile with verified command/repair flow

## 8. Detailed references

Expanded operational guidance moved to:
- `documentation/recipes/spec-archive/19-repair.full.md`
- `documentation/recipes/spec-archive/20-command-safety.full.md`
- `documentation/recipes/spec-archive/21-coding-saddle-readiness.full.md`
