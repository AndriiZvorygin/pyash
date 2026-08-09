# Pyash Manager and Worker Audit

Audit date: 2026-08-07

This document records the repository state and the bounded Sol/Luna execution
slice implemented after the durable work queue foundation. Historical roadmaps
are evidence, not current commitments.

## Current State

The repository was fetched and fast-forwarded before implementation. The
starting branch was clean at `f539ae5d`, `master` tracked both configured
remotes, and no additional worktree or local WIP was found.

The durable work lane is under `program/runtime/work/` and reuses the existing
holding spool:

```text
world/holding/work/*.pya
        |
        v
Pyash supervisor claims one task
        |
        +--> Sol App Server thread: plan and review
        +--> Luna App Server thread: implementation and tests
        |
        v
Pyash .pya checkpoint, queue ack, and final decision
```

A task envelope carries its bounded prompt, context, acceptance criteria,
retry policy, status, and work specification. The status projection now
preserves named `.pya` sections for:

- workspace: repository, base revision, detached worktree, and mode;
- roles: manager/worker models, reasoning effort, and App Server thread ids;
- plan: Sol summary, work order, and risks;
- implementation: summary, changed files, file-change events, diff, tests,
  blockers, and uncertainty;
- review: `ACCEPT`, `REVISE`, or `BLOCK`, rationale, and correction request;
- interruption: phase, timestamp, reason, and last turn;
- active turn identity: phase, role, thread id, turn id, deterministic request
  identity, state, timestamps, result capture, and ambiguity;
- completed/abandoned turn history, blocker, human response, last action,
  selection reason, revision count, original `workSpec`, and original payload
  sentence.

This is one canonical Pyash checkpoint artifact, not a second JSON state store.
Structured values are encoded inside named Pyash map fields using the existing
artifact convention.

Task claiming remains atomic through spool rename. Selection is deterministic:
higher numeric `priority` wins, then the oldest `queuedAt`, then the filename.
Equal-priority work is therefore FIFO. A larger number means more urgent; this
simple rule is intentionally not a fair-share scoring engine.

## Reporter and Roadmap Reality

Reporter work is shared in `program/library/reporter_shared/`; Grey County and
Owen Sound houses are deployment-specific and are not present in this checkout.
Shared Stage 2/3 contracts cover canonical `.pya` artifacts, source anchors,
child/parent lineage, contiguous ranges, timing, monotonicity, motion grounding,
and quality verification. JSON and `meeting.json` paths remain boundary
compatibility debt. Live publishing, cover upload, external house imports, and
some reporter quizzes still require credentials or ignored house assets.

| Historical goal | Status | Current evidence |
| --- | --- | --- |
| Parity-first interpreter, JavaScript, and C | ACTIVE | Cross-backend examples and compiler goldens exist; higher-level parity remains incomplete. |
| Feature gates for lagging backends | PARTIAL | Targeted gates and parity quizzes exist, but no complete current status artifact exists. |
| Frozen specifications before promotion | ACTIVE | Numbered specifications remain the design source of truth. |
| Golden and replay corpus | ACTIVE | Examples, artifacts, newspapers, checkpoints, and `again` support exist. |
| Sentence-shaped, human-speakable Pyash | ACTIVE | It remains an interpreter and `.pya` design constraint. |
| Media IO and listen -> mind -> TTS | PARTIAL | `hear`, streaming, Piper, Whisper, and refinery paths exist; one default loop is unfinished. |
| MCP bridge | DONE | MCP stdio/HTTP, policy, replay, timeouts, restart, and discharge are implemented. |
| Minimal agent loop | ACTIVE | Houses, sessions, memory, channels, MCP, Codex projection, and one durable Sol/Luna cycle exist. |
| General concurrency | PARTIAL | Schedulers, leases, channels, and runtime handles exist; fair-share work scheduling remains open. |
| Newspaper-style replayable history | ACTIVE | Newspaper, artifacts, checkpoints, and Pyash-first Codex projection exist. |
| Knowledge core and adjudication | HIGH-VALUE UNSTARTED | Useful old roadmap work with no current implementation to assume. |
| Genetic/speculative packaging branches | STALE | Not the highest-value use of the current architecture. |

## Manager and Worker Foundation

### App Server adapter

`program/runtime/codex/app_server.mjs` extracts the JSONL transport that was
previously private to `command/codex_account.mjs`. It launches and initializes
`codex app-server`, supports request/notification subscriptions, persists
stderr, validates malformed JSON, and detects server errors or process exit.

The first-cycle operations are:

- `initialize` and `initialized`;
- `thread/start` with model, working directory, approval policy, and sandbox;
- `thread/resume`;
- `turn/start` with model, working directory, reasoning effort, input, and
  sandbox policy plus a deterministic `clientUserMessageId` request identity;
