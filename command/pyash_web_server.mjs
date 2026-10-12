#!/usr/bin/env node
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

import { interpret } from "../program/bridge/index.mjs";
import { remember, doRemember } from "../program/remember/index.mjs";
import { mind_to_name_text } from "../program/verbs/mind/mind.mjs";
import {
  ensureAgentDirs,
  listSessionFiles,
  readSessionMessages
} from "../program/agent/session.mjs";
import { resolveConfigText } from "../program/configure/env.mjs";
import { queueDepth } from "../program/runtime/gpu/queue.mjs";
import { readGpuHandleStatus } from "../program/runtime/gpu/handle_status.mjs";
import {
  buildRuntime,
  serializeResult,
  toolListFromSchemas
} from "./pyash_mcp_server.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_TOOLS_MAP = "agent tools";
const MAX_CHAT_BYTES = 64 * 1024;
const MAX_JOB_BYTES = 2 * 1024 * 1024;
const SAFE_JOB_INTENTS = new Map([
  ["draw", "comfyui-draw"],
  ["hear", "comfyui-hear"]
]);
const PUBLIC_TOOL_WORDS = new Set([
  "search",
  "download",
  "read",
  "read markdown",
  "list",
  "list files",
  "exists"
]);
const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true
});

const WEB_SYSTEM_PROMPT = [
  "You are the Pyash private web assistant.",
  "Answer clearly and honestly, using the available Pyash tools when the user asks for current information, web research, downloads, or local artifacts.",
  "For web research, search first, cite the returned source URLs in your answer, and distinguish retrieved evidence from your own synthesis.",
  "Never claim that a search, download, file read, image job, or transcription job succeeded unless the tool result proves it.",
  "Do not expose secrets, private configuration, arbitrary filesystem contents, or internal tool arguments.",
  "When a request would require an unsafe or unavailable action, explain the boundary and offer a safe next step."
].join("\n");

function readArgValue(args, name, fallback = "") {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return String(args[idx + 1] ?? "").trim() || fallback;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    root: path.resolve(readArgValue(args, "--root", process.env.PYA_WEB_ROOT || process.cwd())),
    host: readArgValue(args, "--host", process.env.PYA_WEB_HOST || DEFAULT_HOST),
    port: Number(readArgValue(args, "--port", process.env.PYA_WEB_PORT || DEFAULT_PORT)),
    toolsMap: readArgValue(args, "--tools-map", DEFAULT_TOOLS_MAP),
    assets: path.resolve(readArgValue(args, "--assets", path.resolve(process.cwd(), "web")))
  };
}

function normalizeSessionId(raw = "web") {
  const normalized = String(raw ?? "web")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "web";
}

function normalizeModelId(raw = "") {
  return String(raw ?? "").trim().slice(0, 160);
}

function sessionIdFromFilename(filename = "") {
  const base = path.basename(String(filename), ".pya");
  return base.replace(/^\d{8}-/, "") || "web";
}

function jsonResponse(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function errorResponse(res, status, message, code = "request_failed") {
  jsonResponse(res, status, { ok: false, error: { code, message } });
}

function setSecurityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "same-origin");
  res.setHeader("content-security-policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'");
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error("request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(req, maxBytes) {
  const raw = await readBody(req, maxBytes);
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
    return value;
  } catch (error) {
    const next = new Error(`invalid JSON body: ${error.message}`);
    next.statusCode = 400;
    throw next;
  }
}

