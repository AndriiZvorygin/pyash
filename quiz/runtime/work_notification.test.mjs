import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { enqueueWorkTask } from "../../program/runtime/work/queue.mjs";
import { readWorkTaskStatus } from "../../program/runtime/work/status.mjs";
import {
  buildWorkReportEmail,
  readWorkNotificationStatus,
  sendWorkReportNotification
} from "../../program/runtime/work/notification.mjs";

async function makeWorldRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return worldRoot;
}

const task = {
  taskId: "notify-task",
  owner: "background",
  kind: "roadmap",
  title: "Close the parity gap",
  status: "accepted",
  promptText: "Make the bounded change.",
  acceptanceText: "The focused test passes."
};

test("accepted, revision, blocked, and deferred reports become distinct email subjects", () => {
  const accepted = buildWorkReportEmail({
    task,
    report: "ACCEPTED REPORT",
    recipient: "andrii@example.com",
    from: "pyash@example.com"
  });
  const revision = buildWorkReportEmail({
    task: { ...task, status: "revision" },
    report: "REVISION REPORT",
    recipient: "andrii@example.com",
    from: "pyash@example.com"
  });
  const blocked = buildWorkReportEmail({
    task: { ...task, status: "blocked" },
    report: "BLOCKED REPORT",
    recipient: "andrii@example.com",
    from: "pyash@example.com"
  });
  const deferred = buildWorkReportEmail({
    title: "background work",
    status: "deferred",
    report: "DEFERRED REPORT",
    recipient: "andrii@example.com",
    from: "pyash@example.com"
  });
  assert.match(accepted.subject, /ACCEPTED$/);
  assert.match(revision.subject, /REVISION$/);
  assert.match(blocked.subject, /BLOCKED$/);
  assert.match(deferred.subject, /DEFERRED$/);
  assert.match(accepted.message, /\r\n\r\nACCEPTED REPORT\r\n$/);
  assert.match(accepted.subject, /Close the parity gap/);
  const digest = buildWorkReportEmail({
    title: "daily improvement",
    status: "progress",
    subjectOverride: "Pyash daily: substantial progress on parity",
    report: "DIGEST",
    recipient: "andrii@example.com",
    from: "pyash@example.com"
  });
  assert.equal(digest.subject, "Pyash daily: substantial progress on parity");
});

test("mail transport success submits the exact durable report and persists status", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-mail-success-");
  let invocation;
  const report = "PYASH BACKGROUND WORK REPORT\n\nResult: ACCEPTED\n";
  const result = await sendWorkReportNotification({
    worldRoot,
    task,
    report,
    recipient: "andrii@example.com",
    from: "pyash@example.com",
    transport: "sendmail",
    sendmailPath: "/usr/sbin/sendmail",
    commandRunner: async (input) => {
      invocation = input;
      return { code: 0, stdout: "" };
    },
    now: () => "2026-08-09T02:00:00.000Z"
  });
  assert.equal(result.status, "submitted");
  assert.equal(invocation.command, "/usr/sbin/sendmail");
  assert.deepEqual(invocation.args, ["-i", "-t", "-f", "pyash@example.com"]);
  assert.match(invocation.input, /Result: ACCEPTED/);
  const persisted = await readWorkNotificationStatus(worldRoot, "notify-task");
  assert.equal(persisted.status, "submitted");
  assert.equal(persisted.recipient, "andrii@example.com");
});

test("mail transport failure is persisted separately from the work task", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-mail-failure-");
  await enqueueWorkTask(worldRoot, { ...task, status: "ready" });
  const before = await readWorkTaskStatus(worldRoot, "notify-task");
  const result = await sendWorkReportNotification({
    worldRoot,
    task: before,
    report: "PYASH BACKGROUND WORK REPORT\n\nResult: ACCEPTED\n",
    recipient: "andrii@example.com",
    from: "pyash@example.com",
    transport: "docker-sendmail",
    commandRunner: async () => ({ code: 75, stderr: "temporary failure" }),
    now: () => "2026-08-09T02:00:00.000Z"
  });
  assert.equal(result.status, "failed");
  assert.match(result.error, /temporary failure/);
  const after = await readWorkTaskStatus(worldRoot, "notify-task");
  assert.deepEqual(after, before);
  assert.equal((await readWorkNotificationStatus(worldRoot, "notify-task")).status, "failed");
});
