import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { resolveConfigMapSeries, resolveConfigMapText, resolveConfigSeries } from "../configure/env.mjs";

function throwRepairError(name, message, raw) {
  throwErrorSentence({
    name,
    message,
    from: { name: "repair" },
    raw
  });
}

function resolvePatchText(sentence, { rememberFn = remember } = {}) {
  if (typeof sentence?.ob?.text === "string") return sentence.ob.text;
  if (typeof sentence?.ob?.name === "string") {
    const fact = rememberFn(sentence.ob.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return null;
}

function normalizePatchText(text) {
  const value = String(text ?? "");
  if (value.includes("\n")) return value;
  return value.replace(/\\n/g, "\n");
}

function normalizeHeaderPath(rawPath) {
  const trimmed = String(rawPath ?? "").trim().split("\t")[0].trim();
  if (!trimmed) return null;
  if (trimmed === "/dev/null") return null;
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) return trimmed.slice(2);
  return trimmed;
}

function parseHunkHeader(line) {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? "1"),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? "1")
  };
}

function parseUnifiedPatch(text) {
  const normalized = String(text).replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const files = [];
  let index = 0;

  const skipMetadata = (line) => (
    line === ""
    || line.startsWith("diff --git ")
    || line.startsWith("index ")
    || line.startsWith("new file mode ")
    || line.startsWith("deleted file mode ")
    || line.startsWith("similarity index ")
    || line.startsWith("rename from ")
    || line.startsWith("rename to ")
  );

  while (index < lines.length) {
    while (index < lines.length && skipMetadata(lines[index])) index += 1;
    if (index >= lines.length) break;

    if (!lines[index].startsWith("--- ")) {
      throwRepairError(
        "repair parse defective",
        `repair parse defective: expected file header at line ${index + 1}`,
        { line: lines[index] }
      );
    }
    const oldPath = normalizeHeaderPath(lines[index].slice(4));
    index += 1;
    if (index >= lines.length || !lines[index].startsWith("+++ ")) {
      throwRepairError(
        "repair parse defective",
        `repair parse defective: missing +++ header after line ${index}`,
        {}
      );
    }
    const newPath = normalizeHeaderPath(lines[index].slice(4));
    index += 1;

    const hunks = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.startsWith("--- ")) break;
      if (line === "" || line.startsWith("diff --git ") || line.startsWith("index ")) break;
      if (!line.startsWith("@@ ")) {
        throwRepairError(
          "repair parse defective",
          `repair parse defective: expected hunk header at line ${index + 1}`,
          { line }
        );
      }
      const hunkHeader = parseHunkHeader(line);
      if (!hunkHeader) {
        throwRepairError(
          "repair parse defective",
          `repair parse defective: malformed hunk header at line ${index + 1}`,
          { line }
        );
      }
      index += 1;
      const entries = [];
      while (index < lines.length) {
        const entryLine = lines[index];
        if (entryLine.startsWith("@@ ") || entryLine.startsWith("--- ") || entryLine.startsWith("diff --git ") || entryLine.startsWith("index ")) break;
        if (entryLine.startsWith("\\ No newline at end of file")) {
          index += 1;
          continue;
        }
        const prefix = entryLine[0];
        if (prefix !== " " && prefix !== "+" && prefix !== "-") {
          throwRepairError(
            "repair parse defective",
            `repair parse defective: malformed hunk line at ${index + 1}`,
            { line: entryLine }
          );
        }
        entries.push({ type: prefix, text: entryLine.slice(1) });
        index += 1;
      }
      hunks.push({ ...hunkHeader, entries });
    }

    if (!hunks.length) {
      throwRepairError(
        "repair parse defective",
        "repair parse defective: file section missing hunks",
        { oldPath, newPath }
      );
    }
    files.push({ oldPath, newPath, hunks });
  }

  if (!files.length) {
    throwRepairError("repair parse defective", "repair parse defective: no file patches found", {});
  }

  return files;
}

