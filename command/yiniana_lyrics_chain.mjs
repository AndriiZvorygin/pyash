#!/usr/bin/env node
// The Yiniana radio lyrics chain, steps 1 and 2.
//
// Step 1 greps one topic out of the channeling corpus and writes the matching
// excerpts to a source file.
// Step 2 runs the learning distillation over that source file and writes the
// learnteaching (the learn card) next to it.
//
// Step 3, the lyrics themselves, lives in examples/pyash/yiniana-radio-lyrics.pya
// because it needs the hymn manuscript ceremony.
//
// Usage:
//   node command/yiniana_lyrics_chain.mjs <topic> [radioDir]
//   node command/yiniana_lyrics_chain.mjs --verify-song <songPath>
//
// The topic is a single word by contract; the curated list in radio/topics.txt
// keeps it that way so the pyash program and this helper agree on file names.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { validateLearnCard } from "./validate_learn_card.mjs";

export const DEFAULT_CORPUS_DIR = "/home/htaf/channelingtxt";
export const DEFAULT_MAX_FILES = 40;
export const DEFAULT_CONTEXT_LINES = 2;
export const DEFAULT_MAX_SOURCE_BYTES = 96 * 1024;
export const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
export const LEARN_PIPELINE_TIMEOUT_MS = 45 * 60 * 1000;

// --------------------------------------------------------------------- paths

export function slugifyTopic(topic) {
  const text = String(topic ?? "").trim().toLowerCase();
  if (!text || !/^[a-z0-9]+$/u.test(text)) {
    throw new Error(`yiniana lyrics chain: topic must be a single word, got "${topic}"`);
  }
  return text;
}

export function buildSourcePath(radioDir, topic) {
  return path.join(radioDir, "lyrics", `source-${slugifyTopic(topic)}.txt`);
}

export function buildTeachingPath(radioDir, topic) {
  return path.join(radioDir, "lyrics", `teaching-${slugifyTopic(topic)}.txt`);
}

export function buildSongPath(radioDir, topic) {
  return path.join(radioDir, "lyrics", `song-${slugifyTopic(topic)}.txt`);
}

// ------------------------------------------------------------------ excerpts

export function buildTopicPattern(topic) {
  const text = String(topic ?? "").trim();
  if (!text) return null;
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "iu");
}

export async function listCorpusFiles(corpusDir) {
  const files = [];
  const seenDirs = new Set();

  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      let stat;
      try {
        // stat follows symlinks; the corpus keeps its years behind links.
        stat = await fsp.stat(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        const real = await fsp.realpath(full).catch(() => full);
        if (seenDirs.has(real)) continue;
        seenDirs.add(real);
        await walk(full);
        continue;
      }
      if (stat.isFile() && entry.name.endsWith(".txt")) files.push(full);
    }
  }

  await walk(corpusDir);
  return files;
}

export async function collectTopicExcerpts({
  corpusDir = DEFAULT_CORPUS_DIR,
  topic,
  maxFiles = DEFAULT_MAX_FILES,
  contextLines = DEFAULT_CONTEXT_LINES,
  maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  files = null
} = {}) {
  const pattern = buildTopicPattern(topic);
  if (!pattern) return { text: "", files: [], matches: 0 };

  const corpusFiles = files ?? (await listCorpusFiles(corpusDir));
  const sections = [];
  const usedFiles = [];
  let bytes = 0;
  let matches = 0;

  for (const file of corpusFiles) {
    if (usedFiles.length >= maxFiles || bytes >= maxSourceBytes) break;
    let content;
    try {
      content = await fsp.readFile(file, "utf8");
    } catch {
      continue;
    }
    if (content.length > maxFileBytes) content = content.slice(0, maxFileBytes);
    const lines = content.split("\n");
    const hits = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (pattern.test(lines[index])) hits.push(index);
    }
    if (!hits.length) continue;

    matches += hits.length;
    const relative = path.relative(corpusDir, file) || path.basename(file);
    const blocks = [];
    for (const hit of hits) {
      const start = Math.max(0, hit - contextLines);
      const end = Math.min(lines.length - 1, hit + contextLines);
      const last = blocks[blocks.length - 1];
      if (last && start <= last.end + 1) {
        for (let index = last.end + 1; index <= end; index += 1) last.lines.push(lines[index]);
        last.end = end;
        continue;
      }
      blocks.push({ start, end, lines: lines.slice(start, end + 1) });
    }

    const body = blocks
      .map((block) => block.lines
        .map((line, offset) => `${relative}:${block.start + offset + 1}:${line}`)
        .join("\n"))
      .join("\n");
    const section = `${body}\n`;
    sections.push(section);
    bytes += Buffer.byteLength(section, "utf8");
    usedFiles.push(relative);
  }

  return { text: sections.join("\n"), files: usedFiles, matches, bytes };
}

