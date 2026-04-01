import fs from "node:fs";

import { parse } from "../program/understand/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

function safeParse(line) {
  try {
    return parse(line);
  } catch {
    return null;
  }
}

export function readPyaTextValues(filePath, wantedNames = []) {
  const names = Array.isArray(wantedNames) ? wantedNames.map((x) => String(x || "").trim()) : [];
  const wanted = new Set(names.filter(Boolean).map((x) => x.toLowerCase()));
  const out = Object.create(null);
  for (const n of names) out[n] = "";

  if (!filePath || !fs.existsSync(filePath)) return out;
  const src = fs.readFileSync(filePath, "utf8");
  const noComments = String(src)
    .split(/\r?\n/u)
    .filter((line) => !/^\s*#/u.test(line))
    .join("\n");
  const lines = splitSentences(noComments, { includeThen: true });

  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line) continue;
    const s = safeParse(line);
    if (!s) continue;
    const suName = String(s?.su?.name || "").trim();
    if (!suName || !wanted.has(suName.toLowerCase())) continue;
    const text = String(s?.ob?.text || "").trim();
    if (!text) continue;
    out[suName] = text;
  }
  return out;
}

