import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parse } from "../understand/index.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function readNewspaperLimits(configRoot = repoRoot) {
  const filename = path.join(configRoot, "configure", "default.pya");
  const source = await fs.readFile(filename, "utf8");
  const values = new Map();
  for (const raw of splitSentences(source, { includeThen: true })) {
    const sentence = parse(raw.trim());
    if (sentence?.be === "default" && sentence?.ob?.num !== undefined) {
      values.set(sentence?.su?.name, Number(sentence.ob.num));
    }
  }
  const maximumBytes = values.get("newspaper maximum bytes");
  const segmentMaximumBytes = values.get("newspaper segment maximum bytes");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("configure/default.pya must set a positive newspaper maximum bytes");
  }
  if (!Number.isSafeInteger(segmentMaximumBytes) || segmentMaximumBytes < 1 || segmentMaximumBytes > maximumBytes) {
    throw new Error("configure/default.pya must set newspaper segment maximum bytes within the total limit");
  }
  return { maximumBytes, segmentMaximumBytes };
}

async function newspaperDirectories(worldRoot) {
  const directories = [path.join(worldRoot, "newspaper")];
  const projects = path.join(worldRoot, "coding-saddle-projects");
  let entries = [];
  try {
    entries = await fs.readdir(projects, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) directories.push(path.join(projects, entry.name, "newspaper"));
  }
  return directories;
}

async function newspaperFiles(worldRoot) {
  const files = [];
  for (const directory of await newspaperDirectories(worldRoot)) {
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".pya")) continue;
      const filename = path.join(directory, entry.name);
      const stat = await fs.stat(filename);
      if (stat.nlink !== 1) throw new Error(`refusing hard-linked newspaper file: ${filename}`);
      files.push({ filename, directory, name: entry.name, bytes: stat.size, mtimeMs: stat.mtimeMs, mtime: stat.mtime });
    }
  }
  return files;
}

export async function verifyNewspaperSet({ worldRoot, maximumBytes, segmentMaximumBytes } = {}) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || !Number.isSafeInteger(segmentMaximumBytes) || segmentMaximumBytes < 1 || segmentMaximumBytes > maximumBytes) {
    throw new Error("invalid newspaper verification limits");
  }
  const files = await newspaperFiles(path.resolve(String(worldRoot || path.join(repoRoot, "world"))));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (totalBytes > maximumBytes) throw new Error(`newspaper total exceeds cap: ${totalBytes}/${maximumBytes}`);
  let recordCount = 0;
  for (const file of files) {
    if (file.bytes > segmentMaximumBytes) throw new Error(`newspaper segment exceeds cap: ${file.filename}`);
    if (!/^\d{8}-\d{4}-.+\.pya$/u.test(file.name)) throw new Error(`newspaper segment name is not canonical: ${file.filename}`);
    let fileRecords = 0;
    for await (const _record of pyaRecords(file.filename, segmentMaximumBytes)) fileRecords += 1;
    if (!fileRecords) throw new Error(`newspaper segment contains no Pyash records: ${file.filename}`);
    recordCount += fileRecords;
  }
  return { files: files.length, totalBytes, maxSegmentBytes: files.reduce((max, file) => Math.max(max, file.bytes), 0), recordCount };
}

function sourceIdentity(file) {
  const match = file.name.match(/^(\d{8})-(?:\d{4}-)?(.+)\.pya$/u);
  const date = match?.[1] || file.mtime.toISOString().slice(0, 10).replace(/-/gu, "");
  const basename = match?.[2] || file.name.replace(/\.pya$/u, "");
  return { date, basename };
}

function quoteBlockState(line, activeType = "") {
  if (activeType) return line.includes(`.${activeType}.quoted`) ? "" : activeType;
  const start = line.match(/quoted\.([A-Za-z0-9_-]+)\./u);
  if (!start || line.includes(`.${start[1]}.quoted`)) return "";
  return start[1];
}

function mapStart(line) {
  const match = line.trim().match(/^(.*?)\s+be\s+(?:json\s+)?map\s+def\s*$/u);
  const subject = match?.[1]?.replace(/\s+/gu, " ") ?? "";
  return /^su name\s/u.test(subject) ? subject : "";
}

function mapEnd(line) {
  const match = line.trim().match(/^(.*?)\s+prah\s*$/u);
  const subject = match?.[1]?.replace(/\s+/gu, " ") ?? "";
  return /^su name\s/u.test(subject) ? subject : "";
}

function omittedRecord(bytes, hash) {
  return [
    `su name newspaper oversized record ${hash.slice(0, 16)} be json map def`,
    `su name byte count ob num ${bytes} ya`,
    `su name sha256 ob text "${hash}" ya`,
    "prah",
    ""
  ].join("\n");
}

