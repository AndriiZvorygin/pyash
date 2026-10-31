---
name: pyash-mcp-tool-debug
description: "Diagnose Pyash MCP tool misbehavior by reproducing against a fresh JSON-RPC server, tracing ceremony dispatch, and checking imperative `to`-target contracts."
---

# Pyash MCP Tool Debug

Use this skill when an MCP tool call (`be_*` tool) returns stale, wrong, or
inherited results even though the underlying verb module looks correct.

## Repeatable workflow

1. Reproduce outside the live session. The running MCP server keeps old code;
   spawn a fresh one in-process:
   ```bash
   node --input-type=module -e "
   import * as m from './command/pyash_mcp_server.mjs';
   const rt = await m.buildRuntime({ root: process.cwd(), toolsMap: 'agent tools' });
   const r = await m.handleToolsCall(rt, { name: '<tool name>', arguments: { ... } });
   console.log(JSON.stringify(r.structuredContent));
   "
   ```
2. Test the exact call sequence the session used (e.g. `command` then `read`).
   Single-call reproductions can pass while sequenced calls fail because
   earlier calls poison remembered facts (`result`, registers).
3. If the result is wrapped as `{ invoked, result }`, the call ran through a
   ceremony (`runDefinitionBody` in `program/bridge/sandpit.mjs`), not the
   built-in verb. Check `module/*.pya` (loaded by `configure/default.pya`)
   for a `def` whose signature matches the tool sentence, and watch for the
   `defTargetName && callerTarget` seed: it copies the caller's `to` fact
   into the ceremony's target register at body start.
4. Trace memory writes by matching signature: a write from
   `rememberCommandResult` (`program/verbs/command/audit.mjs`) only lands when
   `sentence.to.name` is a string. A missing write with a present `to` case
   usually means `handleImperative` rewrote `to`.
5. Known contract: in `program/bridge/imperative.mjs`, `useRawTo` lists the
   verbs whose `to` is a destination name. Any verb missing from that list
   receives `target.ob` instead of `to`, silently erasing the destination
   (this caused `command` outputs to vanish inside ceremonies; `read` then
   returned the previous command's output via the `read_auto.pya` ceremony).

## Quiz pattern

Encode the failing tool sequence as a JSON-RPC quiz that spawns the real
server (`quiz/read_tool_after_command.test.mjs` is the template): call the
polluting tool first, then the broken one, and assert the second call's
content does not contain the first call's output.