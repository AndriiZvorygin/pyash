import fs from "node:fs/promises";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { recordArtifact, recordExchange } from "../bridge/exchange.mjs";
import { resolveAgentPath } from "../library/agent_cwd.mjs";

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

export async function copy(sentence, { remember: rememberFn = remember } = {}) {
  const src = resolveFilename(sentence?.ob, { rememberFn });
  const dest = resolveFilename(sentence?.to, { rememberFn });
  const modeRaw = sentence?.as?.wo;
  const mode = typeof modeRaw === "string" ? modeRaw.toLowerCase() : null;
  const recursive = mode === "recursive";
  if (!src || !dest) {
    throwErrorSentence({
      name: "copy target missing",
      message: "copy target missing",
      from: { name: "copy" },
      raw: { sentence }
    });
  }
  const resolvedSrc = path.resolve(src);
  const { resolved: resolvedDest, outside, agentCwd } = resolveAgentPath(dest, { rememberFn });
  if (outside) {
    throwErrorSentence({
      name: "copy defective",
      message: `copy defective: outside agent cwd (${agentCwd})`,
      from: { name: "copy" },
      raw: { dest }
    });
  }
  let stats;
  try {
    stats = await fs.stat(resolvedSrc);
  } catch (err) {
    throwErrorSentence({
      name: "copy source missing",
      message: `copy source missing: ${resolvedSrc}`,
      from: { name: "copy" },
      raw: { error: err?.message }
    });
  }
  const isFile = stats?.isFile?.();
  const isDir = stats?.isDirectory?.();
  if (!isFile && !(recursive && isDir)) {
    throwErrorSentence({
      name: "copy source defective",
      message: `copy source defective: ${resolvedSrc}`,
      from: { name: "copy" },
      raw: { resolvedSrc }
    });
  }
  if (resolvedSrc === resolvedDest) {
    return { ob: { filename: resolvedDest }, be: "copy" };
  }
  await fs.mkdir(path.dirname(resolvedDest), { recursive: true });
  if (isDir && recursive) {
    if (typeof fs.cp !== "function") {
      throwErrorSentence({
        name: "copy defective",
        message: "copy defective: recursive copy unsupported",
        from: { name: "copy" },
        raw: { resolvedSrc }
      });
    }
    await fs.cp(resolvedSrc, resolvedDest, { recursive: true, force: true });
  } else {
    await fs.copyFile(resolvedSrc, resolvedDest);
    try {
      const bytes = await fs.readFile(resolvedDest);
      const artifact = recordArtifact({ locator: resolvedDest, producer: "exchange", bytes });
      if (artifact?.su?.name) {
        recordExchange({ artifactName: artifact.su.name, op: "write", producer: "exchange" });
      }
    } catch {}
  }
  return { ob: { filename: resolvedDest }, be: "copy" };
}

export default copy;

export const signatures = [
  { signatureWords: ["be", "copy", "ob", "filename", "to", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "ob", "name", "filename", "to", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "ob", "filename", "to", "name", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "ob", "name", "filename", "to", "name", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "ob", "text", "to", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "ob", "text", "to", "name", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "as", "wo", "recursive", "ob", "filename", "to", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "as", "wo", "recursive", "ob", "name", "filename", "to", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "as", "wo", "recursive", "ob", "filename", "to", "name", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "as", "wo", "recursive", "ob", "name", "filename", "to", "name", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "as", "wo", "recursive", "ob", "text", "to", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "as", "wo", "recursive", "ob", "text", "to", "name", "filename"], handler: copy }
];
