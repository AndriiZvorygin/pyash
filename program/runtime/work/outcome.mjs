import fs from "node:fs/promises";
import path from "node:path";

import { worldNewspaperLogPath } from "../../agent/newspaper_log.mjs";

function quote(value) {
  return JSON.stringify(String(value ?? ""));
}

function safe(value) {
  return String(value ?? "").replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export async function appendWorkOutcome(worldRoot, task, {
  reason = "",
  capacity = null,
  action = ""
} = {}) {
  const file = worldNewspaperLogPath({ worldRoot, name: `work-${safe(task?.taskId || "scheduler")}` });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const checkpoint = task?.checkpoint || {};
  const lines = [
    "su name work task outcome be map def",
    `  su name task id ob text ${quote(task?.taskId)} ya`,
    `  su name status ob text ${quote(task?.status)} ya`,
    `  su name phase ob text ${quote(checkpoint.interruption?.phase || task?.status)} ya`,
    `  su name action ob text ${quote(action)} ya`,
    `  su name reason ob text ${quote(reason)} ya`,
    `  su name selected because ob text ${quote(checkpoint.selectionReason)} ya`,
    `  su name plan ob text ${quote(checkpoint.plan?.summary)} ya`,
    `  su name implementation ob text ${quote(checkpoint.implementation?.summary)} ya`,
    `  su name tests ob text ${quote(JSON.stringify(checkpoint.implementation?.tests || []))} ya`,
    `  su name review ob text ${quote(checkpoint.review?.decision)} ya`,
    `  su name explanation ob text ${quote(checkpoint.review?.explanation || task?.message)} ya`,
    `  su name revisions ob text ${quote(checkpoint.revisionCount)} ya`,
    `  su name capacity ob text ${quote(capacity?.state || "unknown")} ya`,
    "prah",
    ""
  ].join("\n");
  await fs.appendFile(file, lines, "utf8");
  return file;
}
