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

test("read tool returns the requested file after a command tool call", async () => {
  const serverPath = path.resolve("command/pyash_mcp_server.mjs");
  const client = createJsonRpcClient({
    command: process.execPath,
    args: [serverPath, "--root", path.resolve(".")],
    cwd: path.resolve(".")
  });
  try {
    await client.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "quiz", version: "0.0.0" }
    });

    const commandCall = await client.send("tools/call", {
      name: "be_command_ob_text_to_name_text",
      arguments: { ob: "echo STALE_MARKER_OUTPUT" }
    });
    assert.match(String(commandCall?.content?.[0]?.text ?? ""), /STALE_MARKER_OUTPUT/);

    const read = await client.send("tools/call", {
      name: "be_read_from_filename",
      arguments: { from: path.resolve("README.md") }
    });
    const text = String(read?.content?.[0]?.text ?? "");
    assert.match(text, /Pyash/, "read should return README.md content");
    assert.doesNotMatch(text, /STALE_MARKER_OUTPUT/, "read must not return the previous command output");
  } finally {
    client.close();
  }
});