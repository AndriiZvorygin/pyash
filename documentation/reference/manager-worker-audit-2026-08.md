# Pyash Manager and Worker Audit

Audit date: 2026-08-07

This document reconciles the older roadmap and the proposed Sol manager / Luna
worker direction with the repository state at `ed7dae5b`. It is an engineering
decision record for the first bounded implementation slice, not a promise that
the historical calendar dates remain current.

## Repository State

The repository was fetched and fast-forwarded before this audit. `master` is
clean, tracks `origin/master`, and has no other worktree or local branch with
unfinished changes. The current tip is the reporter hardening commit
`ed7dae5b`.

The latest work is active rather than abandoned WIP:

- reporter agenda, transcript verification, and refinery recovery were just
  hardened;
- GPU routing, KataGo support, and the housekeeper ownership boundary are
  already committed;
- watchdog state was recently moved into Pyash `.pya` records.

There are no modified or untracked files to preserve. External reporter houses
are intentionally not tracked in this repository. Commit `fd264b78` removed
the top-level Grey County house files, while shared reporter behavior now lives
in `program/library/reporter_shared/` and deployment-specific wrappers remain
house-local.

## Current Architecture

### Canonical Pyash state

Pyash already has the right persistence vocabulary for this problem:

- `world/house/<agent>/` owns identity, memory, sessions, conduct, artifacts,
  and gold;
- `world/newspaper/` records human-readable run outcomes;
- `world/holding/<lane>/` is the durable spool for external work;
- `.pya` files are the canonical state format, with JSON reserved for explicit
  interchange or generated reports;
- `duty`, `stream`, and `vyah await|finish|cancel` provide the existing runtime
  handle concepts;
- schedulers, channel routers, leases, retries, and agent presence already
  provide most of the operational vocabulary a worker needs.

The important missing generalization is a durable backlog record for bounded
engineering work. GPU, Android, and channel queues each implement a related
lane-specific envelope, but there is no shared work item carrying acceptance
criteria, priority, review state, retry state, and external thread metadata.

### GPU and workload runtime

The GPU path is substantially implemented:

- `program/runtime/gpu/queue.mjs` writes and claims the Pyash holding spool;
- `handle_status.mjs` persists queued/running/success/fail handles as `.pya`;
- `lease.mjs` provides exclusive TTL leases and heartbeats;
- `worker.mjs` claims, leases, submits, polls, writes the terminal handle, and
  acknowledges the spool item;
- `housekeeper_adapter.mjs` speaks to a host-local housekeeper;
- the housekeeper executes Ollama, ComfyUI, and KataGo jobs and exposes transient
  status;
- `documentation/reference/gpu-housekeeper-architecture.md` explicitly makes
  the Pyash holding spool the system of record.

The housekeeper does not duplicate the durable queue. Its job record is an
in-memory execution projection. This is the correct ownership boundary for
remote GPU hosts, including hosts that do not run Pyash locally.

Remaining runtime risks are real but outside this first slice: one configured
housekeeper URL per worker, no peer selection or forwarding yet, transient
remote status after a housekeeper restart, and possible duplicate execution if
the local worker dies after remote submission but before terminal handle
acknowledgement.

### Reporter and Grey/Owen parity

The shared reporter surface is now the dominant implementation:

- stage 2 grounding, stage 3 rendering, lineage, timing, motion attribution,
  attachment mirroring, quality verification, and transcript reliability are in
  `program/library/reporter_shared/`;
- `agenda-stage-contracts.mjs` validates canonical space-key `.pya` artifacts,
  contiguous coverage, parent/child lineage, monotonic chapters, source
  excerpts, and stage 3 summary shape;
- the current refinery runbook defines retryable generation failures,
  independent probes, shared pipeline locks, and `needs_human` for external
  authority or credentials;
- the current test suite has focused reporter, verifier, and refinery coverage.

Classification:

