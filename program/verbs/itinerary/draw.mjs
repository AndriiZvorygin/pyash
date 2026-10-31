import fs from "node:fs/promises";
import path from "node:path";
import { throwErrorSentence } from "../../error.mjs";
import { remember } from "../../remember/index.mjs";
import { resolveAgentPath } from "../../library/agent_cwd.mjs";
import { outputPathForCut, promptFromCut, runDraw } from "../../../command/itinerary_to_draw_images.mjs";
import { emitExchangeSentence, getExchangeRunId, recordArtifact } from "../../bridge/exchange.mjs";
import { buildRunTag, itinerarySuffixFromSentence, resolveItineraryCuts } from "./manifest.mjs";
import { resolveNumericFromMapEntry, resolveTextFromMapEntry, normalizePlatformHandleToPrefix, platformOutputHandleName, resolveFromTextPrompt, resolveFilenameFromCase } from "./media.mjs";
import { findCharacterDrawRoute, findCharacterDrawRouteByWorkflow, composeCharacterDrawPrompt } from "./routes.mjs";

function defaultDrawOutputDir() {
  const runId = String(getExchangeRunId?.() ?? "").trim();
  if (runId) return path.join("artifacts", runId, "draw");
  return path.join("artifacts", "draw", buildRunTag());
}

function drawHost(rememberFn) {
  return String(rememberFn("draw host")?.ob?.text ?? "").trim();
}

function drawWorkflowName(rememberFn) {
  return String(rememberFn("draw workflow default")?.ob?.text ?? "").trim();
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

export async function drawFromNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
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
  const explicitWorkflowName = String(sentence?.as?.text ?? "").trim();
  const defaultWorkflowName = explicitWorkflowName || drawWorkflowName(rememberFn);
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
    const basePrompt = promptFromCut(cut, sentence?.ob?.text ?? "", systemPrompt);
    const cutWorkflowName = String(cut?.workflowName ?? "").trim();
    const characterRoute = !explicitWorkflowName
      ? (findCharacterDrawRouteByWorkflow(cutWorkflowName, rememberFn) || findCharacterDrawRoute(cut?.sourceText, rememberFn))
      : null;
    const usesCharacterWorkflow = Boolean(characterRoute) && (!cutWorkflowName || cutWorkflowName === characterRoute.workflowName);
    const workflowName = explicitWorkflowName || cutWorkflowName || (usesCharacterWorkflow ? characterRoute.workflowName : defaultWorkflowName);
    const prompt = usesCharacterWorkflow ? composeCharacterDrawPrompt(characterRoute, basePrompt) : basePrompt;
    const requestSentence = {
      mood: "do",
      su: { name: `draw request ${String(cut.index).padStart(3, "0")}` },
      ob: { text: prompt },
      fromstate: { text: host || "http://localhost:8188" },
      to: { filename: output },
      by: { num: cut.index },
      be: "draw"
    };
    if (typeof sentence?.fromtext?.name === "string" && sentence.fromtext.name.trim()) {
      requestSentence.accordingto = { name: sentence.fromtext.name.trim() };
    }
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

export const draw = drawFromNameItinerary;

export const signatures = [
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
];

