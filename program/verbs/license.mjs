import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

const execFileAsync = promisify(execFile);

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

async function resolveUserId(name) {
  if (typeof name !== "string") return null;
  if (/^\d+$/.test(name)) return Number(name);
  if (os.platform() === "win32") return null;
  try {
    const text = await fs.readFile("/etc/passwd", "utf8");
    const line = text.split("\n").find(row => row && row.split(":")[0] === name);
    return line ? Number(line.split(":")[2]) : null;
  } catch {
    return null;
  }
}

async function resolveGroupId(name) {
  if (typeof name !== "string") return null;
  if (/^\d+$/.test(name)) return Number(name);
  if (os.platform() === "win32") return null;
  try {
    const text = await fs.readFile("/etc/group", "utf8");
    const line = text.split("\n").find(row => row && row.split(":")[0] === name);
    return line ? Number(line.split(":")[2]) : null;
  } catch {
    return null;
  }
}

function parsePermissionsVector(values) {
  const groups = { owner: null, flock: null, all: null };
  let current = null;
  for (const raw of values) {
    const token = String(raw ?? "");
    if (token === "owner" || token === "flock" || token === "all") {
      current = token;
      groups[current] = [];
      continue;
    }
    if (!current) return null;
    groups[current].push(token);
  }
  if (!groups.owner && !groups.flock && !groups.all) return null;
  return groups;
}

function bitsFromTokens(tokens) {
  if (!Array.isArray(tokens)) return 0;
  let bits = 0;
  if (tokens.includes("read")) bits |= 0b100;
  if (tokens.includes("write")) bits |= 0b010;
  if (tokens.includes("command")) bits |= 0b001;
  return bits;
}

function modeFromGroups(groups) {
  const owner = bitsFromTokens(groups.owner);
  const flock = bitsFromTokens(groups.flock);
  const all = bitsFromTokens(groups.all);
  return (owner << 6) | (flock << 3) | all;
}

function modeFromSingle(tokens, label) {
  const bits = bitsFromTokens(tokens);
  if (label === "owner") return bits << 6;
  if (label === "flock") return bits << 3;
  if (label === "all") return bits;
  return bits;
}