async function* pyaRecords(filename, maximumRecordBytes) {
  let carry = "";
  let current = "";
  let currentBytes = 0;
  let currentHash = createHash("sha256");
  let currentOversized = false;
  const mapStack = [];
  let lineNumber = 0;
  let quotedType = "";
  const stream = createReadStream(filename, { encoding: "utf8" });
  const takeRecord = () => {
    const bytes = currentBytes;
    const hash = currentHash.digest("hex");
    const record = currentOversized ? omittedRecord(bytes, hash) : current;
    current = "";
    currentBytes = 0;
    currentHash = createHash("sha256");
    currentOversized = false;
    return record;
  };
  const addLine = function* (line) {
    lineNumber += 1;
    if (!currentOversized) current += line;
    currentBytes += Buffer.byteLength(line, "utf8");
    currentHash.update(line, "utf8");
    if (currentBytes > maximumRecordBytes) {
      current = "";
      currentOversized = true;
    }
    const plain = line.trim();
    const previouslyQuoted = Boolean(quotedType);
    quotedType = quoteBlockState(line, quotedType);
    if (quotedType) return;
    if (previouslyQuoted && mapStack.length === 0) {
      yield takeRecord();
      return;
    }
    if (previouslyQuoted) return;
    const start = mapStart(plain);
    if (start) {
      mapStack.push(start);
      return;
    }
    const end = mapEnd(plain);
    if ((plain === "prah" && mapStack.length > 0) || (end && mapStack.at(-1) === end)) {
      mapStack.pop();
      if (mapStack.length === 0) {
        yield takeRecord();
      }
      return;
    }
    if (mapStack.length === 0) {
      yield takeRecord();
    }
  };

  for await (const chunk of stream) {
    carry += chunk;
    let newline;
    while ((newline = carry.indexOf("\n")) >= 0) {
      const line = carry.slice(0, newline + 1);
      carry = carry.slice(newline + 1);
      yield* addLine(line);
    }
  }
  if (carry) yield* addLine(carry);
  if (current.trim()) {
    if (mapStack.length || quotedType) throw new Error(`incomplete final Pyash record in ${filename}`);
    yield takeRecord();
  }
}

function numberedName(file, sequence) {
  const { date, basename } = sourceIdentity(file);
  return `${date}-${String(sequence).padStart(4, "0")}-${basename}.pya`;
}

async function stageSelectedFiles(selectedFiles, {
  stageByDirectory,
  segmentMaximumBytes,
  maximumBytes
} = {}) {
  const parts = [];
  let retainedBytes = 0;
  const nextSequence = new Map();
  for (const file of [...selectedFiles].reverse()) {
    const { date, basename } = sourceIdentity(file);
    const key = `${file.directory}\0${date}\0${basename}`;
    let sequence = nextSequence.get(key) ?? 1;
    let body = "";
    let bodyBytes = 0;
    const flush = async () => {
      if (!body) return;
      const name = numberedName(file, sequence);
      const staged = path.join(stageByDirectory.get(file.directory), `${randomUUID()}.part`);
      await fs.writeFile(staged, body, { flag: "wx" });
      const part = { staged, name, directory: file.directory, file, date, basename, sequence, bytes: bodyBytes };
      parts.push(part);
      retainedBytes += bodyBytes;
      sequence += 1;
      body = "";
      bodyBytes = 0;
      while (retainedBytes > maximumBytes && parts.length) {
        const oldest = parts.shift();
        retainedBytes -= oldest.bytes;
        await fs.rm(oldest.staged);
      }
    };
    for await (const record of pyaRecords(file.filename, segmentMaximumBytes)) {
      const recordBytes = Buffer.byteLength(record, "utf8");
      if (bodyBytes && bodyBytes + recordBytes > segmentMaximumBytes) await flush();
      body += record;
      bodyBytes += recordBytes;
    }
    await flush();
    nextSequence.set(key, sequence);
  }

  const sequences = new Map();
  for (const part of parts) {
    const key = `${part.directory}\0${part.date}\0${part.basename}`;
    const sequence = (sequences.get(key) ?? 0) + 1;
    sequences.set(key, sequence);
    part.name = `${part.date}-${String(sequence).padStart(4, "0")}-${part.basename}.pya`;
  }
  return { parts, retainedBytes };
}

