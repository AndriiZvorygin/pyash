import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function createJsonRpcClient({ command, args, cwd }) {
  const proc = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  proc.stdin.setDefaultEncoding("utf8");
  let nextId = 1;
  let buffer = "";
  const pending = new Map();

  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx === -1) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg?.id == null) continue;
      const slot = pending.get(msg.id);
      if (!slot) continue;
      pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(String(msg.error?.message ?? "jsonrpc error")));
      else slot.resolve(msg.result);
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

  const close = () => {
    try { proc.kill(); } catch {}
  };

  return { send, close, proc };
}

test("pyash mcp server lists tools and executes exists tool", async () => {
  const serverPath = path.resolve("command/pyash_mcp_server.mjs");
  const client = createJsonRpcClient({
    command: process.execPath,
    args: [serverPath, "--root", path.resolve(".")],
    cwd: path.resolve(".")
  });
  try {
    const init = await client.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "quiz", version: "0.0.0" }
    });
    assert.equal(init?.protocolVersion, "2024-11-05");

    const list = await client.send("tools/list", {});
    const tools = Array.isArray(list?.tools) ? list.tools : [];
    assert.equal(tools.length > 0, true);
    const existsTool = tools.find((tool) => String(tool?.name ?? "").startsWith("be_exists_"));
    assert.ok(existsTool, "expected exists tool in tools/list");

    const call = await client.send("tools/call", {
      name: existsTool.name,
      arguments: { ob: path.resolve("AGENTS.md") }
    });
    assert.equal(Array.isArray(call?.content), true);
    const text = String(call?.content?.[0]?.text ?? "");
    assert.equal(text.length > 0, true);
    const boolValue = call?.structuredContent?.value?.bool;
    assert.equal(boolValue === true || boolValue === false, true);
  } finally {
    client.close();
  }
});

test("pyash mcp server loads the selected saddle tools map", async () => {
  const markdownPath = path.resolve("artifacts", `mcp-download-markdown-${process.pid}.md`);
  const previousDownloadResponse = process.env.PYA_DOWNLOAD_RESPONSE;
  process.env.PYA_DOWNLOAD_RESPONSE = "<h1>Retrieved page</h1><p>Useful source text.</p>";
  const serverPath = path.resolve("command/pyash_mcp_server.mjs");
  const client = createJsonRpcClient({
    command: process.execPath,
    args: [serverPath, "--root", path.resolve("."), "--tools-map", "saddle tools"],
    cwd: path.resolve(".")
  });
  try {
    const list = await client.send("tools/list", {});
    const tools = Array.isArray(list?.tools) ? list.tools : [];
    const descriptions = tools.map((tool) => String(tool?.description ?? ""));
    assert.equal(tools.length, 15);
    assert.ok(descriptions.some((description) => description.includes("su name read from filename input be read")));
    assert.ok(descriptions.some((description) => description.includes("su name command ob text")));
    assert.ok(descriptions.some((description) => description.includes("su name repair ob text")));
    const archiveFocusTool = tools.find((tool) => tool.name === "read_archive_focus");
    assert.ok(archiveFocusTool, "expected the semantic archive-focus tool");
    assert.match(archiveFocusTool.description, /Read a bounded passage/u);
    assert.deepEqual(archiveFocusTool.inputSchema?.required, ["archive_path", "entry_path", "focus"]);
    assert.ok(descriptions.some((description) => description.includes('su name session plan ob text "input" fromstate text "coding saddle plan" be write can')));
    const archiveSearchTool = tools.find((tool) => tool.name === "search_archive");
    assert.ok(archiveSearchTool, "expected the archive-scoped ZIM search capability");
    assert.match(archiveSearchTool.description, /archive file is mounted.*archive_path is a local archive path.*remote-only archives/u);
    assert.deepEqual(archiveSearchTool.inputSchema?.required, ["archive_path", "query"]);
    const zimSearchTool = tools.find((tool) => tool.name === "search_zim_library");
    assert.ok(zimSearchTool, "expected the query-only ZIM search capability");
    assert.match(zimSearchTool.description, /configured Kiwix ZIM service.*resolves the host-configured endpoint.*usable full page URL.*Pass that returned URL unchanged/u);
    assert.deepEqual(zimSearchTool.inputSchema?.required, ["query"]);
    assert.deepEqual(Object.keys(zimSearchTool.inputSchema?.properties ?? {}), ["query"]);
    const downloadTool = tools.find((tool) => String(tool?.name ?? "").startsWith("be_download_as_wo_web_"));
    assert.ok(downloadTool, "expected web download capability in the saddle tools map");
    assert.deepEqual(downloadTool.inputSchema?.required, ["from", "to"]);

    const downloadMarkdownTool = tools.find((tool) => String(tool?.name ?? "").startsWith("be_download_markdown_"));
    assert.ok(downloadMarkdownTool, "expected Markdown download capability in the saddle tools map");
    assert.deepEqual(downloadMarkdownTool.inputSchema?.required, ["from", "to"]);
    const markdownDownload = await client.send("tools/call", {
      name: downloadMarkdownTool.name,
      arguments: { from: "https://example.com/page.html", to: markdownPath }
    });
    assert.equal(markdownDownload?.isError, undefined);
    assert.match(await fs.readFile(markdownPath, "utf8"), /Retrieved page\nUseful source text\./u);

    const readMarkdownTool = tools.find((tool) => String(tool?.name ?? "")
      .startsWith("be_read_markdown_from_filename"));
    assert.ok(readMarkdownTool, "expected bounded HTML-to-Markdown capability in the saddle tools map");
    assert.deepEqual(readMarkdownTool.inputSchema?.required, ["from"]);
    assert.match(readMarkdownTool.description, /atmost byte 65536/u);

    const readTool = tools.find((tool) => String(tool?.name ?? "").startsWith("be_read_from_filename"));
    assert.ok(readTool, "expected read capability in the saddle tools map");
    const read = await client.send("tools/call", {
      name: readTool.name,
      arguments: { from: path.resolve("AGENTS.md") }
    });
    assert.match(String(read?.content?.[0]?.text ?? ""), /Pyash/i);
  } finally {
    client.close();
    if (previousDownloadResponse === undefined) delete process.env.PYA_DOWNLOAD_RESPONSE;
    else process.env.PYA_DOWNLOAD_RESPONSE = previousDownloadResponse;
    await fs.rm(markdownPath, { force: true });
  }
});

