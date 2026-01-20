import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder, setExchangeStrict } from "../program/bridge/exchange.mjs";
import { closeMcpServers, getMcpServerTools } from "../program/motor/mcp.mjs";
import { jsonToPyashText } from "../program/verbs/exchange/json_map.mjs";

test("mcp replay uses snapshot and skips discovery", async () => {
  forget();
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mcp-replay-"));
  const snapshot = {
    server: "mock",
    tools: {
      from_snapshot: {
        description: "snapshot only",
        inputSchema: { type: "object", properties: { ob: { type: "string" } } },
        outputSchema: null
      }
    }
  };
  const { text: snapshotText } = jsonToPyashText(snapshot, "mcp mock tools snapshot", { existingNames: [] });
  const snapshotPath = path.join(runRoot, "artifacts/mcp/mock-tools.json");
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.writeFile(snapshotPath, snapshotText, "utf8");

  setExchangeRecorder({ record: () => {}, runRoot });
  setExchangeStrict(true);

  const serverPath = path.resolve("quiz/fixtures/mcp_mock_server.json");
  doRemember({
    mood: "ya",
    su: { name: "mcp mock" },
    be: "default",
    ob: { text: "inline" },
    by: { ve: { type: "text", values: [serverPath] } }
  });

  await interpret(parse("from name mcp mock to name mcp mock be import do"));
  const toolNames = getMcpServerTools("mock").map(tool => tool.name);
  assert.deepEqual(toolNames, ["from_snapshot"]);

  closeMcpServers();
  clearExchangeRecorder();
});
