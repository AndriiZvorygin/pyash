import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { resolveGpuHousekeeperUrl, submitManagedGpuJob } from "../program/runtime/gpu/managed-ollama.mjs";

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
    output: null,
    reference: null
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
    else if (arg === "--reference") out.reference = args[++i] ?? null;
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
  return opts.workflowName ?? process.env.PYA_MUSIC_WORKFLOW_DEFAULT ?? "audio_ace_step_1_5_xl_turbo";
}

function defaultOutputPath(format = "mp3") {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = crypto.randomBytes(3).toString("hex");
  const ext = String(format ?? "mp3").trim().replace(/^\./u, "") || "mp3";
  return path.join("artifacts", "music", `music-${stamp}-${rand}.${ext}`);
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
    // Keep the capitals camelize just produced; stripping them would turn
    // "voice_boost" into "voiceoost" and every mapping key would miss.
    .replace(/[^a-zA-Z0-9]/g, "");
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

// The mapping .pya spells its keys in words ("voice boost path"); the runner
// asks for them in camel case ("voiceBoostPath"). Compare them the same way
// the runner compares option names, so the two spellings meet.
function mappingLookup(mapping, key) {
  if (!mapping || typeof mapping !== "object") return null;
  const wanted = String(key ?? "").trim();
  if (!wanted) return null;
  if (mapping[wanted]) return mapping[wanted];
  const lower = wanted.toLowerCase();
  for (const [name, value] of Object.entries(mapping)) {
    if (String(name).toLowerCase() === lower) return value;
  }
  return null;
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

// Reads a dotted path back out, so a caller can tell a plain value from a
// link to another node.
function readAtPath(obj, dottedPath) {
  const parts = String(dottedPath ?? "").split(".");
  let cur = obj;
  for (const key of parts) {
    if (cur === undefined || cur === null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

function detectInputPath(workflow, promptObject, inputName, preferredNodeType = "") {
  const wanted = String(inputName ?? "").trim().toLowerCase();
  const preferred = (Array.isArray(preferredNodeType) ? preferredNodeType : [preferredNodeType])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    if (preferred.length && !preferred.includes(String(node?.type ?? ""))) continue;
    const id = String(node?.id ?? "");
    if (!id) continue;
    const inputs = Array.isArray(node?.inputs) ? node.inputs : [];
    if (inputs.some((input) => String(input?.name ?? "").toLowerCase() === wanted)) {
      return `${id}.inputs.${inputName}`;
    }
  }
  for (const [id, entry] of Object.entries(promptObject ?? {})) {
    if (preferred.length && !preferred.includes(String(entry?.class_type ?? ""))) continue;
    const inputs = entry?.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(inputs, inputName)) {
      return `${id}.inputs.${inputName}`;
    }
  }
  return null;
}

const LYRICS_NODE_TYPES = ["AceStepSFTTextEncode", "YuE2GenerateMusic", "TextEncodeAceStepAudio1.5"];
const STYLE_NODE_TYPES = ["AceStepSFTTextEncode", "YuE2GenerateMusic", "TextEncodeAceStepAudio1.5"];
const SAMPLER_NODE_TYPES = ["AceStepSFTGenerate", "KSampler"];
const LATENT_NODE_TYPES = ["EmptyYuE2LatentAudio", "EmptyAceStep1.5LatentAudio"];
const SAVE_NODE_TYPES = ["AceStepSFTSaveAudio", "SaveAudioMP3", "SaveAudioOpus", "SaveAudio"];
const OPTION_ALIASES = new Map([
  ["bpm", ["bpm"]],
  ["timesignature", ["timesignature", "time signature"]],
  ["language", ["language", "langauge"]],
  ["keyscale", ["keyscale", "key scale"]],
  ["duration", ["duration"]],
  ["seconds", ["seconds"]],
  ["seed", ["seed"]],
  ["steps", ["steps"]],
  ["cfg", ["cfg"]],
  ["cfgScale", ["cfgScale", "cfg_scale", "cfg scale", "lmCfgScale", "lm_cfg_scale", "lm cfg scale"]],
  ["cfgscale", ["cfgscale", "cfg_scale", "cfg scale"]],
  ["temperature", ["temperature", "lmTemperature", "lm_temperature", "lm temperature"]],
  ["topP", ["topP", "top_p", "top p"]],
  ["topp", ["topp", "top_p", "top p"]],
  ["topK", ["topK", "top_k", "top k"]],
  ["topk", ["topk", "top_k", "top k"]],
  ["minP", ["minP", "min_p", "min p"]],
  ["minp", ["minp", "min_p", "min p"]],
  ["samplerName", ["samplerName", "sampler_name", "sampler", "sampler name"]],
  ["samplername", ["samplername", "sampler_name", "sampler", "sampler name"]],
  ["scheduler", ["scheduler"]],
  ["denoise", ["denoise"]],
  ["quality", ["quality"]],
  ["maxDuration", ["maxDuration", "max_duration", "max duration"]],
  ["voiceBoost", ["voiceBoost", "voice_boost", "voice boost"]],
  ["repetitionPenalty", ["repetitionPenalty", "repetition_penalty", "repetition penalty"]],
  ["referenceGuidance", ["referenceGuidance", "reference_guidance", "reference guidance"]],
  ["referenceTimbreRepeats", ["referenceTimbreRepeats", "reference_timbre_repeats", "reference timbre repeats"]]
]);
// A workflow may take the voice it sings in from a recording of that voice.
const REFERENCE_NODE_TYPES = ["AceStepSFTLoadReferenceAudio"];

// A save node may name its format outright or fix it in the node type.
const SAVE_NODE_FORMATS = { SaveAudioMP3: "mp3", SaveAudioOpus: "opus" };

function applyWorkflowOption(workflow, promptObject, mapping, canonical, value) {
  const aliases = OPTION_ALIASES.get(canonical);
  if (!aliases) return;

  let resolvedPath = mappingLookup(mapping, `${canonical}Path`);
  if (!resolvedPath) {
    for (const alias of aliases) {
      resolvedPath =
        detectInputPath(workflow, promptObject, alias, STYLE_NODE_TYPES) ||
        detectInputPath(workflow, promptObject, alias, SAMPLER_NODE_TYPES) ||
        detectInputPath(workflow, promptObject, alias, LATENT_NODE_TYPES) ||
        detectInputPath(workflow, promptObject, alias, SAVE_NODE_TYPES);
      if (resolvedPath) break;
    }
  }
  if (resolvedPath) setAtPath(promptObject, resolvedPath, value);
}

// The save node knows which container it will write. The output file must
// carry that extension, because Icecast is handed the bytes as they are.
function detectSaveFormat(workflow, promptObject) {
  for (const entry of Object.values(promptObject ?? {})) {
    const classType = String(entry?.class_type ?? "");
    if (!SAVE_NODE_TYPES.includes(classType)) continue;
    const format = String(entry?.inputs?.format ?? "").trim().toLowerCase();
    if (format) return format;
    const fixed = SAVE_NODE_FORMATS[classType];
    if (fixed) return fixed;
  }
  return "";
}

// Reads the container out of the bytes themselves, so the extension we hand
// on can be checked against what ComfyUI really produced.
function sniffAudioFormat(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (buf.length < 4) return "unknown";
  if (buf.subarray(0, 3).toString("latin1") === "ID3") return "mp3";
  if (buf.subarray(0, 4).toString("latin1") === "fLaC") return "flac";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF") return "wav";
  if (buf.subarray(0, 4).toString("latin1") === "OggS") {
    const head = buf.subarray(0, 64).toString("latin1");
    if (head.includes("OpusHead")) return "opus";
    return "ogg";
  }
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "mp3";
  return "unknown";
}

function formatMatchesExtension(format, ext) {
  const want = String(ext ?? "").trim().toLowerCase().replace(/^\./u, "");
  const got = String(format ?? "").trim().toLowerCase();
  if (!want || !got || got === "unknown") return true;
  if (want === got) return true;
  if (got === "ogg" && want === "opus") return true;
  if (got === "opus" && want === "ogg") return true;
  return false;
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

// A reference voice is a local recording, but ComfyUI only reads files already
// in its own input folder. Upload the bytes first and hand the loader the name
// ComfyUI gave them, so no one has to copy files into the container by hand.
async function uploadReferenceAudio(host, filePath) {
  const bytes = await fs.readFile(filePath);
  const name = path.basename(filePath);
  const form = new FormData();
  form.append("image", new Blob([bytes]), name);
  form.append("type", "input");
  form.append("overwrite", "true");
  const res = await fetch(`${host.replace(/\/$/, "")}/upload/image`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`music_comfyui_runner: reference upload failed ${res.status} ${res.statusText}: ${text}`);
  }
  const payload = await res.json();
  const stored = String(payload?.name ?? "").trim();
  if (!stored) throw new Error("music_comfyui_runner: reference upload returned no name");
  const subfolder = String(payload?.subfolder ?? "").trim();
  return subfolder ? `${subfolder}/${stored}` : stored;
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

// Another surface on the shared ComfyUI runtime can interrupt a render that
// is already under way. That is not the model's fault and the same seed will
// produce the same song, so the run is worth repeating.
function isInterruptedExecution(historyEntry) {
  const status = historyEntry?.status;
  const messages = Array.isArray(status?.messages) ? status.messages : [];
  return messages.some((pair) => Array.isArray(pair) && String(pair[0] ?? "") === "execution_interrupted");
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

  const host = resolveHost(opts);
  const workflowFile = await resolveWorkflowFile(opts);
  const workflow = await readWorkflowJson(workflowFile);
  const promptObject = normalizePromptObject(workflow);
  const saveFormat = detectSaveFormat(workflow, promptObject);
  const outputPath = opts.output ? String(opts.output) : defaultOutputPath(saveFormat);
  if (await copyFixtureToOutput(outputPath)) {
    fsSync.writeFileSync(1, `${outputPath}\n`, "utf8");
    return;
  }

  const mapping = await readMappingPya(workflowFile);
  const options = parseOptions(opts.optionsJson);

  const lyricsPath = mappingLookup(mapping, "lyricsPath")
    || detectInputPath(workflow, promptObject, "lyrics", LYRICS_NODE_TYPES);
  if (!lyricsPath) throw new Error("music_comfyui_runner: lyrics path unresolved");
  setAtPath(promptObject, lyricsPath, lyrics);

  const style = String(opts.style ?? "").trim();
  if (style) {
    const stylePath = mappingLookup(mapping, "stylePath")
      || mappingLookup(mapping, "tagsPath")
      || detectInputPath(workflow, promptObject, "caption", STYLE_NODE_TYPES)
      || detectInputPath(workflow, promptObject, "style", STYLE_NODE_TYPES)
      || detectInputPath(workflow, promptObject, "tags", STYLE_NODE_TYPES);
    if (stylePath) setAtPath(promptObject, stylePath, style);
  }

  // A voice reference is the recording whose timbre the song is sung in. The
  // workflow must carry a loader for it; the file itself is a caller's choice,
  // never baked into the graph.
  const referenceFile = String(opts.reference ?? "").trim();
  if (referenceFile) {
    const referencePath = mappingLookup(mapping, "referenceAudioPath")
      || detectInputPath(workflow, promptObject, "audio", REFERENCE_NODE_TYPES);
    if (!referencePath) throw new Error("music_comfyui_runner: reference audio path unresolved");
    const stored = await uploadReferenceAudio(host, referenceFile);
    setAtPath(promptObject, referencePath, stored);
    const enabledPath = mappingLookup(mapping, "referenceEnabledPath")
      || detectInputPath(workflow, promptObject, "enabled", REFERENCE_NODE_TYPES);
    if (enabledPath) setAtPath(promptObject, enabledPath, true);
  }

  const optionsByCanonical = {};
  for (const [rawKey, rawValue] of Object.entries(options)) {
    const canonical = camelize(rawKey);
    if (!canonical) continue;
    optionsByCanonical[canonical] = parsePrimitive(rawValue);
  }

  for (const canonical of OPTION_ALIASES.keys()) {
    let value = optionsByCanonical[canonical];
    if (value === undefined) value = optionsByCanonical[String(canonical).toLowerCase()];
    if (value === undefined) continue;
    applyWorkflowOption(workflow, promptObject, mapping, canonical, value);
  }

  // The text encoder, the latent and the sampler each carry a length of their
  // own; they must agree, or the two halves of the song disagree in length.
  const durationValue = optionsByCanonical.duration
    ?? optionsByCanonical.Duration
    ?? optionsByCanonical.maxDuration
    ?? optionsByCanonical.maxduration;
  if (durationValue !== undefined) {
    for (const [wanted, types] of [["duration", STYLE_NODE_TYPES], ["duration", SAMPLER_NODE_TYPES], ["seconds", LATENT_NODE_TYPES]]) {
      const durationPath = detectInputPath(workflow, promptObject, wanted, types);
      if (!durationPath) continue;
      // A linked length is driven by the node it points at; overwriting it
      // would cut the link and let the two halves drift apart.
      const current = readAtPath(promptObject, durationPath);
      if (Array.isArray(current)) continue;
      setAtPath(promptObject, durationPath, durationValue);
    }
  }

  const savePrefixPath = mappingLookup(mapping, "saveAudioPrefixPath");
  if (savePrefixPath) {
    const base = path.basename(outputPath, path.extname(outputPath));
    setAtPath(promptObject, savePrefixPath, base);
  } else {
    const savePrefixPath = detectInputPath(workflow, promptObject, "filename_prefix", SAVE_NODE_TYPES);
    if (savePrefixPath) {
      const base = path.basename(outputPath, path.extname(outputPath));
      setAtPath(promptObject, savePrefixPath, base);
    }
  }

  const managerUrl = resolveGpuHousekeeperUrl({ managerUrl: process.env.PYA_GPU_HOUSEKEEPER_URL || "", ollamaUrl: host });
  let audio;
  let promptId = "";
  if (managerUrl) {
    const maxAttempts = Math.max(1, Number.parseInt(String(process.env.PYA_COMFYUI_ATTEMPTS || "3"), 10) || 3);
    const timeoutSec = Number.parseInt(String(process.env.PYA_COMFYUI_TIMEOUT_SEC || "5400"), 10) || 5400;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let managed;
      let history = null;
      try {
        managed = await submitManagedGpuJob({
          runtimeName: "comfyui",
          profileName: resolveWorkflowName(opts),
          providerUrl: host,
          managerUrl,
          jobSpec: {
            kind: "comfyui-prompt",
            resourceRequest: { vramRequiredMb: Number.parseInt(String(process.env.PYA_COMFYUI_VRAM_REQUIRED_MB || "12000"), 10) || 12000 },
            prompt: promptObject,
            clientId: `pyash-${crypto.randomBytes(6).toString("hex")}`,
            timeoutSec
          },
          timeoutMs: (timeoutSec + 300) * 1000
        });
        promptId = String(managed?.promptId || "");
        history = managed?.history || managed;
      } catch (err) {
        // The Housekeeper reports an interrupted render as a failed job, so the
        // interruption is only visible in the error text.
        const text = String(err?.message ?? err ?? "");
        if (!text.includes("execution_interrupted")) throw err;
        if (attempt >= maxAttempts) {
          throw new Error(`music_comfyui_runner: render interrupted ${attempt} time(s): ${text}`);
        }
        fsSync.writeFileSync(2, `music_comfyui_runner: render interrupted, retrying (${attempt}/${maxAttempts})\n`, "utf8");
        continue;
      }
      const errorMessage = extractExecutionError(history);
      if (errorMessage) {
        throw new Error(`music_comfyui_runner: execution failed: ${errorMessage}`);
      }
      audio = pickFirstAudio(history);
      if (audio) break;
      // A render that another surface interrupted is worth repeating: the same
      // seed gives the same song, and the interruption was not the model's doing.
      if (isInterruptedExecution(history) && attempt < maxAttempts) {
        fsSync.writeFileSync(2, `music_comfyui_runner: render interrupted, retrying (${attempt}/${maxAttempts})\n`, "utf8");
        continue;
      }
      throw new Error("music_comfyui_runner: history audio missing");
    }
    if (!audio) throw new Error("music_comfyui_runner: history audio missing");
  } else {
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
    promptId = queued?.prompt_id;
    if (!promptId) throw new Error("music_comfyui_runner: missing prompt_id from ComfyUI");
    audio = await pollHistoryForAudio(host, promptId);
  }
  const filename = String(audio?.filename ?? "");
  if (!filename) throw new Error("music_comfyui_runner: history audio missing filename");
  const subfolder = String(audio?.subfolder ?? "");
  const type = String(audio?.type ?? "output");
  const viewUrl =
    `${host.replace(/\/$/, "")}/view?filename=${encodeURIComponent(filename)}` +
    `&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
  const bytes = await requestBytes(viewUrl);
  const outputExt = path.extname(outputPath).replace(/^\./u, "");
  const sniffed = sniffAudioFormat(bytes);
  if (!formatMatchesExtension(sniffed, outputExt)) {
    throw new Error(
      `music_comfyui_runner: produced ${sniffed || "unknown"} bytes but the output is named ${outputExt}`
    );
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, bytes);
  fsSync.writeFileSync(1, `${outputPath}\n`, "utf8");
}

export {
  applyWorkflowOption,
  camelize,
  detectInputPath,
  detectSaveFormat,
  formatMatchesExtension,
  isInterruptedExecution,
  mappingLookup,
  parseOptions,
  readAtPath,
  readMappingPya,
  setAtPath,
  sniffAudioFormat,
  LYRICS_NODE_TYPES,
  REFERENCE_NODE_TYPES,
  SAMPLER_NODE_TYPES,
  SAVE_NODE_TYPES,
  STYLE_NODE_TYPES
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    const message = err?.message ?? String(err);
    if (message) fsSync.writeFileSync(2, `${message}\n`, "utf8");
    process.exit(1);
  });
}
