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

function resolveText(value, { rememberFn } = {}) {
  if (!value) return "";
  if (typeof value.text === "string") return value.text;
  if (value.name && rememberFn) {
    const fact = rememberFn(value.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return "";
}

async function listFiles(root) {
  const stats = await fs.stat(root);
  if (stats.isFile()) return [root];
  if (!stats.isDirectory()) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFiles(next);
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(next);
    }
  }
  return files;
}

export async function search(sentence, { remember: rememberFn = remember } = {}) {
  const pattern = resolveText(sentence?.ob, { rememberFn });
  const target = resolveFilename(sentence?.in ?? sentence?.inside, { rememberFn });
  if (!pattern) {
    throwErrorSentence({
      name: "search pattern missing",
      message: "search pattern missing",
      from: { name: "search" },
      raw: { sentence }
    });
  }
  if (!target) {
    throwErrorSentence({
      name: "search target missing",
      message: "search target missing",
      from: { name: "search" },
      raw: { sentence }
    });
  }
  const resolved = path.resolve(String(target));
  let files;
  try {
    files = await listFiles(resolved);
  } catch (err) {
    throwErrorSentence({
      name: "search defective",
      message: `search defective: ${resolved}`,
      from: { name: "search" },
      raw: { error: err?.message }
    });
  }
  const regex = new RegExp(pattern, "i");
  const matches = [];
  for (const file of files) {
    let contents;
    try {
      contents = await fs.readFile(file, "utf8");
    } catch (err) {
      throwErrorSentence({
        name: "search defective",
        message: `search defective: ${file}`,
        from: { name: "search" },
        raw: { error: err?.message }
      });
    }
    const lines = contents.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (regex.test(lines[i])) {
        matches.push(`${file}:${i + 1}:${lines[i]}`);
      }
    }
  }
  matches.sort((a, b) => a.localeCompare(b));
  return { ob: { text: matches.join("\n") }, be: "search" };
}

export default search;

export const signatures = [
  { signatureWords: ["be", "search", "ob", "text", "in", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "name", "text", "in", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "text", "in", "name", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "name", "text", "in", "name", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "text", "inside", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "name", "text", "inside", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "text", "inside", "name", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "name", "text", "inside", "name", "filename"], handler: search },
  { signatureWords: ["be", "search", "in", "filename", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "in", "filename", "ob", "name", "text"], handler: search },
  { signatureWords: ["be", "search", "in", "name", "filename", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "in", "name", "filename", "ob", "name", "text"], handler: search },
  { signatureWords: ["be", "search", "inside", "filename", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "inside", "filename", "ob", "name", "text"], handler: search },
  { signatureWords: ["be", "search", "inside", "name", "filename", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "inside", "name", "filename", "ob", "name", "text"], handler: search }
];
