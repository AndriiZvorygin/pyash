import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    lyrics: null,
    style: null,
    host: null,
    backend: null,
    workflowRoot: null,
    workflowName: null,
    workflowFile: null,
    optionsJson: null,
    output: null
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--lyrics") out.lyrics = args[++i] ?? null;
    else if (arg === "--style") out.style = args[++i] ?? null;
    else if (arg === "--host") out.host = args[++i] ?? null;
    else if (arg === "--backend") out.backend = args[++i] ?? null;
    else if (arg === "--workflow-root") out.workflowRoot = args[++i] ?? null;
    else if (arg === "--workflow-name") out.workflowName = args[++i] ?? null;
    else if (arg === "--workflow-file") out.workflowFile = args[++i] ?? null;
    else if (arg === "--options-json") out.optionsJson = args[++i] ?? null;
    else if (arg === "--output") out.output = args[++i] ?? null;
  }
  return out;
}

function resolveHost(opts) {
  return opts.host ?? process.env.PYA_MUSIC_HOST ?? process.env.PYA_SAY_HOST ?? process.env.PYA_DRAW_HOST ?? "http://localhost:8188";
}

function resolveBackend(opts) {
  return opts.backend ?? process.env.PYA_MUSIC_BACKEND ?? "comfyui";
}

function resolveWorkflowRoot(opts) {
  return opts.workflowRoot ?? process.env.PYA_MUSIC_WORKFLOW_ROOT ?? "./music/";
}

function resolveWorkflowName(opts) {
  return opts.workflowName ?? process.env.PYA_MUSIC_WORKFLOW_DEFAULT ?? "audio_ace_step_1_5_checkpoint";
}

function defaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = crypto.randomBytes(3).toString("hex");
  return path.join("artifacts", "music", `music-${stamp}-${rand}.opus`);
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
    throw new Error(`music_comfyui_runner: invalid workflow json (${err?.message ?? err})`);
  }
}

function camelize(input = "") {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+([a-z0-9])/g, (_m, ch) => String(ch).toUpperCase())
    .replace(/[^a-z0-9]/g, "");
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
      const keyRaw = String(m[1] ?? "").trim();
      const value = String(m[2] ?? "");
      const lower = keyRaw.toLowerCase();
      if (lower.endsWith(" path")) {
        const base = camelize(lower.replace(/\s+path$/u, ""));
        if (base) result[`${base}Path`] = value;
      }
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
    throw new Error("music_comfyui_runner: workflow missing nodes");
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
        let value = widgets[widgetIndex];
        if (inputName !== "seed" && widgetIndex === 1 && typeof value === "string" && (value === "fixed" || value === "randomize" || value === "increment")) {
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

function detectInputPath(workflow, promptObject, inputName, preferredNodeType = "") {
  const wanted = String(inputName ?? "").trim().toLowerCase();
  const preferred = String(preferredNodeType ?? "").trim();
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    if (preferred && String(node?.type ?? "") !== preferred) continue;
    const id = String(node?.id ?? "");
    if (!id) continue;
    const inputs = Array.isArray(node?.inputs) ? node.inputs : [];
    if (inputs.some((input) => String(input?.name ?? "").toLowerCase() === wanted)) {
      return `${id}.inputs.${inputName}`;
    }
  }
  for (const [id, entry] of Object.entries(promptObject ?? {})) {
    if (preferred && String(entry?.class_type ?? "") !== preferred) continue;
    const inputs = entry?.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(inputs, inputName)) {
      return `${id}.inputs.${inputName}`;
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
    throw new Error(`music_comfyui_runner: request failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function requestText(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`music_comfyui_runner: request failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.text();
}

async function requestBytes(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`music_comfyui_runner: request failed ${res.status} ${res.statusText}: ${text}`);
  }
  return Buffer.from(await res.arrayBuffer());
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

async function pollHistoryForAudio(host, promptId, timeoutMs = 300000) {
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
      throw new Error(`music_comfyui_runner: execution failed: ${errorMessage}`);
    }
    const audio = pickFirstAudio(entry);
    if (audio) return audio;
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  throw new Error("music_comfyui_runner: timed out waiting for generated audio");
}

async function copyFixtureToOutput(outputPath) {
  const fixtureFile = process.env.PYA_MUSIC_COMFYUI_FIXTURE_FILE;
  if (!fixtureFile) return false;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.copyFile(fixtureFile, outputPath);
  return true;
}