// ------------------------------------------------------------------- writing

export async function writeFileAtomic(target, text) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(temp, text, "utf8");
  await fsp.rename(temp, target);
  return target;
}

// ------------------------------------------------------------- learnteaching

export function runLearnPipeline({ sourcePath, topic, cwd = process.cwd(), timeoutMs = LEARN_PIPELINE_TIMEOUT_MS }) {
  const runner = path.join(cwd, "command", "learn_from_filename_pipeline.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, sourcePath, topic], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("yiniana lyrics chain: learn pipeline timed out"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`yiniana lyrics chain: learn pipeline failed (${code}): ${stderr.trim()}`));
        return;
      }
      resolve({ card: stdout.trim(), stderr });
    });
  });
}

export function readCardFromResult(stdout) {
  const text = String(stdout ?? "");
  const match = /FINAL_RESULT_FILE:\s*(\S+)/u.exec(text);
  if (!match) return text.trim();
  return fs.readFileSync(match[1], "utf8").trim();
}

// ---------------------------------------------------------------- song check

// The hymn manuscript writes bracketed section tags, as ACE-Step expects:
// [intro], [verse 1], [chorus], [bridge], [outro]. A tag opens its line and the
// first lyric line follows it on the same line. The numbering is dropped when
// the tag is read, exactly as ACE-Step drops it.
export function parseSongSections(text) {
  const tags = [];
  for (const match of String(text ?? "").matchAll(/^\s*\[([^\]]+)\]/gmu)) {
    const inside = String(match[1] ?? "").trim();
    const name = inside.split("-", 1)[0].replace(/\s+\d+$/u, "").toLowerCase();
    if (name) tags.push(name);
  }
  return tags;
}

export function verifySongStructure(text) {
  const tags = parseSongSections(text);
  const count = (name) => tags.filter((tag) => tag === name).length;
  const missing = [];
  if (!count("intro")) missing.push("intro");
  if (count("verse") < 2) missing.push("verse");
  if (count("chorus") < 2) missing.push("chorus");
  if (!count("bridge")) missing.push("bridge");
  if (!count("outro")) missing.push("outro");
  return { ok: missing.length === 0, missing, tags };
}

// -------------------------------------------------------------------- driver

export async function runLyricsChain({
  topic,
  radioDir,
  corpusDir = DEFAULT_CORPUS_DIR,
  runLearn = runLearnPipeline,
  cwd = process.cwd()
} = {}) {
  const sourcePath = buildSourcePath(radioDir, topic);
  const teachingPath = buildTeachingPath(radioDir, topic);

  const excerpts = await collectTopicExcerpts({ corpusDir, topic });
  if (!excerpts.text.trim()) {
    throw new Error(`yiniana lyrics chain: no channeling excerpts for "${topic}"`);
  }
  await writeFileAtomic(sourcePath, excerpts.text);

  const learned = await runLearn({ sourcePath, topic, cwd });
  const card = readCardFromResult(learned.card);
  const defect = validateLearnCard(card);
  if (defect) throw new Error(`yiniana lyrics chain: ${defect}`);
  await writeFileAtomic(teachingPath, card);

  return {
    topic,
    sourcePath,
    teachingPath,
    files: excerpts.files,
    matches: excerpts.matches,
    bytes: excerpts.bytes
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args[0] === "--verify-song") {
    return { mode: "verify-song", songPath: args[1] ?? "" };
  }
  return { mode: "chain", topic: args[0] ?? "", radioDir: args[1] ?? "" };
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.mode === "verify-song") {
    if (!args.songPath) throw new Error("yiniana lyrics chain: --verify-song needs a path");
    const text = await fsp.readFile(args.songPath, "utf8");
    const verdict = verifySongStructure(text);
    if (!verdict.ok) {
      throw new Error(`yiniana lyrics chain: song missing sections ${verdict.missing.join(", ")}`);
    }
    process.stdout.write(`${args.songPath}\n`);
    return;
  }

  if (!args.topic) {
    throw new Error("yiniana lyrics chain: usage: node command/yiniana_lyrics_chain.mjs <topic> [radioDir]");
  }
  const radioDir = path.resolve(args.radioDir || path.join(process.cwd(), "radio"));
  const corpusDir = process.env.RADIO_CORPUS_DIR || DEFAULT_CORPUS_DIR;
  const result = await runLyricsChain({ topic: args.topic, radioDir, corpusDir });
  process.stdout.write(`${result.teachingPath}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exit(1);
  });
}
