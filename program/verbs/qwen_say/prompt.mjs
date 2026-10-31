import fs from "node:fs/promises";
import path from "node:path";
import { remember } from "../../remember/index.mjs";
import { parseItineraryPya } from "../../../command/itinerary_io.mjs";
import { resolveWorkflowRoot, resolveWorkflowDefault, resolveToneDefault } from "./config.mjs";

function quotePyashText(value) {
  return JSON.stringify(String(value ?? ""));
}

export function renderSayPromptSeries(chunks = [], instructs = []) {
  const lines = ["su name section say prompts be series def"];
  for (let i = 0; i < chunks.length; i += 1) {
    const idx = String(i + 1).padStart(3, "0");
    const since = Number(i).toFixed(3);
    const until = Number(i + 1).toFixed(3);
    const chunkText = quotePyashText(chunks[i] ?? "");
    const instructText = quotePyashText(instructs[i] ?? "");
    lines.push(`su name cut ${idx} since num ${since} until num ${until} ob text ${chunkText} fromtext text ${instructText} ya`);
  }
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

export function resolveSayPromptSeriesPath(outputPath = "") {
  return path.join(path.dirname(String(outputPath ?? "")), "section-say-prompts.series.pya");
}

export async function pathExists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch {
    return false;
  }
}

function resolveFilenameFromCase(value = {}, rememberFn = remember) {
  if (typeof value?.filename === "string" && value.filename.trim()) return value.filename.trim();
  const fromName = String(value?.name ?? "").trim();
  if (!fromName) return "";
  const fact = rememberFn?.(fromName);
  return String(fact?.ob?.filename ?? "").trim();
}

export async function resolveToneManifestInstructs(sentence, { rememberFn = remember } = {}) {
  const filename = resolveFilenameFromCase(sentence?.from, rememberFn);
  if (!filename) return [];
  try {
    const text = await fs.readFile(filename, "utf8");
    const parsed = parseItineraryPya(text);
    const cuts = Array.isArray(parsed?.cuts) ? parsed.cuts : [];
    return cuts.map((cut) => String(cut?.obText ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function resolveWorkflowAndTone(
  sentence,
  { rememberFn = remember, pathExistsFn = pathExists } = {}
) {
  const workflowRoot = resolveWorkflowRoot({ rememberFn });
  const workflowDefault = resolveWorkflowDefault({ rememberFn });
  const toneDefault = resolveToneDefault({ rememberFn });
  const explicit = String(sentence?.as?.text ?? "").trim();
  if (!explicit) {
    return {
      workflowRoot,
      workflowName: workflowDefault,
      toneOverride: "",
      toneDefault
    };
  }

  const workflowCandidate = explicit.replace(/\.json$/i, "").trim();
  const workflowPaths = [
    path.resolve(workflowRoot, "comfyui", `${workflowCandidate}.json`),
    path.resolve(workflowRoot, `${workflowCandidate}.json`)
  ];
  for (const workflowPath of workflowPaths) {
    if (await pathExistsFn(workflowPath)) {
      return {
        workflowRoot,
        workflowName: workflowCandidate,
        toneOverride: "",
        toneDefault
      };
    }
  }

  return {
    workflowRoot,
    workflowName: workflowDefault,
    toneOverride: explicit,
    toneDefault
  };
}

export function inferChunkTone(chunk = "", fallback = "") {
  const text = String(chunk ?? "");
  if (!text.trim()) return fallback;
  if (/[?]/.test(text)) return "speak in a curious, professional tone";
  if (/\b(crisis|collapse|warning|debt|foreclosure|danger|harm|desperate|loss)\b/i.test(text)) {
    return "speak in an urgent, serious tone";
  }
  if (/\b(restore|build|hope|future|solution|reform|can|together|opportunity|thrive)\b/i.test(text)) {
    return "speak in an optimistic, confident tone";
  }
  return fallback;
}

export function resolveChunkInstructs(chunks = [], { toneOverride = "", toneDefault = "" } = {}) {
  const override = String(toneOverride ?? "").trim();
  if (override) return chunks.map(() => override);
  return chunks.map((chunk) => inferChunkTone(chunk, toneDefault));
}

export function normalizeToneInstruction(value = "", fallback = "") {
  const tone = String(value ?? "").replace(/[`"'*]/g, "").replace(/\s+/g, " ").trim();
  if (tone) return tone.slice(0, 140);
  return String(fallback ?? "").trim();
}

export async function planChunkInstructs(
  chunks = [],
  {
    rememberFn = remember,
    toneOverride = "",
    toneDefault = "",
    toneStrategy = "heuristic"
  } = {}
) {
  const override = String(toneOverride ?? "").trim();
  if (override) {
    return { instructs: chunks.map(() => override), strategy: "override" };
  }

  return {
    instructs: resolveChunkInstructs(chunks, { toneOverride: "", toneDefault }),
    strategy: "heuristic"
  };
}

