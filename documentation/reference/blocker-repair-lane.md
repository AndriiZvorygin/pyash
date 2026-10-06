# Blocker Repair Lane

The background worker has a bounded blocker-repair lane for days in which
scheduled work produces no useful progress. It is part of the existing durable
WorkTask and scheduler machinery; it is not a second queue or a separate
project-management system.

## Trigger

After a 24-hour window with observed scheduler wakes but no useful wake, the
runner performs a cheap inspection of durable health, task checkpoints, and
recent scheduler events. Useful work includes a recovery, baseline
synchronization, integration reconciliation, material progress, a started
workflow, or an accepted/integrated result.

The lane creates at most one deterministic repair task for a source blocker per
day. The repair task keeps the source task unchanged and records the source
task, blocker class, blocker text, and trigger day in its existing `.pya`
checkpoint. A repair task is bounded and does not automatically integrate into
`automation/roadmap`.

## Ordering and safety

The repair lane chooses a global automation-baseline blocker first because a
failed baseline synchronization can prevent every ordinary roadmap task from
starting. Otherwise it chooses the highest-priority blocked technical or
external-evidence task that has a concrete bounded repair path.

The selected repair uses the normal Sol/Luna workflow and existing preflight,
turn identity, recovery, and convergence safeguards. It may inspect an
existing remote checkout or container deployment, but must use the established
deployment path, preserve credentials, and never create a parallel repository
or service layout. It must either remove the blocker with deterministic
evidence or leave the original acceptance boundary intact and document the
remaining external or human boundary.

The lane does not revive human-decision, ambiguous-mutation, or dependency
blocked work. It does not bypass weekly pacing, foreground protection, or the
one-workflow-per-wake rule. A same-day repair is not duplicated after restart.

## Current search-endpoint example

The canonical public SearXNG endpoint used by the current Pyash web-search
examples and quizzes is `https://tsoc.liberit.ca/`. Its JSON search contract
currently responds successfully to a probe. `localhost:60490` is the local
container fallback, while `mriczo:60490` is a separate legacy/local deployment
and must not be inferred as the public search motor.

The stale research blocker named `mriczo:60490`; that service responds to its
root HTML page, but its mounted settings expose only HTML and force POST. That
explains a GET JSON request returning HTTP 403, but it does not prove that the
canonical public SearXNG service is broken. A repair task should inspect the
effective `PYA_WEB_SEARCH_MOTOR` and Pyash configuration first, switch the
proof to the configured canonical endpoint when appropriate, and only then
repair an existing container. It must not copy or print the SearXNG secret.

`yacy.liberit.ca` is not a tracked Pyash search endpoint and did not resolve in
the current development-machine probe. YaCy may be an upstream backend behind
SearXNG, but it should not be treated as a direct Pyash motor without explicit
configuration and a successful contract probe.

The daily digest shows the lane separately, including the number of observed
wakes, the selected repair, and the source blocker. This makes a no-progress
day actionable without misclassifying the source task as accepted or as a
human decision.
