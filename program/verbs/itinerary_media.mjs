import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { throwErrorSentence } from "../error.mjs";
import { allRemember, remember } from "../remember/index.mjs";
import { resolveAgentPath } from "../library/agent_cwd.mjs";
import { state } from "../bridge/state.mjs";
import { parseSrtToCuts, parseItineraryPya, renderItineraryPya } from "../../command/itinerary_io.mjs";
import { outputPathForCut, promptFromCut, runDraw } from "../../command/itinerary_to_draw_images.mjs";
import {
  buildTimelineItems,
  createConcatListFile,
  createVideoConcatListFile,
  findImageForCut,
  getAudioDurationSeconds,
  runFfmpeg,
  runFfmpegConcatVideos
} from "../../command/itinerary_to_video.mjs";
import { callPromptMind, buildPromptifyPacket } from "../../command/itinerary_promptify.mjs";
import { enforceAutoDischarge } from "../motor/provider_auto_discharge.mjs";
import { emitExchangeSentence, getExchangeRunId, lookupArtifactLocator, recordArtifact } from "../bridge/exchange.mjs";
import { renderSayValue } from "./say.mjs";

function buildRunTag(now = new Date()) {
  const iso = now.toISOString();
  const stamp = iso.replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = Math.random().toString(16).slice(2, 8).padEnd(6, "0").slice(0, 6);
  return `${stamp}-${rand}`;
}

function defaultDrawOutputDir() {
  const runId = String(getExchangeRunId?.() ?? "").trim();
  if (runId) return path.join("artifacts", runId, "draw");
  return path.join("artifacts", "draw", buildRunTag());
}

function normalizeCutEntry(entry, index) {
  const since = Number(entry?.since?.num ?? entry?.since ?? 0);
  const until = Number(entry?.until?.num ?? entry?.until ?? since);
  const obText = String(entry?.ob?.text ?? entry?.obText ?? "");
  const obFilename = String(entry?.ob?.filename ?? entry?.obFilename ?? "");
  const name = String(entry?.su?.name ?? entry?.name ?? `cut ${String(index).padStart(3, "0")}`);
  return {
    index,
    name,
    since: Number.isFinite(since) ? since : 0,
    until: Number.isFinite(until) ? until : 0,
    obText,
    obFilename
  };
}

function itineraryCutsFromSeriesFact(fact = {}) {
  const entries = Array.isArray(fact?.ob?.series) ? fact.ob.series : [];
  return entries
    .map((entry, idx) => normalizeCutEntry(entry, idx + 1))
    .filter(cut => cut.obText || cut.obFilename);
}

function windowCuts(rows = [], targetSeconds = 6) {
  const target = Number.isFinite(targetSeconds) && targetSeconds > 0 ? targetSeconds : 6;
  const ordered = Array.isArray(rows) ? rows : [];
  if (!ordered.length) return [];
  const out = [];
  let cursor = null;
  let index = 1;
  const flush = () => {
    if (!cursor) return;
    const text = cursor.textParts.join(" ").replace(/\s+/g, " ").trim();
    if (!text) return;
    out.push({
      index,
      name: `cut ${String(index).padStart(3, "0")}`,
      since: cursor.since,
      until: Math.max(cursor.until, cursor.since + 0.05),
      obText: text
    });
    index += 1;
    cursor = null;
  };
  for (const row of ordered) {
    const since = Number(row?.since ?? 0);
    const until = Number(row?.until ?? since);
    const text = String(row?.obText ?? "").trim();
    if (!text) continue;
    if (!cursor) {
      cursor = { since, until, textParts: [text] };
      continue;
    }
    const nextUntil = Math.max(cursor.until, until);
    const spanIfMerged = nextUntil - cursor.since;
    if (spanIfMerged <= target || cursor.textParts.length < 2) {
      cursor.until = nextUntil;
      cursor.textParts.push(text);
      continue;
    }
    flush();
    cursor = { since, until, textParts: [text] };
  }
  flush();
  return out;
}

function splitTextParagraphs(text = "") {
  const source = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  return source
    .split(/\n\s*\n+/u)
    .map((entry) => String(entry ?? "").replace(/[ \t]+\n/g, "\n").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function itinerarySuffixFromSentence(sentence = {}) {
  const raw = Number(sentence?.by?.num);
  if (!Number.isFinite(raw) || raw <= 0) return "";
  return `-${String(Math.trunc(raw)).padStart(3, "0")}`;
}

async function persistItineraryManifest({
  sentence = {},
  itineraryName = "itinerary",
  series = [],
  rememberFn = remember,
  fallbackPrefix = "itinerary"
} = {}) {
  const runId = String(getExchangeRunId?.() ?? "").trim();
  if (!runId) return "";
  const outputHandle = platformOutputHandleName(sentence, fallbackPrefix);
  const outputPrefix = `${normalizePlatformHandleToPrefix(outputHandle, fallbackPrefix)}${itinerarySuffixFromSentence(sentence)}`;
  const outputFile = path.join("artifacts", runId, `${outputPrefix}.series.pya`);
  const outputResolved = resolveAgentPath(outputFile, { rememberFn });
  if (outputResolved.outside) {
    throwErrorSentence({
      name: "itinerary defective",
      message: `itinerary defective: outside agent cwd (${outputResolved.agentCwd})`,
      from: { name: "itinerary" },
      raw: { sentence }
    });
  }
  await fs.mkdir(path.dirname(outputResolved.resolved), { recursive: true });
  const itineraryText = renderItineraryPya({
    itineraryName,
    cuts: series.map((entry, idx) => ({
      index: Number(entry?.by?.num ?? (idx + 1)),
      name: String(entry?.su?.name ?? `cut ${String(idx + 1).padStart(3, "0")}`),
      since: Number(entry?.since?.num ?? 0),
      until: Number(entry?.until?.num ?? entry?.since?.num ?? 0),
      obText: entry?.ob?.text !== undefined ? String(entry?.ob?.text ?? "") : undefined,
      obFilename: entry?.ob?.filename !== undefined ? String(entry?.ob?.filename ?? "") : undefined
    }))
  });
  await fs.writeFile(outputResolved.resolved, itineraryText, "utf8");
  const itineraryBytes = await fs.readFile(outputResolved.resolved);
  const itineraryArtifact = recordArtifact({
    locator: outputResolved.resolved,
    producer: String(sentence?.su?.name ?? fallbackPrefix),
    bytes: itineraryBytes,
    kind: "series"
  });
  emitExchangeSentence({
    mood: "ya",
    su: { name: `${fallbackPrefix} itinerary manifest` },
    ob: { filename: outputResolved.resolved },
    be: "artifact",
    accordingto: itineraryArtifact?.su?.name ? { name: itineraryArtifact.su.name } : undefined
  });
  return outputResolved.resolved;
}

async function resolveItineraryCuts(fromCase, { rememberFn = remember } = {}) {
  const dependencyNamesFromVectorCase = (source) => {
    const values = Array.isArray(source?.ve?.values)
      ? source.ve.values.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    if (!values.length) return [];
    const dependencies = [];
    let i = 0;
    while (i < values.length) {
      if (values[i] === "name") {
        i += 1;
        continue;
      }
      const words = [];
      while (i < values.length && values[i] !== "name") {
        words.push(values[i]);
        i += 1;
      }
      const token = words.join(" ").trim();
      if (token) dependencies.push(token);
    }
    return dependencies;
  };

  const resolveItineraryName = (source) => {
    const fromName = String(source?.name ?? "").trim();
    if (fromName) return fromName;

    const dependencies = dependencyNamesFromVectorCase(source);
    if (!dependencies.length) return "";

    const typedItinerary = dependencies.find((token) => {
      const parts = token.split(/\s+/).filter(Boolean);
      return parts.length >= 2 && parts[0].toLowerCase() === "itinerary";
    });
    if (typedItinerary) {
      return typedItinerary.split(/\s+/).slice(1).join(" ").trim();
    }

    const exactItinerary = dependencies.find((token) => token.toLowerCase() === "itinerary");
    if (exactItinerary) return exactItinerary;

    return String(dependencies[0] ?? "").trim();
  };

  const name = resolveItineraryName(fromCase);
  if (!name) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: missing from name itinerary or from ve name itinerary",
      from: { name: "itinerary" },
      raw: { from: fromCase }
    });
  }
  const fact = rememberFn(name);
  if (!fact) {
    throwErrorSentence({
      name: "itinerary defective",
      message: `itinerary defective: missing ${name}`,
      from: { name: "itinerary" },
      raw: { from: fromCase }
    });
  }

  const filename = typeof fact?.ob?.filename === "string" ? fact.ob.filename : "";
  if (filename.trim()) {
    const { resolved, outside, agentCwd } = resolveAgentPath(filename, { rememberFn });
    if (outside) {
      throwErrorSentence({
        name: "itinerary defective",
        message: `itinerary defective: outside agent cwd (${agentCwd})`,
        from: { name: "itinerary" },
        raw: { filename }
      });
    }
    try {
      const text = await fs.readFile(resolved, "utf8");
      const parsed = parseItineraryPya(text);
      return parsed.cuts;
    } catch {
      // fall through to inline or series payload when persisted locator is unavailable
    }
  }

  const seriesCuts = itineraryCutsFromSeriesFact(fact);
  if (seriesCuts.length) return seriesCuts;

  const inlineText = typeof fact?.ob?.text === "string" ? fact.ob.text : "";
  if (inlineText.trim()) {
    const parsed = parseItineraryPya(inlineText);
    return parsed.cuts;
  }

  throwErrorSentence({
    name: "itinerary defective",
    message: "itinerary defective: requires ob series, ob text, or ob filename",
    from: { name: "itinerary" },
    raw: { fact }
  });
}

