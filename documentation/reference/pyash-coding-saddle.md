# Pyash Coding Saddle

The coding saddle is the terminal projection for an interactive Pyash coding
session. It is deliberately small: Pyash remains responsible for the mind
call, agent house, session `.pya`, tool policy, worktree boundary, provider
queue, and discharge lifecycle.

## Run

From the repository root:

```sh
node command/pyash_saddle.mjs
```

The default model/backend/host come from `configure/default.pya`. Local
overrides may be supplied through `PYA_SADDLE_MODEL`, `PYA_SADDLE_BACKEND`,
`PYA_SADDLE_HOST`, and `PYA_SADDLE_CWD`; these select an existing provider and
coding root, they do not start a separate model runtime.

## Controls

Enter submits the current request. Shift+Enter inserts a newline on terminals
that report the standard modified-key sequence; `Ctrl+J` is the portable
newline fallback. `Ctrl+C` writes the existing Pyash mind-interrupt signal and
`Ctrl+D` exits. `/status`, `/model <name>`, `/backend <name>`, `/host <url>`,
`/discharge`, and `/exit` are local saddle commands.

## Durable state

Conversation records use the existing coding-saddle agent house and session
files. Tool calls go through `module/saddle_tools.pya`, so command, read,
write, list, and repair continue to use the existing command policy and
checkpoint/newspaper conventions. The terminal display is only a projection;
it is not an authoritative transcript or task queue.

The next roadmap tranche connects a request to an existing `WorkTask`. That
handoff keeps the same normal planner, implementer, independent reviewer,
checkpoint, recovery, and `automation/roadmap` integration path.

## Provider lifecycle

The saddle shows the current provider and local Pyash GPU queue depth before a
turn. Model loading and residency remain external to Criterion and to this
terminal command. `/discharge` and normal exit use the existing Pyash Ollama
discharge path when the selected backend is Ollama; other providers retain
their own existing lifecycle hooks.