- streamed `item/agentMessage/delta`, `item/fileChange/patchUpdated`, and
  `turn/diff/updated` events;
- `turn/completed` success/failure classification;
- `turn/interrupt` and clean process termination.

The installed Codex was `0.146.1` during this audit. The adapter is injectable,
so ordinary tests never launch Codex. Its protocol schema was generated from
the installed binary rather than copied into Pyash.

### Roles and supervisor

Roles are configurable through supervisor options or environment variables:

```text
manager model: gpt-5.6-sol
manager effort: high
worker model: gpt-5.6-luna
worker effort: high
```

The role names are architectural. Model names are configuration defaults, not
provider assumptions.

`runWorkSupervisorOnce` claims one ready task, prepares a task-specific
detached Git worktree, transitions `ready -> planning`, starts or resumes Sol,
persists the work order, starts or resumes Luna, persists implementation and
Git evidence, then resumes Sol for review. It maps decisions as follows:

```text
ACCEPT -> accepted
REVISE -> one revision loop, then implement/review again
BLOCK  -> blocked
```

`accepted` means Sol judged the bounded implementation satisfactory. It does
not mean Pyash automatically merged or pushed it. The worktree and diff remain
available for human inspection.

### Recovery

The claimed spool file stays in `world/holding/work/runtime/` until the
supervisor reaches `accepted` and acknowledges success. A `blocked` task stays
in the runtime spool (or input spool when blocked before claiming), so it is
visible and cannot be mistaken for successful work. `work resume <task-id>
--context ...` records the human response, preserves all prior threads,
worktree, plans, evidence, and history, abandons an ambiguous active turn
explicitly, and returns the task to `ready`.

Before each external Codex turn, the supervisor persists a deterministic
request identity and `started` state. After the adapter returns, it persists
the turn id and complete bounded result before applying the phase checkpoint.
On restart, a captured-but-not-applied result is consumed locally rather than
replaying Codex. If a turn is still `started` or otherwise ambiguous, the task
becomes `blocked` with the request identity and reason recorded. This is the
safe recovery boundary because the current App Server does not provide a
reliable Pyash-visible lookup that can prove an unknown turn completed.

`usage-limited` is distinct from `failed`: quota rejection clears the active
attempt for a later retry, while a remote operation whose outcome is unknown
remains human-resumable. Accepted work is terminal and is never silently
reopened.

Ordinary failures before a remote operation use the existing retry policy.
Filesystem evidence is collected after the worker turn, but the completed
turn result is already durable, so a restart can collect evidence and finish
without another worker turn. There is still no distributed lease/heartbeat
for two independently started supervisors; operationally run one background
coding worker per world until stale-runtime ownership is added.

## Unattended Operation

The operator surface is intentionally small:

```text
work_supervisor.mjs add --title ... --prompt ... --acceptance ...
work_supervisor.mjs list [--active]
work_supervisor.mjs show <task-id>
work_supervisor.mjs run-next
work_supervisor.mjs block <task-id> --reason ...
work_supervisor.mjs resume <task-id> --context ...
work_supervisor.mjs fail|cancel <task-id> [--reason ...]
work_supervisor.mjs background [--continuous] [--watch]
work_supervisor.mjs report <task-id>
work_supervisor.mjs health
```

Human output is compact; `--json` exposes the complete durable task or
snapshot. The status includes priority, phase, role models, worktree,
blocker, last action, and revision count. No command merges, commits, pushes,
or deletes an accepted worktree.

`--watch` attaches an optional observer to the same supervisor events used by
the runner. It renders capacity admission, selection, Sol planning, Luna
implementation, tests and diff evidence, review decisions, revisions, and
terminal outcomes without exposing JSONL protocol traffic or token deltas.
The reusable report renderer reads the persisted task/checkpoint/evidence
artifacts, so `report <task-id>` produces the same report body after the
original process has exited. This body is intentionally suitable for a later
email or other notifier.

`program/runtime/work/capacity.mjs` normalizes the installed Codex
`account/rateLimits/read` response, including its nested `rateLimits.primary`
window, to `available`, `usage-limited`, or
`unknown`, with remaining/used percentage, reset time, window, observed time,
and the raw provider payload. Unknown capacity is conservative and defers
background work. The background policy also defers when foreground activity is
reported, when no eligible task exists, or when remaining capacity is at or
below the default 20 percent reserve. It is disabled by default; the explicit
`background` command enables it for that invocation. `--near-reset` is an
operator choice to spend capacity that would otherwise expire. Continuous
mode polls rather than busy-waits and processes one coding task at a time.

Scheduler health is a named `.pya` artifact under
`world/holding/work/artifacts/scheduler-health.pya`. Task decisions and
outcomes are also appended to the world newspaper, including selection
reason, plan, implementation, tests, review, revision count, blocker, and
capacity state.

## Proof

### Implemented

