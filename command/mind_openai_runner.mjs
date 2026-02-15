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

function parseJsonLines(text = "") {
  const out = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !(trimmed.startsWith("{") || trimmed.startsWith("["))) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // ignore non-JSONL diagnostics
    }
  }
  return out;
}

function clipText(value, limit = 4000) {
  const text = String(value ?? "").replace(/\r/g, "").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function normalizeCodexToolName(item = {}) {
  return String(item?.tool_name ?? item?.name ?? item?.type ?? "tool").trim() || "tool";
}

function normalizeToolCallPayload(item = {}) {
  const rawArgs = item?.arguments ?? item?.input ?? item?.params ?? {};
  const args = (rawArgs && typeof rawArgs === "object") ? rawArgs : { value: String(rawArgs ?? "") };
  return {
    id: String(item?.id ?? ""),
    type: "function",
    function: {
      name: normalizeCodexToolName(item),
      arguments: JSON.stringify(args)
    }
  };
}

function mapCodexEvents(events = []) {
  const observedToolEvents = [];
  const agentMessages = [];
  for (const event of events) {
    const type = String(event?.type ?? "").trim();
    const item = event?.item ?? {};
    const itemType = String(item?.type ?? "").trim();

    if (type === "item.completed" && itemType === "agent_message") {
      const text = clipText(item?.text ?? item?.content ?? "");
      if (text) agentMessages.push(text);
      continue;
    }

    if (itemType === "command_execution") {
      if (type === "item.started") {
        observedToolEvents.push({
          stage: "call",
          toolName: "command",
          toolCall: {
            id: String(item?.id ?? ""),
            type: "function",
            function: {
              name: "command",
              arguments: JSON.stringify({ command: String(item?.command ?? "") })
            }
          },
          toolText: clipText(item?.command ?? "")
        });
      } else if (type === "item.completed") {
        const exitCode = Number(item?.exit_code);
        const output = clipText(item?.aggregated_output ?? item?.output ?? "");
        observedToolEvents.push({
          stage: "result",
          toolName: "command",
          toolText: clipText(`exit=${Number.isFinite(exitCode) ? exitCode : "unknown"}${output ? ` output=${output}` : ""}`)
        });
      }
      continue;
    }

    const looksLikeToolItem = /tool|mcp|function/i.test(itemType)
      && itemType !== "agent_message"
      && itemType !== "reasoning";
    if (!looksLikeToolItem) continue;
    const toolName = normalizeCodexToolName(item);
    if (type === "item.started") {
      observedToolEvents.push({
        stage: "call",
        toolName,
        toolCall: normalizeToolCallPayload(item),
        toolText: clipText(item?.text ?? "")
      });
    } else if (type === "item.completed") {
      if (item?.arguments || item?.input || item?.params) {
        observedToolEvents.push({
          stage: "call",
          toolName,
          toolCall: normalizeToolCallPayload(item),
          toolText: clipText(item?.text ?? "")
        });
      }
      observedToolEvents.push({
        stage: "result",
        toolName,
        toolText: clipText(item?.output ?? item?.result ?? item?.text ?? "")
      });
    }
  }
  const responseText = clipText(agentMessages.at(-1) ?? "");
  return { responseText, observedToolEvents };
}

async function runCodexFallback(payload = {}, { stream = false } = {}) {
  const model = String(payload?.model || "gpt-5-codex").trim() || "gpt-5-codex";
  const prompt = buildCodexPrompt(payload);
  const args = [
    "exec",
    "--json",
    "--model", model,
    "--color", "never",
    "--ephemeral",
    prompt
  ];
  const proc = spawnSync("codex", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    const stderr = String(proc.stderr || "").trim();
    throw new Error(`codex exec failed: status=${proc.status}${stderr ? ` stderr=${JSON.stringify(stderr)}` : ""}`);
  }
  const events = parseJsonLines(proc.stdout);
  const { responseText, observedToolEvents } = mapCodexEvents(events);
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
    message: {
      content: responseText,
      observed_tool_events: observedToolEvents
    }
  };
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
