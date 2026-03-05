import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    input: null,
    host: null,
    backend: null,
    workflowRoot: null,
    workflowName: null,
    workflowFile: null,
    language: null,
    context: null,
    returnTimestamps: true
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--input") out.input = args[++i] ?? null;
    else if (arg === "--host") out.host = args[++i] ?? null;
    else if (arg === "--backend") out.backend = args[++i] ?? null;
    else if (arg === "--workflow-root") out.workflowRoot = args[++i] ?? null;
    else if (arg === "--workflow-name") out.workflowName = args[++i] ?? null;
    else if (arg === "--workflow-file") out.workflowFile = args[++i] ?? null;
    else if (arg === "--language") out.language = args[++i] ?? null;
    else if (arg === "--context") out.context = args[++i] ?? null;
    else if (arg === "--return-timestamps") out.returnTimestamps = String(args[++i] ?? "true").trim().toLowerCase() !== "false";
  }
  return out;
}

function resolveHost(opts) {
  return opts.host ?? process.env.PYA_HEAR_QWEN_HOST ?? process.env.PYA_DRAW_HOST ?? "http://localhost:8188";
}

function resolveBackend(opts) {
  return opts.backend ?? process.env.PYA_HEAR_QWEN_BACKEND ?? "comfyui";
}

function resolveWorkflowRoot(opts) {
  return opts.workflowRoot ?? process.env.PYA_HEAR_WORKFLOW_ROOT ?? "./hear/";
}

function resolveWorkflowName(opts) {
  return opts.workflowName ?? process.env.PYA_HEAR_WORKFLOW_DEFAULT ?? "qwen3-asr-timestamps-attn2";
}

async function resolveWorkflowFile(opts) {
  if (opts.workflowFile) return opts.workflowFile;
  const root = resolveWorkflowRoot(opts);
  const backend = resolveBackend(opts);
  const name = resolveWorkflowName(opts);
  return path.join(root, backend, `${name}.json`);
}

async function readWorkflowJson(filename) {
  const text = await fs.readFile(filename, "utf8");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`hear_comfyui_runner: invalid workflow json (${err?.message ?? err})`);
  }
}

async function readMappingPya(workflowFile) {
  const ext = path.extname(workflowFile);
  const mappingFile = workflowFile.slice(0, workflowFile.length - ext.length) + ".pya";
  try {
    const text = await fs.readFile(mappingFile, "utf8");
    const result = {};
    const lines = text.split(/\r?\n/u);
    for (const line of lines) {
      const trimmed = line.trim();
      const m = /^su name (.+?) ob text "([^"]*)" ya$/u.exec(trimmed);
      if (!m) continue;
      const key = String(m[1] ?? "").trim().toLowerCase();
      const value = String(m[2] ?? "");
      if (key === "audio input path") result.audioInputPath = value;
      if (key === "language path") result.languagePath = value;
      if (key === "context path") result.contextPath = value;
      if (key === "return timestamps path") result.returnTimestampsPath = value;
      if (key === "transcript path") result.transcriptPath = value;
      if (key === "timestamps path") result.timestampsPath = value;
    }
    return result;
  } catch {
    return {};
  }
}

function normalizePromptObject(workflow) {
  if (workflow && typeof workflow === "object" && workflow.prompt && typeof workflow.prompt === "object") {
    return workflow.prompt;
  }
  if (!Array.isArray(workflow?.nodes)) {
    throw new Error("hear_comfyui_runner: workflow missing nodes");
  }
  const links = Array.isArray(workflow.links) ? workflow.links : [];
  const linkById = new Map();
  for (const link of links) {
    if (!Array.isArray(link) || link.length < 5) continue;
    linkById.set(Number(link[0]), link);
  }
  const prompt = {};
  for (const node of workflow.nodes) {
    const id = String(node?.id ?? "");
    if (!id) continue;
    const classType = String(node?.type ?? "");
    if (!classType || classType === "Note") continue;
    const inputs = Array.isArray(node?.inputs) ? node.inputs : [];
    const widgets = Array.isArray(node?.widgets_values) ? node.widgets_values : [];
    let widgetIndex = 0;
    const entry = { class_type: classType, inputs: {} };
    for (const input of inputs) {
      const inputName = String(input?.name ?? "");
      if (!inputName) continue;
      const linkId = Number(input?.link);
      const link = Number.isFinite(linkId) ? linkById.get(linkId) : null;
      if (Array.isArray(link)) {
        entry.inputs[inputName] = [String(link[1]), Number(link[2])];
        continue;
      }
      if (input?.widget?.name) {
        const value = widgets[widgetIndex];
        if (value !== undefined) entry.inputs[inputName] = value;
        widgetIndex += 1;
      }
    }
    prompt[id] = entry;
  }
  return prompt;
}

