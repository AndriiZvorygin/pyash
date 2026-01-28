import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder } from "../program/bridge/exchange.mjs";
import { canonicalJsonStringify } from "../program/verbs/exchange/write_json.mjs";
import { closeMcpServers, getMcpServerTools } from "../program/motor/mcp.mjs";

let hasFilesystemServer = false;
try {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  req.resolve("@modelcontextprotocol/server-filesystem");
  hasFilesystemServer = true;
} catch {}

const skipFilesystem = process.env.PYA_SKIP_MCP_FILESYSTEM === "1" || !hasFilesystemServer;

test("mcp filesystem server records snapshot and exposes tools", { skip: skipFilesystem, timeout: 120000 }, async () => {
  forget();
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mcp-"));
  const allowedDir = await fs.mkdtemp(path.join(runRoot, "fs-"));
  const allowedDir2 = await fs.mkdtemp(path.join(runRoot, "fs2-"));

  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence), runRoot });

  try {
    doRemember({
      mood: "ya",
      su: { name: "files" },
      be: "mcp",
      ob: { text: "npx" },
      by: { ve: { type: "text", values: ["-y", "@modelcontextprotocol/server-filesystem", allowedDir, allowedDir2] } }
    });

    await interpret(parse("from name mcp files to name mcp files be import do"));
    await interpret(parse(`ob text "${allowedDir}" be mcp files list_directory do`));

    const snapshotSentence = records.find(s => s?.be === "tool snapshot" && s?.su?.name === "mcp files");
    assert.ok(snapshotSentence?.ob?.text, "snapshot sentence should be recorded");
    assert.ok(snapshotSentence.ob.text.includes("be json map def"), "snapshot should be pyash map text");

    const artifactSentence = records.find(s => s?.be === "artifact" && s?.to?.filename === "artifacts/mcp/files-tools.json");
    assert.ok(artifactSentence, "snapshot artifact should be recorded");

    const tools = getMcpServerTools("files");
    assert.ok(Array.isArray(tools) && tools.length > 0, "snapshot should include tools");
    const listTool = tools.find(tool => tool.name === "list_directory") ?? tools[0];
    const record = {
      server: "files",
      name: listTool.name,
      description: listTool.description ?? "",
      inputSchema: listTool.inputSchema ?? null,
      outputSchema: listTool.outputSchema ?? null
    };
    const hash = crypto.createHash("sha256").update(canonicalJsonStringify(record)).digest("hex");
    assert.equal(listTool.toolId, `sha256:${hash}`);
  } finally {
    closeMcpServers();
    clearExchangeRecorder();
  }
});