function drawHost(rememberFn) {
  return String(rememberFn("draw host")?.ob?.text ?? "").trim();
}

function drawWorkflowName(rememberFn) {
  return String(rememberFn("draw workflow default")?.ob?.text ?? "").trim();
}

function normalizePlatformHandleToPrefix(value, fallback = "draw") {
  const raw = String(value ?? "").trim();
  const base = raw || fallback;
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function platformOutputHandleName(sentence, fallback = "draw") {
  const target = String(sentence?.to?.name ?? "").trim();
  if (target) return target;
  const subject = String(sentence?.su?.name ?? "").trim();
  if (subject) return subject;
  return fallback;
}

function resolveFromTextPrompt(value, rememberFn) {
  if (!value) return "";
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.name === "string" && rememberFn) {
    const fact = rememberFn(value.name);
    return String(fact?.ob?.text ?? "");
  }
  return "";
}

function resolvePromptifyPacketTemplate(sentence, rememberFn) {
  if (typeof sentence?.ob?.text === "string") return sentence.ob.text;
  if (typeof sentence?.ob?.name === "string" && rememberFn) {
    const fact = rememberFn(sentence.ob.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  if (sentence?.ob?.genitive) {
    const rendered = renderSayValue({ genitive: sentence.ob.genitive }, { rememberFn });
    if (rendered !== undefined && rendered !== null) return String(rendered);
  }
  return "";
}

function promptifyModel(sentence, rememberFn) {
  const callModel = String(sentence?.as?.name ?? sentence?.as?.text ?? "").trim();
  if (callModel) return callModel;
  const mindName = String(sentence?.for?.name ?? "mind").trim();
  const mindFact = rememberFn?.(mindName);
  const model = String(mindFact?.as?.name ?? "").trim();
  if (model) return model;
  return process.env.PYA_DRAW_PROMPT_MODEL || process.env.PYA_MIND_MODEL || "qwen3-vl:8b-instruct";
}

function promptifyHost(sentence, rememberFn) {
  const callHost = String(sentence?.fromstate?.text ?? "").trim();
  if (callHost) return callHost;
  const hostFact = String(rememberFn?.("mind host")?.ob?.text ?? "").trim();
  if (hostFact) return hostFact;
  return process.env.OLLAMA_HOST || "http://localhost:11434";
}

function resolveNumericFromMapEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const direct = Number(entry?.num);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const obNum = Number(entry?.ob?.num);
  if (Number.isFinite(obNum) && obNum > 0) return Math.floor(obNum);
  return null;
}

function resolveTextFromMapEntry(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (typeof entry?.text === "string") return entry.text;
  if (typeof entry?.ob?.text === "string") return entry.ob.text;
  return "";
}

function resolveDrawSize(sentence, rememberFn) {
  const withName = String(sentence?.with?.name ?? "").trim();
  if (!withName) return { width: null, height: null, negativePrompt: "" };
  const fact = rememberFn?.(withName);
  const map = fact?.ob?.map;
  if (!map || typeof map !== "object") return { width: null, height: null, negativePrompt: "" };
  const width = resolveNumericFromMapEntry(map.width);
  const height = resolveNumericFromMapEntry(map.height);
  const negativePrompt = resolveTextFromMapEntry(map["negative prompt"]) || resolveTextFromMapEntry(map.negativePrompt);
  return { width, height, negativePrompt };
}

function sentenceWantsPhotographsType(sentence) {
  const words = Array.isArray(sentence?.to?.nameTypeWords)
    ? sentence.to.nameTypeWords.map(v => String(v).trim().toLowerCase())
    : [];
  return words.includes("photographs");
}

function buildPhotographSeriesEntry({ cut, artifact, filename, bytes }) {
  const row = {
    mood: "ya",
    su: { name: `cut ${String(cut.index).padStart(3, "0")}` },
    by: { num: Number(bytes ?? 0) },
    since: { num: Number(cut.since ?? 0) },
    until: { num: Number(cut.until ?? cut.since ?? 0) },
    ob: { filename: String(filename ?? "") },
    be: "photograph"
  };
  if (artifact?.su?.name) row.accordingto = { name: artifact.su.name };
  return row;
}

function photographSeriesToPya(series = []) {
  const lines = ["su name photographs be series def"];
  for (const row of series) {
    const cutName = String(row?.su?.name ?? "cut");
    const since = Number(row?.since?.num ?? 0);
    const until = Number(row?.until?.num ?? since);
    const filename = String(row?.ob?.filename ?? "");
    const bytes = Number(row?.by?.num ?? 0);
    const accordingto = String(row?.accordingto?.name ?? "");
    let line = `su name ${cutName} since num ${since.toFixed(3)} until num ${until.toFixed(3)} ob filename ${JSON.stringify(filename)} by num ${bytes}`;
    if (accordingto) line += ` accordingto name ${accordingto}`;
    line += " be photograph ya";
    lines.push(line);
  }
  return `${lines.join("\n")}\n`;
}

function indexFromSeriesEntry(entry = {}, fallback = 0) {
  const by = Number(entry?.by?.num);
  if (Number.isFinite(by) && by > 0) return Math.trunc(by);
  const name = String(entry?.su?.name ?? "");
  const match = name.match(/(\d{1,6})\s*$/);
  if (match) return Number.parseInt(match[1], 10);
  return fallback;
}

function imagesByPhotographsFact(fact = {}) {
  if (!Array.isArray(fact?.ob?.series)) return new Map();
  const looksLikePhotographs = fact?.be === "photographs"
    || fact.ob.series.some(row => String(row?.be ?? "").trim().toLowerCase() === "photograph");
  if (!looksLikePhotographs) return new Map();
  const map = new Map();
  for (let i = 0; i < fact.ob.series.length; i += 1) {
    const row = fact.ob.series[i];
    const index = indexFromSeriesEntry(row, i + 1);
    const filename = String(row?.ob?.filename ?? "").trim();
    if (!index || !filename) continue;
    if (!/\.(png|jpe?g|webp|gif|bmp)$/iu.test(filename)) continue;
    map.set(index, filename);
  }
  return map;
}

async function imagesByRunManifest(runId, rememberFn) {
  const id = String(runId ?? "").trim();
  if (!id) return new Map();
  const manifestDir = resolveAgentPath(path.join("artifacts", id), { rememberFn });
  if (manifestDir.outside) return new Map();
  let names = [];
  try {
    names = await fs.readdir(manifestDir.resolved);
  } catch {
    return new Map();
  }
  const manifests = names.filter(name => name.endsWith(".series.pya")).sort();
  for (const name of manifests) {
    let text = "";
    try {
      text = await fs.readFile(path.join(manifestDir.resolved, name), "utf8");
    } catch {
      continue;
    }
    const map = new Map();
    for (const line of String(text).split(/\r?\n/u)) {
      const indexMatch = line.match(/su\s+name\s+cut\s+(\d{1,6})/u);
      const fileMatch = line.match(/ob\s+filename\s+"([^"]+)"/u);
      if (!indexMatch || !fileMatch) continue;
      const idx = Number.parseInt(indexMatch[1], 10);
      const file = String(fileMatch[1] ?? "").trim();
      if (!Number.isFinite(idx) || idx <= 0 || !file) continue;
      if (!/\.(png|jpe?g|webp|gif|bmp)$/iu.test(file)) continue;
      map.set(idx, file);
    }
    if (map.size) return map;
  }
  return new Map();
}

