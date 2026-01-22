import fs from "node:fs/promises";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { recordArtifact, recordExchange } from "../bridge/exchange.mjs";

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
  if (!src || !dest) {
    throwErrorSentence({
      name: "copy target missing",
      message: "copy target missing",
      from: { name: "copy" },
      raw: { sentence }
    });
  }
  const resolvedSrc = path.resolve(src);
  const resolvedDest = path.resolve(dest);
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
  if (!stats?.isFile?.()) {
    throwErrorSentence({
      name: "copy source defective",
      message: `copy source defective: ${resolvedSrc}`,
      from: { name: "copy" },
      raw: { resolvedSrc }
    });
  }
  await fs.mkdir(path.dirname(resolvedDest), { recursive: true });
  await fs.copyFile(resolvedSrc, resolvedDest);
  try {
    const bytes = await fs.readFile(resolvedDest);
    const artifact = recordArtifact({ locator: resolvedDest, producer: "exchange", bytes });
    if (artifact?.su?.name) {
      recordExchange({ artifactName: artifact.su.name, op: "write", producer: "exchange" });
    }
  } catch {}
  return { ob: { filename: resolvedDest }, be: "copy" };
}

export default copy;

export const signatures = [
  { signatureWords: ["be", "copy", "ob", "filename", "to", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "ob", "name", "filename", "to", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "ob", "filename", "to", "name", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "ob", "name", "filename", "to", "name", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "ob", "text", "to", "filename"], handler: copy },
  { signatureWords: ["be", "copy", "ob", "text", "to", "name", "filename"], handler: copy }
];
