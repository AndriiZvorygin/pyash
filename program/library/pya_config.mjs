import fs from "node:fs";

import { parse } from "../understand/index.mjs";
import { splitSentences } from "./sentenceSplitter.mjs";

function safeParse(line) {
  try {
    return parse(line);
  } catch {
    return null;
  }
}

export function readPyaTextValues(filePath, wantedNames = []) {
  const names = Array.isArray(wantedNames) ? wantedNames.map((value) => String(value || "").trim()) : [];
  const wanted = new Set(names.filter(Boolean).map((name) => name.toLowerCase()));
  const out = Object.create(null);
  for (const name of names) out[name] = "";

  if (!filePath || !fs.existsSync(filePath)) return out;
  const source = fs.readFileSync(filePath, "utf8");
  const noComments = source.split(/\r?\n/u).filter((line) => !/^\s*#/u.test(line)).join("\n");
  for (const raw of splitSentences(noComments, { includeThen: true })) {
    const sentence = safeParse(String(raw || "").trim());
    const suName = String(sentence?.su?.name || "").trim();
    if (!suName || !wanted.has(suName.toLowerCase())) continue;
    const text = String(sentence?.ob?.text || sentence?.as?.text || "").trim();
    if (text) out[suName] = text;
  }
  return out;
}