test("saddle MCP command errors expose failure diagnostics to the model", async () => {
  const serverPath = path.resolve("command/pyash_mcp_server.mjs");
  const client = createJsonRpcClient({
    command: process.execPath,
    args: [serverPath, "--root", path.resolve("."), "--tools-map", "saddle tools"],
    cwd: path.resolve(".")
  });
  try {
    const list = await client.send("tools/list", {});
    const commandTool = list?.tools?.find((tool) => tool.name === "be_command_ob_text_to_name_text");
    assert.ok(commandTool, "expected the saddle command tool");
    const commandText = `node -e "process.stdout.write('stdout-from-failed-tool\\n'); process.stderr.write('stderr-from-failed-tool\\n'); process.exit(9)"`;
    const result = await client.send("tools/call", {
      name: commandTool.name,
      arguments: { ob: commandText }
    });
    assert.equal(result?.isError, true);
    const visibleText = String(result?.content?.[0]?.text ?? "");
    assert.match(visibleText, /status=9/u);
    assert.ok(visibleText.includes(`command: ${commandText}`));
    assert.ok(visibleText.includes(`working directory: ${path.resolve(".")}`));
    assert.match(visibleText, /stdout:\nstdout-from-failed-tool/u);
    assert.match(visibleText, /stderr:\nstderr-from-failed-tool/u);
  } finally {
    client.close();
  }
});

test("pyash mcp server loads tools from Pyash while operating in an external project", async () => {
  const installRoot = path.resolve(".");
  const serverPath = path.join(installRoot, "command", "pyash_mcp_server.mjs");
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mcp-external-project-"));
  const notePath = path.join(projectRoot, "project-note.txt");
  await fs.writeFile(notePath, "external workspace tool access works\n", "utf8");
  const client = createJsonRpcClient({
    command: process.execPath,
    args: [
      serverPath,
      "--root", projectRoot,
      "--config-root", installRoot,
      "--tools-map", "saddle tools"
    ],
    cwd: projectRoot
  });
  try {
    const init = await client.send("initialize", { protocolVersion: "2024-11-05" });
    assert.equal(init?.protocolVersion, "2024-11-05");
    const list = await client.send("tools/list", {});
    const readTool = list?.tools?.find((tool) => String(tool?.name ?? "").startsWith("be_read_from_filename"));
    assert.ok(readTool, "expected the installed saddle read tool");
    const read = await client.send("tools/call", {
      name: readTool.name,
      arguments: { from: notePath }
    });
    assert.equal(read?.content?.[0]?.text, "external workspace tool access works\n");
  } finally {
    client.close();
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
