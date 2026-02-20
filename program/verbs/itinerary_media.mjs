import fs from "node:fs/promises";
import path from "node:path";

import { throwErrorSentence } from "../error.mjs";
import { allRemember, remember } from "../remember/index.mjs";
import { resolveAgentPath } from "../library/agent_cwd.mjs";
import { parseSrtToCuts, parseItineraryPya } from "../../command/itinerary_io.mjs";
import { outputPathForCut, promptFromCut, runDraw } from "../../command/itinerary_to_draw_images.mjs";
import { buildTimelineItems, createConcatListFile, findImageForCut, getAudioDurationSeconds, runFfmpeg } from "../../command/itinerary_to_video.mjs";
import { enforceAutoDischarge } from "../motor/provider_auto_discharge.mjs";
import { emitExchangeSentence, recordArtifact } from "../bridge/exchange.mjs";

function buildRunTag(now = new Date()) {
  const iso = now.toISOString();
  const stamp = iso.replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = Math.random().toString(16).slice(2, 8).padEnd(6, "0").slice(0, 6);
  return `${stamp}-${rand}`;
}

function defaultDrawOutputDir() {
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
  const baseDir = path.dirname(outputFile || ".");
  const stem = path.basename(outputFile || "video", path.extname(outputFile || "video"));
  return path.join(baseDir, `${stem}-cuts`);
}

function videoAudioFilename(rememberFn, { outputFile = "" } = {}) {
  const byName = String(rememberFn("video cuts audio filename")?.ob?.text ?? "").trim();
  if (byName) return byName;
  const byFilename = String(rememberFn("video cuts audio filename")?.ob?.filename ?? "").trim();
  if (byFilename) return byFilename;
  const baseDir = path.dirname(outputFile || ".");
  const stem = path.basename(outputFile || "video", path.extname(outputFile || "video"));
  return path.join(baseDir, `${stem}.wav`);
}

function videoPrefix(rememberFn, { outputFile = "" } = {}) {
  const configured = String(rememberFn("video cuts prefix")?.ob?.text ?? "").trim();
  if (configured) return configured;
  return path.basename(outputFile || "video", path.extname(outputFile || "video"));
}

function videoFps(rememberFn) {
  const raw = Number(rememberFn("video cuts fps")?.ob?.num ?? 30);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30;
}

export async function cutFromFilenameToNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const source = String(sentence?.from?.filename ?? "").trim();
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
  for (let i = 0; i < cuts.length; i += 1) {
    const base = cuts[i];
    const since = Number(base.since ?? 0);
    const untilRaw = Number(base.until ?? since + window);
    const until = Math.max(since, window > 0 ? Math.min(untilRaw, since + window) : untilRaw);
    series.push({
      mood: "ya",
      su: { name: base.name || `cut ${String(i + 1).padStart(3, "0")}` },
      since: { num: since },
      until: { num: until },
      ob: { text: String(base.obText ?? "") },
      be: "cut"
    });
  }
  return { ob: { series }, be: "itinerary" };
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
  const prefix = String(sentence?.as?.text ?? "teaching").trim() || "teaching";
  const host = drawHost(rememberFn);
  const workflowName = drawWorkflowName(rememberFn);
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
  for (const cut of work) {
    const output = outputPathForCut(outputResolved, prefix, cut);
    const prompt = promptFromCut(cut, sentence?.ob?.text ?? "");
    const requestSentence = {
      mood: "do",
      su: { name: `draw request ${String(cut.index).padStart(3, "0")}` },
      ob: { text: prompt },
      fromstate: { text: host || "http://localhost:8188" },
      to: { filename: output },
      by: { num: cut.index },
      be: "draw"
    };
    if (workflowName) requestSentence.as = { text: workflowName };
    emitExchangeSentence(requestSentence);
    const drawResult = await runDraw({ prompt, output, host, workflowName });
    const bytes = await fs.readFile(output);
    const artifact = recordArtifact({ locator: output, producer: "draw", bytes, kind: "image" });
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
  return { ob: { filename: outputResolved }, be: "draw" };
}

export async function concatenateFromNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const cuts = await resolveItineraryCuts(sentence?.from, { rememberFn });
  const outputFile = String(sentence?.to?.filename ?? "").trim();
  if (!outputFile) {
    throwErrorSentence({
      name: "concatenate defective",
      message: "concatenate defective: missing to filename",
      from: { name: "concatenate" },
      raw: { sentence }
    });
  }
  const imagesDir = videoImagesDir(rememberFn, { outputFile });
  const audioFile = videoAudioFilename(rememberFn, { outputFile });
  const imageDirResolved = resolveAgentPath(imagesDir, { rememberFn });
  const audioResolved = resolveAgentPath(audioFile, { rememberFn });
  const outputResolved = resolveAgentPath(outputFile, { rememberFn });
  if (imageDirResolved.outside || audioResolved.outside || outputResolved.outside) {
    throwErrorSentence({
      name: "concatenate defective",
      message: `concatenate defective: outside agent cwd (${outputResolved.agentCwd || imageDirResolved.agentCwd || audioResolved.agentCwd})`,
      from: { name: "concatenate" },
      raw: { sentence }
    });
  }
  const prefix = videoPrefix(rememberFn, { outputFile });
  const fps = videoFps(rememberFn);
  const audioDurationSeconds = await getAudioDurationSeconds(audioResolved.resolved);
  const timeline = buildTimelineItems(cuts, audioDurationSeconds);
  const items = [];
  for (const cut of timeline) {
    const image = await findImageForCut(imageDirResolved.resolved, prefix, cut.index);
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
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return { ob: { filename: outputResolved.resolved }, be: "concatenate" };
}

export default cutFromFilenameToNameItinerary;

export const signatures = [
  { signatureWords: ["be", "cut", "during", "num", "from", "filename", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "filename", "during", "num", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },
  { signatureWords: ["be", "cut", "from", "filename", "to", "name", "itinerary"], handler: cutFromFilenameToNameItinerary },

  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "filename"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "filename"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "filename"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text", "to", "filename"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text"], handler: drawFromNameItinerary },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "by", "num", "from", "name", "itinerary", "fromstate", "wo", "text", "ob", "text"], handler: drawFromNameItinerary },

  { signatureWords: ["be", "concatenate", "become", "wo", "video", "from", "name", "itinerary", "fromstate", "wo", "itinerary", "to", "filename"], handler: concatenateFromNameItinerary }
];
