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

export async function exists(sentence, { remember: rememberFn = remember } = {}) {
  const target = resolveFilename(sentence?.ob, { rememberFn });
  if (!target) {
    throwErrorSentence({
      name: "exists target missing",
      message: "exists target missing",
      from: { name: "exists" },
      raw: { sentence }
    });
  }
  const resolved = path.resolve(String(target));
  try {
    await fs.access(resolved);
    return { ob: { bool: true }, be: "exists" };
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { ob: { bool: false }, be: "exists" };
    }
    throwErrorSentence({
      name: "exists defective",
      message: `exists defective: ${resolved}`,
      from: { name: "exists" },
      raw: { error: err?.message }
    });
  }
}

export default exists;

export const signatures = [
  { signatureWords: ["be", "exists", "ob", "filename"], handler: exists },
  { signatureWords: ["be", "exists", "ob", "name", "filename"], handler: exists },
  { signatureWords: ["be", "exists", "ob", "text"], handler: exists },
  { signatureWords: ["be", "exists", "ob", "name", "text"], handler: exists }
];
