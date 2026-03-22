import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { splitSentences, splitSentencesWithLines } from "../program/library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { state } from "../program/bridge/state.mjs";
import { pushModuleDir, popModuleDir } from "../program/bridge/modules.mjs";

export async function loadConfigFile({ configPath, interpretFn }) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const lines = splitSentencesWithLines(raw, { includeThen: true });
    for (const entry of lines) {
      const trimmed = entry.text.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("#")) continue;
      state.currentSourceFilename = configPath;
      state.currentSourceLine = entry.line;
      const sentence = parse(trimmed);
      state.currentSourceSentence = sentence;
      await interpretFn(sentence);
    }
    state.currentSourceFilename = null;
    state.currentSourceLine = null;
    state.currentSourceSentence = null;
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
}

export async function isContainerEnv() {
  if (process.env?.PYA_CONTAINER || process.env?.CONTAINER || process.env?.container) return true;
  const markers = ["/.dockerenv", "/run/.containerenv"];
  for (const marker of markers) {
    try {
      await fs.access(marker);
      return true;
    } catch {
      // ignore missing markers
    }
  }
  return false;
}

async function findConfigRoots({ cwd, entryPath }) {
  const roots = [];
  const seen = new Set();
  const addRoot = (root) => {
    if (!root || seen.has(root)) return;
    seen.add(root);
    roots.push(root);
  };
  addRoot(path.resolve(cwd));
  let cursor = entryPath ? path.dirname(entryPath) : null;
  while (cursor && cursor !== path.dirname(cursor)) {
    const candidate = path.join(cursor, "configure", "default.pya");
    try {
      await fs.access(candidate);
      addRoot(cursor);
      break;
    } catch {
      cursor = path.dirname(cursor);
    }
  }
  return roots;
}

export async function loadDefaultConfig({ cwd, interpretFn, entryPath }) {
  const roots = await findConfigRoots({ cwd, entryPath });
  for (const root of roots) {
    const configPaths = [
      path.resolve(root, "configure", "default.pya"),
      path.resolve(root, "configure", "secret.pya"),
      path.resolve(root, "configure", "container.pya")
    ];
    pushModuleDir(root);
    try {
      for (const configPath of configPaths) {
        if (configPath.endsWith(`${path.sep}container.pya`) && !(await isContainerEnv())) continue;
        await loadConfigFile({ configPath, interpretFn });
      }
    } finally {
      popModuleDir();
    }
  }
}

