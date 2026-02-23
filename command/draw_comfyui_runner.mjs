import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    promptStdin: false,
    prompt: null,
    host: null,
    backend: null,
    workflowRoot: null,
    workflowName: null,
    workflowFile: null,
    output: null,
    width: null,
    height: null,
    negativePrompt: null
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--prompt-stdin") out.promptStdin = true;
    else if (arg === "--prompt") out.prompt = args[++i] ?? null;
    else if (arg === "--host") out.host = args[++i] ?? null;
    else if (arg === "--backend") out.backend = args[++i] ?? null;
    else if (arg === "--workflow-root") out.workflowRoot = args[++i] ?? null;
    else if (arg === "--workflow-name") out.workflowName = args[++i] ?? null;
    else if (arg === "--workflow-file") out.workflowFile = args[++i] ?? null;
    else if (arg === "--output") out.output = args[++i] ?? null;
    else if (arg === "--width") out.width = Number(args[++i] ?? "");
    else if (arg === "--height") out.height = Number(args[++i] ?? "");
    else if (arg === "--negative-prompt") out.negativePrompt = args[++i] ?? null;
  }
  return out;
}

function resolveHost(opts) {
  return opts.host ?? process.env.PYA_DRAW_HOST ?? "http://localhost:8188";
}

function resolveBackend(opts) {
  return opts.backend ?? process.env.PYA_DRAW_BACKEND ?? "comfyui";
}

function resolveWorkflowRoot(opts) {
  return opts.workflowRoot ?? process.env.PYA_DRAW_WORKFLOW_ROOT ?? "./draw/";
}

function resolveWorkflowName(opts) {
  return opts.workflowName ?? process.env.PYA_DRAW_WORKFLOW_DEFAULT ?? "Z-Image-TSV";
}

function resolvePrompt(opts) {
  if (opts.prompt !== null) return String(opts.prompt);
  if (opts.promptStdin) return fsSync.readFileSync(0, "utf8");
  return "";
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
    throw new Error(`draw_comfyui_runner: invalid workflow json (${err?.message ?? err})`);
  }
}

async function readMappingPya(workflowFile) {
  const ext = path.extname(workflowFile);
  const mappingFile = workflowFile.slice(0, workflowFile.length - ext.length) + ".pya";
  try {
    const text = await fs.readFile(mappingFile, "utf8");
    const result = {};
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      const m = /^su name (.+?) ob text "([^"]*)" ya$/u.exec(trimmed);
      if (!m) continue;
      const key = String(m[1] ?? "").trim().toLowerCase();
      const value = String(m[2] ?? "");
      if (key === "positive prompt path") result.positivePromptPath = value;
      if (key === "save image prefix path") result.saveImagePrefixPath = value;
      if (key === "width path") result.widthPath = value;
      if (key === "height path") result.heightPath = value;
      if (key === "negative prompt path") result.negativePromptPath = value;
    }
    return result;
  } catch {
    return {};
  }
}

function detectDimensionPath(workflow, promptObject, axis = "width") {
  const desired = String(axis).toLowerCase() === "height" ? "height" : "width";
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    const nodeId = String(node?.id ?? "");
    if (!nodeId) continue;
    const inputs = Array.isArray(node?.inputs) ? node.inputs : [];
    const hasAxis = inputs.some((input) => String(input?.name ?? "").toLowerCase() === desired);
    if (!hasAxis) continue;
    return `${nodeId}.inputs.${desired}`;
  }
  if (!promptObject || typeof promptObject !== "object") return null;
  for (const [id, entry] of Object.entries(promptObject)) {
    if (!entry || typeof entry !== "object") continue;
    const inputs = entry.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(inputs, desired)) {
      return `${id}.inputs.${desired}`;
    }
  }
  return null;
}

function normalizePromptObject(workflow) {
  if (workflow && typeof workflow === "object" && workflow.prompt && typeof workflow.prompt === "object") {
    return workflow.prompt;
  }
  if (!Array.isArray(workflow?.nodes)) {
    throw new Error("draw_comfyui_runner: workflow missing nodes");
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
    const widgetInputNames = inputs.filter(inp => inp?.widget?.name).map(inp => String(inp.name));
    const hasKSamplerSeedShape = widgetInputNames.includes("seed") && widgets.length > widgetInputNames.length;

    const entry = {
      class_type: classType,
      inputs: {}
    };

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
        let value = widgets[widgetIndex];
        if (
          hasKSamplerSeedShape &&
          inputName === "steps" &&
          typeof value === "string" &&
          (value === "randomize" || value === "fixed" || value === "increment")
        ) {
          widgetIndex += 1;
          value = widgets[widgetIndex];
        }
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

function detectPositivePromptPath(workflow, promptObject) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  let positive = null;
  for (const node of nodes) {
    if (String(node?.type ?? "") !== "CLIPTextEncode") continue;
    const title = String(node?.title ?? "").toLowerCase();
    if (title.includes("positive")) {
      positive = String(node.id);
      break;
    }
    if (positive === null) positive = String(node.id);
  }
  if (!positive && promptObject && typeof promptObject === "object") {
    for (const [id, entry] of Object.entries(promptObject)) {
      if (String(entry?.class_type ?? "") !== "CLIPTextEncode") continue;
      positive = id;
      break;
    }
  }
  if (!positive) return null;
  return `${positive}.inputs.text`;
}

function detectNegativePromptPath(workflow, promptObject, positivePath = null) {
  const positiveNode = String(positivePath ?? "").split(".")[0] || null;
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  let fallback = null;
  for (const node of nodes) {
    if (String(node?.type ?? "") !== "CLIPTextEncode") continue;
    const id = String(node?.id ?? "");
    if (!id) continue;
    const title = String(node?.title ?? "").toLowerCase();
    if (title.includes("negative")) return `${id}.inputs.text`;
    if (!fallback && id !== positiveNode) fallback = `${id}.inputs.text`;
  }
  if (!fallback && promptObject && typeof promptObject === "object") {
    for (const [id, entry] of Object.entries(promptObject)) {
      if (String(entry?.class_type ?? "") !== "CLIPTextEncode") continue;
      if (String(id) === String(positiveNode ?? "")) continue;
      fallback = `${id}.inputs.text`;
      break;
    }
  }
  return fallback;
}

function defaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = crypto.randomBytes(3).toString("hex");
  return path.join("artifacts", "draw", `draw-${stamp}-${rand}.png`);
}