function imageFromPhotographFact(fact = {}) {
  if (fact?.be !== "photograph" && fact?.be !== "filename") return "";
  const byFilename = String(fact?.ob?.filename ?? "").trim();
  if (byFilename && /\.(png|jpe?g|webp|gif|bmp)$/iu.test(byFilename)) return byFilename;
  const byName = String(fact?.ob?.name ?? "").trim();
  if (byName) {
    const locator = String(lookupArtifactLocator(byName) ?? "").trim();
    if (locator && /\.(png|jpe?g|webp|gif|bmp)$/iu.test(locator)) return locator;
  }
  return "";
}

function videoImagesDir(rememberFn, { outputFile = "" } = {}) {
  const configured = String(rememberFn("video cuts images directory")?.ob?.text ?? "").trim();
  if (configured) return configured;
  const history = allRemember();
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const sentence = history[i];
    if (sentence?.be !== "draw") continue;
    const filename = String(sentence?.ob?.filename ?? "").trim();
    if (!filename) continue;
    if (/\.(png|jpe?g|webp|gif)$/iu.test(filename)) continue;
    return filename;
  }
  const runId = String(getExchangeRunId?.() ?? "").trim();
  if (runId) return path.join("artifacts", runId, "draw");
  const baseDir = path.dirname(outputFile || ".");
  const stem = path.basename(outputFile || "video", path.extname(outputFile || "video"));
  return path.join(baseDir, `${stem}-cuts`);
}

function videoAudioFilename(rememberFn, { outputFile = "" } = {}) {
  const byName = String(rememberFn("video cuts audio filename")?.ob?.text ?? "").trim();
  if (byName) return byName;
  const byFilename = String(rememberFn("video cuts audio filename")?.ob?.filename ?? "").trim();
  if (byFilename) return byFilename;
  const tellingFact = rememberFn("telling");
  const tellingHandle = String(tellingFact?.ob?.name ?? "").trim();
  if (tellingHandle) {
    const locator = String(lookupArtifactLocator(tellingHandle) ?? "").trim();
    if (locator) return locator;
  }
  const history = allRemember();
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const sentence = history[i];
    if (sentence?.be === "say") {
      const handle = String(sentence?.ob?.name ?? "").trim();
      if (handle) {
        const locator = String(lookupArtifactLocator(handle) ?? "").trim();
        if (locator) return locator;
      }
      const filename = String(sentence?.ob?.filename ?? "").trim();
      if (filename) return filename;
    }
    if (sentence?.be === "artifact" && sentence?.as?.name === "say") {
      const filename = String(sentence?.to?.filename ?? sentence?.ob?.filename ?? "").trim();
      if (filename) return filename;
    }
  }
  const baseDir = path.dirname(outputFile || ".");
  const stem = path.basename(outputFile || "video", path.extname(outputFile || "video"));
  return path.join(baseDir, `${stem}.wav`);
}

function videoPrefix(rememberFn, { outputFile = "" } = {}) {
  const configured = String(rememberFn("video cuts prefix")?.ob?.text ?? "").trim();
  if (configured) return configured;
  void outputFile;
  return "";
}

function videoFps(rememberFn) {
  const raw = Number(rememberFn("video cuts fps")?.ob?.num ?? 30);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30;
}

function videoThumbnailSeconds(rememberFn, firstDuration = 1) {
  const configured = Number(rememberFn("video thumbnail seconds")?.ob?.num ?? 0.8);
  const desired = Number.isFinite(configured) && configured > 0 ? configured : 0.8;
  const maxByFirst = Math.max(0.2, Number(firstDuration) * 0.8);
  return Math.min(desired, maxByFirst);
}

