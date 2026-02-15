import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  resolveHost,
  resolveApiKey,
  buildChatCompletionsRequest,
  requestJson,
  requestStream
} from "../program/motor/openai_mind.mjs";

function parseArgs(argv) {
  const args = argv.slice(2);
  const stream = args.includes("--stream");
  const payloadIndex = args.indexOf("--payload");
  const payloadFileIndex = args.indexOf("--payload-file");
  const payload = payloadIndex !== -1 ? args[payloadIndex + 1] ?? "" : null;
  const payloadFile = payloadFileIndex !== -1 ? args[payloadFileIndex + 1] ?? "" : null;
  return { stream, payload, payloadFile };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
}

async function parsePayload() {
  const { stream, payload: payloadArg, payloadFile } = parseArgs(process.argv);
  let raw = "";
  if (payloadArg != null) raw = payloadArg;
  else if (payloadFile) raw = await fs.promises.readFile(payloadFile, "utf8");
  else raw = await readStdin();
  if (!raw.trim()) throw new Error("mind_openai_runner: missing request payload");
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    throw new Error(`mind_openai_runner: invalid JSON payload (${err?.message ?? err})`);
  }
  payload.stream = stream || payload.stream === true;
  return payload;
}

function textPart(part) {
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  return "";
}

function messageContentText(message = {}) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(textPart).filter(Boolean).join("\n");
  }
  return "";
}

function buildCodexPrompt(payload = {}) {
  if (String(payload?.mode || "").toLowerCase() === "generate") {
    return String(payload?.prompt || "");
  }
  const lines = [];
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  for (const message of messages) {
    const role = String(message?.role || "user").toUpperCase();
    const text = messageContentText(message);
    if (!text) continue;
    lines.push(`${role}: ${text}`);
  }
  if (lines.length === 0 && payload?.prompt) {
    lines.push(`USER: ${String(payload.prompt)}`);
  }
  return lines.join("\n\n");
}

async function runCodexFallback(payload = {}, { stream = false } = {}) {
  const model = String(payload?.model || "gpt-5-codex").trim() || "gpt-5-codex";
  const prompt = buildCodexPrompt(payload);
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pyash-codex-runner-"));
  const outputPath = path.join(tmpDir, "last-message.txt");
  try {
    const args = [
      "exec",
      "--model", model,
      "--color", "never",
      "--ephemeral",
      "--output-last-message", outputPath,
      "-"
    ];
    const proc = spawnSync("codex", args, {
      input: prompt,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 8 * 1024 * 1024
    });
    if (proc.error) throw proc.error;
    if (proc.status !== 0) {
      const stderr = String(proc.stderr || "").trim();
      throw new Error(`codex exec failed: status=${proc.status}${stderr ? ` stderr=${JSON.stringify(stderr)}` : ""}`);
    }
    const responseText = String(await fs.promises.readFile(outputPath, "utf8")).trim();
    if (stream) {
      const chunks = responseText.split(/\s+/).filter(Boolean);
      for (const chunk of chunks) {
        process.stdout.write(`${JSON.stringify(`${chunk} `)}\n`);
      }
      process.stdout.write("[STREAM_END]\n");
      return null;
    }
    return {
      response: responseText,
      message: { content: responseText }
    };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const payload = await parsePayload();

  if (process.env.PYA_COMMAND_RESPONSE) {
    process.stdout.write(`${process.env.PYA_COMMAND_RESPONSE}\n`);
    return;
  }

  const host = resolveHost(payload);
  const apiKey = resolveApiKey({ host, payload });
  if (!apiKey) {
    const fallback = await runCodexFallback(payload, { stream: payload.stream === true });
    if (fallback) process.stdout.write(`${JSON.stringify(fallback)}\n`);
    return;
  }
  const body = await buildChatCompletionsRequest(payload);

  if (payload.stream === true) {
    await requestStream({
      host,
      apiKey,
      body,
      onChunk: (chunk) => {
        process.stdout.write(`${JSON.stringify(String(chunk))}\n`);
      }
    });
    process.stdout.write("[STREAM_END]\n");
    return;
  }

  const result = await requestJson({ host, apiKey, body });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.message ?? String(err)}\n`);
  process.exit(1);
});