| Area | Status | Evidence / interpretation |
| --- | --- | --- |
| Shared Stage 2/3 contracts | DONE | `agenda-stage-contracts.mjs` and its quizzes enforce canonical artifact shapes and lineage. |
| Shared synthesis and quality logic | ACTIVE | Recent `ed7dae5b` changes show this is still being hardened. |
| Grey/Owen wrapper parity | PARTIAL | Houses are external; shared logic is in-repo, but live wrapper parity cannot be proven from this checkout. |
| JSON compatibility paths | PARTIAL / compatibility debt | `command/render_transcript_html_from_transcript_folder.mjs` still accepts legacy JSON and `meeting.json` fallbacks at the boundary. |
| Child chapter and timing validation | DONE at contract level | Contract validators cover ranges, backing chunks, lineage, monotonicity, source anchors, and timing. |
| Speaker auto-assignment and top-news quality | ACTIVE | Verifiers and grounded selection exist, but these remain quality-sensitive live workflows. |
| Agenda publishing and cover upload | BLOCKED outside this repo when credentials or external services fail | The runbook correctly treats these as external-authority outcomes, not silent local success. |

The remaining work should stay shared when behavior is genuinely shared. New
paired Grey/Owen fixes would be a regression in architecture unless a source
adapter is truly different.

## Roadmap Reconciliation

The historical `documentation/roadmap.md` is valuable as design evidence but
its 2026 weekly calendar is stale. The present classifications are:

| Historical goal | Status | Current reality |
| --- | --- | --- |
| Parity-first interpreter / JS / C | ACTIVE | Core examples and many data-format/compiler goldens exist, but `documentation/parity/status.json` is not checked in and higher-level translation parity remains in `documentation/todo.md`. |
| Feature gates for lagging backends | PARTIAL | Gates and targeted parity tests exist; the full status inventory is not maintained as a current artifact. |
| Frozen specs before promotion | ACTIVE | Numbered specs are the source of truth, but the old roadmap still describes future work as if it were pending on its original dates. |
| Growing golden / replay corpus | ACTIVE | Examples, newspapers, artifacts, retry checkpoints, and `again` support exist; breadth and live-backend coverage continue to grow. |
| Human-speakable sentence-shaped Pyash | ACTIVE | This remains a central design constraint and is implemented in the interpreter, docs, and `.pya` state surfaces. |
| Media IO and listen -> mind -> TTS loop | PARTIAL | `hear`, `say`, streaming, Piper, Whisper, and refinery examples exist; one simple unified production loop is not yet the default product path. |
| MCP bridge | DONE | MCP stdio/HTTP support, schemas, replay, policy, timeouts, restart, and `discharge` are implemented and tested. |
| Minimal agent loop | PARTIAL / ACTIVE | Agent houses, sessions, memory, channels, scheduler, MCP, Codex TUI projection, and watchdogs exist; a generic durable manager/worker backlog does not. |
| Concurrency | PARTIAL | Scheduler, leases, channels, and runtime lifecycle primitives exist; generalized fair-share work scheduling and cancellation/backpressure remain unfinished. |
| Replayable newspaper-style history | ACTIVE | Newspaper, artifacts, content-addressed outputs, checkpoints, and Pyash-first Codex projection exist; not every external workflow has the same replay fidelity. |
| Knowledge core, digestion, adjudication | HIGH-VALUE UNSTARTED | The old roadmap describes useful future capabilities, but no current implementation should be inferred from those sections. |
| Genetic programming / speculative packaging work | STALE | These are not the best next use of the current architecture or user capacity. |

The short `documentation/todo.md` is more current than the weekly roadmap for
language work: higher-level parity, richer mind reply envelopes, stale wording,
additional noun/class verbs, `hnuc` validation, ceremony error paths, and CLI
smoke coverage remain open.

## Manager and Worker Options

### Codex App Server

The installed Codex is `0.146.1`. The existing `command/codex_account.mjs`
already proves local stdio App Server integration for initialization, account
state, rate limits, and model listing. The current protocol also provides
persistent threads, thread goals, turns, streamed item events, interruption,
resumption, file-change events, model selection, and usage-limited statuses.
The exact version schema can be generated with
`codex app-server generate-json-schema`.

App Server is the best execution adapter for Sol and Luna because Pyash can own
the task, priority, retry, acceptance, and result records while storing only
Codex thread ids as external metadata. It also allows a future worker to
checkpoint on usage-limited events without treating a Codex cache as durable
business state. The adapter should use local stdio first; remote WebSocket
operation is experimental and should not become the first deployment contract.

### CAO-style MCP and tmux

