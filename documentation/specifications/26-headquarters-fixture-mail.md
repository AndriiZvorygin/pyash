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