async function copyFixtureToOutput(outputPath) {
  const fixtureFile = process.env.PYA_DRAW_FIXTURE_FILE;
  if (!fixtureFile) return false;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.copyFile(fixtureFile, outputPath);
  return true;
}

async function requestJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`draw_comfyui_runner: request failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function requestBytes(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`draw_comfyui_runner: request failed ${res.status} ${res.statusText}: ${text}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function requestText(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`draw_comfyui_runner: request failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.text();
}

function pickFirstImage(historyEntry) {
  const outputs = historyEntry?.outputs;
  if (!outputs || typeof outputs !== "object") return null;
  for (const value of Object.values(outputs)) {
    if (!value || typeof value !== "object") continue;
    const images = Array.isArray(value.images) ? value.images : [];
    if (images.length > 0) return images[0];
  }
  return null;
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

async function pollHistoryForImage(host, promptId, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
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
      throw new Error(`draw_comfyui_runner: execution failed: ${errorMessage}`);
    }
    const image = pickFirstImage(entry);
    if (image) return image;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("draw_comfyui_runner: timed out waiting for generated image");
}

async function main() {
  const opts = parseArgs(process.argv);
  const promptText = String(resolvePrompt(opts) ?? "");
  const outputPath = opts.output ? String(opts.output) : defaultOutputPath();

  if (await copyFixtureToOutput(outputPath)) {
    fsSync.writeFileSync(1, `${outputPath}\n`, "utf8");
    return;
  }

  const host = resolveHost(opts);
  const workflowFile = await resolveWorkflowFile(opts);
  const workflow = await readWorkflowJson(workflowFile);
  const promptObject = normalizePromptObject(workflow);
  const mapping = await readMappingPya(workflowFile);

  const positivePath = mapping.positivePromptPath || detectPositivePromptPath(workflow, promptObject);
  if (!positivePath) throw new Error("draw_comfyui_runner: positive prompt path unresolved");
  setAtPath(promptObject, positivePath, promptText);
  const negativePath = mapping.negativePromptPath || detectNegativePromptPath(workflow, promptObject, positivePath);
  if (opts.negativePrompt && negativePath) {
    setAtPath(promptObject, negativePath, String(opts.negativePrompt));
  }

  const prefixPath = mapping.saveImagePrefixPath;
  if (prefixPath) {
    const base = path.basename(outputPath, path.extname(outputPath));
    setAtPath(promptObject, prefixPath, base);
  }

  if (Number.isFinite(opts.width) && opts.width > 0) {
    const widthPath = mapping.widthPath || detectDimensionPath(workflow, promptObject, "width");
    if (!widthPath) {
      throw new Error("draw_comfyui_runner: width path unresolved");
    }
    setAtPath(promptObject, widthPath, Math.floor(opts.width));
  }
  if (Number.isFinite(opts.height) && opts.height > 0) {
    const heightPath = mapping.heightPath || detectDimensionPath(workflow, promptObject, "height");
    if (!heightPath) {
      throw new Error("draw_comfyui_runner: height path unresolved");
    }
    setAtPath(promptObject, heightPath, Math.floor(opts.height));
  }

  const payload = {
    client_id: `pyash-${crypto.randomBytes(6).toString("hex")}`,
    prompt: promptObject
  };
  const queued = await requestJson(`${host.replace(/\/$/, "")}/prompt`, payload);
  if (queued?.error) {
    const message = String(queued.error?.message ?? queued.error ?? "prompt rejected");
    throw new Error(`draw_comfyui_runner: prompt rejected: ${message}`);
  }
  if (queued?.node_errors && typeof queued.node_errors === "object" && Object.keys(queued.node_errors).length > 0) {
    throw new Error(`draw_comfyui_runner: prompt node_errors: ${JSON.stringify(queued.node_errors)}`);
  }
  const promptId = queued?.prompt_id;
  if (!promptId) throw new Error("draw_comfyui_runner: missing prompt_id from ComfyUI");

  const image = await pollHistoryForImage(host, promptId);
  const filename = String(image?.filename ?? "");
  if (!filename) throw new Error("draw_comfyui_runner: history image missing filename");
  const subfolder = String(image?.subfolder ?? "");
  const type = String(image?.type ?? "output");
  const viewUrl =
    `${host.replace(/\/$/, "")}/view?filename=${encodeURIComponent(filename)}` +
    `&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
  const bytes = await requestBytes(viewUrl);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, bytes);
  fsSync.writeFileSync(1, `${outputPath}\n`, "utf8");
}

main().catch((err) => {
  const message = err?.message ?? String(err);
  if (message) fsSync.writeFileSync(2, `${message}\n`, "utf8");
  process.exit(1);
});
