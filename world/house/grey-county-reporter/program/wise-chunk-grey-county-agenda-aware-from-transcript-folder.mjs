#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAgendaWiseArtifacts } from "./shared/agenda-wise-chunks.mjs";

const PROGRAM_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOUSE = path.resolve(PROGRAM_DIR, "..");
const OLLAMA_URL = process.env.OLLAMA_HOST?.replace(/\/$/u, "")
  ? `${process.env.OLLAMA_HOST.replace(/\/$/u, "")}/api/chat`
  : "http://localhost:11434/api/chat";
const LLM_MODEL = process.env.GREY_AGENDA_CHIP_LLM_MODEL || process.env.OWEN_AGENDA_CHIP_LLM_MODEL || "qwen3.5:9b";
const USE_LLM_RANGE = /^(1|true|yes)$/iu.test(String(process.env.GREY_AGENDA_USE_LLM_RANGE || process.env.OWEN_AGENDA_USE_LLM_RANGE || ""));

function usage() {
  return [
    "Usage: node program/wise-chunk-grey-county-agenda-aware-from-transcript-folder.mjs <transcript_dir> [prefix]",
    "Example: node ... artifacts/grey-county/meetings/<meeting>/transcript auto",
  ].join("\n");
}

function ensureDir(dirPath) {
  const st = fs.statSync(dirPath, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`transcript directory not found: ${dirPath}`);
}

function resolveReporterPath(inputPath) {
  if (path.isAbsolute(inputPath)) return path.normalize(inputPath);
  const fromCwd = path.resolve(process.cwd(), inputPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(HOUSE, inputPath);
}

function readNormalizeCheckpoint(transcriptDir, prefix) {
  const metaPath = path.join(transcriptDir, `${prefix}.normalize.metadata.json`);
  if (!fs.existsSync(metaPath)) return { exists: false, complete: false };
  try {
    const obj = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const total = Number(obj?.chunks_total);
    const done = Number(obj?.chunks_processed);
    const complete = Number.isFinite(total) && total > 0 && done === total;
    return { exists: true, complete };
  } catch {
    return { exists: true, complete: false };
  }
}

function pickPlainTranscript(transcriptDir, prefix = "auto") {
  const wantsAuto = !prefix || /^auto$/iu.test(String(prefix));
  if (!wantsAuto) {
    const preferred = path.join(transcriptDir, `${prefix}.plain.txt`);
    if (fs.existsSync(preferred)) return { plainPath: preferred, resolvedPrefix: prefix };
  }

  const candidates = fs.readdirSync(transcriptDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => name.endsWith(".plain.txt"));

  if (!candidates.length) throw new Error(`no *.plain.txt transcript found in ${transcriptDir}`);

  const ranked = candidates.map((name) => {
    const full = path.join(transcriptDir, name);
    const st = fs.statSync(full);
    const pfx = name.replace(/\.plain\.txt$/u, "");
    const cp = readNormalizeCheckpoint(transcriptDir, pfx);
    let score = 0;
    if (cp.complete) score += 400;
    if (cp.exists && !cp.complete) score -= 300;
    if (/normalized/iu.test(pfx)) score += 150;
    if (/test|tmp|partial/iu.test(pfx)) score -= 250;
    if (pfx === "meeting-qwen-auto") score += 10;
    return { name, full, pfx, score, mtimeMs: Number(st.mtimeMs || 0), size: Number(st.size || 0) };
  }).sort((a, b) =>
    b.score - a.score ||
    b.mtimeMs - a.mtimeMs ||
    b.size - a.size ||
    a.name.localeCompare(b.name)
  );

  const chosen = ranked[0];
  return { plainPath: chosen.full, resolvedPrefix: chosen.pfx };
}

function pickAgendaMarkdown(meetingDir) {
  const convertedDir = path.join(meetingDir, "converted");
  const preferred = path.join(convertedDir, "agenda-01.pruned.md");
  if (fs.existsSync(preferred)) return preferred;

  if (!fs.existsSync(convertedDir)) return "";
  const names = fs.readdirSync(convertedDir)
    .filter((n) => n.toLowerCase().endsWith(".pruned.md"))
    .sort();
  if (names.length) return path.join(convertedDir, names[0]);

  const mdNames = fs.readdirSync(convertedDir)
    .filter((n) => n.toLowerCase().startsWith("agenda-") && n.toLowerCase().endsWith(".md"))
    .sort();
  return mdNames.length ? path.join(convertedDir, mdNames[0]) : "";
}

async function main() {
  const transcriptDirArg = process.argv[2];
  const prefixArg = process.argv[3] || "auto";
  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = resolveReporterPath(transcriptDirArg);
  ensureDir(transcriptDir);

  const meetingDir = path.dirname(transcriptDir);
  const { plainPath, resolvedPrefix } = pickPlainTranscript(transcriptDir, prefixArg);
  const agendaPath = pickAgendaMarkdown(meetingDir);
  if (!agendaPath) throw new Error(`agenda markdown not found under: ${meetingDir}/converted`);

  const outputPath = path.join(transcriptDir, `${resolvedPrefix}.agenda-wise.series.pya`);
  const matchPath = path.join(transcriptDir, `${resolvedPrefix}.agenda.matches.json`);

  process.stdout.write(`[agenda-wise] transcript: ${plainPath}\n`);
  process.stdout.write(`[agenda-wise] agenda: ${agendaPath}\n`);
  process.stdout.write(`[agenda-wise] output: ${outputPath}\n`);

  await generateAgendaWiseArtifacts({
    plainPath,
    agendaPath,
    outputPath,
    matchPath,
    useLlmRange: USE_LLM_RANGE,
    llmModel: LLM_MODEL,
    ollamaUrl: OLLAMA_URL,
    log: (line) => process.stdout.write(`${line}\n`),
  });
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