function parseOptions(raw = null) {
  const text = String(raw ?? "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parsePrimitive(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (trimmed === "truth") return true;
  if (trimmed === "lie") return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return value;
}

async function main() {
  const opts = parseArgs(process.argv);
  const lyrics = String(opts.lyrics ?? "").trim();
  if (!lyrics) throw new Error("music_comfyui_runner: missing lyrics");
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
  const options = parseOptions(opts.optionsJson);

  const lyricsPath = mapping.lyricsPath || detectInputPath(workflow, promptObject, "lyrics", "TextEncodeAceStepAudio1.5");
  if (!lyricsPath) throw new Error("music_comfyui_runner: lyrics path unresolved");
  setAtPath(promptObject, lyricsPath, lyrics);

  const style = String(opts.style ?? "").trim();
  if (style) {
    const stylePath = mapping.stylePath || mapping.tagsPath || detectInputPath(workflow, promptObject, "tags", "TextEncodeAceStepAudio1.5");
    if (stylePath) setAtPath(promptObject, stylePath, style);
  }

  const keyAliases = new Map([
    ["bpm", ["bpm"]],
    ["timesignature", ["timesignature", "time signature"]],
    ["language", ["language", "langauge"]],
    ["keyscale", ["keyscale", "key scale"]],
    ["duration", ["duration"]],
    ["seconds", ["seconds"]],
    ["seed", ["seed"]],
    ["steps", ["steps"]],
    ["cfg", ["cfg"]],
    ["cfgscale", ["cfg_scale", "cfg scale"]],
    ["temperature", ["temperature"]],
    ["topp", ["top_p", "top p"]],
    ["topk", ["top_k", "top k"]],
    ["minp", ["min_p", "min p"]],
    ["samplername", ["sampler_name", "sampler", "sampler name"]],
    ["scheduler", ["scheduler"]],
    ["denoise", ["denoise"]],
    ["quality", ["quality"]]
  ]);

  const optionsByCanonical = {};
  for (const [rawKey, rawValue] of Object.entries(options)) {
    const canonical = camelize(rawKey);
    if (!canonical) continue;
    optionsByCanonical[canonical] = parsePrimitive(rawValue);
  }

  for (const [canonical, aliases] of keyAliases.entries()) {
    if (!Object.prototype.hasOwnProperty.call(optionsByCanonical, canonical)) continue;
    const pathKey = `${canonical}Path`;
    let resolvedPath = mapping[pathKey] || null;
    if (!resolvedPath) {
      for (const alias of aliases) {
        const aliasName = String(alias);
        resolvedPath =
          detectInputPath(workflow, promptObject, aliasName, "TextEncodeAceStepAudio1.5") ||
          detectInputPath(workflow, promptObject, aliasName, "KSampler") ||
          detectInputPath(workflow, promptObject, aliasName, "EmptyAceStep1.5LatentAudio") ||
          detectInputPath(workflow, promptObject, aliasName, "SaveAudioOpus");
        if (resolvedPath) break;
      }
    }
    if (resolvedPath) setAtPath(promptObject, resolvedPath, optionsByCanonical[canonical]);
  }

  if (mapping.saveAudioPrefixPath) {
    const base = path.basename(outputPath, path.extname(outputPath));
    setAtPath(promptObject, mapping.saveAudioPrefixPath, base);
  } else {
    const savePrefixPath = detectInputPath(workflow, promptObject, "filename_prefix", "SaveAudioOpus");
    if (savePrefixPath) {
      const base = path.basename(outputPath, path.extname(outputPath));
      setAtPath(promptObject, savePrefixPath, base);
    }
  }

  const queued = await requestJson(`${host.replace(/\/$/, "")}/prompt`, {
    client_id: `pyash-${crypto.randomBytes(6).toString("hex")}`,
    prompt: promptObject
  });
  if (queued?.error) {
    const message = String(queued.error?.message ?? queued.error ?? "prompt rejected");
    throw new Error(`music_comfyui_runner: prompt rejected: ${message}`);
  }
  if (queued?.node_errors && typeof queued.node_errors === "object" && Object.keys(queued.node_errors).length > 0) {
    throw new Error(`music_comfyui_runner: prompt node_errors: ${JSON.stringify(queued.node_errors)}`);
  }
  const promptId = queued?.prompt_id;
  if (!promptId) throw new Error("music_comfyui_runner: missing prompt_id from ComfyUI");

  const audio = await pollHistoryForAudio(host, promptId);
  const filename = String(audio?.filename ?? "");
  if (!filename) throw new Error("music_comfyui_runner: history audio missing filename");
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
