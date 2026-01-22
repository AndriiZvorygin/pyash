import fs from "node:fs/promises";
import path from "node:path";

import { remember } from "../remember/index.mjs";
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
    magnitude: stats.size,
    "improve time": toIsoDate(stats.mtime),
    sort: kind
  };
  if (permissions) {
    map.license = { ve: { values: permissions } };
  }
  if (typeof stats.uid === "number") {
    map.owner = stats.uid;
  }
  if (typeof stats.gid === "number") {
    map.flock = stats.gid;
  }
  const ctime = toIsoDate(stats.ctime);
  if (ctime) {
    map["license time"] = ctime;
  }
  return { ob: { map }, be: "glance" };
}

export default glance;

export const signatures = [
  { signatureWords: ["be", "glance", "ob", "filename"], handler: glance },
  { signatureWords: ["be", "glance", "ob", "name", "filename"], handler: glance },
  { signatureWords: ["be", "glance", "ob", "text"], handler: glance },
  { signatureWords: ["be", "glance", "ob", "name", "text"], handler: glance }
];