export function formatIsoWithOffset(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hourCycle: "h23",
      timeZoneName: "shortOffset"
    });
    const parts = formatter.formatToParts(date);
    const get = (type) => parts.find(p => p.type === type)?.value ?? "";
    const yyyy = get("year");
    const mm = get("month");
    const dd = get("day");
    const hh = get("hour");
    const min = get("minute");
    const sec = get("second");
    const ms = get("fractionalSecond");
    let offset = get("timeZoneName");
    if (offset.startsWith("GMT")) offset = offset.slice(3);
    if (!offset || offset === "Z") return `${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}.${ms}Z`;
    const match = offset.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (match) {
      const sign = match[1];
      const hours = match[2].padStart(2, "0");
      const minutes = (match[3] ?? "00").padStart(2, "0");
      offset = `${sign}${hours}:${minutes}`;
    }
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}.${ms}${offset}`;
  } catch {
    return date.toISOString();
  }
}

export function resolveTimeZone(rememberFn) {
  const tz = rememberFn?.("timezone");
  if (typeof tz?.ob?.text === "string") return tz.ob.text;
  if (typeof tz?.ob?.name === "string") return tz.ob.name;
  return null;
}

export function formatRunDurationMs(durationMs) {
  const ms = Math.max(0, Math.round(Number(durationMs) || 0));
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function readFlagValue(args, name) {
  const prefix = `${name}=`;
  const idx = args.findIndex(arg => arg === name || arg.startsWith(prefix));
  if (idx === -1) return null;
  const arg = args[idx];
  if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  return args[idx + 1] ?? null;
}

export function sanitizeRunId(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\\/]/g, "_")
    .replace(/\s+/g, "-") || "run";
}

export function artifactRunPath(value) {
  const parts = String(value ?? "")
    .trim()
    .split(/[\\/]+/g)
    .map(part => sanitizeRunId(part))
    .filter(Boolean);
  return parts.join("/") || "run";
}

export function normalizeRunRoot(value) {
  return String(value ?? "").replace(/[\\]+/g, "/");
}

function isSubpath(relPath) {
  if (!relPath || relPath === ".") return true;
  return !relPath.startsWith("..") && !path.isAbsolute(relPath);
}

function firstKnowInputBinding({ cwd, bindingFacts }) {
  const root = path.resolve(cwd ?? process.cwd());
  const knowInputRoot = path.resolve(root, "know", "input");
  const entries = Array.isArray(bindingFacts) ? bindingFacts : [];
  for (const entry of entries) {
    if (String(entry?.transport ?? "") !== "filename") continue;
    const rawValue = String(entry?.value ?? "").trim();
    if (!rawValue) continue;
    const absValue = path.resolve(root, rawValue);
    const relWithinInput = path.relative(knowInputRoot, absValue);
    if (!isSubpath(relWithinInput)) continue;
    return {
      root,
      absValue,
      relWithinInput,
      parsed: path.parse(relWithinInput)
    };
  }
  return null;
}

async function listSiblingProduceDescriptors(sourcePath) {
  const absolute = path.resolve(sourcePath);
  const parsed = path.parse(absolute);
  const entries = [{ sourcePath: absolute, middleSuffix: "", ext: parsed.ext || "" }];
  let siblings = [];
  try {
    siblings = await fs.readdir(parsed.dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return entries;
    throw err;
  }
  for (const sibling of siblings) {
    if (!sibling?.isFile?.()) continue;
    const siblingParsed = path.parse(String(sibling.name));
    if (siblingParsed.base === parsed.base) continue;
    if (!siblingParsed.name.startsWith(`${parsed.name}.`)) continue;
    const middleSuffix = siblingParsed.name.slice(parsed.name.length);
    entries.push({
      sourcePath: path.join(parsed.dir, sibling.name),
      middleSuffix,
      ext: siblingParsed.ext || ""
    });
  }
  return entries;
}

function withProduceStem({ dir, stem, bundleSuffix, middleSuffix, ext }) {
  const finalStem = bundleSuffix ? `${stem}${bundleSuffix}` : stem;
  return path.join(dir, `${finalStem}${middleSuffix}${ext}`);
}

async function pathExists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

function isObject(value) {
  return Boolean(value && typeof value === "object");
}

async function latestVideoArtifactSource({ cwd, runId, memoryFacts }) {
  const root = path.resolve(cwd ?? process.cwd());
  const runToken = runId ? `artifacts/${artifactRunPath(runId)}/` : "artifacts/";
  const entries = Array.isArray(memoryFacts) ? memoryFacts : [];
  for (let idx = entries.length - 1; idx >= 0; idx -= 1) {
    const fact = entries[idx];
    if (!isObject(fact) || fact.be !== "artifact") continue;
    if (String(fact?.as?.name ?? "") !== "video") continue;
    const locator = String(fact?.to?.filename ?? "").trim();
    if (!locator || !locator.includes(runToken)) continue;
    const sourcePath = path.resolve(root, locator);
    if (!(await pathExists(sourcePath))) continue;
    return sourcePath;
  }
  return null;
}

function latestVideoArtifactFromNewspaper({ cwd, runId, newspaperLines }) {
  const root = path.resolve(cwd ?? process.cwd());
  const runToken = runId ? `artifacts/${artifactRunPath(runId)}/` : "artifacts/";
  const lines = Array.isArray(newspaperLines) ? newspaperLines : [];
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    const line = String(lines[idx] ?? "").trim();
    if (!line) continue;
    let sentence;
    try {
      sentence = parse(line);
    } catch {
      continue;
    }
    if (!isObject(sentence) || sentence.be !== "artifact") continue;
    if (String(sentence?.as?.name ?? "") !== "video") continue;
    const locator = String(sentence?.to?.filename ?? "").trim();
    if (!locator || !locator.includes(runToken)) continue;
    return path.resolve(root, locator);
  }
  return null;
}

export async function deriveKnowProduceBundle({ cwd, bindingFacts, result, runId, memoryFacts, newspaperLines }) {
  const binding = firstKnowInputBinding({ cwd, bindingFacts });
  if (!binding) return [];
  const produceDir = path.resolve(binding.root, "know", "produce", binding.parsed.dir);
  const stem = binding.parsed.name;

  if (typeof result?.ob?.filename === "string" && result.ob.filename.trim()) {
    const primarySource = path.resolve(binding.root, result.ob.filename);
    if (!(await pathExists(primarySource))) return [];
    const entries = await listSiblingProduceDescriptors(primarySource);
    return entries.map((entry) => ({
      kind: "copy",
      sourcePath: entry.sourcePath,
      targetDir: produceDir,
      stem,
      middleSuffix: entry.middleSuffix,
      ext: entry.ext
    }));
  }

  const videoSource = (await latestVideoArtifactSource({ cwd, runId, memoryFacts }))
    ?? latestVideoArtifactFromNewspaper({ cwd, runId, newspaperLines });
  if (videoSource) {
    const entries = await listSiblingProduceDescriptors(videoSource);
    return entries.map((entry) => ({
      kind: "copy",
      sourcePath: entry.sourcePath,
      targetDir: produceDir,
      stem,
      middleSuffix: entry.middleSuffix,
      ext: entry.ext
    }));
  }

  if (result?.ob?.text !== undefined) {
    return [{
      kind: "text",
      text: String(result.ob.text ?? ""),
      targetDir: produceDir,
      stem,
      middleSuffix: "",
      ext: ".txt"
    }];
  }

  return [];
}

export async function allocateProduceBundle(bundle) {
  const entries = Array.isArray(bundle) ? bundle : [];
  if (entries.length === 0) return [];
  const first = entries[0];
  const targetDir = path.resolve(first.targetDir);
  const stem = String(first.stem ?? "").trim();
  if (!stem) return [];
  await fs.mkdir(targetDir, { recursive: true });
  for (let index = 1; index < 1000; index += 1) {
    const bundleSuffix = index === 1 ? "" : `-${String(index).padStart(2, "0")}`;
    const candidates = entries.map((entry) => withProduceStem({
      dir: targetDir,
      stem,
      bundleSuffix,
      middleSuffix: String(entry.middleSuffix ?? ""),
      ext: String(entry.ext ?? "")
    }));
    let collision = false;
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        collision = true;
        break;
      }
    }
    if (!collision) {
      return entries.map((entry, idx) => ({
        ...entry,
        targetPath: candidates[idx]
      }));
    }
  }
  throw new Error(`produce path allocation defective: too many collisions for ${path.join(targetDir, stem)}`);
}

export async function materializeProduceBundle(bundle) {
  const allocated = await allocateProduceBundle(bundle);
  const written = [];
  for (const entry of allocated) {
    const targetPath = path.resolve(entry.targetPath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    if (entry.kind === "text") {
      let payload = String(entry.text ?? "");
      if (!payload.includes("\n") && payload.includes("\\n")) {
        payload = payload.replace(/\\n/g, "\n");
      }
      const text = payload.endsWith("\n") ? payload : `${payload}\n`;
      await fs.writeFile(targetPath, text, "utf8");
    } else if (entry.kind === "copy") {
      await fs.copyFile(entry.sourcePath, targetPath);
    } else {
      throw new Error(`produce bundle defective: unsupported kind ${JSON.stringify(entry.kind)}`);
    }
    written.push(targetPath);
  }
  return written;
}

function parseCheckpointPayload(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function collectSentenceNodes(root) {
  const nodes = [];
  const stack = [root];
  const seen = new Set();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (current.be || current.mood) nodes.push(current);
    for (const value of Object.values(current)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return nodes;
}

export function shouldAutoEnableNewspaper({ entries, rememberFn }) {
  const knownMinds = new Set();
  for (const entry of entries) {
    const line = entry.text.trim();
    if (!line) continue;
    let sentence;
    try {
      sentence = parse(line);
    } catch {
      continue;
    }
    const nodes = collectSentenceNodes(sentence);
    for (const node of nodes) {
      if (node?.be === "mind" && node?.mood === "ya" && node?.su?.name) {
        knownMinds.add(node.su.name);
      }
      if (node?.be === "mind" && node?.mood === "do") return true;
      if (node?.be !== "write" || node?.mood !== "do") continue;
      if (node?.for?.name) return true;
      if (node?.totext?.name) return true;
      const targetName = node?.to?.name;
      if (targetName && knownMinds.has(targetName)) return true;
      if (targetName && rememberFn?.(targetName)?.be === "mind") return true;
    }
  }
  return false;
}

export function shouldAutoEnableNewspaperForRefinery({ entries }) {
  for (const entry of entries) {
    const line = entry.text.trim();
    if (!line) continue;
    let sentence;
    try {
      sentence = parse(line);
    } catch {
      continue;
    }
    const nodes = collectSentenceNodes(sentence);
    for (const node of nodes) {
      if (node?.be === "refinery" && node?.mood === "do") return true;
    }
  }
  return false;
}

export function dateStampFromRunTime(runTime) {
  const match = String(runTime ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}${match[2]}${match[3]}`;
  const now = new Date();
  const yyyy = String(now.getFullYear()).padStart(4, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

export async function nextRunSequence({ dateStamp, cwd }) {
  const candidateDirs = [
    path.resolve(cwd, "newspaper"),
    path.resolve(cwd, "artifacts")
  ];
  let max = 0;
  const prefix = `${dateStamp}-`;
  for (const dir of candidateDirs) {
    let entries = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      const match = entry.match(/^(\d{8})-(\d{3})-/);
      if (!match) continue;
      const value = Number(match[2]);
      if (Number.isFinite(value)) max = Math.max(max, value);
    }
  }
  return String(max + 1).padStart(3, "0");
}

