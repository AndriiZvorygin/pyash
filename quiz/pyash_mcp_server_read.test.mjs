import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
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

test("MCP read expands home-relative paths without agent sandbox context", async () => {
  const configRoot = process.cwd();
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mcp-home-read-project-"));
  const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mcp-home-read-"));
  const previousHome = process.env.HOME;
  await fs.writeFile(path.join(homeRoot, "note.md"), "home-relative read\n", "utf8");

  try {
    const runtime = await buildRuntime({ root: projectRoot, configRoot, toolsMap: "saddle tools" });
    const readTool = runtime.tools.find((tool) => tool.name.startsWith("be_read_from_filename"));
    assert.ok(readTool, "expected the saddle read capability");

    process.env.HOME = homeRoot;
    const result = await handleToolsCall(runtime, {
      name: readTool.name,
      arguments: { from: "~/note.md" }
    });

    assert.equal(result.isError, undefined, result.content?.[0]?.text ?? "missing MCP error detail");
    assert.equal(result.content[0].text, "home-relative read\n");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    process.chdir(configRoot);
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(homeRoot, { recursive: true, force: true });
  }
});
