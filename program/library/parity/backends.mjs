import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const COMMANDS = { interpreter: "run", javascript: "runjs", c: "runc" };
const DEFAULT_TIMEOUT_MS = 120_000;
const FIXTURE_ENV = [
  "PYA_MIND_RESPONSE",
  "PYA_HEAR_FIXTURE",
  "PYA_PIPER_FIXTURE",
  "PYA_COMMAND_RESPONSE"
];

export const BACKENDS = ["interpreter", "javascript", "c"];

export function repoRoot() {
  return ROOT;
}

function cleanEnv() {
  const env = { ...process.env };
  for (const key of FIXTURE_ENV) delete env[key];
  return env;
}

export function normalizeOutput(text, tempDir) {
  return String(text ?? "")
    .split(/\r?\n/u)
    .map((line) => line.split(tempDir).join("<tmp>").trimEnd())
    .filter((line) => line.length > 0);
}

function spawnBackend(command, file, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, [file], {
      cwd,
      env: cleanEnv(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (buf) => {
      stdout += buf.toString();
    });
    child.stderr.on("data", (buf) => {
      stderr += buf.toString();
    });
    child.on("error", (error) => {
      finish({ code: -1, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      finish({ code, stdout, stderr, timedOut });
    });
  });
}

export async function runBackendCase(backend, lines, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const command = COMMANDS[backend];
  if (!command) throw new Error(`unknown parity backend: ${backend}`);
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-parity-"));
  try {
    const file = path.join(cwd, "program.pya");
    await fs.writeFile(file, `${lines.join("\n")}\n`, "utf8");
    const result = await spawnBackend(path.join(ROOT, command), file, { cwd, timeoutMs });
    return {
      backend,
      code: result.code,
      timedOut: result.timedOut,
      lines: normalizeOutput(result.stdout, cwd),
      stderr: result.stderr
    };
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

export async function runCase(backends, lines, options = {}) {
  const outputs = {};
  for (const backend of backends) {
    outputs[backend] = await runBackendCase(backend, lines, options);
  }
  return outputs;
}