export async function license(sentence, { remember: rememberFn = remember } = {}) {
  const target = resolveFilename(sentence?.ob, { rememberFn });
  if (!target) {
    throwErrorSentence({
      name: "license target missing",
      message: "license target missing",
      from: { name: "license" },
      raw: { sentence }
    });
  }
  const resolved = path.resolve(String(target));
  const ownerName = sentence?.to?.name ?? sentence?.to?.text;
  const groupName = sentence?.among?.name ?? sentence?.among?.text;
  if (ownerName || groupName) {
    const uid = await resolveUserId(String(ownerName ?? ""));
    const gid = await resolveGroupId(String(groupName ?? ""));
    if (uid === null || gid === null) {
      throwErrorSentence({
        name: "license defective",
        message: `license defective: ${resolved}`,
        from: { name: "license" },
        raw: { ownerName, groupName }
      });
    }
    try {
      await fs.chown(resolved, uid, gid);
    } catch (err) {
      throwErrorSentence({
        name: "license defective",
        message: `license defective: ${resolved}`,
        from: { name: "license" },
        raw: { error: err?.message }
      });
    }
    return { ob: { filename: resolved }, be: "license" };
  }

  const modeNum = sentence?.as?.num;
  if (typeof modeNum === "number") {
    const modeRaw = String(modeNum);
    const mode = /^[0-7]+$/.test(modeRaw) ? parseInt(modeRaw, 8) : modeNum;
    try {
      await fs.chmod(resolved, mode);
    } catch (err) {
      throwErrorSentence({
        name: "license defective",
        message: `license defective: ${resolved}`,
        from: { name: "license" },
        raw: { error: err?.message }
      });
    }
    return { ob: { filename: resolved }, be: "license" };
  }

  const modeText = sentence?.as?.text;
  if (typeof modeText === "string" && modeText.trim()) {
    try {
      await execFileAsync("chmod", [modeText, resolved], { timeout: 2000 });
    } catch (err) {
      throwErrorSentence({
        name: "license defective",
        message: `license defective: ${resolved}`,
        from: { name: "license" },
        raw: { error: err?.message }
      });
    }
    return { ob: { filename: resolved }, be: "license" };
  }

  const values = sentence?.as?.ve?.values;
  if (Array.isArray(values) && values.length > 0) {
    const vecType = sentence?.as?.ve?.type;
    const prefix = (typeof vecType === "string" && !["num", "text", "bool", "name", "filename"].includes(vecType))
      ? [vecType]
      : [];
    const merged = [...prefix, ...values];
    const groups = parsePermissionsVector(merged);
    const scope = sentence?.for?.name ?? sentence?.for?.text;
    let mode;
    if (groups) {
      mode = modeFromGroups(groups);
    } else if (scope === "owner" || scope === "flock" || scope === "all") {
      mode = modeFromSingle(merged, scope);
    }
    if (mode === undefined) {
      throwErrorSentence({
        name: "license defective",
        message: `license defective: ${resolved}`,
        from: { name: "license" },
        raw: { values, scope }
      });
    }
    try {
      await fs.chmod(resolved, mode);
    } catch (err) {
      throwErrorSentence({
        name: "license defective",
        message: `license defective: ${resolved}`,
        from: { name: "license" },
        raw: { error: err?.message }
      });
    }
    return { ob: { filename: resolved }, be: "license" };
  }

  throwErrorSentence({
    name: "license target missing",
    message: "license target missing",
    from: { name: "license" },
    raw: { sentence }
  });
}

export default license;

export const signatures = [
  { signatureWords: ["be", "license", "ob", "filename", "to", "name", "among", "name"], handler: license },
  { signatureWords: ["be", "license", "ob", "name", "filename", "to", "name", "among", "name"], handler: license },
  { signatureWords: ["be", "license", "ob", "filename", "as", "num"], handler: license },
  { signatureWords: ["be", "license", "ob", "name", "filename", "as", "num"], handler: license },
  { signatureWords: ["be", "license", "as", "num", "ob", "filename"], handler: license },
  { signatureWords: ["be", "license", "as", "num", "ob", "name", "filename"], handler: license },
  { signatureWords: ["be", "license", "ob", "filename", "as", "text"], handler: license },
  { signatureWords: ["be", "license", "ob", "name", "filename", "as", "text"], handler: license },
  { signatureWords: ["be", "license", "ob", "filename", "as", "vec"], handler: license },
  { signatureWords: ["be", "license", "ob", "name", "filename", "as", "vec"], handler: license },
  { signatureWords: ["be", "license", "as", "vec", "ob", "filename"], handler: license },
  { signatureWords: ["be", "license", "as", "vec", "ob", "name", "filename"], handler: license },
  { signatureWords: ["be", "license", "ob", "filename", "as", "vec", "for", "name"], handler: license },
  { signatureWords: ["be", "license", "ob", "name", "filename", "as", "vec", "for", "name"], handler: license },
  { signatureWords: ["be", "license", "as", "vec", "for", "name", "ob", "filename"], handler: license },
  { signatureWords: ["be", "license", "as", "vec", "for", "name", "ob", "name", "filename"], handler: license },
  { signatureWords: ["be", "license", "ob", "filename", "as", "vec", "owner"], handler: license },
  { signatureWords: ["be", "license", "ob", "name", "filename", "as", "vec", "owner"], handler: license },
  { signatureWords: ["be", "license", "as", "vec", "owner", "ob", "filename"], handler: license },
  { signatureWords: ["be", "license", "as", "vec", "owner", "ob", "name", "filename"], handler: license }
];
