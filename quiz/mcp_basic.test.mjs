import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember, remember } from "../program/remember/index.mjs";
import { closeMcpServers } from "../program/motor/mcp.mjs";

test("mcp module import exposes tool calls", async () => {
  forget();

  const serverPath = path.resolve("quiz/fixtures/mcp_mock_server.json");
  doRemember({
    mood: "ya",
    su: { name: "mcp mock" },
    be: "default",
    ob: { text: "inline" },
    by: { ve: { type: "text", values: [serverPath] } }
  });

  const importSentence = parse("from name mcp mock to name mcp mock be import do");
  await interpret(importSentence);

  const callSentence = parse("ob text \"hello\" be mcp mock echo do");
  await interpret(callSentence);

  assert.deepEqual(remember("result")?.ob, { text: "hello" });
  closeMcpServers();
});
