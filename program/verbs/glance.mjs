import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

function resolveFilename(value, { rememberFn } = {}) {
  if (!value) return "";
  if (typeof value.filename === "string") return value.filename;
  if (typeof value.text === "string") return value.text;
  if (value.name && rememberFn) {
    const fact = rememberFn(value.name);
    if (typeof fact?.ob?.filename === "string") return fact.ob.filename;
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return "";
}

function toIsoDate(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

const execFileAsync = promisify(execFile);

async function resolveUserName(uid) {
  if (typeof uid !== "number") return null;
  if (os.platform() === "win32") return null;
  try {
    const text = await fs.readFile("/etc/passwd", "utf8");
    const line = text.split("\n").find(row => row && row.split(":")[2] === String(uid));
    return line ? line.split(":")[0] : null;
  } catch {
    return null;
  }
}

async function resolveGroupName(gid) {
  if (typeof gid !== "number") return null;
  if (os.platform() === "win32") return null;
  try {
    const text = await fs.readFile("/etc/group", "utf8");
    const line = text.split("\n").find(row => row && row.split(":")[2] === String(gid));
    return line ? line.split(":")[0] : null;
  } catch {
    return null;
  }
}

async function resolveDescriptive(pathname) {
  try {
    const { stdout } = await execFileAsync("file", ["-b", pathname], { timeout: 2000 });
    const text = String(stdout ?? "").trim();
    return text || null;
  } catch {
    return null;
  }
}

function modeBitsToWords(mode) {
  if (typeof mode !== "number") return null;
  const flags = [
    { label: "owner", shift: 6 },
    { label: "flock", shift: 3 },
    { label: "all", shift: 0 }
  ];
  const words = [];
  for (const flag of flags) {
    words.push(flag.label);
    const mask = (mode >> flag.shift) & 0b111;
    words.push((mask & 0b100) ? "read" : "hollow");
    words.push((mask & 0b010) ? "write" : "hollow");
    words.push((mask & 0b001) ? "interpret" : "hollow");
  }
  return words;
}

function mapNameForPath(resolved) {
  const hash = crypto.createHash("sha256").update(String(resolved)).digest("hex").slice(0, 8);
  return `glance ${hash}`;
}

export async function glance(sentence, { remember: rememberFn = remember } = {}) {
  const target = resolveFilename(sentence?.ob, { rememberFn });
  if (!target) {
    throwErrorSentence({
      name: "glance target missing",
      message: "glance target missing",
      from: { name: "glance" },
      raw: { sentence }
    });
  }
  const resolved = path.resolve(String(target));
  let stats;
  try {
    stats = await fs.stat(resolved);
  } catch (err) {
    throwErrorSentence({
      name: "glance defective",
      message: `glance defective: ${resolved}`,
      from: { name: "glance" },
      raw: { error: err?.message }
    });
  }
  const kind = stats?.isDirectory?.() ? "directory" : "file";
  const permissions = modeBitsToWords(stats?.mode);
  const map = {
    magnitude: { num: stats.size },
    "improve time": { text: toIsoDate(stats.mtime) },
    sort: { text: kind }
  };
  if (permissions) {
    map.license = { ve: { type: "text", values: permissions } };
  }
  const ownerName = await resolveUserName(stats.uid);
  if (ownerName) {
    map.owner = { text: ownerName };
  } else if (typeof stats.uid === "number") {
    map.owner = { num: stats.uid };
  }
  const groupName = await resolveGroupName(stats.gid);
  if (groupName) {
    map.flock = { text: groupName };
  } else if (typeof stats.gid === "number") {
    map.flock = { num: stats.gid };
  }
  const ctime = toIsoDate(stats.ctime);
  if (ctime) {
    map["license time"] = { text: ctime };
  }
  const descriptive = await resolveDescriptive(resolved);
  if (descriptive) {
    map.descriptive = { text: descriptive };
  }
  const mapName = mapNameForPath(resolved);
  doRemember({ mood: "ya", su: { name: mapName }, be: "map", ob: { map } });
  return { ob: { name: mapName }, be: "glance" };
}

export default glance;

export const signatures = [
  { signatureWords: ["be", "glance", "ob", "filename"], handler: glance },
  { signatureWords: ["be", "glance", "ob", "name", "filename"], handler: glance },
  { signatureWords: ["be", "glance", "ob", "text"], handler: glance },
  { signatureWords: ["be", "glance", "ob", "name", "text"], handler: glance }
];
