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

export async function del(sentence, { remember: rememberFn = remember } = {}) {
  const target = resolveFilename(sentence?.ob, { rememberFn });
  if (!target) {
    throwErrorSentence({
      name: "delete target missing",
      message: "delete target missing",
      from: { name: "delete" },
      raw: { sentence }
    });
  }
  const resolved = path.resolve(String(target));
  let stats;
  try {
    stats = await fs.stat(resolved);
  } catch (err) {
    throwErrorSentence({
      name: "delete target missing",
      message: `delete target missing: ${resolved}`,
      from: { name: "delete" },
      raw: { error: err?.message }
    });
  }
  if (!stats?.isFile?.()) {
    if (!stats?.isDirectory?.()) {
      throwErrorSentence({
        name: "delete target defective",
        message: `delete target defective: ${resolved}`,
        from: { name: "delete" },
        raw: { resolved }
      });
    }
    const recursive = sentence?.as?.wo === "recursive";
    if (!recursive) {
      throwErrorSentence({
        name: "delete target defective",
        message: `delete target defective: ${resolved}`,
        from: { name: "delete" },
        raw: { resolved }
      });
    }
    try {
      await fs.rm(resolved, { recursive: true, force: false });
    } catch (err) {
      throwErrorSentence({
        name: "delete defective",
        message: `delete defective: ${resolved}`,
        from: { name: "delete" },
        raw: { error: err?.message }
      });
    }
    return { ob: { filename: resolved }, be: "delete" };
  }
  try {
    await fs.unlink(resolved);
  } catch (err) {
    throwErrorSentence({
      name: "delete defective",
      message: `delete defective: ${resolved}`,
      from: { name: "delete" },
      raw: { error: err?.message }
    });
  }
  return { ob: { filename: resolved }, be: "delete" };
}

export default del;

export const signatures = [
  { signatureWords: ["be", "delete", "ob", "filename"], handler: del },
  { signatureWords: ["be", "delete", "ob", "name", "filename"], handler: del },
  { signatureWords: ["be", "delete", "ob", "text"], handler: del },
  { signatureWords: ["be", "delete", "ob", "name", "text"], handler: del },
  { signatureWords: ["be", "delete", "as", "wo", "recursive", "ob", "filename"], handler: del },
  { signatureWords: ["be", "delete", "as", "wo", "recursive", "ob", "name", "filename"], handler: del },
  { signatureWords: ["be", "delete", "as", "wo", "recursive", "ob", "text"], handler: del },
  { signatureWords: ["be", "delete", "as", "wo", "recursive", "ob", "name", "text"], handler: del }
];
