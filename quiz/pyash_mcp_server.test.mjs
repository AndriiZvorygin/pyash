import test from "node:test";
import assert from "node:assert/strict";
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