export function resolveFilenameFromCase(value, rememberFn) {
  const sanitizeFilenameText = (raw) => {
    if (typeof raw === "number") return String(raw);
    if (typeof raw !== "string") return "";
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (trimmed === "[object Object]") return "";
    return trimmed;
  };

  const resolveGenitiveScalar = (genitive, { depth = 0, seen = new Set() } = {}) => {
    if (depth > 10) return null;
    const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
    if (chainArr.length === 0) return null;
    const [root, ...rest] = chainArr;
    let curr =
      root === "this"
        ? (state.currentEvokeRef || state.currentEvoke)
        : (typeof root === "string" && rememberFn ? rememberFn(root) : null);
    for (const part of rest) {
      if (curr && typeof curr === "object" && curr.genitive) {
        if (seen.has(curr.genitive)) return null;
        seen.add(curr.genitive);
        const resolved = resolveGenitiveScalar(curr.genitive, { depth: depth + 1, seen });
        if (resolved !== null && resolved !== undefined) curr = resolved;
      }
      if (curr && typeof curr === "object" && curr.name && rememberFn) {
        const fact = rememberFn(curr.name);
        if (fact) curr = part === "ob" ? fact : (fact.ob ?? fact);
      }
      if (curr && typeof curr === "object") {
        if (curr.text !== undefined && (part === "filename" || part === "text")) {
          curr = curr.text;
          continue;
        }
        if (curr.filename !== undefined && part === "filename") {
          curr = curr.filename;
          continue;
        }
        if (curr.ob?.text !== undefined && (part === "filename" || part === "text")) {
          curr = curr.ob.text;
          continue;
        }
        if (curr.ob?.filename !== undefined && part === "filename") {
          curr = curr.ob.filename;
          continue;
        }
        if (curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
          curr = curr.ob.map[part];
        } else if (curr.ob && curr.ob[part] !== undefined) {
          curr = curr.ob[part];
        } else {
          curr = curr[part];
        }
      } else {
        curr = curr?.[part];
      }
    }
    if (typeof curr === "string" || typeof curr === "number" || typeof curr === "boolean") return curr;
    if (curr && typeof curr === "object") {
      if (curr.text !== undefined) return curr.text;
      if (curr.filename !== undefined) return curr.filename;
      if (curr.num !== undefined) return curr.num;
      if (curr.boolean !== undefined) return curr.boolean;
    }
    return curr ?? null;
  };

  const normalizeResolved = (resolved) => {
    const scalar = sanitizeFilenameText(resolved);
    if (scalar) return scalar;
    if (!resolved || typeof resolved !== "object") return "";

    if (resolved.genitive) {
      const byGenitive = normalizeResolved(resolveGenitiveScalar(resolved.genitive));
      if (byGenitive) return byGenitive;
    }

    const byFilename = normalizeResolved(resolved.filename);
    if (byFilename) return byFilename;

    const byText = normalizeResolved(resolved.text);
    if (byText) return byText;

    const byObFilename = normalizeResolved(resolved.ob?.filename);
    if (byObFilename) return byObFilename;

    const byObText = normalizeResolved(resolved.ob?.text);
    if (byObText) return byObText;

    const byName = sanitizeFilenameText(resolved.name);
    if (byName) return resolveByName(byName);

    const byObName = sanitizeFilenameText(resolved.ob?.name);
    if (byObName) return resolveByName(byObName);

    return "";
  };

  const resolveByName = (name) => {
    const normalizedName = sanitizeFilenameText(name);
    if (!normalizedName) return "";
    const byArtifact = sanitizeFilenameText(lookupArtifactLocator(normalizedName));
    if (byArtifact) return byArtifact;
    const fact = rememberFn?.(normalizedName);
    const byObFilename = normalizeResolved(fact?.ob?.filename);
    if (byObFilename) return byObFilename;
    const byToFilename = normalizeResolved(fact?.to?.filename);
    if (byToFilename) return byToFilename;
    if (fact?.ob?.genitive) {
      const resolved = resolveGenitiveScalar(fact.ob.genitive);
      const byResolved = normalizeResolved(resolved);
      if (byResolved) return byResolved;
    }
    const byObText = normalizeResolved(fact?.ob?.text);
    if (byObText) return byObText;
    return "";
  };

  const dependencyNamesFromVectorCase = (source) => {
    const values = Array.isArray(source?.ve?.values)
      ? source.ve.values.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [];
    if (!values.length) return [];
    const out = [];
    let i = 0;
    while (i < values.length) {
      if (values[i] === "name") {
        i += 1;
        continue;
      }
      const words = [];
      while (i < values.length && values[i] !== "name") {
        words.push(values[i]);
        i += 1;
      }
      const token = words.join(" ").trim();
      if (token) out.push(token);
    }
    return out;
  };

  const directFilename = value?.filename;
  const directString = sanitizeFilenameText(directFilename);
  if (directString) return directString;
  if (directFilename && typeof directFilename === "object") {
    if (directFilename.genitive) {
      const byGenitive = normalizeResolved(resolveGenitiveScalar(directFilename.genitive));
      if (byGenitive) return byGenitive;
    }
    const nestedName = typeof directFilename.name === "string" ? directFilename.name.trim() : "";
    if (nestedName) {
      const byName = resolveByName(nestedName);
      if (byName) return byName;
    }
    const nestedResolved = normalizeResolved(directFilename);
    if (nestedResolved) return nestedResolved;
  }

  if (value?.genitive) {
    const byGenitive = normalizeResolved(resolveGenitiveScalar(value.genitive));
    if (byGenitive) return byGenitive;
  }

  const name = String(value?.name ?? "").trim();
  if (name) return resolveByName(name);

  const dependencies = dependencyNamesFromVectorCase(value);
  for (const dependency of dependencies) {
    const resolved = resolveByName(dependency);
    if (resolved) return resolved;
  }
  return "";
}

function defaultFootnoteOutputFilename(inputVideo) {
  const ext = path.extname(inputVideo || ".mp4") || ".mp4";
  const stem = path.basename(inputVideo || "video", ext);
  return path.join(path.dirname(inputVideo || "."), `${stem}-footnote${ext}`);
}

function metadataTextFromRemember(rememberFn, { videoFile = "", thumbnailFile = "" } = {}) {
  const lines = ["su name video metadata be map def"];
  const title = String(rememberFn("video title")?.ob?.text ?? "").trim();
  const heading = String(rememberFn("video heading")?.ob?.text ?? "").trim();
  const description = String(rememberFn("video description")?.ob?.text ?? "").trim();
  const video = String(videoFile ?? "").trim();
  const thumbnail = String(thumbnailFile ?? "").trim();
  if (title) lines.push(`su name title ob text ${JSON.stringify(title)} ya`);
  if (heading) lines.push(`su name heading ob text ${JSON.stringify(heading)} ya`);
  if (description) lines.push(`su name description ob text ${JSON.stringify(description)} ya`);
  if (video) lines.push(`su name video ob filename ${JSON.stringify(video)} ya`);
  if (thumbnail) lines.push(`su name thumbnail ob filename ${JSON.stringify(thumbnail)} ya`);
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

async function runFootnoteVideo({ inputVideo, inputSrt, outputVideo, mode }) {
  const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../command/footnote_video.mjs");
  const args = [runner, inputVideo, inputSrt, outputVideo];
  if (mode) args.push("--mode", mode);
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(stderr.trim() || `footnote failed with status ${code}`));
    });
  });
}

