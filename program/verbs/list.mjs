import fs from "node:fs/promises";
import path from "node:path";

import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { appendWorldActivity, derivePresence, ensureWorldDir, isWorldToolsActive, readActivityTail, resolveWorldAgent, resolveWorldPath, resolveWorldPlace, resolveWorldPlaceDir, resolveWorldRoot } from "../library/world.mjs";
import { schedulerList } from "../agent/scheduler_control.mjs";
import { listAgents } from "../agent/admin.mjs";

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

function asciiCompare(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

async function walkDir(root, options) {
  const entries = [];
  const includeFiles = options.filter === "file" || options.filter === "all";
  const includeDirs = options.filter === "dir" || options.filter === "all";

  async function visit(current, relBase) {
    const dirents = await fs.readdir(current, { withFileTypes: true });
    for (const dirent of dirents) {
      if (!options.hidden && dirent.name.startsWith(".")) continue;
      const fullPath = path.join(current, dirent.name);
      const relPath = relBase ? path.join(relBase, dirent.name) : dirent.name;
      const outputPath = options.recursive ? normalizePath(relPath) : dirent.name;
      if (dirent.isDirectory()) {
        if (includeDirs) entries.push(outputPath);
        if (options.recursive) {
          await visit(fullPath, relPath);
        }
        continue;
      }
      if (includeFiles) entries.push(outputPath);
    }
  }

  await visit(root, "");
  return entries.sort(asciiCompare);
}

function normalizeFilter(value) {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "file" || raw === "files") return "file";
  if (raw === "dir" || raw === "dirs" || raw === "directory") return "dir";
  return "all";
}

function isCalendarScope(sentence) {
  const raw = sentence?.from?.wo ?? sentence?.from?.text ?? sentence?.from?.name ?? "";
  const text = String(raw ?? "").trim().toLowerCase();
  return text === "calendar";
}

function isHouseScope(sentence) {
  const raw = sentence?.from?.wo ?? sentence?.from?.text ?? sentence?.from?.name ?? "";
  const text = String(raw ?? "").trim().toLowerCase();
  return text === "house";
}

function resolveSchedulerTarget(sentence) {
  if (typeof sentence?.su?.name === "string" && sentence.su.name.trim()) return sentence.su.name.trim();
  if (typeof sentence?.to?.name === "string" && sentence.to.name.trim()) return sentence.to.name.trim();
  return "";
}

export async function list(sentence, { remember: rememberFn = remember } = {}) {
  if (isHouseScope(sentence)) {
    const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
    const includeBase = String(sentence?.with?.wo ?? sentence?.with?.name ?? sentence?.with?.text ?? "").trim().toLowerCase() === "base";
    const names = await listAgents({ worldRoot, includeBase });
    const target = resolveSchedulerTarget(sentence).toLowerCase();
    if (target) {
      const hit = names.filter(name => String(name).toLowerCase() === target);
      return { ob: { ve: { type: "text", values: hit } }, be: "list" };
    }
    return { ob: { ve: { type: "text", values: names } }, be: "list" };
  }
  if (isCalendarScope(sentence)) {
    const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
    const result = await schedulerList({ worldRoot });
    const target = resolveSchedulerTarget(sentence).toLowerCase();
    if (target && target !== "scheduler" && target !== "scheduler daemon") {
      const hit = result.services.filter(name => String(name).toLowerCase() === target);
      return { ob: { ve: { type: "text", values: hit } }, be: "list" };
    }
    return { ob: { ve: { type: "text", values: result.services } }, be: "list" };
  }

  const worldMode = isWorldToolsActive({ rememberFn });
  const rootRaw = resolveFilename(sentence?.from, { rememberFn }) || ".";
  const root = worldMode
    ? (() => {
      if (sentence?.from) {
        const { resolved, outside, root: worldRoot } = resolveWorldPath(rootRaw, { rememberFn });
        if (outside) {
          throwErrorSentence({
            name: "list defective",
            message: `list defective: outside world root (${worldRoot})`,
            from: { name: "list" },
            raw: { root: rootRaw }
          });
        }
        return resolved;
      }
      const place = resolveWorldPlace({ rememberFn }) ?? "commons";
      return resolveWorldPlaceDir(place, { rememberFn }) ?? path.resolve(String(rootRaw));
    })()
    : path.resolve(String(rootRaw));
  const hiddenToken = sentence?.with?.name ?? sentence?.with?.text ?? sentence?.with?.wo;
  const hidden = hiddenToken === "hidden";
  const mode = sentence?.as?.wo;
  const recursive = mode === "recursive";
  const filter = recursive ? "all" : normalizeFilter(mode);

  if (worldMode && root) {
    await ensureWorldDir(root);
  }
  let stats;
  try {
    stats = await fs.stat(root);
  } catch (err) {
    throwErrorSentence({
      name: "list defective",
      message: `list defective: ${root}`,
      from: { name: "list" },
      raw: { error: err?.message }
    });
  }
  if (!stats?.isDirectory?.()) {
    throwErrorSentence({
      name: "list defective",
      message: `list defective: ${root}`,
      from: { name: "list" },
      raw: { root }
    });
  }

  let entries;
  try {
    entries = await walkDir(root, { filter, hidden, recursive });
  } catch (err) {
    throwErrorSentence({
      name: "list defective",
      message: `list defective: ${root}`,
      from: { name: "list" },
      raw: { error: err?.message }
    });
  }

  if (!entries.length) {
    if (!worldMode) return { ob: { ve: { type: "hollow", values: [] } }, be: "list" };
  }
  if (worldMode) {
    const place = resolveWorldPlace({ rememberFn }) ?? "commons";
    const placeDir = resolveWorldPlaceDir(place, { rememberFn });
    const activity = await readActivityTail({ placeDir });
    const presence = derivePresence(activity);
    const mapName = sentence?.to?.name ?? "world list";
    doRemember({
      mood: "ya",
      su: { name: mapName },
      be: "map",
      ob: {
        map: {
          entries: { mood: "ya", su: { name: "entries" }, ob: { ve: { type: "text", values: entries } }, be: "vector" },
          presence: { mood: "ya", su: { name: "presence" }, ob: { ve: { type: "text", values: presence } }, be: "vector" },
          place: { mood: "ya", su: { name: "place" }, ob: { text: String(place) }, be: "text" }
        }
      }
    });
    const agent = resolveWorldAgent({ rememberFn });
    if (agent && placeDir) {
      await appendWorldActivity({
        placeDir,
        sentence: {
          mood: "ya",
          su: { name: agent },
          at: { date: new Date().toISOString() },
          be: "list"
        }
      });
    }
    const wantsMap = sentence?.as?.wo === "map" || sentence?.as?.text === "map" || sentence?.as?.name === "map";
    if (wantsMap) {
      return { ob: { name: mapName }, be: "list" };
    }
    return { ob: { ve: { type: "text", values: entries } }, be: "list" };
  }
  return { ob: { ve: { type: "text", values: entries } }, be: "list" };
}

