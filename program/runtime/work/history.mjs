import fs from "node:fs/promises";
import path from "node:path";

import { worldNewspaperLogPath } from "../../agent/newspaper_log.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function quote(value) {
  return JSON.stringify(String(value ?? ""));
}

function iso(now) {
  const value = typeof now === "function" ? now() : now || new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function parseBlocks(source) {
  return [...String(source ?? "").matchAll(/su name work scheduler event be map def\n([\s\S]*?)\nprah/giu)]
    .map((match) => {
      const event = {};
      for (const line of String(match[1]).split("\n")) {
        const found = line.trim().match(/^su name (.+?) ob text (.+?) ya$/iu);
        if (!found) continue;
        try {
          event[found[1]] = JSON.parse(found[2]);
        } catch {
          event[found[1]] = found[2];
        }
      }
      return event;
    });
}

export async function appendWorkSchedulerEvent(worldRoot, event = {}, { now = () => new Date() } = {}) {
  const at = text(event.at) || iso(now);
  const file = worldNewspaperLogPath({ worldRoot, name: "work-scheduler", now: new Date(at) });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const fields = {
    at,
    action: event.action || event.type,
    taskId: event.taskId,
    status: event.status,
    reason: event.reason,
    capacityState: event.capacity?.state,
    weeklyIdentified: event.capacity?.weekly?.identified === true,
    usedPercent: event.capacity?.weekly?.usedPercent ?? event.capacity?.usedPercent,
    remainingPercent: event.capacity?.weekly?.remainingPercent ?? event.capacity?.remainingPercent,
    pacingFloor: event.pacing?.minimumRemainingPercent,
    headroom: event.pacing?.headroomPercent,
    taskCount: event.taskCount,
    selected: event.selected,
    baseline: event.baseline,
    preflight: event.preflight,
    workStarted: event.workStarted === true,
    usefulWake: event.usefulWake === true,
    materialProgress: event.materialProgress === true,
    integration: event.integration,
    previousBlocker: event.previousBlocker,
    recoveryCount: event.recoveryCount,
    replacementWorktree: event.replacementWorktree,
    previousThreadId: event.previousThreadId
  };
  const lines = [
    "su name work scheduler event be map def",
    ...Object.entries(fields).map(([key, value]) => `  su name ${key} ob text ${quote(value)} ya`),
    "prah",
    ""
  ].join("\n");
  await fs.appendFile(file, lines, "utf8");
  return file;
}

export async function readWorkSchedulerEvents(worldRoot, { since = "", until = "" } = {}) {
  const directory = path.join(worldRoot, "newspaper");
  let names = [];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const lower = Date.parse(since || "1970-01-01T00:00:00.000Z");
  const upper = Date.parse(until || "2999-12-31T23:59:59.999Z");
  const files = names.filter((name) => /^\d{8}-work-scheduler\.pya$/u.test(name)).sort();
  const events = [];
  for (const name of files) {
    const source = await fs.readFile(path.join(directory, name), "utf8");
    for (const event of parseBlocks(source)) {
      const at = Date.parse(event.at);
      if (Number.isFinite(at) && at >= lower && at <= upper) events.push(event);
    }
  }
  return events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}
