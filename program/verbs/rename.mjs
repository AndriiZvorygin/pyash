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

export async function rename(sentence, { remember: rememberFn = remember } = {}) {
  const source = resolveFilename(sentence?.ob, { rememberFn });
  const dest = resolveFilename(sentence?.to, { rememberFn });
  if (!source || !dest) {
    throwErrorSentence({
      name: "rename target missing",
      message: "rename target missing",
      from: { name: "rename" },
      raw: { sentence }
    });
  }
  const resolvedSource = path.resolve(String(source));
  const resolvedDest = path.resolve(String(dest));
  try {
    await fs.stat(resolvedSource);
  } catch (err) {
    throwErrorSentence({
      name: "rename target missing",
      message: `rename target missing: ${resolvedSource}`,
      from: { name: "rename" },
      raw: { error: err?.message }
    });
  }
  try {
    await fs.mkdir(path.dirname(resolvedDest), { recursive: true });
    await fs.rm(resolvedDest, { recursive: true, force: true });
    await fs.rename(resolvedSource, resolvedDest);
  } catch (err) {
    throwErrorSentence({
      name: "rename defective",
      message: `rename defective: ${resolvedSource} -> ${resolvedDest}`,
      from: { name: "rename" },
      raw: { error: err?.message }
    });
  }
  return { ob: { filename: resolvedDest }, be: "rename" };
}

export default rename;

export const signatures = [
  { signatureWords: ["be", "rename", "ob", "filename", "to", "filename"], handler: rename },
  { signatureWords: ["be", "rename", "ob", "name", "filename", "to", "filename"], handler: rename },
  { signatureWords: ["be", "rename", "ob", "filename", "to", "name", "filename"], handler: rename },
  { signatureWords: ["be", "rename", "ob", "name", "filename", "to", "name", "filename"], handler: rename },
  { signatureWords: ["be", "rename", "ob", "text", "to", "text"], handler: rename },
  { signatureWords: ["be", "rename", "ob", "name", "text", "to", "text"], handler: rename },
  { signatureWords: ["be", "rename", "ob", "text", "to", "name", "text"], handler: rename },
  { signatureWords: ["be", "rename", "ob", "name", "text", "to", "name", "text"], handler: rename }
];