- durable named `.pya` checkpoint sections;
- deterministic priority selection and durable turn idempotency checkpoints;
- explicit blocked/resume lifecycle and operator commands;
- normalized capacity observation, conservative background admission, and
  scheduler health/newspaper outcomes;
- extracted shared App Server JSONL transport;
- configurable manager/worker roles and reasoning effort;
- one Sol plan -> Luna implementation -> Sol review cycle;
- one revision loop with a revision cap;
- task-specific detached Git worktrees;
- runtime recovery for persisted checkpoints and usage limits;
- explicit supervisor and smoke commands.

### Proven by fake tests

`quiz/runtime/codex_app_server.test.mjs` covers initialization, thread start,
thread resume, streamed assistant output, diff/file-change events, server
errors, malformed responses, and process exit. `quiz/runtime/work_queue.test.mjs`,
`quiz/runtime/work_supervisor.test.mjs`, and `quiz/runtime/work_runner.test.mjs`
cover checkpoint round trips, priority ordering, ACCEPT, REVISE, BLOCK,
blocked/resume, ambiguous-turn recovery, usage-limited recovery, capacity
admission, queue acknowledgement, scheduler health, and role/workspace
evidence.

### Proven by real Codex smoke

`npm run work:smoke` created a temporary Git repository and ran the complete
real cycle with the installed App Server models. The successful run produced a
real Sol work order, a real Luna file and test result in the isolated worktree,
real Git evidence, a real Sol `ACCEPT`, and an acknowledged empty queue.

The smoke command uses `danger-full-access` only for its disposable fixture
because this host's nested workspace-write sandbox failed with
`bwrap: loopback: Failed RTM_NEWADDR`. The normal supervisor default remains
`workspace-write` with the task worktree as its writable root.

### Proven by real Pyash language task

The watched background command was run against the genuine Pyash task
`language-ret-register-live` (priority 131), which closed a specific ceremony
`ret` register-parity gap. The terminal showed capacity admission, task
selection, a Sol plan, Luna implementation, tests and diff evidence, a Sol
`REVISE` request, a second Luna implementation, and a final Sol `ACCEPT`.
The accepted task is retained in its isolated worktree with one revision and
was not merged or pushed into `master`:

```text
/home/htaf/pyash/world/holding/work/worktrees/language-ret-register-live
```

The live run also exposed and fixed a real runner boundary: after selecting a
task, the runner now passes that task id into the supervisor for an exact
claim, so an older ready task cannot be substituted between selection and
execution. The host's nested Codex sandbox also required the explicitly
opt-in `PYA_CODEX_THREAD_SANDBOX=danger-full-access` and
`PYA_CODEX_TURN_SANDBOX=dangerFullAccess` settings for this demonstration;
the default remains unchanged.

## Options and Trade-offs

Codex App Server is the execution adapter because it supplies persistent
threads, streamed turns, model selection, interruption, and resumption while
Pyash retains task state, acceptance, retry, and evidence ownership. CAO-style
MCP orchestration and CCB/tmux bridges remain useful prior art for visible
sessions, handoff, callbacks, and human intervention, but they should wrap
Pyash records rather than replace the holding spool.

## Deferred Work

- distributed stale-runtime ownership, heartbeats, and two-supervisor fencing;
- formal machine-readable Sol plan/review schema beyond bounded headings;
- automatic merge, push, or cleanup of accepted worktrees;
- multi-host Codex execution, CAO/CCB replacement, and tmux dashboard work;
- generalized multi-worker concurrency;
- unrelated reporter parity and external house repairs;
- GPU peer routing and residency-aware forwarding.

## Next Highest-Value Slice

1. Add a durable accepted-worktree report and human merge/cleanup workflow,
   without giving Pyash automatic push authority.
2. Add stale-runtime ownership/heartbeat fencing before allowing two workers
   against one world.
3. Operate the seeded bounded backlog, then tune capacity reserve values from
   observed Codex rate-limit payloads rather than guesses.

## Sources

- `program/runtime/work/contract.mjs`
- `program/runtime/work/queue.mjs`
- `program/runtime/work/checkpoint.mjs`
- `program/runtime/work/supervisor.mjs`
- `program/runtime/codex/app_server.mjs`
- `documentation/specifications/04-runtime-primitives.md`
- `documentation/specifications/18-pyash-agent.md`
- `documentation/reference/gpu-housekeeper-architecture.md`
- `documentation/runbooks/reporter-refinery-recovery.md`
- `documentation/roadmap.md`
- `documentation/todo.md`
- [Codex App Server manual](https://learn.chatgpt.com/docs/app-server.md)
- [AWS CLI Agent Orchestrator](https://github.com/awslabs/cli-agent-orchestrator)
- [Claude Codex Bridge](https://github.com/SeemSeam/claude_codex_bridge)