export async function cutFromFilenameToNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const source = (() => {
    const direct = String(sentence?.from?.filename ?? "").trim();
    if (direct) return direct;
    const fromName = String(sentence?.from?.name ?? "").trim();
    if (!fromName) return "";
    const byArtifact = lookupArtifactLocator(fromName);
    if (typeof byArtifact === "string" && byArtifact.trim()) return byArtifact.trim();
    const fact = rememberFn?.(fromName);
    const byFact = String(fact?.ob?.filename ?? fact?.to?.filename ?? "").trim();
    return byFact;
  })();
  const targetName = String(sentence?.to?.name ?? "").trim();
  const duration = Number(sentence?.during?.num ?? 6);
  if (!source || !targetName) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: cut requires from filename and to name itinerary",
      from: { name: "cut" },
      raw: { sentence }
    });
  }
  const { resolved, outside, agentCwd } = resolveAgentPath(source, { rememberFn });
  if (outside) {
    throwErrorSentence({
      name: "itinerary defective",
      message: `itinerary defective: outside agent cwd (${agentCwd})`,
      from: { name: "cut" },
      raw: { source }
    });
  }
  const srtText = await fs.readFile(resolved, "utf8");
  const rawCuts = parseSrtToCuts(srtText);
  const window = Number.isFinite(duration) && duration > 0 ? duration : 6;
  const cuts = windowCuts(rawCuts, window);
  const series = [];
  let outIndex = 1;
  for (let i = 0; i < cuts.length; i += 1) {
    const base = cuts[i];
    const baseSince = Number(base.since ?? 0);
    const baseUntil = Number(base.until ?? baseSince + window);
    const text = String(base.obText ?? "");
    if (!(Number.isFinite(baseSince) && Number.isFinite(baseUntil))) continue;
    if (window > 0 && baseUntil - baseSince > window + 1e-6) {
      let cursor = baseSince;
      while (cursor < baseUntil - 1e-6) {
        const until = Math.min(baseUntil, cursor + window);
        series.push({
          mood: "ya",
          su: { name: `cut ${String(outIndex).padStart(3, "0")}` },
          since: { num: cursor },
          until: { num: until },
          ob: { text },
          be: "cut"
        });
        outIndex += 1;
        cursor = until;
      }
      continue;
    }
    const since = baseSince;
    const until = Math.max(since, window > 0 ? Math.min(baseUntil, since + window) : baseUntil);
    series.push({
      mood: "ya",
      su: { name: `cut ${String(outIndex).padStart(3, "0")}` },
      since: { num: since },
      until: { num: until },
      ob: { text },
      be: "cut"
    });
    outIndex += 1;
  }
  const manifestFilename = await persistItineraryManifest({
    sentence,
    itineraryName: targetName,
    series,
    rememberFn,
    fallbackPrefix: "cut"
  });
  const ob = manifestFilename ? { series, filename: manifestFilename } : { series };
  return { ob, be: "itinerary" };
}

export async function cutFromNameFilenameToNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const sourceName = String(sentence?.from?.name ?? "").trim();
  if (!sourceName) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: cut requires from name filename and to name itinerary",
      from: { name: "cut" },
      raw: { sentence }
    });
  }
  const sourceFact = rememberFn(sourceName);
  const sourceFilename = String(sourceFact?.ob?.filename ?? "").trim();
  if (!sourceFilename) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: cut source missing filename",
      from: { name: "cut" },
      raw: { sourceName, sourceFact }
    });
  }
  return cutFromFilenameToNameItinerary(
    {
      ...sentence,
      from: { filename: sourceFilename }
    },
    { remember: rememberFn }
  );
}

function resolveCutTextSource(fromCase = {}, { rememberFn = remember } = {}) {
  if (typeof fromCase?.text === "string") return fromCase.text;
  const fromName = String(fromCase?.name ?? "").trim();
  if (!fromName) return "";
  const fact = rememberFn(fromName);
  return String(fact?.ob?.text ?? "");
}

export async function cutFromTextToNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const targetName = String(sentence?.to?.name ?? "").trim();
  const sourceText = resolveCutTextSource(sentence?.from, { rememberFn });
  if (!sourceText || !targetName) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: cut requires from text and to name itinerary",
      from: { name: "cut" },
      raw: { sentence }
    });
  }
  const sections = splitTextParagraphs(sourceText);
  if (!sections.length) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: cut source text is empty",
      from: { name: "cut" },
      raw: { sentence }
    });
  }
  const series = sections.map((sectionText, index) => ({
    mood: "ya",
    su: { name: `cut ${String(index + 1).padStart(3, "0")}` },
    since: { num: Number(index) },
    until: { num: Number(index + 1) },
    ob: { text: sectionText },
    be: "cut"
  }));
  const manifestFilename = await persistItineraryManifest({
    sentence,
    itineraryName: targetName,
    series,
    rememberFn,
    fallbackPrefix: "cut"
  });
  const ob = manifestFilename ? { series, filename: manifestFilename } : { series };
  return { ob, be: "itinerary" };
}

export async function drawFromNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  await enforceAutoDischarge({ activatingClass: "draw", rememberFn });
  const cuts = await resolveItineraryCuts(sentence?.from, { rememberFn });
  const outputDir = resolveFilenameFromCase(sentence?.to, rememberFn) || defaultDrawOutputDir();
  const { resolved: outputResolved, outside, agentCwd } = resolveAgentPath(outputDir, { rememberFn });
  if (outside) {
    throwErrorSentence({
      name: "draw defective",
      message: `draw defective: outside agent cwd (${agentCwd})`,
      from: { name: "draw" },
      raw: { outputDir }
    });
  }
  const outputHandle = platformOutputHandleName(sentence, "draw");
  const prefix = normalizePlatformHandleToPrefix(outputHandle, "draw");
  const host = drawHost(rememberFn);
  const workflowName = String(sentence?.as?.text ?? "").trim() || drawWorkflowName(rememberFn);
  const limitRaw = Number(sentence?.by?.num ?? Number.POSITIVE_INFINITY);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : Number.POSITIVE_INFINITY;
  await fs.mkdir(outputResolved, { recursive: true });
  emitExchangeSentence({
    mood: "ya",
    su: { name: "draw output directory" },
    ob: { filename: outputResolved },
    be: "draw"
  });
  const work = cuts.slice(0, Number.isFinite(limit) ? limit : cuts.length);
  const systemPrompt = resolveFromTextPrompt(sentence?.fromtext, rememberFn);
  const { width, height, negativePrompt } = resolveDrawSize(sentence, rememberFn);
  const photographRows = [];
  for (const cut of work) {
    const output = outputPathForCut(outputResolved, prefix, cut);
    const prompt = promptFromCut(cut, sentence?.ob?.text ?? "", systemPrompt);
    const requestSentence = {
      mood: "do",
      su: { name: `draw request ${String(cut.index).padStart(3, "0")}` },
      ob: { text: prompt },
      fromstate: { text: host || "http://localhost:8188" },
      to: { filename: output },
      by: { num: cut.index },
      be: "draw"
    };
    if (negativePrompt) requestSentence.fromtext = { text: `negative prompt: ${negativePrompt}` };
    if (workflowName) requestSentence.as = { text: workflowName };
    emitExchangeSentence(requestSentence);
    const drawResult = await runDraw({ prompt, output, host, workflowName, width, height, negativePrompt });
    const bytes = await fs.readFile(output);
    const artifact = recordArtifact({ locator: output, producer: String(sentence?.su?.name ?? "draw"), bytes, kind: "image" });
    photographRows.push(buildPhotographSeriesEntry({ cut, artifact, filename: output, bytes: bytes.length }));
    const resultSentence = {
      mood: "ya",
      su: { name: `draw result ${String(cut.index).padStart(3, "0")}` },
      ob: { filename: output },
      fromstate: { text: host || "http://localhost:8188" },
      by: { num: bytes.length },
      be: "draw"
    };
    if (workflowName) resultSentence.as = { text: workflowName };
    if (drawResult?.stdout) resultSentence.totext = { text: drawResult.stdout };
    if (artifact?.su?.name) resultSentence.accordingto = { name: artifact.su.name };
    emitExchangeSentence(resultSentence);
  }
  if (sentenceWantsPhotographsType(sentence)) {
    const runId = String(getExchangeRunId?.() ?? "").trim();
    const outputHandle = platformOutputHandleName(sentence, "photographs");
    const prefix = `${normalizePlatformHandleToPrefix(outputHandle, "photographs")}${itinerarySuffixFromSentence(sentence)}`;
    const manifestPath = runId
      ? path.join("artifacts", runId, `${prefix}.series.pya`)
      : path.join(outputResolved, `${prefix}.series.pya`);
    const manifestResolved = resolveAgentPath(manifestPath, { rememberFn });
    if (manifestResolved.outside) {
      throwErrorSentence({
        name: "draw defective",
        message: `draw defective: outside agent cwd (${manifestResolved.agentCwd})`,
        from: { name: "draw" },
        raw: { manifestPath }
      });
    }
    await fs.mkdir(path.dirname(manifestResolved.resolved), { recursive: true });
    const manifestText = photographSeriesToPya(photographRows);
    await fs.writeFile(manifestResolved.resolved, manifestText, "utf8");
    const manifestBytes = await fs.readFile(manifestResolved.resolved);
    const manifestArtifact = recordArtifact({
      locator: manifestResolved.resolved,
      producer: String(sentence?.su?.name ?? "draw"),
      bytes: manifestBytes,
      kind: "series"
    });
    emitExchangeSentence({
      mood: "ya",
      su: { name: "draw photographs manifest" },
      ob: { filename: manifestResolved.resolved },
      be: "artifact",
      accordingto: manifestArtifact?.su?.name ? { name: manifestArtifact.su.name } : undefined
    });
    return { ob: { series: photographRows }, be: "photographs" };
  }
  return { ob: { filename: outputResolved }, be: "draw" };
}