function publicToolName(name) {
  const words = String(name ?? "")
    .replace(/^be[_ ]/, "")
    .split(/[_ ]+/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  return words.some((word, index) => {
    const phrase = words.slice(0, index + 1).join(" ");
    return PUBLIC_TOOL_WORDS.has(phrase) || PUBLIC_TOOL_WORDS.has(word);
  });
}

export function filterPublicTools(tools = []) {
  return tools.filter((entry) => publicToolName(entry?.name));
}

export function renderAssistantMarkdown(text = "") {
  return markdown.render(String(text ?? ""));
}

export function buildChatSentence({ message, root, agentHouse, session = "web", model = "" }) {
  return {
    mood: "do",
    be: "write",
    for: { name: "web assistant" },
    ob: { text: String(message ?? "").trim(), ...(model ? { model } : {}) },
    to: { name: "text" },
    with: { name: "agent tools" },
    fromtext: { name: `session name ${normalizeSessionId(session)}` },
    at: { filename: path.resolve(agentHouse || path.join(root, "world", "house", "web-assistant")) }
  };
}

async function readWebSessions(sessionDir) {
  const files = await listSessionFiles(sessionDir);
  const grouped = new Map();
  for (const filename of files) {
    const id = sessionIdFromFilename(filename);
    const filePath = path.join(sessionDir, filename);
    let stat;
    let history;
    try {
      [stat, history] = await Promise.all([
        fs.stat(filePath),
        readSessionMessages({ sessionFile: filePath, historyWindow: 100 })
      ]);
    } catch {
      continue;
    }
    const prior = grouped.get(id);
    grouped.set(id, {
      id,
      updatedAt: new Date(Math.max(prior ? Date.parse(prior.updatedAt) : 0, stat.mtimeMs)).toISOString(),
      messageCount: (prior?.messageCount ?? 0) + history.messages.length,
      model: history.lastSystemModel ?? prior?.model ?? null
    });
  }
  return [...grouped.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function readWebSession(sessionDir, sessionId) {
  const wanted = normalizeSessionId(sessionId);
  const files = (await listSessionFiles(sessionDir)).filter((filename) => sessionIdFromFilename(filename) === wanted);
  const messages = [];
  let updatedAt = null;
  let model = null;
  for (const filename of files.sort()) {
    const filePath = path.join(sessionDir, filename);
    try {
      const [stat, history] = await Promise.all([
        fs.stat(filePath),
        readSessionMessages({ sessionFile: filePath, historyWindow: 100 })
      ]);
      messages.push(...history.messages);
      model = history.lastSystemModel ?? model;
      updatedAt = new Date(Math.max(updatedAt ? Date.parse(updatedAt) : 0, stat.mtimeMs)).toISOString();
    } catch {
      // Ignore a session file that disappears during a concurrent append.
    }
  }
  return {
    id: wanted,
    updatedAt,
    model,
    messages: messages.slice(-200).map((message) => ({
      ...message,
      html: message.role === "assistant" ? renderAssistantMarkdown(message.content) : null
    }))
  };
}

function configuredWebModels() {
  return String(process.env.PYA_WEB_MODELS ?? "")
    .split(",")
    .map(normalizeModelId)
    .filter(Boolean);
}

async function fetchOllamaModels(defaultModel) {
  const configured = configuredWebModels();
  const host = String(
    resolveConfigText("ollama host")
      || process.env.OLLAMA_HOST
      || process.env.OLLAMA_BASE_URL
      || "http://localhost:11434"
  ).replace(/\/$/u, "");
  try {
    const response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`Ollama tags returned HTTP ${response.status}`);
    const payload = await response.json();
    const installed = (Array.isArray(payload?.models) ? payload.models : [])
      .map((entry) => normalizeModelId(entry?.name ?? entry?.model))
      .filter(Boolean);
    const allowed = configured.length ? installed.filter((name) => configured.includes(name)) : installed;
    return {
      host,
      available: true,
      models: allowed.length ? allowed : (configured.length ? configured : [defaultModel]),
      error: allowed.length ? null : "no configured web models are installed"
    };
  } catch (error) {
    return {
      host,
      available: false,
      models: configured.length ? configured : [defaultModel],
      error: String(error?.message ?? error)
    };
  }
}

function extractUrls(events = []) {
  const urls = new Set();
  for (const event of events) {
    const text = String(event?.toolText ?? "");
    for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
      urls.add(match[0].replace(/[.,;:]+$/, ""));
    }
  }
  return [...urls].slice(0, 20);
}

export function validateMediaJobRequest(body = {}) {
  const intent = String(body.intent ?? "").trim().toLowerCase();
  const expectedKind = SAFE_JOB_INTENTS.get(intent);
  if (!expectedKind) {
    return { ok: false, message: "only draw and hear jobs are available through the private web gateway" };
  }
  const jobSpec = body.jobSpec;
  if (!jobSpec || typeof jobSpec !== "object" || Array.isArray(jobSpec)) {
    return { ok: false, message: "jobSpec must be a JSON object" };
  }
  if (String(jobSpec.kind ?? "").trim() !== expectedKind) {
    return { ok: false, message: `jobSpec.kind must be ${expectedKind}` };
  }
  const serialized = JSON.stringify(jobSpec);
  if (/\b(command|shell|exec|javascript|writeFile|unlink)\b/i.test(serialized)) {
    return { ok: false, message: "jobSpec contains a forbidden execution field" };
  }
  const profileName = String(body.profileName ?? jobSpec.profileName ?? jobSpec.workflow ?? intent).trim();
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(profileName)) {
    return { ok: false, message: "profileName contains unsupported characters" };
  }
  return { ok: true, intent, expectedKind, jobSpec, profileName };
}

