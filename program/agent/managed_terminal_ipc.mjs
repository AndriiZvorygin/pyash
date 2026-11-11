import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DAEMON_PATH = fileURLToPath(new URL("../../command/pyash_terminal_manager.mjs", import.meta.url));
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function worldIdentity(worldRoot, uid, projectRoot) {
  return crypto.createHash("sha256")
    .update(`${path.resolve(worldRoot)}\n${path.resolve(projectRoot || worldRoot)}\n${uid}`)
    .digest("hex")
    .slice(0, 24);
}

function terminalIdentityOptions({ uid } = {}) {
  return uid ?? (typeof process.getuid === "function" ? process.getuid() : process.env.USER || "user");
}

export function managedTerminalSocketPath(worldRoot, {
  projectRoot = "",
  platform = process.platform,
  uid = typeof process.getuid === "function" ? process.getuid() : process.env.USER || "user",
  tmpdir = os.tmpdir()
} = {}) {
  const owner = terminalIdentityOptions({ uid });
  const identity = worldIdentity(worldRoot, owner, projectRoot);
  if (platform === "win32") return `\\\\.\\pipe\\pyash-terminal-${identity}`;
  return path.join(tmpdir, `pyash-terminal-${identity}`, "manager.sock");
}

async function ensurePrivateRuntimeDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await fs.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("terminal manager runtime path must be a real directory");
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error("terminal manager runtime directory has a different owner");
  }
  await fs.chmod(directory, 0o700);
}

function runtimeDirectoryForSocket(socketPath) {
  if (!socketPath.startsWith("\\\\.\\pipe\\")) return path.dirname(socketPath);
  const identity = crypto.createHash("sha256").update(socketPath).digest("hex").slice(0, 24);
  return path.join(os.tmpdir(), `pyash-terminal-${identity}`);
}

function connect(socketPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("terminal manager connection timed out"));
    }, timeoutMs);
    timer.unref?.();
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function ensureDaemon({ worldRoot, projectRoot, socketPath, startupTimeoutMs }) {
  try {
    const socket = await connect(socketPath, 250);
    socket.end();
    return;
  } catch (error) {
    if (!new Set(["ENOENT", "ECONNREFUSED", "EACCES", "ETIMEDOUT"]).has(error?.code)) throw error;
  }

  const runtimeDirectory = runtimeDirectoryForSocket(socketPath);
  await ensurePrivateRuntimeDirectory(runtimeDirectory);
  const lockPath = path.join(runtimeDirectory, "manager.lock");
  const deadline = Date.now() + startupTimeoutMs;
  let lock = null;
  while (Date.now() < deadline) {
    try {
      lock = await fs.open(lockPath, "wx", 0o600);
      await lock.writeFile(`${process.pid}\n`, "utf8");
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const socket = await connect(socketPath, 200);
        socket.end();
        return;
      } catch (connectError) {
        if (!new Set(["ENOENT", "ECONNREFUSED", "EACCES", "ETIMEDOUT"]).has(connectError?.code)) throw connectError;
      }
      let stale = false;
      try {
        const [contents, stats] = await Promise.all([fs.readFile(lockPath, "utf8"), fs.stat(lockPath)]);
        const pid = Number(contents.trim());
        if (Date.now() - stats.mtimeMs > 30000) {
          if (!Number.isSafeInteger(pid) || pid <= 0) stale = true;
          else {
            try {
              process.kill(pid, 0);
            } catch (processError) {
              stale = processError?.code === "ESRCH";
            }
          }
        }
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw statError;
      }
      if (stale) await fs.rm(lockPath, { force: true });
      else await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!lock) throw new Error("terminal manager startup lock timed out");

  let child;
  try {
    child = spawn(process.execPath, [DAEMON_PATH], {
      detached: true,
      stdio: "ignore",
      cwd: path.resolve(projectRoot),
      env: {
        ...Object.fromEntries([
          "APPDATA", "COMSPEC", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA", "LOGNAME", "PATH",
          "PATHEXT", "SHELL", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "USER", "WINDIR"
        ].filter((key) => Object.prototype.hasOwnProperty.call(process.env, key))
          .map((key) => [key, process.env[key]])),
        PYASH_TERMINAL_MANAGER: "true",
        PYASH_TERMINAL_WORLD_ROOT: path.resolve(worldRoot),
        PYASH_TERMINAL_PROJECT_ROOT: path.resolve(projectRoot),
        PYASH_TERMINAL_SOCKET: socketPath
      }
    });
    child.unref();

    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const socket = await connect(socketPath, 250);
        socket.end();
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    child.kill("SIGTERM");
    throw new Error(`terminal manager did not become ready: ${lastError?.message ?? "startup timeout"}`);
  } finally {
    await lock.close().catch(() => {});
    await fs.rm(lockPath, { force: true });
  }
}

export async function requestManagedTerminal(worldRoot, projectRoot, request, {
  timeoutMs = 5000,
  startupTimeoutMs = 5000,
  socketPath = managedTerminalSocketPath(worldRoot, { projectRoot })
} = {}) {
  const action = String(request?.action ?? "request");
  await ensureDaemon({ worldRoot, projectRoot, socketPath, startupTimeoutMs });
  const socket = await connect(socketPath, timeoutMs);
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      socket.destroy();
      reject(new Error(`terminal manager ${action} request timed out`));
    }, timeoutMs);
    timer.unref?.();
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_RESPONSE_BYTES) {
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(new Error("terminal manager response exceeded size limit"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0 || settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (!response?.ok) throw new Error(String(response?.error ?? "terminal manager request failed"));
        resolve(response.result);
      } catch (error) {
        reject(error);
      } finally {
        socket.end();
      }
    });
    socket.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    socket.end(`${JSON.stringify(request)}\n`);
  });
}
