import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { buildRuntime, handleToolsCall } from "../command/pyash_mcp_server.mjs";

test("MCP read returns each requested file's contents without a stale command result wrapper", async () => {
  const root = process.cwd();
  const runtime = await buildRuntime({ root, toolsMap: "saddle tools" });
  const readTool = runtime.tools.find((tool) => tool.name.startsWith("be_read_from_filename"));
  assert.ok(readTool, "expected the saddle read capability");

  const expectedPackage = await fs.readFile(path.join(root, "package.json"), "utf8");
  const expectedReadme = await fs.readFile(path.join(root, "README.md"), "utf8");
  const packageResult = await handleToolsCall(runtime, {
    name: readTool.name,
    arguments: { from: path.join(root, "package.json") }
  });
  const readmeResult = await handleToolsCall(runtime, {
    name: readTool.name,
    arguments: { from: path.join(root, "README.md") }
  });

  assert.equal(packageResult.isError, undefined);
  assert.equal(readmeResult.isError, undefined);
  assert.equal(packageResult.content[0].text, expectedPackage);
  assert.equal(readmeResult.content[0].text, expectedReadme);
  assert.notEqual(readmeResult.content[0].text, packageResult.content[0].text);
  assert.equal(readmeResult.structuredContent.result.text, expectedReadme);
});
