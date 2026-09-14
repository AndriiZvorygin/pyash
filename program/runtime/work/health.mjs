import fs from "node:fs/promises";
import path from "node:path";

import { ensureWorkQueueDirs } from "./queue.mjs";

function quote(value) {
  return JSON.stringify(String(value ?? ""));
}

function healthPath(worldRoot) {
  return path.join(worldRoot, "holding", "work", "artifacts", "scheduler-health.pya");
}

function mapBlock(name, entries) {
  return [
    `su name ${name} be map def`,
    ...entries.map((entry) => `  su name ${entry.key} ob text ${quote(entry.value)} ya`),
    "prah"
  ].join("\n");
}

function parse(text) {
  const match = String(text ?? "").match(/su name work scheduler health be map def\n([\s\S]*?)\nprah/i);
  const out = {};
  for (const line of String(match?.[1] || "").split("\n")) {
    const found = line.trim().match(/^su name (.+?) ob text (.+?) ya$/i);
    if (!found) continue;
    try {
      out[found[1]] = JSON.parse(found[2]);
    } catch {
      out[found[1]] = found[2];
    }
  }
  return out;
}

export async function readWorkSchedulerHealth(worldRoot) {
  try {
    return parse(await fs.readFile(healthPath(worldRoot), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export async function writeWorkSchedulerHealth(worldRoot, value = {}) {
  await ensureWorkQueueDirs(worldRoot);
  const target = healthPath(worldRoot);
  const entries = Object.entries(value).map(([key, item]) => ({ key, value: item }));
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${mapBlock("work scheduler health", entries)}\n`, "utf8");
  await fs.rename(tmp, target);
  return value;
}

export function workSchedulerHealthPath(worldRoot) {
  return healthPath(worldRoot);
}
