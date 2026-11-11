#!/usr/bin/env node
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { createManagedTerminalManager, spawnNodePty } from "../program/agent/managed_terminal.mjs";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

function quote(value) {
  return JSON.stringify(String(value ?? ""));
}

function withinRoot(target, root) {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function terminalDirectory(worldRoot) {
  return path.join(worldRoot, "house", "coding saddle", "terminal");
}

async function createEventWriter(worldRoot) {
  const directory = terminalDirectory(worldRoot);
  const counters = new Map();
  await fs.mkdir(directory, { recursive: true });
  return async (event) => {
    const filename = path.join(directory, `${event.terminalId}.pya`);
    const index = (counters.get(event.terminalId) ?? 0) + 1;
    counters.set(event.terminalId, index);
    const lines = [
      `su name terminal event ${index} be map def`,
      `  su name terminal id ob text ${quote(event.terminalId)} ya`,
      `  su name event type ob text ${quote(event.type)} ya`,
      `  su name event time ob text ${quote(event.at)} ya`
    ];
    for (const fieldName of ["command", "cwd", "signal", "output", "mind", "model", "sessionName", "outputSha256"]) {
      if (event[fieldName] !== undefined) lines.push(`  su name ${fieldName} ob text ${quote(event[fieldName])} ya`);
    }
    for (const fieldName of ["bytes", "cursor", "columns", "rows", "exitCode", "outputTruncated"]) {
      if (Number.isSafeInteger(event[fieldName])) lines.push(`  su name ${fieldName} ob num ${event[fieldName]} ya`);
      else if (typeof event[fieldName] === "boolean") lines.push(`  su name ${fieldName} ob bool ${event[fieldName] ? "truth" : "lie"} ya`);
    }
    if (Array.isArray(event.args)) lines.push(`  su name arguments ob text ${quote(JSON.stringify(event.args))} ya`);
    if (event.sha256) lines.push(`  su name input sha256 ob text ${quote(event.sha256)} ya`);
    lines.push("prah", "");
    await fs.appendFile(filename, lines.join("\n"), "utf8");
  };
}

function response(socket, value) {
  const line = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(line, "utf8") <= MAX_REQUEST_BYTES) socket.end(line);
  else socket.end(`${JSON.stringify({ ok: false, error: "terminal manager response exceeded size limit" })}\n`);
}

async function dispatch(manager, request, shutdown) {
  const action = String(request?.action ?? "").trim();
  if (action === "shutdown") {
    setImmediate(() => { void shutdown(); });
    return { status: "stopping" };
  }
  if (!["start", "read", "write", "resize", "status", "list", "close"].includes(action)) {
    throw new Error(`terminal manager action unsupported: ${action || "(empty)"}`);
  }
  if (action === "list") return manager.list();
  return manager[action](request);
}

async function run() {
  if (process.env.PYASH_TERMINAL_MANAGER !== "true") {
    throw new Error("terminal manager is an internal Pyash service");
  }
  const worldRootRaw = String(process.env.PYASH_TERMINAL_WORLD_ROOT ?? "").trim();
  const projectRootRaw = String(process.env.PYASH_TERMINAL_PROJECT_ROOT ?? "").trim();
  const worldRoot = path.resolve(worldRootRaw);
  const projectRoot = path.resolve(projectRootRaw);
  const socketPath = String(process.env.PYASH_TERMINAL_SOCKET ?? "").trim();
  if (!worldRootRaw || !projectRootRaw || !socketPath) throw new Error("terminal manager configuration is incomplete");
  const persistEvent = await createEventWriter(worldRoot);
  const manager = createManagedTerminalManager({
    spawnPty: spawnNodePty,
    authorizeLaunch: async ({ cwd }) => withinRoot(cwd, projectRoot),
    persistEvent
  });
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let handled = false;
    const timer = setTimeout(() => socket.destroy(), 10000);
    timer.unref?.();
    socket.on("data", (chunk) => {
      if (handled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_REQUEST_BYTES) {
        handled = true;
        clearTimeout(timer);
        response(socket, { ok: false, error: "terminal manager request exceeded size limit" });
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      clearTimeout(timer);
      try {
        const request = JSON.parse(buffer.slice(0, newline));
        Promise.resolve(dispatch(manager, request, shutdown)).then(
          (result) => response(socket, { ok: true, result }),
          (error) => response(socket, { ok: false, error: String(error?.message ?? error) })
        );
      } catch (error) {
        response(socket, { ok: false, error: String(error?.message ?? error) });
      }
    });
    socket.once("close", () => clearTimeout(timer));
  });

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await new Promise((resolve) => server.close(resolve));
    await manager.closeAll({ signal: "SIGTERM" });
    if (process.platform !== "win32") await fs.rm(socketPath, { force: true });
  };

  if (process.platform !== "win32") await fs.rm(socketPath, { force: true });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  if (process.platform !== "win32") await fs.chmod(socketPath, 0o600);

  process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
  process.once("uncaughtException", (error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    void shutdown().finally(() => process.exit(1));
  });
  process.once("unhandledRejection", (error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    void shutdown().finally(() => process.exit(1));
  });
}

run().catch((error) => {
  process.stderr.write(`[terminal manager] ${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
