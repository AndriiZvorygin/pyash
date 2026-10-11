import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { jsonToPyashText } from "../verbs/exchange/json_map.mjs";
import { pyaFileToJson, pyaToPlainValue } from "./pya_to_json.mjs";

const USAGE_ROOT = "ollama usage record";

function finiteOrEmpty(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function text(value) {
  return String(value ?? "").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function sanitizeSegment(value, fallback = "manual") {
  return text(value)
    .replace(/[\\/]+/gu, "-")
    .replace(/[^A-Za-z0-9._:-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "") || fallback;
}

function redactEndpoint(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return raw.replace(/[?].*$/u, "");
  }
}

function endpointBase(value) {
  try {
    const url = new URL(String(value));
    url.pathname = url.pathname.replace(/\/api\/(?:generate|chat)$/u, "") || "/";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return String(value ?? "").replace(/\/api\/(?:generate|chat)(?:\?.*)?$/u, "");
  }
}

function responsePayload(response) {
  if (response?.envelope && typeof response.envelope === "object") return response.envelope;
  return response && typeof response === "object" ? response : {};
}

function usagePyaValue(value) {
  if (value && typeof value === "object" && typeof value.boolean === "boolean") return value.boolean;
  return pyaToPlainValue(value);
}

function metric(response, key) {
  return finiteOrEmpty(responsePayload(response)?.[key]);
}

export function makeOllamaCallId({ now = new Date(), pid = process.pid } = {}) {
  const stamp = now instanceof Date ? now.toISOString().replace(/[^0-9]/gu, "").slice(0, 17) : Date.now();
  return `ollama-${stamp}-${pid}-${crypto.randomBytes(6).toString("hex")}`;
}

export function buildOllamaUsageRecord({
  callId,
  runId = process.env.PYA_RUN_ID || "manual",
  payload = {},
  endpoint = "",
  response = {},
  requestHash = "",
  responseHash = "",
  startedAt = "",
  finishedAt = "",
  elapsedMs = "",
  status = "completed",
  failureKind = "",
  error = "",
  queueManaged = false,
  hostId = process.env.PYA_GPU_HOST_ID || os.hostname()
} = {}) {
  const result = responsePayload(response);
  const requestedModel = text(payload?.model);
  const resolvedModel = text(result?.model) || requestedModel;
  const record = {
    schema_version: 1,
    call_id: text(callId) || makeOllamaCallId(),
    run_id: text(runId) || "manual",
    host: text(hostId),
    ollama_host: redactEndpoint(payload?.host || endpointBase(endpoint) || process.env.OLLAMA_HOST || ""),
    endpoint: redactEndpoint(endpoint),
    mode: text(payload?.mode) || "generate",
    model: requestedModel,
    resolved_model: resolvedModel,
    model_digest: text(result?.digest || payload?.modelDigest),
    status: text(status) || "completed",
    failure_kind: text(failureKind),
    error: text(error),
    started_at: text(startedAt),
    finished_at: text(finishedAt),
    elapsed_ms: finiteOrEmpty(elapsedMs),
    stream: payload?.stream === true,
    queue_managed: queueManaged === true,
    request_sha256: text(requestHash),
    response_sha256: text(responseHash),
    finish_reason: text(result?.done_reason),
    prompt_eval_count: metric(response, "prompt_eval_count"),
    prompt_eval_cached_count: metric(response, "prompt_eval_cached_count"),
    eval_count: metric(response, "eval_count"),
    prompt_eval_duration: metric(response, "prompt_eval_duration"),
    eval_duration: metric(response, "eval_duration"),
    total_duration: metric(response, "total_duration")
  };
  const recordHash = sha256Text(jsonToPyashText(record, USAGE_ROOT).text);
  return { ...record, record_hash: recordHash };
}

export function ollamaUsagePya(record) {
  return jsonToPyashText(record, USAGE_ROOT).text;
}

export function resolveOllamaUsageDir({ cwd = process.cwd(), runId = process.env.PYA_RUN_ID, usageDir = process.env.PYA_OLLAMA_USAGE_DIR } = {}) {
  if (text(usageDir)) return path.resolve(usageDir);
  return path.resolve(cwd, "artifacts", sanitizeSegment(runId, "manual"), "ollama", "usage");
}

export async function writeOllamaUsageRecord({ record, cwd, runId, usageDir } = {}) {
  if (!record || typeof record !== "object") throw new Error("ollama usage record requires an object");
  const dir = resolveOllamaUsageDir({ cwd, runId, usageDir });
  await fs.mkdir(dir, { recursive: true });
  const callId = sanitizeSegment(record.call_id, "ollama-call");
  const hash = sanitizeSegment(record.record_hash, "unhashed");
  const filePath = path.join(dir, `call-${callId}-${hash.slice(0, 16)}.pya`);
  const content = ollamaUsagePya(record);
  try {
    await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return filePath;
}

export async function listOllamaUsageRecords(usageDir) {
  const dir = path.resolve(usageDir);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const name of names.filter(entry => /^call-.*\.pya$/u.test(entry)).sort()) {
    const filePath = path.join(dir, name);
    try {
      const payload = await pyaFileToJson(filePath, { memoryOnly: false });
      const entry = Object.entries(payload?.index ?? {}).find(([key]) => key.toLowerCase() === USAGE_ROOT);
      const rawMap = entry?.[1]?.raw?.ob?.map;
      if (rawMap && typeof rawMap === "object") {
        const record = Object.fromEntries(Object.entries(rawMap).map(([key, value]) => [key, usagePyaValue(value)]));
        records.push({ ...record, file_path: filePath });
      }
    } catch {
      // A partial artifact is excluded from totals rather than guessed into them.
    }
  }
  return records;
}

function sumMetric(records, key) {
  return records.reduce((total, record) => total + (Number.isFinite(Number(record?.[key])) ? Number(record[key]) : 0), 0);
}

export function summarizeOllamaUsage(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const byModel = new Map();
  for (const record of rows) {
    const model = text(record?.resolved_model || record?.model) || "unknown";
    const current = byModel.get(model) ?? { model, calls: 0, completed: 0, failed: 0, prompt_tokens: 0, output_tokens: 0, total_duration: 0 };
    current.calls += 1;
    if (record?.status === "completed") current.completed += 1;
    else current.failed += 1;
    current.prompt_tokens += Number(record?.prompt_eval_count) || 0;
    current.output_tokens += Number(record?.eval_count) || 0;
    current.total_duration += Number(record?.total_duration) || 0;
    byModel.set(model, current);
  }
  return {
    schema_version: 1,
    record_count: rows.length,
    completed_count: rows.filter(record => record?.status === "completed").length,
    failed_count: rows.filter(record => record?.status !== "completed").length,
    prompt_eval_count: sumMetric(rows, "prompt_eval_count"),
    eval_count: sumMetric(rows, "eval_count"),
    prompt_eval_duration: sumMetric(rows, "prompt_eval_duration"),
    eval_duration: sumMetric(rows, "eval_duration"),
    total_duration: sumMetric(rows, "total_duration"),
    models: [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model))
  };
}

export { USAGE_ROOT };
