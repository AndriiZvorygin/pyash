import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    textStdin: false,
    text: null,
    instruct: null,
    host: null,
    backend: null,
    workflowRoot: null,
    workflowName: null,
    workflowFile: null,
    output: null
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--text-stdin") out.textStdin = true;
    else if (arg === "--text") out.text = args[++i] ?? null;
    else if (arg === "--instruct") out.instruct = args[++i] ?? null;
    else if (arg === "--host") out.host = args[++i] ?? null;
    else if (arg === "--backend") out.backend = args[++i] ?? null;
    else if (arg === "--workflow-root") out.workflowRoot = args[++i] ?? null;
    else if (arg === "--workflow-name") out.workflowName = args[++i] ?? null;
    else if (arg === "--workflow-file") out.workflowFile = args[++i] ?? null;
    else if (arg === "--output") out.output = args[++i] ?? null;
  }
  return out;
}

function resolveHost(opts) {
  return opts.host ?? process.env.PYA_SAY_HOST ?? process.env.PYA_DRAW_HOST ?? "http://localhost:8188";
}

function resolveBackend(opts) {
  return opts.backend ?? process.env.PYA_SAY_BACKEND ?? "comfyui";
}

function resolveWorkflowRoot(opts) {
  return opts.workflowRoot ?? process.env.PYA_SAY_WORKFLOW_ROOT ?? "./say/";
}

function resolveWorkflowName(opts) {
  return opts.workflowName ?? process.env.PYA_SAY_WORKFLOW_DEFAULT ?? "andrii_teaching_voice_qwen3_TTS";
}

function resolveText(opts) {
  if (opts.text !== null) return String(opts.text);
  if (opts.textStdin) return fsSync.readFileSync(0, "utf8");
  return "";
}

function defaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = crypto.randomBytes(3).toString("hex");
  return path.join("artifacts", "say", `qwen-say-${stamp}-${rand}.wav`);
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
    throw new Error(`say_comfyui_runner: invalid workflow json (${err?.message ?? err})`);
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
      if (key === "text path") result.textPath = value;
      if (key === "instruct path") result.instructPath = value;
      if (key === "default instruct path") result.instructPath = value;
      if (key === "tone path") result.instructPath = value;
      if (key === "audio path") result.audioPath = value;
      if (key === "save audio prefix path") result.saveAudioPrefixPath = value;
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
    throw new Error("say_comfyui_runner: workflow missing nodes");
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
    const hasSeedWidget = widgetInputNames.includes("seed");
    const seedModeToken = widgets.length > 1 ? String(widgets[1] ?? "") : "";
    const hasQwenSeedModeShape =
      hasSeedWidget &&
      (seedModeToken === "randomize" || seedModeToken === "fixed" || seedModeToken === "increment") &&
      widgets.length === widgetInputNames.length + 1;
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
        let value = widgets[widgetIndex];
        if (hasQwenSeedModeShape && inputName !== "seed" && widgetIndex === 1) {
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

function detectTextPath(workflow, promptObject) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    const nodeId = String(node?.id ?? "");
    if (!nodeId) continue;
    const inputs = Array.isArray(node?.inputs) ? node.inputs : [];
    const hasText = inputs.some((input) => String(input?.name ?? "").toLowerCase() === "text");
    if (hasText) return `${nodeId}.inputs.text`;
  }
  for (const [id, entry] of Object.entries(promptObject ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    const input = entry.inputs;
    if (input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "text")) {
      return `${id}.inputs.text`;
    }
  }
  return null;
}

