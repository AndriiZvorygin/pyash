import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder } from "../program/bridge/exchange.mjs";
import { closeMcpServers } from "../program/motor/mcp.mjs";

test("mcp tool timeout is deterministic", async () => {
  forget();
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });
  const serverPath = path.resolve("quiz/fixtures/mcp_mock_server.json");
  doRemember({
    mood: "ya",
    su: { name: "mock" },
    be: "mcp",
    ob: { text: "inline" },
    by: { ve: { type: "text", values: [serverPath] } }
  });

  await interpret(parse("from name mcp mock to name mcp mock be import do"));

  await assert.rejects(
    () => interpret(parse("by num 0.001 be mcp mock slow do")),
    (err) => err?.sentence?.su?.name === "mcp tool timeout"
  );
  assert.ok(records.some(s => s?.be === "error" && s?.su?.name === "mcp tool timeout"));
  closeMcpServers();
  clearExchangeRecorder();
});