function getAtPath(obj, dottedPath) {
  if (!dottedPath) return undefined;
  const parts = String(dottedPath).split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      cur = Number.isFinite(idx) ? cur[idx] : undefined;
      continue;
    }
    cur = cur[part];
  }
  return cur;
}

function setAtPath(obj, dottedPath, value) {
  const parts = String(dottedPath).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (cur[key] === undefined || cur[key] === null || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

function detectPath(workflow, promptObject, { nodeType, inputName }) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    if (nodeType && String(node?.type ?? "") !== nodeType) continue;
    const id = String(node?.id ?? "");
    if (!id) continue;
    const inputs = Array.isArray(node?.inputs) ? node.inputs : [];
    const has = inputs.some((input) => String(input?.name ?? "").toLowerCase() === String(inputName ?? "").toLowerCase());
    if (has) return `${id}.inputs.${inputName}`;
  }
  for (const [id, entry] of Object.entries(promptObject ?? {})) {
    if (nodeType && String(entry?.class_type ?? "") !== nodeType) continue;
    const inputs = entry?.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(inputs, inputName)) {
      return `${id}.inputs.${inputName}`;
    }
  }
  return null;
}

function normalizeText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(normalizeText).join("\n");
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.string === "string") return value.string;
    if (typeof value.value === "string") return value.value;
    return JSON.stringify(value);
  }
  return String(value);
}

function collectStrings(value, out = []) {
  if (value === null || value === undefined) return out;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
    return out;
  }
  return out;
}

function looksLikeTimestamps(text = "") {
  const value = String(text ?? "");
  if (!value.trim()) return false;
  if (/-->/u.test(value)) return true;
  if (/\[\s*\d+(?:\.\d+)?\s*[,|-]\s*\d+(?:\.\d+)?/u.test(value)) return true;
  if (/<\|\d+(?:\.\d+)?\|>/u.test(value)) return true;
  if (/"start"|"end"|"timestamp"/u.test(value)) return true;
  return false;
}

function extractExecutionError(historyEntry) {
  const status = historyEntry?.status;
  const messages = Array.isArray(status?.messages) ? status.messages : [];
  for (const pair of messages) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const kind = String(pair[0] ?? "");
    const payload = pair[1] ?? {};
    if (kind !== "execution_error") continue;
    const nodeType = String(payload?.node_type ?? "");
    const message = String(payload?.exception_message ?? payload?.error ?? "").trim();
    if (nodeType && message) return `${nodeType}: ${message}`;
    if (message) return message;
  }
  return "";
}

async function requestJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`hear_comfyui_runner: request failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function requestText(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`hear_comfyui_runner: request failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.text();
}

async function tryUploadAudio(host, inputPath) {
  const filename = path.basename(inputPath);
  const bytes = await fs.readFile(inputPath);
  const blob = new Blob([bytes]);
  const targets = [
    { endpoint: "/upload/audio", field: "audio" },
    { endpoint: "/upload/audio", field: "image" },
    { endpoint: "/upload/image", field: "image" }
  ];
  for (const target of targets) {
    try {
      const form = new FormData();
      form.append(target.field, blob, filename);
      const res = await fetch(`${host.replace(/\/$/, "")}${target.endpoint}`, {
        method: "POST",
        body: form
      });
      if (!res.ok) continue;
      let payload = {};
      try {
        payload = await res.json();
      } catch {
        payload = {};
      }
      const uploaded =
        String(payload?.name ?? "").trim() ||
        String(payload?.filename ?? "").trim() ||
        String(payload?.file ?? "").trim();
      if (uploaded) return uploaded;
    } catch {
      // Try next upload method.
    }
  }
  return null;
}

async function pollHistoryForTexts(host, promptId, timeoutMs = 240000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await requestText(`${host.replace(/\/$/, "")}/history/${encodeURIComponent(promptId)}`);
    let payload = {};
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
    const entry = payload?.[promptId] ?? payload?.[String(promptId)] ?? null;
    const errorMessage = extractExecutionError(entry);
    if (errorMessage) {
      throw new Error(`hear_comfyui_runner: execution failed: ${errorMessage}`);
    }
    const outputs = entry?.outputs;
    if (outputs && typeof outputs === "object" && Object.keys(outputs).length > 0) {
      return entry;
    }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  throw new Error("hear_comfyui_runner: timed out waiting for transcription result");
}

