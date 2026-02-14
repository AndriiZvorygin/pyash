import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dayStamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;
}

function timeStamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}`;
}

function sanitizeSegment(raw, fallback = "x") {
  const text = String(raw ?? "").trim().toLowerCase();
  const safe = text
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || fallback;
}

function hash12(text) {
  return crypto
    .createHash("sha1")
    .update(String(text ?? ""))
    .digest("hex")
    .slice(0, 12);
}

function stripWorkerSuffixes(name) {
  const text = String(name ?? "").trim();
  if (!text) return "";
  return text.replace(/(?:--[a-z0-9._-]+)+(?=\.pya$)/gi, "");
}

function clampFilenameLength(name, maxLen = 220) {
  const text = String(name ?? "").trim();
  if (text.length <= maxLen) return text;
  const ext = text.toLowerCase().endsWith(".pya") ? ".pya" : "";
  const stem = ext ? text.slice(0, -ext.length) : text;
  const digest = hash12(stem);
  const headLen = Math.max(24, maxLen - (digest.length + ext.length + 1));
  const head = stem.slice(0, headLen).replace(/-+$/g, "");
  return `${head}-${digest}${ext}`;
}

function toArrayLayout(layout = []) {
  if (Array.isArray(layout)) return layout;
  if (layout && typeof layout === "object") return Object.values(layout);
  return [];
}

export async function ensureSpoolDirs(rootPath, layout = []) {
  const dirs = [String(rootPath ?? ""), ...toArrayLayout(layout)];
  for (const dir of dirs) {
    const target = String(dir ?? "").trim();
    if (!target) continue;
    await fs.mkdir(target, { recursive: true });
  }
}

export function makeSpoolFilename({
  at = new Date(),
  channelType = "",
  agentName = "",
  roomName = "",
  kind = "event",
  hash = "",
  hashSource = ""
} = {}) {
  const date = at instanceof Date ? at : new Date(at);
  const stamp = `${dayStamp(date)}-${timeStamp(date)}`;
  const channel = sanitizeSegment(channelType, "channel");
  const agent = sanitizeSegment(agentName, "agent");
  const room = sanitizeSegment(roomName, "room");
  const payloadKind = sanitizeSegment(kind, "event");
  const payloadHash = sanitizeSegment(hash, "")
    || hash12(hashSource || `${channel}|${agent}|${room}|${payloadKind}|${date.toISOString()}`);
  return `${stamp}-${channel}-${agent}-${room}-${payloadKind}-${payloadHash}.pya`;
}

async function pathExists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

export async function writeSpoolItem({
  tmpDir,
  targetDir,
  filename,
  text
} = {}) {
  const tmp = String(tmpDir ?? "").trim();
  const target = String(targetDir ?? "").trim();
  const name = String(filename ?? "").trim();
  if (!tmp || !target || !name) throw new Error("spool write defective: missing tmp/target/filename");

  await ensureSpoolDirs("", [tmp, target]);
  const tmpName = `${name}.tmp-${process.pid}-${Date.now()}`;
  const tmpPath = path.join(tmp, tmpName);
  await fs.writeFile(tmpPath, String(text ?? ""), "utf8");
  const base = clampFilenameLength(name);
  let finalName = base;
  let targetPath = path.join(target, finalName);
  if (await pathExists(targetPath)) {
    const stamp = `${Date.now()}-${process.pid}`;
    finalName = clampFilenameLength(`${base.replace(/\.pya$/i, "")}-${stamp}.pya`);
    targetPath = path.join(target, finalName);
  }
  await fs.rename(tmpPath, targetPath);
  return { filename: finalName, path: targetPath };
}

export async function listSpoolItemsOldestFirst(dirPath) {
  const dir = String(dirPath ?? "").trim();
  if (!dir) return [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".pya"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "en"));
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

export async function claimSpoolItem({
  fromDir,
  runtimeDir,
  filename,
  workerTag = ""
} = {}) {
  const sourceDir = String(fromDir ?? "").trim();
  const runDir = String(runtimeDir ?? "").trim();
  const name = String(filename ?? "").trim();
  if (!sourceDir || !runDir || !name) throw new Error("spool claim defective: missing from/runtime/filename");
  await ensureSpoolDirs("", [sourceDir, runDir]);

  const sourcePath = path.join(sourceDir, name);
  const baseName = stripWorkerSuffixes(name);
  const claimedName = workerTag
    ? `${baseName.replace(/\.pya$/i, "")}--${sanitizeSegment(workerTag, "worker")}.pya`
    : baseName;
  const safeClaimedName = clampFilenameLength(claimedName);
  const runtimePath = path.join(runDir, safeClaimedName);
  try {
    await fs.rename(sourcePath, runtimePath);
    return { path: runtimePath, filename: safeClaimedName };
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

async function moveWithUniqueName(sourcePath, targetDir, { preferredName = "" } = {}) {
  await fs.mkdir(targetDir, { recursive: true });
  const fallbackBase = path.basename(sourcePath);
  const base = clampFilenameLength(String(preferredName || fallbackBase));
  const candidate = path.join(targetDir, base);
  if (!(await pathExists(candidate))) {
    await fs.rename(sourcePath, candidate);
    return candidate;
  }
  const next = path.join(
    targetDir,
    `${base.replace(/\.pya$/i, "")}-${Date.now()}-${process.pid}.pya`
  );
  await fs.rename(sourcePath, next);
  return next;
}

export async function completeSpoolItem({
  runtimePath,
  successDir
} = {}) {
  const sourcePath = String(runtimePath ?? "").trim();
  const targetDir = String(successDir ?? "").trim();
  if (!sourcePath || !targetDir) throw new Error("spool complete defective: missing runtime/success");
  return moveWithUniqueName(sourcePath, targetDir);
}

export async function failSpoolItem({
  runtimePath,
  failDir,
  requeueDir = "",
  retryCount = 0,
  maxRetries = 0
} = {}) {
  const sourcePath = String(runtimePath ?? "").trim();
  if (!sourcePath) throw new Error("spool fail defective: missing runtime path");
  const retries = Math.max(0, Math.trunc(Number(retryCount) || 0));
  const max = Math.max(0, Math.trunc(Number(maxRetries) || 0));
  if (requeueDir && retries < max) {
    const requeueName = clampFilenameLength(stripWorkerSuffixes(path.basename(sourcePath)));
    return moveWithUniqueName(sourcePath, String(requeueDir), { preferredName: requeueName });
  }
  const targetDir = String(failDir ?? "").trim();
  if (!targetDir) throw new Error("spool fail defective: missing fail dir");
  return moveWithUniqueName(sourcePath, targetDir);
}