AWS CLI Agent Orchestrator is useful prior art for supervisor-to-worker
delegation, asynchronous assignment, synchronous handoff, `send_message`, MCP
operations, status detection, and visible tmux sessions. It solves provider
launch and human observability problems well, but its supervisor/session layer
should not replace Pyash holding records.

### CCB and related tmux bridges

Claude Codex Bridge is useful for visible provider panes, worktrees, callbacks,
inboxes, project memory, attachment, and intervention. It is a good optional
operator surface. It is not the right owner for Pyash task state, retries,
usage policy, or replayable outcomes.

## Recommended Architecture

Use one coherent ownership model:

```text
world/holding/work/*.pya
        |
        v
Pyash work supervisor state machine
        |
        +--> Sol App Server thread: bounded plan and acceptance criteria
        |
        +--> Luna App Server thread: bounded implementation and tests
        |
        v
Pyash review outcome, diff/test evidence, newspaper, and handle
```

Pyash owns:

- durable task records and priorities;
- lifecycle state: `ready`, `planning`, `implementing`, `reviewing`,
  `revision`, `blocked`, `usage-limited`, `accepted`, `failed`;
- retry and resumption policy;
- foreground-over-background admission and usage checkpoints;
- acceptance criteria, tests, diffs, and durable results.

Codex App Server owns provider execution and thread continuity. Sol and Luna
are roles backed by persistent App Server threads, not separate durable queue
systems. tmux/CAO/CCB can be added later as an observation and intervention
surface around the same Pyash work item.

## Prioritized Course of Action

1. **Work item contract and holding lane.** Create the durable `.pya` task
   record, explicit state transitions, oldest-first claim, retry metadata, and
   tests. This is the first slice implemented in this audit.
2. **App Server execution adapter.** Extract/reuse the existing JSONL RPC
   pattern for persistent thread start/resume, goal updates, turn events,
   interruption, and usage/rate-limit snapshots. Keep it injectable in tests.
3. **Small supervisor.** Add one bounded cycle: select one ready task, ask Sol
   for a plan and acceptance criteria, persist the plan, then hand off to Luna.
   Foreground work must preempt background work; usage-limited status must leave
   a resumable record.
4. **Independent review and evidence.** Run Luna's declared tests and diff
   checks, have Sol review the bounded result, and write a Pyash newspaper
   outcome plus accepted/rejected artifact.
5. **Operational integration.** Attach scheduler health, agent presence, Matrix
   reporting, and optional tmux/CAO/CCB observation. Only after local recovery
   is reliable should GPU-housekeeper-style peer routing be generalized.

## First Slice and Acceptance Criteria

This change adds `program/runtime/work/` and the `world/holding/work/` lane.
It deliberately does not launch Codex or make `.codex` state canonical yet.

Acceptance criteria:

- a task is represented by a `.pya` envelope in the Pyash holding area;
- the envelope carries bounded prompt and acceptance text, priority, retry cap,
  and Sol/Luna thread metadata;
- status records are `.pya`, not ad hoc JSON;
- task states and legal transitions are explicit and validated;
- oldest-first claim is atomic through the existing spool rename operation;
- success and terminal failure move the claimed record to the existing produce
  paths;
- tests cover round-trip persistence, ordering, transitions, invalid states,
  retry metadata, and terminal acknowledgement.

## Deferred Work

- multi-host Codex routing and peer forwarding;
- automatic GPU-housekeeper host selection and residency scoring;
- a custom CAO/CCB replacement;
- background quota prediction beyond the App Server rate-limit snapshot;
- streaming mind work through the durable queue;
- broad parity cleanup unrelated to the work-item contract;
- reporter wrapper changes that belong to external house deployments;
- knowledge-core and genetic-programming roadmap branches.

## Sources

- `documentation/specifications/04-runtime-primitives.md`
- `documentation/specifications/18-pyash-agent.md`
- `documentation/reference/agent-tui-session-projection.md`
- `documentation/reference/gpu-housekeeper-architecture.md`
- `documentation/runbooks/reporter-refinery-recovery.md`
- `documentation/roadmap.md`
- `documentation/todo.md`
- `command/codex_account.mjs`
- [Codex App Server manual](https://learn.chatgpt.com/docs/app-server.md)
- [AWS CLI Agent Orchestrator](https://github.com/awslabs/cli-agent-orchestrator)
- [Claude Codex Bridge](https://github.com/SeemSeam/claude_codex_bridge)
