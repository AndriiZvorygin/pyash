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

export async function directory(sentence, { remember: rememberFn = remember } = {}) {
  const target = resolveFilename(sentence?.ob, { rememberFn });
  if (!target) {
    throwErrorSentence({
      name: "directory target missing",
      message: "directory target missing",
      from: { name: "directory" },
      raw: { sentence }
    });
  }
  const resolved = path.resolve(String(target));
  try {
    await fs.mkdir(resolved, { recursive: true });
  } catch (err) {
    throwErrorSentence({
      name: "directory defective",
      message: `directory defective: ${resolved}`,
      from: { name: "directory" },
      raw: { error: err?.message }
    });
  }
  let stats;
  try {
    stats = await fs.stat(resolved);
  } catch (err) {
    throwErrorSentence({
      name: "directory defective",
      message: `directory defective: ${resolved}`,
      from: { name: "directory" },
      raw: { error: err?.message }
    });
  }
  if (!stats?.isDirectory?.()) {
    throwErrorSentence({
      name: "directory defective",
      message: `directory defective: ${resolved}`,
      from: { name: "directory" },
      raw: { resolved }
    });
  }
  return { ob: { filename: resolved }, be: "directory" };
}

export default directory;

export const signatures = [
  { signatureWords: ["be", "directory", "ob", "filename"], handler: directory },
  { signatureWords: ["be", "directory", "ob", "name", "filename"], handler: directory },
  { signatureWords: ["be", "directory", "ob", "text"], handler: directory },
  { signatureWords: ["be", "directory", "ob", "name", "text"], handler: directory }
];
