import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_CHUNK_SIZE = 16 * 1024;
export const DEFAULT_CHUNK_OVERLAP = 1800;
const PARAGRAPH_BOUNDARY = /\n\s*\n/gmu;

function createMindFixtureAllocator(raw) {
  const source = String(raw ?? "").trim();
  if (!source) {
    return () => null;
  }
  let queue = null;
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) {
      queue = parsed;
    }
  } catch {
    // Leave queue null so the caller can use the raw fixture unchanged.
  }
  if (!queue) {
    return () => source;
  }
  let index = 0;
  return (count) => {
    const needed = Math.max(0, Number(count) || 0);
    if (needed === 0) return JSON.stringify([]);
    if (queue.length === 0) return JSON.stringify([]);
    const taken = [];
    for (let i = 0; i < needed; i += 1) {
      const item = queue[Math.min(index, queue.length - 1)];
      taken.push(item);
      if (index < queue.length - 1) index += 1;
    }
    return JSON.stringify(taken);
  };
}

export function parseLearningPipelineRequest(text) {
  const raw = String(text ?? "").replace(/\r\n?/gu, "\n");
  const lines = raw.split("\n");
  const sourceIdx = lines.findIndex((line) => line.trim() === "SOURCE_FILENAME:");
  const focusIdx = lines.findIndex((line) => line.trim() === "LEARNING_FOCUS:");
  if (sourceIdx === -1 || focusIdx === -1 || focusIdx <= sourceIdx) {
    throw new Error("learn filename pipeline defective: malformed request");
  }
  const sourceFilename = (lines.slice(sourceIdx + 1, focusIdx).find((line) => line.trim().length > 0) ?? "").trim();
  const focusBlock = lines.slice(focusIdx + 1).join("\n").trim();
  if (!sourceFilename || !focusBlock) {
    throw new Error("learn filename pipeline defective: malformed request");
  }
  return {
    sourceFilename,
    learningFocus: focusBlock.trim()
  };
}

function findBoundaryNear(text, target, min, max) {
  let best = null;
  for (const match of text.matchAll(PARAGRAPH_BOUNDARY)) {
    const idx = match.index ?? -1;
    if (idx < min || idx > max) continue;
    const end = idx + match[0].length;
    const distance = Math.abs(end - target);
    if (!best || distance < best.distance) {
      best = { end, distance };
    }
  }
  return best?.end ?? null;
}

export function splitIntoOverlappingChunks(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
  const source = String(text ?? "");
  if (!source.length) return [""];
  if (source.length <= chunkSize) return [source];
  const chunks = [];
  const tolerance = Math.min(2000, Math.max(600, Math.floor(overlap)));
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + chunkSize);
    if (end < source.length) {
      const minBoundary = Math.max(start + Math.floor(chunkSize * 0.6), end - tolerance);
      const maxBoundary = Math.min(source.length, end + tolerance);
      const boundaryEnd = findBoundaryNear(source, end, minBoundary, maxBoundary);
      if (boundaryEnd && boundaryEnd > start) {
        end = boundaryEnd;
      }
    }
    const chunk = source.slice(start, end);
    chunks.push(chunk);
    if (end >= source.length) break;
    let nextStart = Math.max(0, end - overlap);
    if (nextStart <= start) {
      nextStart = Math.min(source.length, start + Math.max(1, chunkSize - overlap));
    }
    start = nextStart;
  }
  return chunks;
}

async function runPyashExample(examplePath, args, envOverrides = {}) {
  const { stdout } = await execFileAsync("./run", [examplePath, ...args, "--no-checkpoint"], {
    cwd: "/workplace",
    env: { ...process.env, ...envOverrides },
    maxBuffer: 20 * 1024 * 1024
  });
  return String(stdout ?? "").trim();
}

export async function runLearnFilenamePipeline({
  sourceFilename,
  learningFocus,
  readFileFn = (file) => fsp.readFile(file, "utf8"),
  mkdtempFn = (prefix) => fsp.mkdtemp(prefix),
  writeFileFn = (file, text) => fsp.writeFile(file, text),
  runDirectFn = ({ sourceFilename: file, learningFocus: focus, envOverrides }) => runPyashExample("examples/pyash/learn-direct-from-filename.pya", [file, focus], envOverrides),
  runExtractFn = ({ sourceFilename: file, learningFocus: focus, envOverrides }) => runPyashExample("examples/pyash/learn-extract-card-from-filename.pya", [file, focus], envOverrides),
  runMergeRefineFn = ({ sourceFilename: source, cardsFilename: cards, learningFocus: focus, envOverrides }) => runPyashExample("examples/pyash/learn-merge-refine-cards-from-filename.pya", [source, cards, focus], envOverrides)
}) {
  const takeFixtureResponses = createMindFixtureAllocator(process.env.PYA_MIND_RESPONSE);
  const sourceText = await readFileFn(sourceFilename);
  if (sourceText.length <= DEFAULT_CHUNK_SIZE) {
    return runDirectFn({
      sourceFilename,
      learningFocus,
      envOverrides: { PYA_MIND_RESPONSE: takeFixtureResponses(4) ?? process.env.PYA_MIND_RESPONSE }
    });
  }

  const chunks = splitIntoOverlappingChunks(sourceText, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP);
  const tempRoot = await mkdtempFn(path.join(os.tmpdir(), "pyash-learn-chunks-"));
  const chunkCards = [];
  for (let idx = 0; idx < chunks.length; idx += 1) {
    const chunkFilename = path.join(tempRoot, `chunk-${String(idx + 1).padStart(3, "0")}.txt`);
    await writeFileFn(chunkFilename, chunks[idx]);
    const card = await runExtractFn({
      sourceFilename: chunkFilename,
      learningFocus,
      envOverrides: { PYA_MIND_RESPONSE: takeFixtureResponses(1) ?? process.env.PYA_MIND_RESPONSE }
    });
    chunkCards.push(card);
  }

  const cardsText = chunkCards
    .map((card, idx) => `CHUNK CARD ${idx + 1}\n${card}`)
    .join("\n\n=====\n\n");
  const cardsFilename = path.join(tempRoot, "chunk-cards.txt");
  await writeFileFn(cardsFilename, cardsText);
  return runMergeRefineFn({
    sourceFilename,
    cardsFilename,
    learningFocus,
    envOverrides: { PYA_MIND_RESPONSE: takeFixtureResponses(4) ?? process.env.PYA_MIND_RESPONSE }
  });
}

async function main() {
  const argvSource = process.argv[2];
  const argvFocus = process.argv.slice(3).join(" ").trim();
  const parsed = argvSource && argvFocus
    ? { sourceFilename: argvSource, learningFocus: argvFocus }
    : parseLearningPipelineRequest(fs.readFileSync(0, "utf8"));
  const output = await runLearnFilenamePipeline(parsed);
  process.stdout.write(output);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