function buildGpuJobSentence({ intent, jobSpec, profileName, handleId }) {
  return {
    mood: "do",
    su: { name: handleId },
    be: `gpu ${intent}`,
    ob: { text: JSON.stringify(jobSpec) },
    to: { name: profileName },
    for: { name: "web assistant" },
    vyah: { ve: { type: "name", values: ["start", "future"] } }
  };
}

function newHandleId(intent) {
  const seed = `${intent}:${Date.now()}:${crypto.randomUUID()}`;
  return `web-${intent}-${crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16)}`;
}

function statusFromResult(result, handleId) {
  const serialized = serializeResult(result);
  return {
    handleId: result?.su?.name || handleId,
    text: serialized.text,
    sentence: serialized.sentence
  };
}

function makeMutex() {
  let tail = Promise.resolve();
  return (work) => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };
}

async function serveStatic(res, assets, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  if (!relative || relative.includes("..") || relative.includes("\\")) {
    errorResponse(res, 404, "not found", "not_found");
    return;
  }
  const target = path.resolve(assets, relative);
  const relativeTarget = path.relative(assets, target);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    errorResponse(res, 404, "not found", "not_found");
    return;
  }
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8"
  };
  try {
    const body = await fs.readFile(target);
    res.writeHead(200, {
      "content-type": contentTypes[path.extname(target)] || "application/octet-stream",
      "cache-control": "no-cache",
      "content-length": body.length
    });
    res.end(body);
  } catch (error) {
    errorResponse(res, error?.code === "ENOENT" ? 404 : 500, "not found", "not_found");
  }
}

