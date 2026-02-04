import fs from "node:fs/promises";
import path from "node:path";

import { remember, doRemember } from "../remember/index.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { parse } from "../understand/index.mjs";
import { splitSentences } from "./sentenceSplitter.mjs";

const DEFAULT_WORLD_DIRNAME = "world";
const DEFAULT_PRESENCE_LIMIT = 20;

export function isWorldToolsActive({ rememberFn } = {}) {
  if (typeof rememberFn !== "function") return false;
  const flag = rememberFn("world tools");
  return flag?.ob?.boolean === true;
}

export function resolveWorldRoot({ rememberFn } = {}) {
  if (typeof rememberFn !== "function") return null;
  const fact = rememberFn("world root");
  const raw = fact?.ob?.filename ?? fact?.ob?.text ?? fact?.ob?.name ?? null;
  if (raw) return path.resolve(String(raw));
  if (!isWorldToolsActive({ rememberFn })) return null;
  return path.resolve(process.cwd(), DEFAULT_WORLD_DIRNAME);
}

export function resolveWorldAgent({ rememberFn } = {}) {
  if (typeof rememberFn !== "function") return null;
  const fact = rememberFn("world agent");
  return fact?.ob?.name ?? fact?.ob?.text ?? null;
}

export function resolveWorldPlace({ rememberFn } = {}) {
  if (typeof rememberFn !== "function") return null;
  const fact = rememberFn("world place");
  return fact?.ob?.name ?? fact?.ob?.text ?? null;
}

export function setWorldPlace(place, { doRememberFn } = {}) {
  const rememberImpl = typeof doRememberFn === "function" ? doRememberFn : doRemember;
  const normalized = path.basename(String(place ?? ""));
  rememberImpl({
    mood: "ya",
    su: { name: "world place" },
    be: "text",
    ob: { text: normalized }
  });
}

export function resolveWorldPlaceDir(place, { rememberFn } = {}) {
  const root = resolveWorldRoot({ rememberFn });
  if (!root || !place) return null;
  return path.join(root, String(place));
}

export function resolveWorldPath(target, { rememberFn } = {}) {
  const raw = target ?? "";
  const root = resolveWorldRoot({ rememberFn });
  if (!root) {
    return { resolved: path.resolve(String(raw)), root: null, outside: false };
  }
  const resolved = path.isAbsolute(String(raw))
    ? path.resolve(String(raw))
    : path.resolve(root, String(raw));
  const relative = path.relative(root, resolved);
  const outside = relative.startsWith("..") || path.isAbsolute(relative);
  return { resolved, root, outside };
}

export async function ensureWorldDir(dir) {
  if (!dir) return;
  await fs.mkdir(dir, { recursive: true });
}

export async function appendWorldActivity({ placeDir, sentence }) {
  if (!placeDir || !sentence) return;
  const activityPath = path.join(placeDir, ".activity.pya");
  const line = sentenceToPyash(sentence);
  if (!line) return;
  await fs.appendFile(activityPath, `${line}\n`, "utf8");
}

export async function readActivityTail({ placeDir, limit = DEFAULT_PRESENCE_LIMIT } = {}) {
  if (!placeDir) return [];
  const activityPath = path.join(placeDir, ".activity.pya");
  let text = "";
  try {
    text = await fs.readFile(activityPath, "utf8");
  } catch {
    return [];
  }
  const lines = splitSentences(text);
  const tail = limit > 0 ? lines.slice(-limit) : lines;
  const sentences = [];
  for (const line of tail) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const sentence = parse(trimmed);
      if (sentence) sentences.push(sentence);
    } catch {
      continue;
    }
  }
  return sentences;
}

export function derivePresence(sentences) {
  const seen = new Set();
  const present = [];
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const name = sentences[i]?.su?.name ?? sentences[i]?.su?.text;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    present.push(String(name));
  }
  return present;
}
