# Maintaining the Pyash Coding Saddle

This runbook is for agents changing the terminal coding saddle: its prompt,
tools, turn lifecycle, terminal UI, session state, and user-visible behavior.
For launch options and user controls, see [Pyash Coding Saddle](../reference/pyash-coding-saddle.md).
For capability targets, see the [Coding Saddle Capability Standard](../reference/coding-saddle-capability-standard.md).

## Source ownership

| Area | Primary source | Change it when |
| --- | --- | --- |
| CLI lifecycle, input dispatch, model selection, status, shutdown | `command/pyash_saddle.mjs` | A terminal interaction or command lifecycle changes. |
| Agent prompt, completion evidence, request classification, worktree summary command | `program/agent/coding_saddle.mjs` | Agent behavior, evidence rules, or the end-of-turn path summary changes. |
| Markdown rendering, terminal layout, keyboard decoding, resize redraw | `program/agent/coding_saddle_tui.mjs` | Text rendering, cursor/layout, project path display, or resize behavior changes. |
| Project house and identity files | `program/agent/coding_saddle_house.mjs` | Project-specific durable state or seeded agent guidance changes. |
| Session and model-selection persistence | `program/agent/coding_saddle_state.mjs` | Session history or saved backend/model behavior changes. |
| Context compaction, plan, trace, usage | `program/agent/coding_saddle_context.mjs`, `coding_saddle_plan.mjs`, `coding_saddle_trace.mjs`, `coding_saddle_usage.mjs` | Those specific durable contracts change. |
| Default terminal tool map and agent instructions | `module/saddle_bash_tools.pya`, `world/house/base/identity/TOOLS.md` | The default Bash surface or guidance about existing Pyash tools changes. |
| Runtime integration | Existing Pyash mind and GPU Housekeeper paths called from `command/pyash_saddle.mjs` | Only when integrating a supported provider or lifecycle behavior. |

The terminal saddle is an adapter around Pyash's existing mind and tool
runtime. Keep provider requests on their configured path; route local model
work through GPU Housekeeper when available. Do not add a parallel model
runner or a second tool-policy system. The default terminal tool map exposes
one `bash(command)` tool; web search and other workflows are explained in the
agent house's `identity/TOOLS.md` and use existing Pyash facilities.

## Turn and display flow

1. `command/pyash_saddle.mjs` resolves the active project directory, loads the
   project-scoped saddle house and session, and initializes the terminal UI.
2. The input decoder distinguishes idle submission, Enter steering, Tab queue,
   newlines, slash commands, and cancellation. Enter steering interrupts the
   active turn and combines new context with the original request for a
   restarted turn. Tab queues a separate message until the current turn ends.
3. The CLI builds a normal Pyash mind call with the selected backend, model,
   session history, and saddle tool map. Tool results are returned to that
   same turn and recorded for completion checks.
4. `runSaddleTurnWithEvidence` in `program/agent/coding_saddle.mjs` decides
   whether a request needs an edit and a later successful validation. The
   returned worktree review is for terminal presentation; it is not another
   model call.
5. `program/agent/coding_saddle_tui.mjs` renders status, progress, tool events,
   streamed Markdown, input, and help. It owns terminal width calculations
   and debounced resize redraws.

The status header's `project:` line must identify the resolved absolute
working directory. Relative Bash paths resolve from that directory. The
automatic post-edit worktree summary lists at most 20 changed paths; it
deliberately does not print file contents or diff hunks. It may include changes
that were already present in the shared worktree. For detailed inspection, run
an explicit read-only Bash command such as `git diff -- path` or `git status
--short`.

## Change workflow

1. Read the source owner above, the matching section in the user reference,
   and the current `AGENTS.md`. Check `git status --short` and preserve any
   unrelated shared-worktree edits.
2. Add or update the smallest failing scenario first. Prefer a TUI unit test
   for a pure layout/rendering rule and a PTY test when keyboard behavior,
   terminal redraw, the CLI lifecycle, model switching, or visible output is
   involved.
3. Make the smallest source change in the owning module. Keep CLI wiring in
   `command/pyash_saddle.mjs`; keep reusable behavior in `program/agent/` so
   unit tests can exercise it without starting another model.
4. Run the focused tests after the final edit. A PTY scenario should assert
   what the user sees and the request/tool result that backs it, not just that
   a helper returned the expected value.
5. Update the user reference and this runbook whenever controls, output,
   persistence, or test workflows change. Update the capability standard if
   the accepted user-visible behavior or its status changes.
6. Run the documentation prose guard and the repository-required test/check
   set. Follow `AGENTS.md` for `dev` synchronization, commits, and publishing;
   do not stage unrelated worktree changes.

## Scenario test map

| Behavior | Test to extend or run | What it should prove |
| --- | --- | --- |
| Prompt, completion evidence, model/session selection, and worktree summary | `quiz/coding_saddle.test.mjs` | Missing/failed evidence stays incomplete; current path and safe status are truthful; project/session settings remain isolated. |
| Rendering, Unicode width, composer, visible status, and resize bursts | `quiz/coding_saddle_tui.test.mjs` | The rendered screen preserves text and shows the project path after layout changes; pending redraws are cancelled on shutdown. |
| End-to-end terminal, model switch, Bash tool, and visible output | `quiz/coding_saddle_pty.test.mjs` | The real CLI runs in a PTY, routes requests to the selected model, preserves response text across resizes, shows the active project, and emits no automatic diff contents. |
| Enter steering, Tab queue, interrupt ordering, and model switch | `quiz/coding_saddle_input_queue_pty.test.mjs` | Steering waits for confirmed cancellation before replacement submission; Tab delivery follows the active turn. |
| Bash-only default and tool-result presentation | `quiz/saddle_bash_tools.test.mjs`, `quiz/coding_saddle_tool_flow.test.mjs` | The default model tool schema is exactly the supported Bash surface and errors/results retain useful status and stderr. |
| House, context, plan, trace, and usage persistence | Matching `quiz/coding_saddle_{house,context,plan,trace,usage}.test.mjs` files | Durable state remains scoped, replayable, and correctly reported. |

The PTY CLI scenarios use a local deterministic Housekeeper fixture. They
exercise the production CLI and PTY boundary without requiring a running model;
they verify protocol and rendering behavior, not answer quality. For a live
provider check, use `node command/run_coding_saddle_gate.mjs` only when its
configured Housekeeper and model are available. Do not replace that route with
an unmanaged direct Ollama request.

## Useful checks

Run the focused policy and display suites:

```sh
node --test quiz/coding_saddle.test.mjs quiz/coding_saddle_tui.test.mjs
```

Run the real CLI-in-PTY scenarios, including model switching and Enter/Tab
behavior:

```sh
node --test quiz/coding_saddle_pty.test.mjs quiz/coding_saddle_input_queue_pty.test.mjs
```

Check the default tool contract and completion flow:

```sh
node --test quiz/saddle_bash_tools.test.mjs quiz/coding_saddle_tool_flow.test.mjs
```

Check documentation and run the full repository suite before publishing:

```sh
node command/check_doc_prose.mjs
npm test
```

The resize handler waits for a short quiet interval before drawing at the
settled terminal size. Keep a regression case that changes PTY dimensions more
than once while a long response is visible; a single static-width render test
will not cover tmux's resize sequence.
