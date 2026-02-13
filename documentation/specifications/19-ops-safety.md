# 19. Ops Safety

Purpose: define safety requirements for repair, command execution, approvals, and coding harness operation.

## 1. Safety keyword table

| Keyword/surface | Meaning | Application |
| --- | --- | --- |
| `be repair` | patch apply/check | deterministic text edits |
| `as wo check` | dry-run validation | validate without writes |
| `be command` | external process execution | shell/tool bridge under policy |
| `propose` | gated action mood | requires ratify decision |
| `be ratify ya` | approval decision fact | allow/deny audit path |

## 2. `be repair` canonical forms

```pyash
be repair ob text "<patch>" do
be repair ob text "<patch>" as wo check do
```

Rules:
- parse before apply,
- `as wo check` performs no writes,
- writes must remain in allowed workspace,
- apply is atomic.

## 3. Command policy model

Required controls:
- cwd,
- writable roots,
- network policy,
- timeout,
- output limit,
- env allowlist.

Classification classes:
- `read_only`, `write_local`, `network`, `process_control`, `destructive`, `unknown`.

## 4. Approvals and audit

Policy modes:
- `deny`, `ask`, `allow`.

Rules:
- `propose` always ratified,
- unresolved decision defaults deny,
- all restricted actions append auditable records.

## 5. Coding saddle baseline

Minimum tool set:
- `command`, `repair`.

Recommended:
- `read`, `write`, `list files`, `repair check`.

Must include at least one non-fixture real run path in validation.

## 6. Conformance

Implementation conforms when repair/command/approval behavior is deterministic, policy-bounded, and auditable.

## 7. References

- `documentation/recipes/spec-archive/19-repair.full.md`
- `documentation/recipes/spec-archive/20-command-safety.full.md`
- `documentation/recipes/spec-archive/21-coding-saddle-readiness.full.md`
