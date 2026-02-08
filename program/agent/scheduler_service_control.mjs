import fs from "node:fs/promises";
import path from "node:path";

import { splitSentences } from "../library/sentenceSplitter.mjs";
import { parse } from "../understand/index.mjs";
import { sentenceToPyash } from "../beautiful.mjs";

function controlPath(worldRoot) {
  return path.join(worldRoot, "conduct", "calendar.services.pya");
}

function normalizeServiceName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeSchedulerServiceName(value) {
  return normalizeServiceName(value);
}

export async function readServiceControls({ worldRoot } = {}) {
  const state = new Map();
  if (!worldRoot) return state;
  let text = "";
  try {
    text = await fs.readFile(controlPath(worldRoot), "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return state;
    throw err;
  }
  const lines = splitSentences(text);
  for (const line of lines) {
    let sentence;
    try {
      sentence = parse(line);
    } catch {
      continue;
    }
    if (sentence?.mood !== "ya") continue;
    const serviceName = normalizeServiceName(sentence?.su?.name);
    if (!serviceName) continue;
    if (sentence?.be === "enabled") state.set(serviceName, true);
    if (sentence?.be === "disabled") state.set(serviceName, false);
  }
  return state;
}

async function writeServiceControls({ worldRoot, state } = {}) {
  if (!worldRoot) return;
  const out = [...state.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "en"))
    .map(([serviceName, enabled]) => sentenceToPyash({
      mood: "ya",
      su: { name: serviceName },
      be: enabled ? "enabled" : "disabled"
    }))
    .join("\n");
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.writeFile(controlPath(worldRoot), out ? `${out}\n` : "", "utf8");
}

export async function isServiceEnabled({ worldRoot, serviceName } = {}) {
  const normalized = normalizeServiceName(serviceName);
  if (!normalized) return true;
  const controls = await readServiceControls({ worldRoot });
  if (!controls.has(normalized)) return true;
  return controls.get(normalized) === true;
}

export async function setServiceEnabled({ worldRoot, serviceName, enabled } = {}) {
  const normalized = normalizeServiceName(serviceName);
  if (!normalized || !worldRoot) return { serviceName: normalized, enabled: true };
  const controls = await readServiceControls({ worldRoot });
  controls.set(normalized, enabled === true);
  await writeServiceControls({ worldRoot, state: controls });
  return {
    serviceName: normalized,
    enabled: enabled === true
  };
}
