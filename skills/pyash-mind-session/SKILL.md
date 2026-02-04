---
name: pyash-mind-session
description: "Capture and review what was learned from mind tool calls and sessions; use when analyzing tool-call behavior, verbose runs, or newspaper logs for mind usage."
---

# Pyash Mind Session Notes

Use this skill to record what the model did during tool-call sessions and to keep a short, actionable summary.

## When to use

- You ran a `mind` tool-call flow and need a short summary of what happened.
- You need to capture tool-call behavior from `--verbose` or the newspaper.
- You want to record what was learned about tool selection or tool-call failures.

## What to capture (minimal)

1. **Run context**: command used, run-id (if any), model name.
2. **Tool-call outcome**: which tools were called (or not), in order.
3. **Observed issue**: missing call, wrong argument shape, tool refusal, etc.
4. **Evidence**: reference the newspaper section or the verbose line that proves it.
5. **Next action**: one concrete change (prompt, tool map, signature, or spec).

Keep it to 5–10 bullet points. Avoid long prose.

## Where to record

- Use `documentation/notes/mind-session/<date>-<short-topic>.md` (create if missing).
- Prefer date format `YYYY-MM-DD`.

## How to verify tool calls

- Use `--verbose` on `./run` to see tool calls as they happen.
- Use `--newspaper` + `--run-id` and inspect:
  - `... response ... tool_calls ...` for tool-call emission.
  - `... tool ...` messages for tool results.

## Common failure patterns

- Model returns a natural language answer with **no tool_calls**.
- Tool name mismatch (signature changes vs tool map).
- Argument shape mismatch (case key order or type words).
- Tool map not passed (`with name <map>` missing).
