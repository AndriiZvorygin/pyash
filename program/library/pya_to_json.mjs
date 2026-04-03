import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../understand/index.mjs";
import { interpret } from "../bridge/index.mjs";
import { forget, allRemember, dumpSandpits } from "../remember/index.mjs";
import { splitSentences } from "./sentenceSplitter.mjs";

export function pyaStripComments(text = "") {
  return String(text)
    .split(/\r?\n/u)
    .filter((line) => !/^\s*#/u.test(line))
    .join("\n");
}

export function pyaToPlainValue(node) {
  if (!node || typeof node !== "object") return node ?? null;
  if (Object.hasOwn(node, "text")) return String(node.text ?? "");
  if (Object.hasOwn(node, "num")) {
    const n = Number(node.num);
    return Number.isFinite(n) ? n : null;
  }
  if (Object.hasOwn(node, "filename")) return String(node.filename ?? "");
  if (Object.hasOwn(node, "name")) return String(node.name ?? "");
  if (Object.hasOwn(node, "map")) return pyaToPlainValue(node.map);
  if (Array.isArray(node.series)) return node.series.map((v) => pyaToPlainValue(v));
  if (node.map && typeof node.map === "object") return pyaToPlainMap(node.map);
  return null;
}

export function pyaToPlainMap(mapNode) {
  const out = {};
  if (!mapNode || typeof mapNode !== "object") return out;
  for (const [key, raw] of Object.entries(mapNode)) {
    out[key] = pyaToPlainValue(raw);
  }
  return out;
}

export function pyaBuildIndex(memory = []) {
  const byName = {};
  for (const sentence of Array.isArray(memory) ? memory : []) {
    const key = String(sentence?.su?.name || "").trim();
    if (!key) continue;
    byName[key] = {
      be: sentence?.be ?? "",
      ob: pyaToPlainValue(sentence?.ob),
      raw: sentence,
    };
  }
  return byName;
}

export async function pyaTextToJson(text, { memoryOnly = false } = {}) {
  const src = pyaStripComments(text);
  forget();
  const lines = splitSentences(src, { includeThen: true });
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line) continue;
    const sentence = parse(line);
    await interpret(sentence);
  }

  const memory = allRemember();
  if (memoryOnly) return { memory };
  return {
    memory,
    sandpits: dumpSandpits(),
    index: pyaBuildIndex(memory),
  };
}

export async function pyaFileToJson(filePath, opts = {}) {
  const p = path.resolve(filePath);
  const src = await fs.readFile(p, "utf8");
  return pyaTextToJson(src, opts);
}