function isWithin(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizeRoots(roots = []) {
  const out = [];
  for (const root of roots) {
    const raw = String(root ?? "").trim();
    if (!raw) continue;
    const resolved = path.resolve(raw);
    if (!out.includes(resolved)) out.push(resolved);
  }
  return out;
}

function resolveWorldRoot({ rememberFn = remember } = {}) {
  const fact = rememberFn("world root")?.ob?.filename;
  if (fact) return path.resolve(String(fact));
  return path.resolve("world");
}

function resolveRepairRoots({ rememberFn = remember } = {}) {
  const configuredRoots =
    resolveConfigMapSeries("repair configure", "writable roots", { rememberFn })
    ?? resolveConfigMapSeries("sandbox configure", "writable roots", { rememberFn })
    ?? resolveConfigSeries("repair writable roots", { rememberFn })
    ?? null;
  const configuredCwd =
    resolveConfigMapText("repair configure", "cwd", { rememberFn })
    ?? resolveConfigMapText("sandbox configure", "cwd", { rememberFn })
    ?? null;
  if (configuredRoots) {
    return {
      baseRoot: path.resolve(String(configuredCwd ?? process.cwd())),
      roots: normalizeRoots(configuredRoots)
    };
  }

  const sandboxEnabled = rememberFn("agent sandbox")?.ob?.boolean === true;
  const agentCwd =
    rememberFn("agent cwd")?.ob?.filename
    ?? rememberFn("agent cwd")?.ob?.text
    ?? null;
  if (sandboxEnabled && agentCwd) {
    const worldRoot = resolveWorldRoot({ rememberFn });
    const sharedRoots = resolveConfigMapSeries("agent command configure", "shared roots", { rememberFn })
      ?? resolveConfigSeries("agent shared roots", { rememberFn })
      ?? [];
    const projectRoots = resolveConfigMapSeries("agent command configure", "project roots", { rememberFn })
      ?? resolveConfigSeries("agent project roots", { rememberFn })
      ?? [];
    const processedRoot =
      resolveConfigMapText("agent command configure", "library processed root", { rememberFn })
      ?? path.join(worldRoot, "library", "processed");
    return {
      baseRoot: path.resolve(String(agentCwd)),
      roots: normalizeRoots([agentCwd, ...sharedRoots, ...projectRoots, processedRoot])
    };
  }

  return {
    baseRoot: process.cwd(),
    roots: normalizeRoots([process.cwd()])
  };
}

function resolveSafePath(targetPath, { baseRoot, allowedRoots, realRoots }) {
  if (!targetPath || typeof targetPath !== "string") {
    throwRepairError("repair path defective", "repair path defective: missing target path", { targetPath });
  }
  if (targetPath.includes("\0")) {
    throwRepairError("repair path defective", "repair path defective: invalid target path", { targetPath });
  }

  const absolute = path.resolve(baseRoot, targetPath);
  const inAllowed = (allowedRoots ?? []).some((root) => isWithin(root, absolute));
  if (!inAllowed) {
    throwRepairError("repair path defective", `repair path defective: outside workspace (${targetPath})`, { targetPath });
  }

  if (fs.existsSync(absolute)) {
    const real = fs.realpathSync(absolute);
    const realAllowed = (realRoots ?? []).some((root) => isWithin(root, real));
    if (!realAllowed) {
      throwRepairError("repair path defective", `repair path defective: symlink escape (${targetPath})`, { targetPath });
    }
    return absolute;
  }

  let probe = path.dirname(absolute);
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realProbe = fs.realpathSync(probe);
  if (!(realRoots ?? []).some((root) => isWithin(root, realProbe))) {
    throwRepairError("repair path defective", `repair path defective: parent outside workspace (${targetPath})`, { targetPath });
  }
  const suffix = path.relative(probe, absolute);
  const resolvedFromRealParent = path.resolve(realProbe, suffix);
  if (!(realRoots ?? []).some((root) => isWithin(root, resolvedFromRealParent))) {
    throwRepairError("repair path defective", `repair path defective: symlink escape (${targetPath})`, { targetPath });
  }

  return absolute;
}

function splitTextLines(text) {
  const normalized = String(text).replace(/\r\n/g, "\n");
  const trailingNewline = normalized.endsWith("\n");
  const body = trailingNewline ? normalized.slice(0, -1) : normalized;
  return {
    lines: body ? body.split("\n") : [],
    trailingNewline
  };
}

function joinTextLines(lines, { trailingNewline, newline }) {
  let output = lines.join("\n");
  if (trailingNewline && (lines.length > 0 || output === "")) output += "\n";
  if (newline === "\r\n") output = output.replace(/\n/g, "\r\n");
  return output;
}

function applyHunksToText(sourceText, hunks, filePath) {
  const newline = String(sourceText).includes("\r\n") ? "\r\n" : "\n";
  const { lines: currentLines, trailingNewline: sourceTrailing } = splitTextLines(sourceText);
  const lines = currentLines.slice();
  let trailingNewline = sourceTrailing || !sourceText;
  let delta = 0;
  let totalAdded = 0;
  let totalDeleted = 0;

  for (const hunk of hunks) {
    const oldLines = hunk.entries.filter(entry => entry.type !== "+").map(entry => entry.text);
    const newLines = hunk.entries.filter(entry => entry.type !== "-").map(entry => entry.text);
    const startIndex = Math.max(0, hunk.oldStart - 1 + delta);
    const currentSlice = lines.slice(startIndex, startIndex + oldLines.length);
    const matches = currentSlice.length === oldLines.length && currentSlice.every((line, idx) => line === oldLines[idx]);
    if (!matches) {
      throwRepairError(
        "repair hunk defective",
        `repair hunk defective: context mismatch for ${filePath} at -${hunk.oldStart},${hunk.oldCount}`,
        { filePath, hunk }
      );
    }
    lines.splice(startIndex, oldLines.length, ...newLines);
    delta += newLines.length - oldLines.length;
    totalAdded += hunk.entries.filter(entry => entry.type === "+").length;
    totalDeleted += hunk.entries.filter(entry => entry.type === "-").length;
  }

  const output = joinTextLines(lines, { trailingNewline, newline });
  return { output, totalAdded, totalDeleted };
}

function resolveFileIntent(filePatch) {
  const { oldPath, newPath } = filePatch;
  if (!oldPath && !newPath) {
    throwRepairError("repair parse defective", "repair parse defective: both file headers are /dev/null", filePatch);
  }
  if (!oldPath && newPath) return { targetPath: newPath, mode: "added" };
  if (oldPath && !newPath) return { targetPath: oldPath, mode: "deleted" };
  if (oldPath !== newPath) {
    throwRepairError(
      "repair path defective",
      `repair path defective: rename/move unsupported (${oldPath} -> ${newPath})`,
      filePatch
    );
  }
  return { targetPath: newPath, mode: "updated" };
}

async function planFilePatch(filePatch, { baseRoot, allowedRoots, realRoots }) {
  const intent = resolveFileIntent(filePatch);
  const safePath = resolveSafePath(intent.targetPath, { baseRoot, allowedRoots, realRoots });
  const exists = fs.existsSync(safePath);

  if ((intent.mode === "updated" || intent.mode === "deleted") && !exists) {
    throwRepairError(
      "repair apply defective",
      `repair apply defective: source file missing (${intent.targetPath})`,
      { filePatch }
    );
  }

  const sourceText = exists ? await fsp.readFile(safePath, "utf8") : "";
  if (sourceText.includes("\0")) {
    throwRepairError("repair apply defective", `repair apply defective: binary file not supported (${intent.targetPath})`, {});
  }

  const { output, totalAdded, totalDeleted } = applyHunksToText(sourceText, filePatch.hunks, intent.targetPath);
  const changed = output !== sourceText || intent.mode === "deleted";
  const status = intent.mode === "deleted"
    ? "deleted"
    : intent.mode === "added"
      ? (changed ? "added" : "unchanged")
      : (changed ? "updated" : "unchanged");

  return {
    safePath,
    targetPath: intent.targetPath,
    intentMode: intent.mode,
    status,
    sourceText,
    output,
    linesAdded: totalAdded,
    linesDeleted: totalDeleted
  };
}

function buildResultMap({ mode, records }) {
  const files = {};
  let filesChanged = 0;
  let linesAdded = 0;
  let linesDeleted = 0;

  for (const record of records) {
    if (record.status !== "unchanged") filesChanged += 1;
    linesAdded += record.linesAdded;
    linesDeleted += record.linesDeleted;
    files[record.targetPath] = {
      map: {
        status: { text: record.status },
        lines_added: { num: record.linesAdded },
        lines_deleted: { num: record.linesDeleted }
      }
    };
  }

  return {
    map: {
      mode: { text: mode },
      files_total: { num: records.length },
      files_changed: { num: filesChanged },
      lines_added: { num: linesAdded },
      lines_deleted: { num: linesDeleted },
      files: { map: files }
    }
  };
}

export async function repair(sentence, { remember: rememberFn = remember } = {}) {
  const patchText = resolvePatchText(sentence, { rememberFn });
  if (typeof patchText !== "string" || !patchText.trim()) {
    throwRepairError("repair defective", "repair defective: missing patch text", { sentence });
  }
  if (patchText.includes("\0")) {
    throwRepairError("repair parse defective", "repair parse defective: binary patch payload not supported", {});
  }

  const checkMode = sentence?.as?.wo === "check";
  if (sentence?.as?.wo && sentence.as.wo !== "check") {
    throwRepairError("repair defective", `repair defective: unsupported mode ${sentence.as.wo}`, { sentence });
  }
  const mode = checkMode ? "check" : "apply";

  const patches = parseUnifiedPatch(normalizePatchText(patchText));
  const roots = resolveRepairRoots({ rememberFn });
  const baseRoot = path.resolve(String(roots.baseRoot ?? process.cwd()));
  const allowedRoots = Array.isArray(roots.roots) && roots.roots.length
    ? roots.roots
    : [process.cwd()];
  const realRoots = allowedRoots.map((root) => {
    try {
      return fs.realpathSync(root);
    } catch {
      return null;
    }
  }).filter(Boolean);
  if (!allowedRoots.some((root) => isWithin(root, baseRoot))) {
    throwRepairError(
      "repair path defective",
      `repair path defective: cwd outside writable roots (${baseRoot})`,
      { baseRoot, allowedRoots }
    );
  }

  const records = [];
  for (const patchFile of patches) {
    records.push(await planFilePatch(patchFile, { baseRoot, allowedRoots, realRoots }));
  }

  if (!checkMode) {
    for (const record of records) {
      try {
        if (record.intentMode === "deleted") {
          if (fs.existsSync(record.safePath)) {
            await fsp.unlink(record.safePath);
          }
          continue;
        }
        await fsp.mkdir(path.dirname(record.safePath), { recursive: true });
        await fsp.writeFile(record.safePath, record.output, "utf8");
      } catch (err) {
        throwRepairError(
          "repair apply defective",
          `repair apply defective: failed writing ${record.targetPath} (${err?.message ?? "unknown"})`,
          { record: record.targetPath }
        );
      }
    }
  }

  return { ob: buildResultMap({ mode, records }), be: "map" };
}

export const signatures = [
  { signatureWords: ["be", "repair", "ob", "text"], handler: repair },
  { signatureWords: ["be", "repair", "ob", "name", "text"], handler: repair },
  { signatureWords: ["be", "repair", "as", "wo", "check", "ob", "text"], handler: repair },
  { signatureWords: ["be", "repair", "as", "wo", "check", "ob", "name", "text"], handler: repair },
  { signatureWords: ["be", "repair", "ob", "text", "to", "name", "map"], handler: repair },
  { signatureWords: ["be", "repair", "ob", "name", "text", "to", "name", "map"], handler: repair },
  { signatureWords: ["be", "repair", "as", "wo", "check", "ob", "text", "to", "name", "map"], handler: repair },
  { signatureWords: ["be", "repair", "as", "wo", "check", "ob", "name", "text", "to", "name", "map"], handler: repair }
];

export default repair;
