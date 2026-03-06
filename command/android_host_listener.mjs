import http from "node:http";
import { spawn } from "node:child_process";

function usage() {
  return "Usage: node command/android_host_listener.mjs [--host 0.0.0.0] [--port 5057] [--token <secret>]";
}

function readFlagValue(args = [], flag = "") {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  if (index + 1 >= args.length) return "";
  return String(args[index + 1] ?? "");
}

function parseInteger(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
}

function shortText(value, max = 200) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function toArgs(deviceId, args = []) {
  const serial = String(deviceId ?? "").trim();
  if (!serial) throw new Error("android bridge defective: missing deviceId");
  return ["-s", serial, ...args.map((value) => String(value))];
}

function validateArgs(args = []) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error("android bridge rejected: args must be non-empty array");
  }
  const root = String(args[0] ?? "").trim().toLowerCase();
  const allow = new Set(["shell", "push", "pull"]);
  if (!allow.has(root)) {
    throw new Error(`android bridge rejected: unsupported adb root ${JSON.stringify(root)}`);
  }
}

function runAdbRaw({ deviceId, args = [], timeoutMs = 20000 } = {}) {
  validateArgs(args);
  return new Promise((resolve, reject) => {
    const child = spawn("adb", toArgs(deviceId, args), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`android adb timeout: ${args.join(" ")}`));
    }, Math.max(1000, Math.trunc(Number(timeoutMs) || 20000)));
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: Number(code) || 0,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function authorize(req, token = "") {
  if (!token) return true;
  const supplied = String(req.headers["x-pyash-token"] ?? "").trim();
  return supplied && supplied === token;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }

  const host = String(readFlagValue(args, "--host") ?? process.env.PYASH_ANDROID_BRIDGE_HOST ?? "0.0.0.0").trim();
  const port = parseInteger(readFlagValue(args, "--port") ?? process.env.PYASH_ANDROID_BRIDGE_PORT, 5057);
  const token = String(readFlagValue(args, "--token") ?? process.env.PYASH_ANDROID_BRIDGE_TOKEN ?? "").trim();

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/adb/run") {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      if (!authorize(req, token)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJsonBody(req);
      const deviceId = String(body?.deviceId ?? "").trim();
      const adbArgs = Array.isArray(body?.args) ? body.args : [];
      const timeoutMs = Math.max(1000, parseInteger(body?.timeoutMs, 20000));
      const result = await runAdbRaw({ deviceId, args: adbArgs, timeoutMs });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 400, { error: shortText(String(err?.message ?? err), 280) });
    }
  });

  server.listen(port, host, () => {
    const tokenState = token ? "token=required" : "token=off";
    console.log(`android bridge listening on http://${host}:${port} (${tokenState})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
