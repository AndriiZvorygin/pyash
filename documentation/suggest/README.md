# Suggested Work

This folder holds **proposals awaiting review**. Nothing here is accepted work,
and nothing here changes what the system does.

## What belongs here

A document in this folder states an intent, the evidence behind it, the shape
of the proposed change, and the questions a reviewer has to answer. It is not a
specification and it is not a record of a decision.

- A proposal is written here first.
- Review happens against the **review questions** the proposal ends with.
- When a proposal is accepted, its substance moves into the place that governs
  it — a specification under `documentation/specifications/`, a decision in
  `documentation/decisions.md`, a package in `program/runtime/work/roadmap.mjs`,
  or a runbook under `documentation/recipes/` or `documentation/runbooks/`.
- When a proposal is rejected, it stays here with the outcome recorded, so the
  reasoning is not lost and the question is not re-asked from scratch.
- A proposal that survives review but has no deliverable is **parked**. It
  stays here, with its outcome recorded and its status shown in the table
  below, until something changes that gives it one. A parked proposal is not
  queued work.

## What does not belong here

- **Specifications.** `documentation/specifications/` is normative. A document
  there says what the system *is*.
- **Records of decisions.** `documentation/decisions.md` says what was *chosen*
  and why.
- **Current state.** `documentation/state.md` says what *is*.
- **Work that is queued and executable.** `documentation/todo.md` carries the
  items the autonomous work system may promote, and the roadmap packages in
  `program/runtime/work/roadmap.mjs` are the executable form.

The distinction that matters: a document in `documentation/` outside this
folder describes something that is true now. A document in this folder
describes something that is proposed.

## Review

Reviewers should answer the proposal's own review questions, and should also
answer three general ones:

1. **Is the evidence reproducible?** Every claim should carry the command that
   reproduces it.
2. **Is the scope honest?** What the proposal explicitly excludes should be
   the real boundary, not a smaller one than the change needs.
3. **Is the acceptance criterion checkable?** A proposal that cannot say what
   "done" means is not ready to be accepted, whatever its merits.

A proposal that has been reviewed and accepted does not simply disappear. Its
substance is carried into the governing document, and the entry in
`documentation/todo.md` is updated to point at where it landed.

## Current proposals

| Document | Subject | Status |
|---|---|---|
| [`vocabulary-runtime-parameter.md`](vocabulary-runtime-parameter.md) | Make the atom table an injected runtime value instead of a module constant | parked — no deliverable; see its Review record |
| [`self-chosen-work-candidates.md`](self-chosen-work-candidates.md) | Let the work system choose what to work on next from detector output | awaiting review |
| [`pyash-as-gios-foundation.md`](pyash-as-gios-foundation.md) | Where Pyash stands as a general intelligence operating system foundation, and what needs work | analysis for review |

All three are also posted in the commons room under `world/commons/notes/` for
live agents to read. See `skills/pyash-world-rooms/SKILL.md` for how that
posting works.
