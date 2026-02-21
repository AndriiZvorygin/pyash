import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { throwErrorSentence } from "../error.mjs";
import { allRemember, remember } from "../remember/index.mjs";
import { resolveAgentPath } from "../library/agent_cwd.mjs";
import { state } from "../bridge/state.mjs";
import { parseSrtToCuts, parseItineraryPya } from "../../command/itinerary_io.mjs";
import { outputPathForCut, promptFromCut, runDraw } from "../../command/itinerary_to_draw_images.mjs";
import { buildTimelineItems, createConcatListFile, findImageForCut, getAudioDurationSeconds, runFfmpeg } from "../../command/itinerary_to_video.mjs";
import { enforceAutoDischarge } from "../motor/provider_auto_discharge.mjs";
import { emitExchangeSentence, getExchangeRunId, lookupArtifactLocator, recordArtifact } from "../bridge/exchange.mjs";

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
  const name = String(entry?.su?.name ?? entry?.name ?? `cut ${String(index).padStart(3, "0")}`);
  return {
    index,
    name,
    since: Number.isFinite(since) ? since : 0,
    until: Number.isFinite(until) ? until : 0,
    obText
  };
}

function itineraryCutsFromSeriesFact(fact = {}) {
  const entries = Array.isArray(fact?.ob?.series) ? fact.ob.series : [];
  return entries.map((entry, idx) => normalizeCutEntry(entry, idx + 1)).filter(cut => cut.obText);
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

async function resolveItineraryCuts(fromCase, { rememberFn = remember } = {}) {
  const name = String(fromCase?.name ?? "").trim();
  if (!name) {
    throwErrorSentence({
      name: "itinerary defective",
      message: "itinerary defective: missing from name itinerary",
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

  const seriesCuts = itineraryCutsFromSeriesFact(fact);
  if (seriesCuts.length) return seriesCuts;

  const inlineText = typeof fact?.ob?.text === "string" ? fact.ob.text : "";
  if (inlineText.trim()) {
    const parsed = parseItineraryPya(inlineText);
    return parsed.cuts;
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
    const text = await fs.readFile(resolved, "utf8");
    const parsed = parseItineraryPya(text);
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
      map.set(idx, file);
    }
    if (map.size) return map;
  }
  return new Map();
}

function videoImagesDir(rememberFn, { outputFile = "" } = {}) {
  const configured = String(rememberFn("video cuts images directory")?.ob?.text ?? "").trim();
  if (configured) return configured;
  const history = allRemember();
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const sentence = history[i];
    if (sentence?.be !== "draw") continue;
    const filename = String(sentence?.ob?.filename ?? "").trim();
    if (filename) return filename;
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

function resolveFilenameFromCase(value, rememberFn) {
  const direct = String(value?.filename ?? "").trim();
  if (direct) return direct;
  const name = String(value?.name ?? "").trim();
  if (!name) return "";
  const byArtifact = String(lookupArtifactLocator(name) ?? "").trim();
  if (byArtifact) return byArtifact;
  const fact = rememberFn?.(name);
  return String(fact?.ob?.filename ?? fact?.to?.filename ?? "").trim();
}

function defaultFootnoteOutputFilename(inputVideo) {
  const ext = path.extname(inputVideo || ".mp4") || ".mp4";
  const stem = path.basename(inputVideo || "video", ext);
  return path.join(path.dirname(inputVideo || "."), `${stem}-footnote${ext}`);
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
  return { ob: { series }, be: "itinerary" };
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

export async function drawFromNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  await enforceAutoDischarge({ activatingClass: "draw", rememberFn });
  const cuts = await resolveItineraryCuts(sentence?.from, { rememberFn });
  const outputDir = String(sentence?.to?.filename ?? "").trim() || defaultDrawOutputDir();
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
    const prefix = normalizePlatformHandleToPrefix(outputHandle, "photographs");
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

export async function concatenateFromNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const cuts = await resolveItineraryCuts(sentence?.from, { rememberFn });
  const requestedOutputFile = String(sentence?.to?.filename ?? "").trim();
  const outputHandle = platformOutputHandleName(sentence, "video");
  const outputPrefix = normalizePlatformHandleToPrefix(outputHandle, "video");
  const defaultOutputFilename = `${outputPrefix}.mp4`;
  const outputFileForDefaults = requestedOutputFile || defaultOutputFilename;
  const imagesDir = videoImagesDir(rememberFn, { outputFile: outputFileForDefaults });
  const audioFile = videoAudioFilename(rememberFn, { outputFile: outputFileForDefaults });
  const imageDirResolved = resolveAgentPath(imagesDir, { rememberFn });
  const audioResolved = resolveAgentPath(audioFile, { rememberFn });
  const runId = String(getExchangeRunId?.() ?? "").trim();
  const outputFile = requestedOutputFile
    || (runId ? path.join("artifacts", runId, defaultOutputFilename) : path.join(imageDirResolved.resolved, defaultOutputFilename));
  const outputResolved = resolveAgentPath(outputFile, { rememberFn });
  if (imageDirResolved.outside || audioResolved.outside || outputResolved.outside) {
    throwErrorSentence({
      name: "concatenate defective",
      message: `concatenate defective: outside agent cwd (${outputResolved.agentCwd || imageDirResolved.agentCwd || audioResolved.agentCwd})`,
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
    const image = mapped || await findImageForCut(imageDirResolved.resolved, prefix, cut.index);
    items.push({ ...cut, image });
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
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return { ob: { filename: outputResolved.resolved }, be: "concatenate" };
}

export async function footnoteVideo(sentence, { remember: rememberFn = remember } = {}) {
  const inputSrtRaw = resolveFilenameFromCase(sentence?.from, rememberFn);
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
  { signatureWords: ["be", "cut", "during", "num", "from", "filename", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "filename", "during", "num", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "filename", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "during", "num", "from", "name", "filename", "to", "name", "itinerary"], handler: cutFromNameFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "filename", "during", "num", "to", "name", "itinerary"], handler: cutFromNameFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "name", "filename", "to", "name", "itinerary"], handler: cutFromNameFilenameToNameItinerary },

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

  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "name", "itinerary", "fromstate", "wo", "itinerary", "to", "filename"], handler: concatenateFromNameItinerary },
  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "name", "itinerary", "fromstate", "wo", "itinerary"], handler: concatenateFromNameItinerary },

  { signatureWords: ["be", "footnote", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo }
];