function resolveResultTexts(historyEntry, mapping = {}) {
  const transcriptMapped = normalizeText(getAtPath(historyEntry, mapping.transcriptPath));
  const timestampsMapped = normalizeText(getAtPath(historyEntry, mapping.timestampsPath));
  if (transcriptMapped.trim() || timestampsMapped.trim()) {
    return { transcript: transcriptMapped.trim(), timestamps: timestampsMapped.trim() };
  }

  const outputs = historyEntry?.outputs ?? historyEntry;
  const strings = collectStrings(outputs, []);
  let transcript = "";
  let timestamps = "";
  for (const candidate of strings) {
    if (!candidate) continue;
    if (!timestamps && looksLikeTimestamps(candidate)) {
      timestamps = candidate;
      continue;
    }
    if (!transcript || candidate.length > transcript.length) {
      transcript = candidate;
    }
  }
  return { transcript: transcript.trim(), timestamps: timestamps.trim() };
}

async function main() {
  const opts = parseArgs(process.argv);
  const inputPath = String(opts.input ?? "").trim();
  if (!inputPath) throw new Error("hear_comfyui_runner: missing input");

  const host = resolveHost(opts);
  const workflowFile = await resolveWorkflowFile(opts);
  const workflow = await readWorkflowJson(workflowFile);
  const promptObject = normalizePromptObject(workflow);
  const mapping = await readMappingPya(workflowFile);

  const audioInputPath = mapping.audioInputPath || detectPath(workflow, promptObject, { nodeType: "LoadAudio", inputName: "audio" });
  if (!audioInputPath) throw new Error("hear_comfyui_runner: audio input path unresolved");
  const languagePath = mapping.languagePath || detectPath(workflow, promptObject, { nodeType: "Qwen3ASRTranscribe", inputName: "language" });
  const contextPath = mapping.contextPath || detectPath(workflow, promptObject, { nodeType: "Qwen3ASRTranscribe", inputName: "context" });
  const returnTimestampsPath =
    mapping.returnTimestampsPath || detectPath(workflow, promptObject, { nodeType: "Qwen3ASRTranscribe", inputName: "return_timestamps" });

  const uploadedAudio = await tryUploadAudio(host, inputPath);
  const audioValue = uploadedAudio || inputPath;
  setAtPath(promptObject, audioInputPath, audioValue);

  const language = String(opts.language ?? "").trim();
  if (languagePath && language) setAtPath(promptObject, languagePath, language);
  const context = String(opts.context ?? "").trim();
  if (contextPath) setAtPath(promptObject, contextPath, context);
  if (returnTimestampsPath) setAtPath(promptObject, returnTimestampsPath, Boolean(opts.returnTimestamps));

  const queued = await requestJson(`${host.replace(/\/$/, "")}/prompt`, {
    client_id: `pyash-${crypto.randomBytes(6).toString("hex")}`,
    prompt: promptObject
  });
  if (queued?.error) {
    const message = String(queued.error?.message ?? queued.error ?? "prompt rejected");
    throw new Error(`hear_comfyui_runner: prompt rejected: ${message}`);
  }
  if (queued?.node_errors && typeof queued.node_errors === "object" && Object.keys(queued.node_errors).length > 0) {
    throw new Error(`hear_comfyui_runner: prompt node_errors: ${JSON.stringify(queued.node_errors)}`);
  }
  const promptId = queued?.prompt_id;
  if (!promptId) throw new Error("hear_comfyui_runner: missing prompt_id from ComfyUI");

  const historyEntry = await pollHistoryForTexts(host, promptId);
  const result = resolveResultTexts(historyEntry, mapping);
  const payload = {
    transcript: String(result.transcript ?? ""),
    timestamps: String(result.timestamps ?? ""),
    promptId: String(promptId),
    host
  };
  fsSync.writeFileSync(1, `${JSON.stringify(payload)}\n`, "utf8");
}

main().catch((err) => {
  const message = err?.message ?? String(err);
  if (message) fsSync.writeFileSync(2, `${message}\n`, "utf8");
  process.exit(1);
});