export async function createWebServer({
  root = process.cwd(),
  assets = path.resolve(process.cwd(), "web"),
  toolsMap = DEFAULT_TOOLS_MAP,
  runtime: providedRuntime = null,
  interpretFn = interpret,
  mindFn = mind_to_name_text,
  readStatusFn = readGpuHandleStatus,
  queueDepthFn = queueDepth,
  modelsFn = fetchOllamaModels
} = {}) {
  const resolvedRoot = path.resolve(root);
  const runtime = providedRuntime || await buildRuntime({ root: resolvedRoot, toolsMap });
  const agentHouse = path.join(resolvedRoot, "world", "house", "web-assistant");
  await ensureAgentDirs(agentHouse);
  const configuredMind = remember("mind model");
  const model = String(process.env.PYA_WEB_MODEL ?? configuredMind?.as?.name ?? "qwen3.5:9b").trim();
  doRemember({
    mood: "ya",
    su: { name: "web assistant" },
    be: "mind",
    as: { name: model },
    fromtext: { text: WEB_SYSTEM_PROMPT }
  });

  const publicTools = filterPublicTools(runtime.tools || toolListFromSchemas([]));
  const runExclusive = makeMutex();
  const sessionDir = path.join(agentHouse, "session");
  let modelCatalog = null;
  let modelCatalogAt = 0;

  async function getModelCatalog() {
    if (modelCatalog && Date.now() - modelCatalogAt < 30000) return modelCatalog;
    modelCatalog = await modelsFn(model);
    modelCatalogAt = Date.now();
    return modelCatalog;
  }

  async function handleRequest(req, res) {
    setSecurityHeaders(res);
    const requestUrl = new URL(req.url || "/", "http://pyash.local");
    const pathname = requestUrl.pathname;
    try {
      if (req.method === "GET" && pathname === "/healthz") {
        jsonResponse(res, 200, { ok: true, service: "pyash-web", model });
        return;
      }
      if (req.method === "GET" && pathname === "/api/tools") {
        jsonResponse(res, 200, { ok: true, tools: publicTools });
        return;
      }
      if (req.method === "GET" && pathname === "/api/models") {
        const catalog = await getModelCatalog();
        jsonResponse(res, 200, {
          ok: true,
          selected: model,
          models: catalog.models,
          available: catalog.available,
          error: catalog.error ?? null
        });
        return;
      }
      if (req.method === "GET" && pathname === "/api/sessions") {
        jsonResponse(res, 200, {
          ok: true,
          selected: "web",
          sessions: await readWebSessions(sessionDir)
        });
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/api/sessions/")) {
        const sessionId = normalizeSessionId(decodeURIComponent(pathname.slice("/api/sessions/".length)));
        jsonResponse(res, 200, { ok: true, session: await readWebSession(sessionDir, sessionId) });
        return;
      }
      if (req.method === "GET" && pathname === "/api/gpu") {
        const worldRoot = path.join(resolvedRoot, "world");
        jsonResponse(res, 200, { ok: true, queue: await queueDepthFn(worldRoot) });
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/api/jobs/")) {
        const handleId = decodeURIComponent(pathname.slice("/api/jobs/".length));
        if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(handleId)) {
          errorResponse(res, 400, "invalid handle id", "invalid_handle");
          return;
        }
        const state = await readStatusFn(path.join(resolvedRoot, "world"), handleId);
        if (!state) {
          errorResponse(res, 404, "job not found", "job_not_found");
          return;
        }
        jsonResponse(res, 200, { ok: true, job: state });
        return;
      }
      if (req.method === "POST" && pathname === "/api/chat") {
        const body = await readJsonBody(req, MAX_CHAT_BYTES);
        const message = String(body.message ?? "").trim();
        if (!message) {
          errorResponse(res, 400, "message is required", "missing_message");
          return;
        }
        if (message.length > 32000) {
          errorResponse(res, 413, "message is too long", "message_too_large");
          return;
        }
        const catalog = await getModelCatalog();
        const selectedModel = normalizeModelId(body.model) || model;
        if (catalog.models.length && !catalog.models.includes(selectedModel)) {
          errorResponse(res, 400, `model is not available to this web assistant: ${selectedModel}`, "model_unavailable");
          return;
        }
        const session = normalizeSessionId(body.session);
        const toolEvents = [];
        const sentence = buildChatSentence({
          message,
          root: resolvedRoot,
          agentHouse,
          session,
          model: selectedModel
        });
        const answer = await runExclusive(() => mindFn(sentence, {
          onToolCall: async (event) => {
            const safe = {
              stage: String(event?.stage ?? "").trim(),
              toolName: String(event?.toolName ?? "").trim(),
              toolText: String(event?.toolText ?? "").slice(0, 12000)
            };
            if (safe.stage && safe.toolName) toolEvents.push(safe);
          }
        }));
        const serialized = serializeResult(answer);
        jsonResponse(res, 200, {
          ok: true,
          text: serialized.text,
          html: renderAssistantMarkdown(serialized.text),
          toolEvents: toolEvents.map(({ stage, toolName }) => ({ stage, toolName })),
          sources: extractUrls(toolEvents),
          session,
          model: selectedModel
        });
        return;
      }
      if (req.method === "POST" && pathname === "/api/jobs") {
        const body = await readJsonBody(req, MAX_JOB_BYTES);
        const validated = validateMediaJobRequest(body);
        if (!validated.ok) {
          errorResponse(res, 400, validated.message, "invalid_job");
          return;
        }
        const handleId = newHandleId(validated.intent);
        const sentence = buildGpuJobSentence({
          intent: validated.intent,
          jobSpec: validated.jobSpec,
          profileName: validated.profileName,
          handleId
        });
        const result = await runExclusive(() => interpretFn(sentence));
        jsonResponse(res, 202, {
          ok: true,
          job: statusFromResult(result, handleId),
          statusUrl: `/api/jobs/${encodeURIComponent(handleId)}`
        });
        return;
      }
      if (req.method === "GET") {
        await serveStatic(res, assets, pathname);
        return;
      }
      errorResponse(res, 405, "method not allowed", "method_not_allowed");
    } catch (error) {
      errorResponse(res, Number(error?.statusCode) || 500, String(error?.message ?? error), "server_error");
    }
  }

  const server = http.createServer(handleRequest);
  return { server, runtime, agentHouse };
}

async function main() {
  const config = parseArgs(process.argv);
  const { server } = await createWebServer(config);
  server.listen(config.port, config.host, () => {
    process.stdout.write(`pyash web listening on http://${config.host}:${config.port}\n`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exit(1);
  });
}
