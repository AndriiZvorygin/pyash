import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../understand/index.mjs";
import { splitSentences, splitSentencesWithLines } from "../library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { state } from "../bridge/state.mjs";
import { pushModuleDir, popModuleDir } from "../bridge/modules.mjs";

export async function loadConfigFile({ configPath, interpretFn }) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const lines = splitSentencesWithLines(raw, { includeThen: true });
    for (const entry of lines) {
      const trimmed = entry.text.trim();
      if (!trimmed) continue;
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

export async function loadDefaultConfig({ cwd, interpretFn }) {
  const configPaths = [
    path.resolve(cwd, "configure", "default.pya"),
    path.resolve(cwd, "configure", "container.pya"),
    path.resolve(cwd, "configure", "secret.pya")
  ];
  pushModuleDir(cwd);
  try {
    for (const configPath of configPaths) {
      if (configPath.endsWith(`${path.sep}container.pya`) && !(await isContainerEnv())) continue;
      await loadConfigFile({ configPath, interpretFn });
    }
  } finally {
    popModuleDir();
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

export function normalizeRunRoot(value) {
  return String(value ?? "").replace(/[\\]+/g, "/");
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
  const newspaperDir = path.resolve(cwd, "newspaper");
  let entries = [];
  try {
    entries = await fs.readdir(newspaperDir);
  } catch {
    return "001";
  }
  let max = 0;
  const prefix = `${dateStamp}-`;
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const match = entry.match(/^(\d{8})-(\d{3})-/);
    if (!match) continue;
    const value = Number(match[2]);
    if (Number.isFinite(value)) max = Math.max(max, value);
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
    const resultSentence = sentence?.to?.la;
    if (!refineryName || !platformName || !hash || !resultSentence) continue;
    const resultLine = sentenceToPyash(resultSentence);
    if (!checkpoints.has(refineryName)) checkpoints.set(refineryName, new Map());
    checkpoints.get(refineryName).set(platformName, { hash, resultSentence, resultLine });
  }
  return checkpoints;
}
