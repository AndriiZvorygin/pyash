import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { enqueueInputEnvelope } from "../program/runtime/gpu/queue.mjs";
import {
  isTerminalHandleStatus,
  readGpuHandleStatus,
  writeGpuHandleStatus
} from "../program/runtime/gpu/handle_status.mjs";
import {
  buildKataGoJobSpec,
  normalizeKataGoResult,
  summarizeKataGoResult
} from "../program/katago/analysis.mjs";

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const payloadIndex = args.indexOf("--payload");
  const payloadFileIndex = args.indexOf("--payload-file");
  return {
    payload: payloadIndex !== -1 ? args[payloadIndex + 1] ?? "" : "",
    payloadFile: payloadFileIndex !== -1 ? args[payloadFileIndex + 1] ?? "" : ""
  };
}

function parseJsonText(text, fallback = null) {
  const value = String(text ?? "").trim();
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function truthy(value) {
  return ["truth", "true", "yes", "1", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function resolveWorldRoot(payload = {}) {
  const raw = payload.worldRoot || process.env.PYA_WORLD_ROOT || process.env.PYA_WORLD || "";
  return raw ? path.resolve(String(raw)) : path.resolve(process.cwd(), "world");
}

function normalizeProfile(payload = {}) {
  return String(payload.katagoProfile ?? payload.profileName ?? process.env.PYA_KATAGO_PROFILE ?? "default").trim() || "default";
}

function makeHandleId(payload = {}) {
  const hash = crypto
    .createHash("sha1")
    .update(JSON.stringify(payload ?? {}))
    .update(String(Date.now()))
    .update(String(process.pid))
    .digest("hex")
    .slice(0, 12);
  return `katago-${hash}`;
}

function timeoutMs() {
  const raw = Number(process.env.PYA_KATAGO_TIMEOUT_MS || process.env.PYA_COMMAND_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  return 900000;
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));
}

async function waitForResult(worldRoot, handleId) {
  const deadline = Date.now() + timeoutMs();
  while (Date.now() <= deadline) {
    const status = await readGpuHandleStatus(worldRoot, handleId);
    if (status && isTerminalHandleStatus(status.status)) {
      if (status.status === "success") return parseJsonText(status.result, {});
      const parsedError = parseJsonText(status.error, status.message);
      throw new Error(`katago_runner gpu queue failed: ${typeof parsedError === "string" ? parsedError : JSON.stringify(parsedError)}`);
    }
    await delay(250);
  }
  throw new Error(`katago_runner gpu queue timed out waiting for ${handleId}`);
}

function payloadSentence(payload = {}, action = "analyze") {
  return {
    mood: "do",
    be: action === "analyze" ? "katago analyze" : action,
    ob: { text: String(payload.sgf ?? payload.prompt ?? action).slice(0, 160) },
    as: { name: "katago" }
  };
}

function lifecycleJobSpec(action = "status") {
  const kind = `katago-${action}`;
  if (!["katago-begin", "katago-discharge", "katago-restart", "katago-status"].includes(kind)) {
    throw new Error(`katago_runner: unsupported action ${action}`);
  }
  return { kind };
}

async function runQueued(payload = {}) {
  const action = String(payload.action ?? payload.mode ?? "analyze").trim().toLowerCase() || "analyze";
  const worldRoot = resolveWorldRoot(payload);
  const handleId = makeHandleId(payload);
  const queuedAt = new Date().toISOString();
  const gpuId = process.env.PYA_GPU_ID || "gpu-0";
  const profileName = normalizeProfile(payload);
  const jobSpec = action === "analyze" ? buildKataGoJobSpec(payload) : lifecycleJobSpec(action);

  await writeGpuHandleStatus(worldRoot, handleId, {
    status: "queued",
    agentName: "katago-runner",
    gpuId,
    intent: "katago",
    lane: "durable",
    queuedAt,
    startedAt: "",
    finishedAt: "",
    retryCount: 0,
    outcome: "queued",
    message: "queued",
    result: "",
    error: ""
  });

  await enqueueInputEnvelope(worldRoot, {
    queuedAt,
    handleId,
    agentName: "katago-runner",
    gpuId,
    intent: "katago",
    lane: "durable",
    payloadSentence: payloadSentence(payload, action),
    serviceName: "katago",
    residencyName: profileName,
    residencyRequired: action !== "discharge",
    beginRequired: action !== "discharge",
    dischargeAllowed: true,
    jobSpec
  });

  return waitForResult(worldRoot, handleId);
}

function normalizeResponse(payload = {}, result = {}) {
  const action = String(payload.action ?? payload.mode ?? "analyze").trim().toLowerCase() || "analyze";
  if (action !== "analyze") {
    const response = String(result?.message ?? `katago ${action} completed`);
    return { response, message: { content: response }, katago: result };
  }
  const katago = normalizeKataGoResult(result);
  const response = summarizeKataGoResult(result);
  return { response, message: { content: response }, katago };
}

async function readPayload() {
  const args = parseArgs(process.argv);
  let raw = args.payload;
  if (!raw && args.payloadFile) raw = await fs.promises.readFile(args.payloadFile, "utf8");
  if (!raw) raw = readStdin();
  if (!raw.trim()) throw new Error("katago_runner: missing request payload");
  const parsed = parseJsonText(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  return { mode: "analyze", sgf: raw };
}

async function main() {
  const payload = await readPayload();
  const fixture = process.env.PYA_KATAGO_RESPONSE;
  if (truthy(process.env.PYA_KATAGO_FIXTURE) && fixture) {
    process.stdout.write(`${JSON.stringify(normalizeResponse(payload, parseJsonText(fixture, {})))}\n`);
    return;
  }
  const result = await runQueued(payload);
  process.stdout.write(`${JSON.stringify(normalizeResponse(payload, result))}\n`);
}

main().catch((err) => {
  const message = err?.message ?? String(err ?? "unknown error");
  if (message) fs.writeFileSync(2, `${message}\n`, "utf8");
  process.exit(1);
});
