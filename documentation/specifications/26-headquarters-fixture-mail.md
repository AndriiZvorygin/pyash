# Headquarters fixture-mail vertical slice

This specification freezes the first Headquarters application proof. It uses
the existing channel and organizational-work contracts; it does not create a
Headquarters queue or a second task store.

## Record and identity

A managed fixture-mail record contains provider, event id, message id, sender,
subject, body, received time, domain, an optional deadline, and explicit
structured facts for decision required, draft response requested, and mutation
requested. The
fixture adapter parses these fields with the Pyash parser and emits the
normalized channel event shape while preserving the optional source metadata.

Channel delivery deduplication is the tuple `(channel type, channel id, event
id)`. Organizational work identity is `provider + message id`; the router
payload id, timestamp, subject, body, and body hash are never identity keys.
The source record retains provider, event id, message id, sender, subject,
received time, domain, deadline, source locator, and routed payload correlation.

## Classification and escalation

Classification is a deterministic structured lookup over four explicit facts,
in this order: decision required, deadline present, draft response requested,
and mutation requested. The reusable Pyash policy maps the four-fact record to
exactly one of `information`, `work`, `draft-response`, or `escalation`; it does
not inspect prose and does not call a language model.

The golden fixture is `escalation` because it explicitly requires a decision
and includes a deadline. Its acceptance text proposes no external send or
mutation. It is assigned to Correspondence Worker and escalated to Chief of
Staff with the same provider/message source identity on both delegation events.

The policy is total over the supported fixture contract and rejects the other
fact combinations as defective rather than guessing. A decision requirement
without a deadline is rejected; a draft response conflicts with a decision or
deadline; and every mutation request is rejected. Thus the only accepted
combinations are the four rows in the policy map: no facts (`information`), a
deadline (`work`), a draft request (`draft-response`), or decision plus deadline
(`escalation`).

## Ordered application stages

The correlated newspaper chain is sentence-shaped and ordered as:

`received -> routed -> classified -> work-created|work-reused -> escalated -> briefing-visible -> channel-completed`

The escalation stage is present only when the classification is escalation.
Every stage carries the provider/message source identity, native event id,
router payload id when available, task id, and source locator. Channel outcome
logging remains best-effort at the channel boundary.

## Briefing input

The briefing seam is a read-only projection of canonical `WorkTask` records.
Each candidate exposes task id, owner, domain, deadline, escalation reason,
escalation target, and source locator. Ranking, approvals, scheduling, and a
briefing database are outside this slice.

## Headquarters knowledge profile

Headquarters contact and commitment data uses the linked claim bundle in
`18-pyash-agent.md`; it does not add a CRM, entity store, or provenance model.
The stable `su` names the record and each separately keyed `be` facet carries
one value. The initial profile is:

| Record | Canonical facets and references |
| --- | --- |
| person | `be person`; contact details use separate `be contact-method` facets |
| organization | `be organization`; memberships and counterparties are separate claims |
| contact method | `be contact-method`, plus `be person` or `be organization` reference and an address/value facet |
| relationship | `be relationship`, plus separate `be person` and `be organization` references |
| commitment | `be commitment`, plus `be person`, `be organization`, `be due-date`, and `be work` references |

For example, the commitment facets can reference `person-ada`,
`organization-analytical-engine`, and `work-fixture-mail-001` with `ob name`,
and carry the deadline as `ob date YYYY-MM-DD` under `be due-date`. Each
sentence carries the Knowledge Core `fromtext`, `accordingto`, and `by`
fields. Source identity and anchor, confidence, claim identity, replay, and
current/contested/provenance views therefore remain the existing Knowledge
Core contract. Unknown references remain unknown, and contested facets are
surfaced rather than adjudicated.

## Approval and checkpoint resumption

Headquarters approval is a Pyash-first extension over the same canonical
WorkTask record. The supported action vocabulary is exactly `send`, `delete`,
`purchase`, `publish`, and `calendar-mutation`; unsupported actions are
defective. The owner’s existing `house/<owner>/conduct/ratify.pya` may contain
additive entries such as:

```pyash
su name action send ob text allow ya
su name action delete ob text ask ya
```

Action resolution prefers `action <action>`, then the existing subject/tool/
signature keys, then `default`. `truth` remains allow and `lie` remains deny.
For Headquarters work, no matching authorization is `ask`, so sensitive work
is durably paused rather than silently denied. Non-Headquarters callers keep
their existing safe-deny fallback.

The checkpoint approval record is written to both the work envelope and the
canonical status copy. A pending request records the pre-block status and
phase, checkpoint identity, normalized proposal, request id, policy evidence,
and an exact task/action/checkpoint-bound resume token. Human approval restores
that recorded status (`planning`, `implementing`, `reviewing`, or `revision`)
and resumes once while preserving progress, retry, result, and delegation
data. Human denial remains blocked. Generic resume and operational recovery
must not bypass pending or denied approval blocks.

Approval evidence remains in the existing work newspaper stream, with the
ordered chains `requested -> allowed`, `requested -> denied`,
`requested -> pending -> approved -> resumed`, and
`requested -> pending -> denied`. The standard run newspaper links the durable
status, envelope, and work-approval evidence artifacts for replay.

## Recovery and duplicate behavior

Channel input is single-writer for the agent/channel scope. A stranded input
envelope in `runtime/` is resumed before a fresh input claim. Durable work is
created or reused by the provider/message-derived task id before channel
acknowledgement. Redelivery preserves owner, status, retry count, checkpoint,
result, progress, and delegation state; it adds no duplicate task, envelope,
assignment, escalation, or checkpoint reset.

The runnable example returns a populated map. Its standard run newspaper also
contains content-addressed SHA-256 artifact links for the application,
channel, and work evidence, so replay verifies the evidence snapshot and fails
when that snapshot is tampered with.