export async function buildRunId({ runTime, sourcePath, cwd }) {
  const dateStamp = dateStampFromRunTime(runTime);
  const seq = await nextRunSequence({ dateStamp, cwd });
  const base = sourcePath
    ? path.basename(sourcePath, path.extname(sourcePath))
    : "run";
  const safeBase = sanitizeRunId(base);
  return `${dateStamp}-${seq}-${safeBase}`;
}

export async function loadCheckpointIndex({ runId, cwd }) {
  const checkpoints = new Map();
  if (!runId) return checkpoints;
  const newspaperPath = path.resolve(cwd, "newspaper", `${sanitizeRunId(runId)}.pya`);
  let text = "";
  try {
    text = await fs.readFile(newspaperPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return checkpoints;
    throw err;
  }
  const lines = splitSentences(text, { includeThen: true });
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let sentence;
    try {
      sentence = parse(line);
    } catch {
      continue;
    }
    if (sentence?.be !== "checkpoint" || sentence?.mood !== "ya") continue;
    const refineryName = sentence?.from?.name;
    const platformName = sentence?.su?.name;
    const hash = sentence?.ob?.text;
    const payload = parseCheckpointPayload(sentence?.fromtext?.text);
    const resultSentence =
      (payload && typeof payload === "object" && payload.result ? payload.result : payload)
      ?? sentence?.to?.la;
    const exportFacts = Array.isArray(payload?.exports) ? payload.exports : [];
    const scopeSlots = payload?.scope && typeof payload.scope === "object" ? payload.scope : {};
    if (!refineryName || !platformName || !hash || !resultSentence) continue;
    const resultLine = sentence?.totext?.text ?? sentenceToPyash(resultSentence);
    if (!checkpoints.has(refineryName)) checkpoints.set(refineryName, new Map());
    checkpoints.get(refineryName).set(platformName, { hash, resultSentence, resultLine, exportFacts, scopeSlots });
  }
  return checkpoints;
}
