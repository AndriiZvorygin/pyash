import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { throwErrorSentence } from "../error.mjs";
import { remember } from "../remember/index.mjs";

const INTERPRET_TIMEOUT_MS = 500;
const INTERPRET_OUTPUT_LIMIT = 64 * 1024;

function resolveLanguage(sentence) {
  const raw = sentence?.as?.wo ?? sentence?.as?.name ?? sentence?.as?.text ?? "";
  return String(raw ?? "").trim().toLowerCase();
}

function resolveScriptText(sentence, { rememberFn } = {}) {
  const raw = sentence?.ob?.text;
  if (typeof raw === "string") return raw;
  const name = sentence?.ob?.name;
  if (typeof name === "string" && rememberFn) {
    const fact = rememberFn(name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return null;
}

function resolveTimeoutMs(sentence) {
  const during = sentence?.during;
  const raw = during?.num ?? during?.text ?? during?.name;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return INTERPRET_TIMEOUT_MS;
  return Math.max(1, Math.trunc(value * 1000));
}

function resolveVendoredPath(relativePath) {
  return fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
}

function ensureExecutable(filepath, label) {
  if (!filepath || !fsSync.existsSync(filepath)) {
    throwErrorSentence({
      name: "interpret defective",
      message: `interpret defective: ${label} missing`,
      from: { name: "interpret" },
      raw: { filepath }
    });
  }
  try {
    fsSync.accessSync(filepath, fsSync.constants.X_OK);
  } catch (err) {
    throwErrorSentence({
      name: "interpret defective",
      message: `interpret defective: ${label} not executable`,
      from: { name: "interpret" },
      raw: { filepath, error: err?.message }
    });
  }
}

function sanitizeErrorText(text, replacements) {
  let out = String(text ?? "");
  for (const value of replacements) {
    if (!value) continue;
    out = out.split(value).join("<sandbox>");
  }
  return out.trim();
}

async function runQuickJs({ scriptText, timeoutMs }) {
  const wasmtimePath = resolveVendoredPath("caterer/wasmtime/bin/wasmtime");
  const qjsPath = resolveVendoredPath("caterer/quickjs-wasi/qjs.wasm");
  ensureExecutable(wasmtimePath, "wasmtime");
  if (!fsSync.existsSync(qjsPath)) {
    throwErrorSentence({
      name: "interpret defective",
      message: "interpret defective: quickjs missing",
      from: { name: "interpret" },
      raw: { qjsPath }
    });
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-interpret-"));
  const scriptPath = path.join(tempDir, "script.js");
  await fs.writeFile(scriptPath, scriptText, "utf8");

  const args = [
    "run",
    "--dir",
    tempDir,
    qjsPath,
    "--",
    scriptPath
  ];

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;
    const proc = spawn(wasmtimePath, args, { stdio: ["ignore", "pipe", "pipe"] });

    const cleanup = async () => {
      if (finished) return;
      finished = true;
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    };

    const finalizeError = async (message, raw = {}) => {
      await cleanup();
      reject(Object.assign(new Error(message), { raw }));
    };

    const appendOutput = (chunk, target) => {
      if (!chunk) return;
      const text = chunk.toString("utf8");
      if (target === "stdout") stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > INTERPRET_OUTPUT_LIMIT) {
        timedOut = true;
        proc.kill("SIGKILL");
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timeout);
      const message = `interpret defective: runtime failure (${err?.code ?? "error"})`;
      finalizeError(message, { error: err?.message });
    });

    proc.stdout.on("data", chunk => appendOutput(chunk, "stdout"));
    proc.stderr.on("data", chunk => appendOutput(chunk, "stderr"));

    proc.on("close", async (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        const isLimit = stdout.length + stderr.length > INTERPRET_OUTPUT_LIMIT;
        const message = isLimit
          ? "interpret defective: output limit exceeded"
          : "interpret defective: timeout";
        await cleanup();
        reject(Object.assign(new Error(message), { stdout, stderr, code, timeout: !isLimit }));
        return;
      }
      if (code && code !== 0) {
        const sanitized = sanitizeErrorText(stderr, [tempDir, scriptPath, qjsPath, wasmtimePath]);
        const message = sanitized
          ? `interpret defective: ${sanitized}`
          : `interpret defective: exit ${code}`;
        await cleanup();
        reject(Object.assign(new Error(message), { stdout, stderr, code }));
        return;
      }
      await cleanup();
      resolve({ stdout, stderr });
    });
  });
}

export async function interpretScript(sentence) {
  const language = resolveLanguage(sentence);
  if (!language) {
    throwErrorSentence({
      name: "interpret defective",
      message: "interpret defective: missing language",
      from: { name: "interpret" },
      raw: { sentence }
    });
  }
  if (language !== "javascript") {
    throwErrorSentence({
      name: "interpret defective",
      message: `interpret defective: unsupported language ${language}`,
      from: { name: "interpret" },
      raw: { sentence }
    });
  }
  const scriptText = resolveScriptText(sentence, { rememberFn: remember });
  if (scriptText === null) {
    throwErrorSentence({
      name: "interpret defective",
      message: "interpret defective: missing script",
      from: { name: "interpret" },
      raw: { sentence }
    });
  }

  let result;
  try {
    const timeoutMs = resolveTimeoutMs(sentence);
    result = await runQuickJs({ scriptText, timeoutMs });
  } catch (err) {
    const message = err?.message ?? "interpret defective";
    const isTimeout = message.includes("timeout") || err?.timeout;
    throwErrorSentence({
      name: isTimeout ? "excessive_duration" : "interpret defective",
      message,
      from: { name: "interpret" },
      raw: { error: err?.raw ?? err?.stderr ?? err?.message }
    });
  }

  return {
    mood: "ya",
    be: "interpret",
    su: { name: "result" },
    ob: { text: result?.stdout ?? "" }
  };
}

export default interpretScript;

export const signatures = [
  { signatureWords: ["be", "interpret", "as", "wo", "javascript", "ob", "text"], handler: interpretScript },
  { signatureWords: ["be", "interpret", "as", "wo", "javascript", "ob", "name", "text"], handler: interpretScript },
  { signatureWords: ["be", "interpret", "as", "wo", "lua", "ob", "text"], handler: interpretScript },
  { signatureWords: ["be", "interpret", "as", "wo", "lua", "ob", "name", "text"], handler: interpretScript },
  { signatureWords: ["be", "interpret", "as", "wo", "python.micro", "ob", "text"], handler: interpretScript },
  { signatureWords: ["be", "interpret", "as", "wo", "python.micro", "ob", "name", "text"], handler: interpretScript },
  { signatureWords: ["be", "interpret", "as", "wo", "javascript", "during", "num", "ob", "text"], handler: interpretScript },
  { signatureWords: ["be", "interpret", "as", "wo", "javascript", "during", "num", "ob", "name", "text"], handler: interpretScript },
  { signatureWords: ["be", "interpret", "as", "wo", "lua", "during", "num", "ob", "text"], handler: interpretScript },
  { signatureWords: ["be", "interpret", "as", "wo", "lua", "during", "num", "ob", "name", "text"], handler: interpretScript },
  { signatureWords: ["be", "interpret", "as", "wo", "python.micro", "during", "num", "ob", "text"], handler: interpretScript },
  { signatureWords: ["be", "interpret", "as", "wo", "python.micro", "during", "num", "ob", "name", "text"], handler: interpretScript }
];
