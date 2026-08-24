import fs from "node:fs/promises";
import path from "node:path";

import { worldNewspaperLogPath } from "../../agent/newspaper_log.mjs";
import { buildWorkTask } from "./contract.mjs";

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
  const current = buildWorkTask(task);
  const file = worldNewspaperLogPath({ worldRoot, name: `work-${safe(task?.taskId || "scheduler")}` });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const checkpoint = current.checkpoint || {};
  const lines = [
    "su name work task outcome be map def",
    `  su name task id ob text ${quote(current.taskId)} ya`,
    `  su name status ob text ${quote(current.status)} ya`,
    `  su name phase ob text ${quote(checkpoint.interruption?.phase || current.status)} ya`,
    `  su name source identity ob text ${quote(current.source.identity)} ya`,
    `  su name source kind ob text ${quote(current.source.kind)} ya`,
    `  su name source locator ob text ${quote(current.source.locator)} ya`,
    `  su name source provider ob text ${quote(current.source.provider)} ya`,
    `  su name source event id ob text ${quote(current.source.eventId)} ya`,
    `  su name source message id ob text ${quote(current.source.messageId)} ya`,
    `  su name source sender ob text ${quote(current.source.sender)} ya`,
    `  su name source subject ob text ${quote(current.source.subject)} ya`,
    `  su name source received at ob text ${quote(current.source.receivedAt)} ya`,
    `  su name source router payload id ob text ${quote(current.source.routerPayloadId)} ya`,
    `  su name domain ob text ${quote(current.domain)} ya`,
    `  su name deadline ob text ${quote(current.deadline)} ya`,
    `  su name dependencies ob text ${quote(JSON.stringify(current.dependencies))} ya`,
    `  su name delegated by ob text ${quote(current.delegatedBy)} ya`,
    `  su name escalation ob text ${quote(JSON.stringify(current.escalation))} ya`,
    `  su name escalation reason ob text ${quote(current.escalation.reason)} ya`,
    `  su name delegation events ob text ${quote(JSON.stringify(current.delegationEvents))} ya`,
    `  su name delegation event types ob text ${quote(JSON.stringify(current.delegationEvents.map((event) => event.type)))} ya`,
    `  su name action ob text ${quote(action)} ya`,
    `  su name reason ob text ${quote(reason)} ya`,
    `  su name selected because ob text ${quote(checkpoint.selectionReason)} ya`,
    `  su name plan ob text ${quote(checkpoint.plan?.summary)} ya`,
    `  su name implementation ob text ${quote(checkpoint.implementation?.summary)} ya`,
    `  su name tests ob text ${quote(JSON.stringify(checkpoint.implementation?.tests || []))} ya`,
    `  su name review ob text ${quote(checkpoint.review?.decision)} ya`,
    `  su name explanation ob text ${quote(checkpoint.review?.explanation || current.message)} ya`,
    `  su name revisions ob text ${quote(checkpoint.revisionCount)} ya`,
    `  su name capacity ob text ${quote(capacity?.state || "unknown")} ya`,
    "prah",
    ""
  ].join("\n");
  await fs.appendFile(file, lines, "utf8");
  return file;
}
