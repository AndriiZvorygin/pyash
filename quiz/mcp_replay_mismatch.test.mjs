import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder, setExchangeStrict } from "../program/bridge/exchange.mjs";
import { closeMcpServers } from "../program/motor/mcp.mjs";
import { jsonObjectFromPyash } from "../program/verbs/exchange/write_json.mjs";
import { jsonToPyashText } from "../program/verbs/exchange/json_map.mjs";

async function recordSnapshot(runRoot) {
  forget();
  const serverPath = path.resolve("quiz/fixtures/mcp_mock_server.json");
  setExchangeRecorder({ record: () => {}, runRoot });
  doRemember({
    mood: "ya",
    su: { name: "mcp mock" },
    be: "default",
    ob: { text: "inline" },
    by: { ve: { type: "text", values: [serverPath] } }
  });
  await interpret(parse("from name mcp mock to name mcp mock be import do"));
  const snapshotPath = path.join(runRoot, "artifacts/mcp/mock-tools.json");
  const snapshotText = await fs.readFile(snapshotPath, "utf8");
  closeMcpServers();
  clearExchangeRecorder();
  return { snapshotPath, snapshotText };
}

test("mcp replay refuses snapshot toolId drift", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mcp-drift-"));
  const { snapshotPath, snapshotText } = await recordSnapshot(runRoot);
  const snapshot = jsonObjectFromPyash(snapshotText, { rootName: "mcp mock tools snapshot" });
  assert.ok(snapshot?.tools?.echo, "echo tool snapshot exists");
  snapshot.tools.echo.inputSchema = {
    type: "object",
    properties: { ob: { type: "number" } },
    required: ["ob"],
    additionalProperties: false
  };
  const { text: driftText } = jsonToPyashText(snapshot, "mcp mock tools snapshot", { existingNames: [] });
  await fs.writeFile(snapshotPath, driftText, "utf8");

  forget();
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence), runRoot });
  setExchangeStrict(true);
  await assert.rejects(
    () => interpret(parse("from name mcp mock to name mcp mock be import do")),
    (err) => err?.sentence?.su?.name === "mcp snapshot mismatch"
  );
  assert.ok(records.some(s => s?.be === "error" && s?.su?.name === "mcp snapshot mismatch"));
  closeMcpServers();
  clearExchangeRecorder();
});
