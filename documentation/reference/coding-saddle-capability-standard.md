# Coding Saddle Capability Standard

This is Pyash's practical acceptance standard for a useful interactive coding
saddle. It describes user-visible capabilities and evidence, not feature parity
with one vendor or a commitment to reproduce every advanced agent feature.

The standard is informed by public coding-agent harnesses, whose documented
surfaces include persistent sessions, tools, execution boundaries, approvals,
progress, and recovery. Pyash keeps its own `.pya` state and provider/Housekeeper
contracts as the implementation basis. See the official [Codex harness overview](https://developers.openai.com/blog/codex-as-a-platform),
[Codex sandbox guidance](https://developers.openai.com/api/docs/guides/agents/sandboxes),
and [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage).

## Status

`Present` means the behavior is available and covered by a test or documented
runtime evidence. `Partial` means a useful path exists but misses an important
part of the expectation. `Gap` means the saddle does not provide a first-class
path today. Status reflects the repository on 2026-11-03.

| Priority | Capability | User expectation | Pyash status | Acceptance evidence |
| --- | --- | --- | --- | --- |
| Core | Project context | Start in the selected project, inspect its instructions and files, and keep project history separate from other directories. | Partial: project-root tools and per-project history work; project instructions are not automatically loaded. | Start from two directories; history remains isolated; project guidance is discoverable and applied. |
| Core | File and repository tools | Read, search, inspect, create, and edit files through a consistent tool surface. | Present: read, list, see, write, command, repair, and repair-check tools; search is available through shell commands such as `rg`. | Tool tests cover schemas, project-root access, edits, and returned results. |
| Core | Run and verify | Run focused tests or checks and show the actual command and result before claiming completion. | Present for recognized code-change turns: completion requires a successful edit and a later relevant command with structured exit code 0, no signal, and no timeout. | Tests reject missing, failed, timed-out, or pre-edit validation evidence; the saddle shows the command and exit result. |
| Core | Responsive composer | Keep editing while a response runs; preserve drafts and allow follow-up messages to queue in order. | Partial: the editor remains active and the terminal dispatches queued messages sequentially; the TUI indicates `next>`/`queue N>`. Slash commands wait for the current turn. | TUI tests verify editable input and visible cursor while busy; an interaction test verifies FIFO delivery and persistence. |
| Core | Progress and tool visibility | Show that work is active, expose tool calls/results, and report failures without hiding them. | Partial: elapsed progress and tool events are visible; OpenAI-compatible SSE assistant text streams incrementally, while Housekeeper-managed local inference remains buffered by its job transport. | A slow tool turn shows progress; every tool call has a visible result or error; stream-capable provider responses update assistant text as deltas arrive. |
| Core | Stop and recover | Interrupt active work deliberately, leave the UI usable, and resume the saved conversation after restart. | Partial: Ctrl+C requests a Pyash mind interrupt; Ctrl+D exits; saved turns resume, while in-flight recovery depends on the backend. Escape does not interrupt. | Test cancellation for each provider; restart after interruption without losing completed messages or misreporting the active turn. |
| Core | Session continuity | Resume a named conversation in the same project and select the intended model for it. | Present: project-scoped transcript and per-session model settings; new projects inherit only the recent model preference. | Restart and resume a session; a different project starts with empty history and can inherit the latest model settings. |
| Core | Provider controls | Choose backend and model, and inspect effective context/reasoning settings and local queue state. | Present: `/mind`, `/model`, `/context`, `/think`, `/host`, and `/status`; available usage is shown when the provider returns it. | Provider-specific tests verify selection, persistence, context/effort behavior, and status display. |
| Core | Permission truth | Make the actual filesystem and command boundary clear; broad access requires deliberate policy. | Partial: Pyash tool-root policy and command policy apply, but project scope is not an OS sandbox because commands run as the worker account. | Show effective scope before work; enforce it at execution; disclose when OS-level isolation is absent. |
| Core | Change review | Make changed paths and the proposed diff easy to inspect before accepting or committing work. | Present: after a code-edit turn, the saddle displays bounded current worktree status and tracked/untracked diff excerpts; credential-like file contents are omitted. | A fixture test verifies changed paths, both diff types, secret-content filtering, and read-only command classification. |
| Core | Durable state and audit | Preserve user/assistant turns and enough operational context to diagnose tool or provider failures. | Partial: project `.pya` session history and visible tool events exist; there is no unified per-turn trace artifact for every backend event. | Reopen a session and inspect a turn's provider, tools, outcomes, and final status from durable records. |
| Daily use | Plan and task tracking | Turn a multi-step request into visible, revisable steps with completion state. | Present: `/plan` shows the current session plan, `/plan clear` clears it, and the model can create/update ordered steps through the Pyash tool map; completion requires evidence. | Plan state is stored as session-isolated `.pya`; tests cover persistence, updates, evidence gates, and session isolation. |
| Daily use | Live response streaming | See response text arrive as generated, separately from progress heartbeat and tool events. | Partial: SSE-capable OpenAI-compatible backends, including Z.AI Coding Plan, stream text and tool-call deltas; Housekeeper-managed Ollama/Strata preserve their buffered response contract. | Stream-capable provider responses update the TUI incrementally; other transports remain visibly active and return their completed response. |
| Daily use | Context awareness | Surface context usage/limits and handle long sessions without silently losing relevant project state. | Present with conservative limits: at 80%, provider input usage is preferred, otherwise a character-based estimate is used; a `.pya` continuity note retains older turns while the active transcript window keeps up to 12 recent exchanges and shrinks further if needed. | Tests cover provider-usage priority, estimate fallback, the 80% trigger, persisted checkpoint, and recent-window reduction. |
| Daily use | Approval checkpoints | Present consequential commands or permission expansions with enough detail for a human decision. | Partial: existing command policy and ratification paths apply; there is no uniform terminal approval card for every risky action. | Display exact action, affected paths, and scope; accept, reject, or cancel without losing session state. |
| Extended | Background work | Let long tasks continue after the terminal closes and reattach to their progress. | Partial: the web Duty surface and workers provide durable work; a local interactive turn is foreground-bound. | Start, detach, reattach, inspect logs, and accept/reject a durable job from the saddle. |
| Extended | Parallel agents | Delegate independent work and bring back attributable results for review. | Gap: no first-class subagent or parallel-task control in the terminal saddle. | Each worker has a scoped assignment, isolated work area, status, and reviewable result. |
| Extended | Rich workspace preview | Inspect images, rendered pages, or running application previews in context. | Partial: the `see` tool can inspect images; there is no integrated browser/live-preview surface. | Open a generated or running artifact and return to the same session without losing the composer. |

## Attainment rule

The saddle is a dependable everyday coding surface when every Core row is
`Present`, with tests for user-visible behavior and truthful disclosure of
execution boundaries. Daily-use and Extended rows can be scheduled by value;
they are not prerequisites for useful repository work.

The standard favors a small number of coherent, composable features. A new
surface should build on Pyash sessions, minds, tool maps, policy, Housekeeper,
and durable work contracts instead of creating a parallel model or permission
system.

## Current priorities

1. Add an interaction-level test for composing and queueing follow-up messages
   during inference; the current unit coverage checks editor visibility, while
   FIFO behavior is currently verified by code path rather than a terminal
   integration fixture.
2. Improve interruption and in-flight recovery across provider transports.
3. Clarify and strengthen command approval and OS isolation boundaries.
4. Add durable resumable execution for work that must continue after the
   interactive terminal closes.
