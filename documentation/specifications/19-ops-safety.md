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

Compiled command runners apply the same policy contract as the interpreter
before creating a process. They resolve `session command configure`, then
`agent command configure`, then `command configure` at each command's
execution point. A declaration that appears later in a source program cannot
authorize an earlier command. Compiled `ask` and `propose` paths fail closed
when no approval/resume loop is available, and emit an identity-linked,
sentence-shaped ratify request with a JSON-parseable resume token.

Every command policy audit includes its request identity, policy source,
decision, classifier class when enabled, and an ISO-8601 `fromtext` timestamp.
Disabling the classifier records class `unknown` and omits the `by` class.

### Headquarters action policy

The initial Headquarters action vocabulary is exactly:

`send`, `delete`, `purchase`, `publish`, and `calendar-mutation`.

An agent-local `conduct/ratify.pya` may add action entries without replacing
the existing subject/tool/signature entries:

```pyash
su name action send ob text allow ya
su name action delete ob text ask ya
su name default ob text deny ya
```

The action value is one of `allow`, `deny`, or `ask`. Existing boolean
`truth` entries continue to resolve to `allow`, and existing boolean `lie`
entries continue to resolve to `deny`. `ask` is a distinct mode and is never
encoded as `lie`.

Resolution order is deterministic: an explicit `action <canonical-action>`
entry first, then the existing subject, tool, and signature keys, then
`default`. A supported Headquarters action with no matching entry resolves
to `ask`. Existing non-Headquarters callers retain their safe-deny behavior
when no entry matches.

The durable approval states are `allowed`, `pending`, `approved`, and
`denied`. A standing `allow` records `requested -> allowed`; a standing
`deny` records `requested -> denied`; an unresolved or explicit `ask` records
`requested -> pending`; a human approval records `pending -> approved ->
resumed`; and a human denial records `pending -> denied`.

Each pending request has a stable request id and a resume token bound to the
task id, canonical action, normalized proposal, and checkpoint identity. A
decision is valid only when it names the current pending request and exactly
matches that binding. Repeating an identical request or decision is a no-op;
conflicting, stale, or tampered requests are defective. Approval increments
resumption once and restores the recorded nonterminal status and phase
(`planning`, `implementing`, `reviewing`, or `revision`), never `ready`.
Pending and denied approval blocks cannot be reopened by generic human resume
or operational recovery.

The authoritative supported-action and sensitivity declaration is the exported
`module/headquarters-approval.pya` map. The built-in surface keeps the
interaction typed and sentence-native:

```pyash
be ratify for name <task> ob text <action> with text <proposal> to name map request do
be ratify for name <task> ob text <action> accordingto text <request-id> fromtext text <resume-token> with text approve as text <actor> totext text <rationale> to name map decision do
```

`as text` records the decision actor and `totext text` records its rationale;
the resulting audit fact remains `be ratify ya`.

The approval record is part of the existing WorkTask checkpoint and is
round-tripped through both the canonical `.pya` status and work envelope. It
contains the state, request id, canonical action, normalized proposal, resume
token, checkpoint identity, resume status/phase, policy mode/key/path,
request/decision timestamps, decision actor, rationale, resumed timestamp,
resume status, and ordered history. Every transition appends a `work task
approval` record to the existing `world/newspaper/YYYYMMDD-work-<task>.pya`
stream with task/source, action/proposal, request/checkpoint identity, policy
evidence, decision source/value, actor/rationale, and resumption phase.

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
