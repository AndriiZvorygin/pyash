import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { closeMcpServers, getMcpServerTools } from "../program/motor/mcp.mjs";

test("discharge closes mcp server", async () => {
  forget();
  const serverPath = path.resolve("quiz/fixtures/mcp_mock_server.json");
  doRemember({
    mood: "ya",
    su: { name: "mcp mock" },
    be: "default",
    ob: { text: "inline" },
    by: { ve: { type: "text", values: [serverPath] } }
  });

  await interpret(parse("from name mcp mock to name mcp mock be import do"));
  assert.ok(getMcpServerTools("mock").length > 0);

  await interpret(parse("be discharge ob name mcp mock as wo mcp do"));
  assert.equal(getMcpServerTools("mock").length, 0);

  closeMcpServers();
});