export async function rotateWorldNewspapers({
  worldRoot,
  configRoot = repoRoot,
  apply = false,
  maximumBytes,
  segmentMaximumBytes
} = {}) {
  const limits = await readNewspaperLimits(configRoot);
  const maximum = maximumBytes ?? limits.maximumBytes;
  const segmentMaximum = segmentMaximumBytes ?? limits.segmentMaximumBytes;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || !Number.isSafeInteger(segmentMaximum) || segmentMaximum < 1 || segmentMaximum > maximum) {
    throw new Error("invalid newspaper retention limits");
  }
  const resolvedWorldRoot = path.resolve(String(worldRoot || path.join(repoRoot, "world")));
  const files = await newspaperFiles(resolvedWorldRoot);
  const beforeBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const canonicalNames = files.every((file) => /^\d{8}-\d{4}-.+\.pya$/u.test(file.name));
  if (beforeBytes <= maximum && files.every((file) => file.bytes <= segmentMaximum) && canonicalNames) {
    return {
      apply,
      maximumBytes: maximum,
      segmentMaximumBytes: segmentMaximum,
      beforeBytes,
      retainedBytes: beforeBytes,
      sourceFiles: files.length,
      generatedParts: files.length,
      removedBytes: 0,
      noChange: true
    };
  }

  const newestFirst = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs || b.filename.localeCompare(a.filename));
  const selectedNewestFirst = [];
  let selectedSourceBytes = 0;
  for (const file of newestFirst) {
    selectedNewestFirst.push(file);
    selectedSourceBytes += file.bytes;
    if (selectedSourceBytes >= maximum) break;
  }
  const selectedChronological = selectedNewestFirst.reverse();
  const directories = [...new Set(files.map((file) => file.directory))];
  const stageByDirectory = new Map();
  const stageToken = `${process.pid}-${randomUUID()}`;
  const stageDirectories = [];
  let backupStarted = false;
  let commitComplete = false;
  let movedOriginals = [];
  let installedParts = [];
  try {
    for (const directory of directories) {
      const stageDirectory = path.join(directory, `.newspaper-rotation-${stageToken}`);
      await fs.mkdir(stageDirectory, { recursive: false });
      stageDirectories.push(stageDirectory);
      stageByDirectory.set(directory, stageDirectory);
    }
    const { parts, retainedBytes } = await stageSelectedFiles(selectedChronological, {
      stageByDirectory,
      segmentMaximumBytes: segmentMaximum,
      maximumBytes: maximum
    });
    if (retainedBytes > maximum || parts.some((part) => part.bytes > segmentMaximum)) {
      throw new Error(`staged newspaper set violates limits: ${retainedBytes}/${maximum} bytes`);
    }
    if (!apply) {
      for (const directory of stageDirectories) await fs.rm(directory, { recursive: true, force: true });
      return {
        apply: false,
        maximumBytes: maximum,
        segmentMaximumBytes: segmentMaximum,
        beforeBytes,
        retainedBytes,
        selectedSourceFiles: selectedChronological.length,
        sourceFiles: files.length,
        generatedParts: parts.length
      };
    }

    const backupByDirectory = new Map();
    for (const directory of directories) {
      const backupDirectory = path.join(stageByDirectory.get(directory), "originals");
      await fs.mkdir(backupDirectory);
      backupByDirectory.set(directory, backupDirectory);
    }
    backupStarted = true;
    for (const file of files) {
      const backup = path.join(backupByDirectory.get(file.directory), file.name);
      await fs.rename(file.filename, backup);
      movedOriginals.push({ file, backup });
    }
    for (const part of parts) {
      const destination = path.join(part.directory, part.name);
      await fs.rename(part.staged, destination);
      installedParts.push(destination);
    }
    const verification = await verifyNewspaperSet({
      worldRoot: resolvedWorldRoot,
      maximumBytes: maximum,
      segmentMaximumBytes: segmentMaximum
    });
    const finalBytes = verification.totalBytes;
    commitComplete = true;
    for (const directory of stageDirectories) await fs.rm(directory, { recursive: true, force: true });
    return {
      apply: true,
      maximumBytes: maximum,
      segmentMaximumBytes: segmentMaximum,
      beforeBytes,
      retainedBytes: finalBytes,
      sourceFiles: files.length,
      selectedSourceFiles: selectedChronological.length,
      generatedParts: verification.files,
      removedBytes: beforeBytes - finalBytes
    };
  } catch (error) {
    if (backupStarted && !commitComplete) {
      for (const destination of installedParts) await fs.rm(destination, { force: true }).catch(() => {});
      let rollbackFailed = false;
      for (const { file, backup } of movedOriginals.reverse()) {
        await fs.rename(backup, file.filename).catch(() => { rollbackFailed = true; });
      }
      if (rollbackFailed) {
        throw new Error(`${error.message}; rollback incomplete, originals remain in ${stageDirectories.join(", ")}`);
      }
    }
    for (const directory of stageDirectories) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