export async function promptifyFromNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const cuts = await resolveItineraryCuts(sentence?.from, { rememberFn });
  const targetName = String(sentence?.to?.name ?? "").trim();
  if (!targetName) {
    throwErrorSentence({
      name: "promptify defective",
      message: "promptify defective: requires to name itinerary",
      from: { name: "promptify" },
      raw: { sentence }
    });
  }
  const packetTemplate = resolvePromptifyPacketTemplate(sentence, rememberFn);
  const instruction = "Turn this transcript cut into one concise image prompt.";
  const systemPrompt = resolveFromTextPrompt(sentence?.fromtext, rememberFn)
    || "Convert this transcript cut into one concise visual image prompt for generation. Return only the prompt text. No markdown, no quotes, no explanation.";
  const host = promptifyHost(sentence, rememberFn);
  const model = promptifyModel(sentence, rememberFn);
  const continuityWindowRaw = Number(sentence?.by?.num ?? sentence?.by?.quantity?.num);
  const continuityWindow = Number.isFinite(continuityWindowRaw) && continuityWindowRaw >= 0
    ? Math.floor(continuityWindowRaw)
    : 1;
  await enforceAutoDischarge({ activatingClass: "mind", activatingModel: model, rememberFn });
  const fullScript = cuts.map(c => String(c?.obText ?? "").trim()).filter(Boolean).join(" ");
  const series = [];
  const promptHistory = [];
  for (let i = 0; i < cuts.length; i += 1) {
    const cut = cuts[i];
    const index = Number(cut?.index ?? (series.length + 1));
    const previousPrompts = continuityWindow > 0
      ? promptHistory.slice(-continuityWindow)
      : [];
    const promptInput = buildPromptifyPacket({
      cuts,
      index: i,
      instruction,
      fullScript,
      previousPrompts,
      packetTemplate
    });
    emitExchangeSentence({
      mood: "do",
      su: { name: `promptify request ${String(index).padStart(3, "0")}` },
      ob: { text: promptInput },
      fromtext: { text: systemPrompt },
      fromstate: { text: host },
      as: { text: model },
      by: { num: index },
      be: "promptify"
    });
    const prompt = await callPromptMind({
      host,
      model,
      systemPrompt,
      cutText: promptInput
    });
    promptHistory.push(prompt);
    series.push({
      mood: "ya",
      su: { name: `cut ${String(index).padStart(3, "0")}` },
      since: { num: Number(cut?.since ?? 0) },
      until: { num: Number(cut?.until ?? cut?.since ?? 0) },
      ob: { text: prompt },
      be: "cut"
    });
    emitExchangeSentence({
      mood: "ya",
      su: { name: `promptify result ${String(index).padStart(3, "0")}` },
      ob: { text: prompt },
      fromstate: { text: host },
      as: { text: model },
      by: { num: index },
      be: "promptify"
    });
  }

  const outputHandle = platformOutputHandleName(sentence, "promptify");
  const outputPrefix = normalizePlatformHandleToPrefix(outputHandle, "promptify");
  const outputSuffix = itinerarySuffixFromSentence(sentence);
  const runId = String(getExchangeRunId?.() ?? "").trim();
  const outputFile = runId
    ? path.join("artifacts", runId, `${outputPrefix}${outputSuffix}.series.pya`)
    : path.join("artifacts", "promptify", buildRunTag(), `${outputPrefix}${outputSuffix}.series.pya`);
  const outputResolved = resolveAgentPath(outputFile, { rememberFn });
  if (outputResolved.outside) {
    throwErrorSentence({
      name: "promptify defective",
      message: `promptify defective: outside agent cwd (${outputResolved.agentCwd})`,
      from: { name: "promptify" },
      raw: { sentence }
    });
  }
  await fs.mkdir(path.dirname(outputResolved.resolved), { recursive: true });
  const itineraryText = renderItineraryPya({
    itineraryName: targetName || "draw prompts",
    cuts: series.map((row, i) => ({
      index: Number(row?.by?.num ?? (i + 1)),
      name: String(row?.su?.name ?? `cut ${String(i + 1).padStart(3, "0")}`),
      since: Number(row?.since?.num ?? 0),
      until: Number(row?.until?.num ?? row?.since?.num ?? 0),
      obText: String(row?.ob?.text ?? "")
    }))
  });
  await fs.writeFile(outputResolved.resolved, itineraryText, "utf8");
  const itineraryBytes = await fs.readFile(outputResolved.resolved);
  const itineraryArtifact = recordArtifact({
    locator: outputResolved.resolved,
    producer: String(sentence?.su?.name ?? "promptify"),
    bytes: itineraryBytes,
    kind: "series"
  });
  emitExchangeSentence({
    mood: "ya",
    su: { name: "promptify itinerary manifest" },
    ob: { filename: outputResolved.resolved },
    be: "artifact",
    accordingto: itineraryArtifact?.su?.name ? { name: itineraryArtifact.su.name } : undefined
  });
  return { ob: { series, filename: outputResolved.resolved }, be: "itinerary" };
}

