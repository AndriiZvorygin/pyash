# Operating Recipe: Channel Stop Control

This recipe describes how to interrupt an in-flight agent run from channel traffic.
It applies to Matrix and other channel adapters routed through the same channel runtime.

## 1. Supported stop messages

Stop control matches these text forms (case-insensitive):

- `stop`
- `@<agent> stop`
- `<agent> stop`
- `stop @<agent>`
- `stop <agent>`

Examples:

- `stop`
- `@ccrc stop`
- `stop @ccrc`

If a message does not match these forms, it is treated as normal chat input.

## 2. What runtime does

When a stop control message is received:

1. Runtime does not forward that text to mind chat.
2. Runtime writes an interrupt request marker in:
   - `world/presence/<agent>-mind-interrupt.pya`
3. Runtime responds on channel:
   - `stop requested for <agent>` when an active run exists.
   - `no active run for <agent>` when no run is active.

When the running mind loop consumes the interrupt marker, the user-visible reply is:

- `stop requested; run interrupted`

## 3. Active-run and interrupt markers

During active mind execution, runtime keeps:

- `world/presence/<agent>-mind-active.pya`

Interrupt requests are cooperative and checked at mind loop boundaries/tool loop boundaries.
If backend execution is currently blocked in a long external call, stop is applied on the next interrupt check.

## 4. Quick verification runbook

1. Confirm scheduler/channel runtime is running:

```bash
pyash calendar health
```

2. In a public room or DM, send one of:
   - `@<agent> stop`
   - `stop @<agent>`
   - `stop`

3. Check immediate control acknowledgment in room:
   - `stop requested for <agent>` or `no active run for <agent>`

4. Inspect channel telemetry:

```bash
pyash channel log --agent <agent> --channel matrix --tail 120
```

Look for decisions:

- `stop_requested`
- `stop_no_active_run`

5. Optional file-level checks:

```bash
ls -l world/presence/*mind-active.pya world/presence/*mind-interrupt.pya
```

## 5. Troubleshooting

If `@agent stop` behaves like normal chat:

1. Confirm the room listener targets the intended agent (`channels.pya` listener/lane config).
2. Confirm exact agent name spelling in stop text.
3. Confirm message has only stop form tokens (no extra words).
4. Review channel telemetry and newspaper:
   - `world/newspaper/YYYYMMDD-channel-<channel>-<agent>.pya`