export default list;

export const signatures = [
  { signatureWords: ["be", "list"], handler: list },
  { signatureWords: ["be", "list", "from", "wo", "house"], handler: list },
  { signatureWords: ["be", "list", "from", "wo", "house", "with", "wo", "base"], handler: list },
  { signatureWords: ["be", "list", "from", "wo", "house", "to", "name", "num"], handler: list },
  { signatureWords: ["be", "list", "from", "wo", "house", "to", "name", "text"], handler: list },
  { signatureWords: ["be", "list", "from", "wo", "house", "to", "name", "map"], handler: list },
  { signatureWords: ["be", "list", "from", "wo", "calendar"], handler: list },
  { signatureWords: ["be", "list", "from", "filename"], handler: list },
  { signatureWords: ["be", "list", "from", "name", "filename"], handler: list },
  { signatureWords: ["be", "list", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "from", "filename", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "from", "name", "filename", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "file"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "dir"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "all"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "recursive"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "file", "from", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "dir", "from", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "all", "from", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "recursive", "from", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "file", "from", "name", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "dir", "from", "name", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "all", "from", "name", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "recursive", "from", "name", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "file", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "dir", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "all", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "recursive", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "file", "with", "name", "hidden", "from", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "dir", "with", "name", "hidden", "from", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "all", "with", "name", "hidden", "from", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "recursive", "with", "name", "hidden", "from", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "file", "with", "name", "hidden", "from", "name", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "dir", "with", "name", "hidden", "from", "name", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "all", "with", "name", "hidden", "from", "name", "filename"], handler: list },
  { signatureWords: ["be", "list", "as", "wo", "recursive", "with", "name", "hidden", "from", "name", "filename"], handler: list },
  { signatureWords: ["be", "list", "from", "filename", "as", "wo", "file"], handler: list },
  { signatureWords: ["be", "list", "from", "filename", "as", "wo", "dir"], handler: list },
  { signatureWords: ["be", "list", "from", "filename", "as", "wo", "all"], handler: list },
  { signatureWords: ["be", "list", "from", "filename", "as", "wo", "recursive"], handler: list },
  { signatureWords: ["be", "list", "from", "filename", "as", "wo", "file", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "from", "filename", "as", "wo", "dir", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "from", "filename", "as", "wo", "all", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "from", "filename", "as", "wo", "recursive", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "from", "name", "filename", "as", "wo", "file"], handler: list },
  { signatureWords: ["be", "list", "from", "name", "filename", "as", "wo", "dir"], handler: list },
  { signatureWords: ["be", "list", "from", "name", "filename", "as", "wo", "all"], handler: list },
  { signatureWords: ["be", "list", "from", "name", "filename", "as", "wo", "recursive"], handler: list },
  { signatureWords: ["be", "list", "from", "name", "filename", "as", "wo", "file", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "from", "name", "filename", "as", "wo", "dir", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "from", "name", "filename", "as", "wo", "all", "with", "name", "hidden"], handler: list },
  { signatureWords: ["be", "list", "from", "name", "filename", "as", "wo", "recursive", "with", "name", "hidden"], handler: list }
];