function clipFilenameFromCut(cut = {}) {
  const explicit = String(cut?.obFilename ?? "").trim();
  if (explicit && /\.(mp4|mov|mkv|webm)$/iu.test(explicit)) return explicit;
  const fallback = String(cut?.obText ?? "").trim();
  if (fallback && /\.(mp4|mov|mkv|webm)$/iu.test(fallback)) return fallback;
  return "";
}

export async function concatenateFromNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const cuts = await resolveItineraryCuts(sentence?.from, { rememberFn });
  const requestedOutputFile = resolveFilenameFromCase(sentence?.to, rememberFn);
  const outputHandle = platformOutputHandleName(sentence, "video");
  const outputPrefix = normalizePlatformHandleToPrefix(outputHandle, "video");
  const defaultOutputFilename = `${outputPrefix}.mp4`;
  const runId = String(getExchangeRunId?.() ?? "").trim();
  const outputFile = requestedOutputFile
    || (runId ? path.join("artifacts", runId, defaultOutputFilename) : path.join("artifacts", "video", buildRunTag(), defaultOutputFilename));
  const outputResolved = resolveAgentPath(outputFile, { rememberFn });
  const metadataFile = path.join(
    path.dirname(outputResolved.resolved),
    `${path.basename(outputResolved.resolved, path.extname(outputResolved.resolved) || ".mp4")}.metadata.pya`
  );
  if (outputResolved.outside) {
    throwErrorSentence({
      name: "concatenate defective",
      message: `concatenate defective: outside agent cwd (${outputResolved.agentCwd})`,
      from: { name: "concatenate" },
      raw: { sentence }
    });
  }
  const emitResultArtifacts = async () => {
    const bytes = await fs.readFile(outputResolved.resolved);
    const artifact = recordArtifact({ locator: outputResolved.resolved, producer: String(sentence?.su?.name ?? "concatenate"), bytes, kind: "video" });
    emitExchangeSentence({
      mood: "ya",
      su: { name: "concatenate result" },
      ob: { filename: outputResolved.resolved },
      be: "concatenate",
      by: { num: bytes.length },
      accordingto: artifact?.su?.name ? { name: artifact.su.name } : undefined
    });

    const thumbnailFilename = resolveFilenameFromCase({ name: "thumbnail" }, rememberFn);
    const metadataText = metadataTextFromRemember(rememberFn, {
      videoFile: outputResolved.resolved,
      thumbnailFile: thumbnailFilename
    });
    await fs.writeFile(metadataFile, metadataText, "utf8");
    const metadataBytes = await fs.readFile(metadataFile);
    const metadataArtifact = recordArtifact({
      locator: metadataFile,
      producer: String(sentence?.su?.name ?? "concatenate"),
      bytes: metadataBytes,
      kind: "metadata"
    });
    emitExchangeSentence({
      mood: "ya",
      su: { name: "concatenate metadata" },
      ob: { filename: metadataFile },
      be: "artifact",
      by: { num: metadataBytes.length },
      accordingto: metadataArtifact?.su?.name ? { name: metadataArtifact.su.name } : undefined
    });
  };

  const clipCandidates = cuts.map((cut) => clipFilenameFromCut(cut));
  const allClipRows = cuts.length > 0 && clipCandidates.length === cuts.length && clipCandidates.every(Boolean);
  if (allClipRows) {
    const clipFiles = [];
    for (let i = 0; i < clipCandidates.length; i += 1) {
      const resolved = resolveAgentPath(clipCandidates[i], { rememberFn });
      if (resolved.outside) {
        throwErrorSentence({
          name: "concatenate defective",
          message: `concatenate defective: outside agent cwd (${resolved.agentCwd})`,
          from: { name: "concatenate" },
          raw: { sentence }
        });
      }
      clipFiles.push(resolved.resolved);
    }
    const { dir, file } = await createVideoConcatListFile(clipFiles);
    try {
      await fs.mkdir(path.dirname(outputResolved.resolved), { recursive: true });
      await runFfmpegConcatVideos({
        listFile: file,
        outputFile: outputResolved.resolved
      });
      await emitResultArtifacts();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
    return { ob: { filename: outputResolved.resolved }, be: "concatenate" };
  }

  const outputFileForDefaults = requestedOutputFile || defaultOutputFilename;
  const imagesDir = videoImagesDir(rememberFn, { outputFile: outputFileForDefaults });
  const audioFile = videoAudioFilename(rememberFn, { outputFile: outputFileForDefaults });
  const imageDirResolved = resolveAgentPath(imagesDir, { rememberFn });
  const audioResolved = resolveAgentPath(audioFile, { rememberFn });
  if (imageDirResolved.outside || audioResolved.outside) {
    throwErrorSentence({
      name: "concatenate defective",
      message: `concatenate defective: outside agent cwd (${imageDirResolved.agentCwd || audioResolved.agentCwd})`,
      from: { name: "concatenate" },
      raw: { sentence }
    });
  }
  const prefix = videoPrefix(rememberFn, { outputFile: outputFileForDefaults });
  const fps = videoFps(rememberFn);
  const audioDurationSeconds = await getAudioDurationSeconds(audioResolved.resolved);
  const timeline = buildTimelineItems(cuts, audioDurationSeconds);
  let imageByIndex = (() => {
    const fromEvoke = imagesByPhotographsFact(state.currentEvokeRef ?? {});
    if (fromEvoke.size) return fromEvoke;
    const history = allRemember();
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const mapped = imagesByPhotographsFact(history[i]);
      if (mapped.size) return mapped;
    }
    return new Map();
  })();
  if (!imageByIndex.size) {
    const runManifestMap = await imagesByRunManifest(runId, rememberFn);
    if (runManifestMap.size) imageByIndex = runManifestMap;
  }
  const items = [];
  for (const cut of timeline) {
    const mapped = String(imageByIndex.get(cut.index) ?? "").trim();
    let image = "";
    if (mapped && /\.(png|jpe?g|webp|gif|bmp)$/iu.test(mapped)) {
      const mappedResolved = resolveAgentPath(mapped, { rememberFn });
      if (!mappedResolved.outside) {
        try {
          const stat = await fs.stat(mappedResolved.resolved);
          if (stat.isFile()) image = mappedResolved.resolved;
        } catch {
          image = "";
        }
      }
    }
    if (!image) {
      image = await findImageForCut(imageDirResolved.resolved, prefix, cut.index);
    }
    items.push({ ...cut, image });
  }

  const thumbnailImage = (() => {
    const fromEvoke = imageFromPhotographFact(state.currentEvokeRef ?? {});
    if (fromEvoke) return fromEvoke;
    const history = allRemember();
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const fromFact = imageFromPhotographFact(history[i]);
      if (fromFact) return fromFact;
    }
    return "";
  })();
  if (thumbnailImage && items.length) {
    const first = items[0];
    const firstDuration = Number(first?.duration ?? 0);
    const thumbDuration = videoThumbnailSeconds(rememberFn, firstDuration);
    if (Number.isFinite(firstDuration) && firstDuration > 0.1 && thumbDuration > 0.05 && thumbDuration < firstDuration) {
      const remainder = Math.max(0.05, firstDuration - thumbDuration);
      const thumbItem = { ...first, image: thumbnailImage, duration: thumbDuration };
      const firstRemainder = { ...first, duration: remainder };
      items.splice(0, 1, thumbItem, firstRemainder);
    } else {
      items[0] = { ...first, image: thumbnailImage };
    }
  }
  const { dir, file } = await createConcatListFile(items);
  try {
    await fs.mkdir(path.dirname(outputResolved.resolved), { recursive: true });
    await runFfmpeg({
      listFile: file,
      audioFile: audioResolved.resolved,
      outputFile: outputResolved.resolved,
      fps
    });
    await emitResultArtifacts();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return { ob: { filename: outputResolved.resolved }, be: "concatenate" };
}

