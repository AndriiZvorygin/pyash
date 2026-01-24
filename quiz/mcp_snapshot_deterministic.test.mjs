import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder } from "../program/bridge/exchange.mjs";
import { closeMcpServers, getMcpServerTools } from "../program/motor/mcp.mjs";
import { jsonObjectFromPyash } from "../program/verbs/exchange/write_json.mjs";

async function runSnapshot(runRoot) {
  forget();
  const records = [];
  const serverPath = path.resolve("quiz/fixtures/mcp_mock_server.json");
  setExchangeRecorder({ record: (sentence) => records.push(sentence), runRoot });
  doRemember({
    mood: "ya",
    su: { name: "mock" },
    be: "mcp",
    ob: { text: "inline" },
    by: { ve: { type: "text", values: [serverPath] } }
  });
  await interpret(parse("from name mcp mock to name mcp mock be import do"));
  await interpret(parse("ob text \"ok\" be mcp mock echo do"));
  const tools = getMcpServerTools("mock").map(tool => tool.toolId);
  const artifact = records.find(s => s?.be === "artifact" && s?.to?.filename === "artifacts/mcp/mock-tools.json");
  assert.ok(artifact, "snapshot artifact recorded");
  const snapshotPath = path.join(runRoot, artifact.to.filename);
  const bytes = await fs.readFile(snapshotPath);
  const snapshotJson = jsonObjectFromPyash(bytes.toString("utf8"), { rootName: "mcp mock tools snapshot" });
  const capabilitySentence = records.find(s => s?.be === "json map" && s?.mood === "def" && String(s?.su?.name || "").startsWith("mcp capability "));
  closeMcpServers();
  clearExchangeRecorder();
  return { bytes, records, tools, snapshotJson, capabilitySentence };
}

test("mcp snapshot bytes and tool hashes are deterministic", async () => {
  const runRoot1 = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mcp-snap-"));
  const runRoot2 = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mcp-snap-"));

  const first = await runSnapshot(runRoot1);
  const second = await runSnapshot(runRoot2);

  assert.equal(first.bytes.toString("utf8"), second.bytes.toString("utf8"));
  assert.deepEqual(first.tools, second.tools);

  const snapshotSentence1 = first.records.find(s => s?.be === "tool snapshot");
  const snapshotSentence2 = second.records.find(s => s?.be === "tool snapshot");
  assert.equal(snapshotSentence1?.ob?.text, snapshotSentence2?.ob?.text);
  assert.ok(first.snapshotJson?.capabilities, "snapshot includes capabilities");
  assert.ok(first.capabilitySentence, "capability sentence emitted");
});