function detectInstructPath(workflow, promptObject) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    const nodeId = String(node?.id ?? "");
    if (!nodeId) continue;
    const inputs = Array.isArray(node?.inputs) ? node.inputs : [];
    const hasInstruct = inputs.some((input) => String(input?.name ?? "").toLowerCase() === "default_instruct");
    if (hasInstruct) return `${nodeId}.inputs.default_instruct`;
  }
  for (const [id, entry] of Object.entries(promptObject ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    const input = entry.inputs;
    if (input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "default_instruct")) {
      return `${id}.inputs.default_instruct`;
    }
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

function pickFirstAudio(historyEntry) {
  const outputs = historyEntry?.outputs;
  if (!outputs || typeof outputs !== "object") return null;
  for (const value of Object.values(outputs)) {
    if (!value || typeof value !== "object") continue;
    const pools = [];
    if (Array.isArray(value.audios)) pools.push(...value.audios);
    if (Array.isArray(value.audio)) pools.push(...value.audio);
    if (value.audio && typeof value.audio === "object") pools.push(value.audio);
    if (Array.isArray(value.sounds)) pools.push(...value.sounds);
    if (Array.isArray(value.files)) pools.push(...value.files);
    for (const item of pools) {
      const filename = String(item?.filename ?? "");
      if (!filename) continue;
      return {
        filename,
        subfolder: String(item?.subfolder ?? ""),
        type: String(item?.type ?? "output")
      };
    }
  }
  return null;
}

async function requestJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`say_comfyui_runner: request failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function requestText(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`say_comfyui_runner: request failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.text();
}

async function requestBytes(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`say_comfyui_runner: request failed ${res.status} ${res.statusText}: ${text}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function pollHistoryForAudio(host, promptId, timeoutMs = 180000) {
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
      throw new Error(`say_comfyui_runner: execution failed: ${errorMessage}`);
    }
    const audio = pickFirstAudio(entry);
    if (audio) return audio;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("say_comfyui_runner: timed out waiting for generated audio");
}

async function copyFixtureToOutput(outputPath) {
  const fixtureFile = process.env.PYA_SAY_COMFYUI_FIXTURE_FILE;
  if (!fixtureFile) return false;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.copyFile(fixtureFile, outputPath);
  return true;
}

async function main() {
  const opts = parseArgs(process.argv);
  const text = String(resolveText(opts) ?? "").trim();
  if (!text) throw new Error("say_comfyui_runner: missing text");
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
  const instruct = String(opts.instruct ?? "").trim();

  const textPath = mapping.textPath || detectTextPath(workflow, promptObject);
  if (!textPath) throw new Error("say_comfyui_runner: text path unresolved");
  setAtPath(promptObject, textPath, text);
  if (instruct) {
    const instructPath = mapping.instructPath || detectInstructPath(workflow, promptObject);
    if (instructPath) setAtPath(promptObject, instructPath, instruct);
  }

  if (mapping.saveAudioPrefixPath) {
    const base = path.basename(outputPath, path.extname(outputPath));
    setAtPath(promptObject, mapping.saveAudioPrefixPath, base);
  }

  const queued = await requestJson(`${host.replace(/\/$/, "")}/prompt`, {
    client_id: `pyash-${crypto.randomBytes(6).toString("hex")}`,
    prompt: promptObject
  });
  if (queued?.error) {
    const message = String(queued.error?.message ?? queued.error ?? "prompt rejected");
    throw new Error(`say_comfyui_runner: prompt rejected: ${message}`);
  }
  if (queued?.node_errors && typeof queued.node_errors === "object" && Object.keys(queued.node_errors).length > 0) {
    throw new Error(`say_comfyui_runner: prompt node_errors: ${JSON.stringify(queued.node_errors)}`);
  }
  const promptId = queued?.prompt_id;
  if (!promptId) throw new Error("say_comfyui_runner: missing prompt_id from ComfyUI");

  let audio = await pollHistoryForAudio(host, promptId);
  if (mapping.audioPath) {
    const filename = String(audio?.filename ?? "");
    if (!filename) throw new Error("say_comfyui_runner: history audio missing filename");
  }
  const filename = String(audio?.filename ?? "");
  if (!filename) throw new Error("say_comfyui_runner: history audio missing filename");
  const subfolder = String(audio?.subfolder ?? "");
  const type = String(audio?.type ?? "output");
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