export async function footnoteVideo(sentence, { remember: rememberFn = remember } = {}) {
  const inputSrtRaw = (() => {
    const direct = resolveFilenameFromCase(sentence?.from, rememberFn);
    if (!direct) return "";
    if (String(sentence?.fromstate?.wo ?? "").trim() !== "srt") return direct;
    if (/\.srt$/iu.test(direct)) return direct;
    const fromValues = Array.isArray(sentence?.from?.ve?.values) ? sentence.from.ve.values : [];
    for (let i = 0; i < fromValues.length; i += 1) {
      const token = String(fromValues[i] ?? "").trim();
      if (!token || token === "name") continue;
      const maybe = resolveFilenameFromCase({ name: token }, rememberFn);
      if (/\.srt$/iu.test(maybe)) return maybe;
      const next = String(fromValues[i + 1] ?? "").trim();
      if (token !== "name" && next && next !== "name") {
        const paired = resolveFilenameFromCase({ name: `${token} ${next}` }, rememberFn);
        if (/\.srt$/iu.test(paired)) return paired;
      }
    }
    return direct;
  })();
  const inputVideoRaw = resolveFilenameFromCase(sentence?.with, rememberFn);
  const outputRaw = resolveFilenameFromCase(sentence?.to, rememberFn)
    || (inputVideoRaw ? defaultFootnoteOutputFilename(inputVideoRaw) : "");
  if (!inputSrtRaw || !inputVideoRaw || !outputRaw) {
    throwErrorSentence({
      name: "footnote defective",
      message: "footnote defective: requires from srt, with video, and to output",
      from: { name: "footnote" },
      raw: { sentence }
    });
  }
  const inputSrt = resolveAgentPath(inputSrtRaw, { rememberFn });
  const inputVideo = resolveAgentPath(inputVideoRaw, { rememberFn });
  const outputVideo = resolveAgentPath(outputRaw, { rememberFn });
  if (inputSrt.outside || inputVideo.outside || outputVideo.outside) {
    throwErrorSentence({
      name: "footnote defective",
      message: `footnote defective: outside agent cwd (${outputVideo.agentCwd || inputVideo.agentCwd || inputSrt.agentCwd})`,
      from: { name: "footnote" },
      raw: { sentence }
    });
  }
  await fs.mkdir(path.dirname(outputVideo.resolved), { recursive: true });
  const mode = String(sentence?.as?.wo ?? sentence?.as?.text ?? "").trim().toLowerCase();
  const samePath = path.resolve(inputVideo.resolved) === path.resolve(outputVideo.resolved);
  const renderOutput = samePath
    ? path.join(path.dirname(outputVideo.resolved), `${path.basename(outputVideo.resolved, path.extname(outputVideo.resolved))}.footnote.tmp${path.extname(outputVideo.resolved) || ".mp4"}`)
    : outputVideo.resolved;
  await runFootnoteVideo({
    inputVideo: inputVideo.resolved,
    inputSrt: inputSrt.resolved,
    outputVideo: renderOutput,
    mode: mode || undefined
  });
  if (samePath) {
    await fs.rename(renderOutput, outputVideo.resolved);
  }
  const bytes = await fs.readFile(outputVideo.resolved);
  const artifact = recordArtifact({
    locator: outputVideo.resolved,
    producer: String(sentence?.su?.name ?? "footnote"),
    bytes,
    kind: "video"
  });
  emitExchangeSentence({
    mood: "ya",
    su: { name: "footnote result" },
    ob: { filename: outputVideo.resolved },
    be: "footnote",
    by: { num: bytes.length },
    accordingto: artifact?.su?.name ? { name: artifact.su.name } : undefined
  });
  return { ob: { filename: outputVideo.resolved }, be: "footnote" };
}

export default cutFromFilenameToNameItinerary;

export const signatures = [
  { signatureWords: ["be", "cut", "by", "num", "during", "num", "from", "filename", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "during", "num", "from", "filename", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "filename", "during", "num", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "filename", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "by", "num", "during", "num", "from", "name", "filename", "to", "name", "itinerary"], handler: cutFromNameFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "during", "num", "from", "name", "filename", "to", "name", "itinerary"], handler: cutFromNameFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "filename", "during", "num", "to", "name", "itinerary"], handler: cutFromNameFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "filename", "to", "name", "itinerary"], handler: cutFromNameFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "text", "to", "name", "itinerary"], handler: cutFromTextToNameItinerary },

  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "filename"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "filename", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "filename"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "filename", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "filename"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "filename", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "filename"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "filename", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "filename"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "filename", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "filename"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "filename", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "filename"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "filename", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "filename"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "filename", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "name", "photographs"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "name", "photographs", "with", "name", "map"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "name", "photographs"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "name", "photographs", "with", "name", "map"], handler: drawFromNameItinerary },

  { signatureWords: ["be", "promptify", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "name", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "name", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "from", "name", "itinerary", "fromtext", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "from", "name", "itinerary", "fromtext", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "from", "name", "itinerary", "fromtext", "name", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "from", "name", "itinerary", "fromtext", "name", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "for", "name", "mind", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "for", "name", "mind", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "for", "name", "mind", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "for", "name", "mind", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "for", "name", "mind", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "name", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "for", "name", "mind", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "name", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "for", "name", "mind", "from", "name", "itinerary", "fromtext", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "for", "name", "mind", "from", "name", "itinerary", "fromtext", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "for", "name", "mind", "from", "name", "itinerary", "fromtext", "name", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "for", "name", "mind", "from", "name", "itinerary", "fromtext", "name", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },

  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "name", "itinerary", "fromstate", "wo", "itinerary", "to", "filename"], handler: concatenateFromNameItinerary },
  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "name", "itinerary", "fromstate", "wo", "itinerary"], handler: concatenateFromNameItinerary },
  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "name", "series", "fromstate", "wo", "itinerary", "to", "filename"], handler: concatenateFromNameItinerary },
  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "name", "series", "fromstate", "wo", "itinerary"], handler: concatenateFromNameItinerary },
  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "itinerary", "to", "filename"], handler: concatenateFromNameItinerary },
  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "itinerary"], handler: concatenateFromNameItinerary },

  { signatureWords: ["be", "footnote", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo }
];
