import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acceptCodingDuty,
  addCodingDutyMessage,
  claimCodingDutyMessage,
  claimCodingDutyMessagesAtBoundary,
  codingDutyOwner,
  completeCodingDutyMessage,
  createCodingDuty,
  dutyWorkerTokenMatches,
  failCodingDutyMessage,
  listCodingDuties,
  parseDutyRepositories,
  parseDutyWebUsers,
  parseDutyWorkerTokens,
  parseDutyWorkerHomeAccess,
  parseDutyWorkerUsers,
  readCodingDuty,
  readDutySessionText,
  recordCodingDutyToolEvent,
  setCodingDutyPermission
} from "../program/agent/coding_duty.mjs";
import { addWorkTask, listAutonomousWorkTasks, listWorkTasks } from "../program/runtime/work/operator.mjs";

async function withWorld(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-duty-"));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function makeDuty(root, overrides = {}) {
  const sessionFile = path.join(root, "sessions", "duty.pya");
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  await fs.writeFile(sessionFile, "session checkpoint\n", "utf8");
  return createCodingDuty(root, {
    id: "duty-test-1",
    title: "Refine this repository",
    initialMessage: "Inspect the code and report a focused improvement.",
    ownerId: "htaf",
    workerId: "worker-a",
    repositoryId: "pyash",
    model: "qwen3.5:9b",
    backend: "ollama",
    host: "http://ollama.test",
    sessionName: "duty-test-1",
    sessionFile,
    ...overrides
  });
}

test("coding duty stores a shared conversation and resumes on an assigned worker", async () => {
  await withWorld(async (root) => {
    const created = await makeDuty(root);
    const firstUser = created.workSpec.codingDuty.messages[0];
    const claimed = await claimCodingDutyMessage(root, "worker-a", { repositoryIds: ["pyash"] });
    assert.equal(claimed.message.id, firstUser.id);
    assert.equal(await claimCodingDutyMessage(root, "other-worker", { repositoryIds: ["pyash"] }), null);

    const claimId = claimed.task.workSpec.codingDuty.claim.claimId;
    assert.equal(await completeCodingDutyMessage(
      root,
      created.taskId,
      "worker-a",
      firstUser.id,
      claimId,
      "I inspected the repository.",
      { sessionText: "updated session checkpoint\n" }
    ).then((task) => task.status), "implementing");

    let task = await readCodingDuty(root, created.taskId);
    assert.equal(task.workSpec.codingDuty.messages.at(-1).parentId, firstUser.id);
    assert.equal((await readDutySessionText(task)).trim(), "updated session checkpoint");

    task = await addCodingDutyMessage(root, created.taskId, "Now make the focused change.");
    assert.equal(task.taskId, created.taskId);
    assert.equal(task.workSpec.codingDuty.messages.at(-1).state, "pending");
    assert.equal((await listCodingDuties(root)).length, 1);
  });
});

test("duty messages enter an active saddle after the selected safe boundary", async () => {
  await withWorld(async (root) => {
    const created = await makeDuty(root);
    const active = await claimCodingDutyMessage(root, "worker-a");
    const claimId = active.task.workSpec.codingDuty.claim.claimId;
    const afterToolTask = await addCodingDutyMessage(root, created.taskId, "Inspect the tool result first.", {
      delivery: "after-tool"
    });
    const afterToolId = afterToolTask.workSpec.codingDuty.messages.at(-1).id;
    const afterTurnTask = await addCodingDutyMessage(root, created.taskId, "Then summarize the complete turn.", {
      delivery: "after-turn"
    });
    const afterTurnId = afterTurnTask.workSpec.codingDuty.messages.at(-1).id;

    await recordCodingDutyToolEvent(root, created.taskId, "worker-a", {
      messageId: active.message.id,
      claimId,
      event: { stage: "call", toolName: "read" }
    });
    await recordCodingDutyToolEvent(root, created.taskId, "worker-a", {
      messageId: active.message.id,
      claimId,
      event: { stage: "result", toolName: "read", toolText: "file contents" }
    });

    const afterToolDelivery = await claimCodingDutyMessagesAtBoundary(root, created.taskId, "worker-a", {
      messageId: active.message.id,
      claimId,
      boundary: "tool-result"
    });
    assert.deepEqual(afterToolDelivery.map((message) => message.id), [afterToolId]);
    assert.equal(afterToolDelivery[0].delivery, "after-tool");

    const afterTurnPending = await readCodingDuty(root, created.taskId);
    assert.equal(afterTurnPending.workSpec.codingDuty.messages.find((message) => message.id === afterTurnId).state, "pending");

    const reread = await readCodingDuty(root, created.taskId);
    assert.deepEqual(reread.workSpec.codingDuty.toolEvents.map((event) => event.stage), ["call", "result"]);
    assert.equal(reread.workSpec.codingDuty.messages.find((message) => message.id === afterToolId).state, "delivered");

    await completeCodingDutyMessage(root, created.taskId, "worker-a", active.message.id, claimId, "The child turn is complete.", {
      sessionText: "completed session checkpoint\n"
    });
    const nextTurn = await claimCodingDutyMessage(root, "worker-a");
    assert.equal(nextTurn.message.id, afterTurnId);
    assert.equal(nextTurn.message.delivery, "after-turn");
  });
});

test("a blocked duty resumes from a new operator instruction without erasing its failed turn", async () => {
  await withWorld(async (root) => {
    const created = await makeDuty(root);
    const claimed = await claimCodingDutyMessage(root, "worker-a");
    const failed = await failCodingDutyMessage(
      root,
      created.taskId,
      "worker-a",
      claimed.message.id,
      claimed.task.workSpec.codingDuty.claim.claimId,
      "temporary worker failure",
      { retry: false }
    );
    assert.equal(failed.status, "blocked");
    const resumed = await addCodingDutyMessage(root, created.taskId, "Resume and inspect the preserved state.");
    assert.equal(resumed.status, "implementing");
    assert.equal(resumed.taskId, created.taskId);
    assert.equal(resumed.workSpec.codingDuty.messages[0].state, "failed");
    assert.equal(resumed.workSpec.codingDuty.messages.at(-1).state, "pending");
    assert.equal(resumed.retryCount, created.retryCount);
  });
});

test("coding duty acceptance requires an idle duty and records operator review", async () => {
  await withWorld(async (root) => {
    const created = await makeDuty(root);
    await assert.rejects(() => acceptCodingDuty(root, created.taskId), /unfinished input/u);
    const claimed = await claimCodingDutyMessage(root, "worker-a");
    await completeCodingDutyMessage(
      root,
      created.taskId,
      "worker-a",
      claimed.message.id,
      claimed.task.workSpec.codingDuty.claim.claimId,
      "Finished with focused checks.",
      { sessionText: "finished session\n" }
    );
    const accepted = await acceptCodingDuty(root, created.taskId, { actor: "test operator" });
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.checkpoint.review.decision, "ACCEPT");
    assert.equal(accepted.checkpoint.review.role, "operator");
  });
});

test("worker credentials and repository mappings are parsed without exposing roots publicly", () => {
  const tokens = parseDutyWorkerTokens("node-a=secret-a; malformed;node-b=secret-b");
  assert.equal(tokens.get("node-a"), "secret-a");
  assert.equal(dutyWorkerTokenMatches("secret-a", "secret-a"), true);
  assert.equal(dutyWorkerTokenMatches("secret-a", "secret-b"), false);
  assert.deepEqual(parseDutyRepositories("pyash=/srv/pyash;bad id=/tmp/no"), [
    { id: "pyash", root: "/srv/pyash" }
  ]);
  assert.deepEqual([...parseDutyWorkerUsers("zvorygin-htaf=htaf")], [["zvorygin-htaf", "htaf"]]);
  assert.deepEqual([...parseDutyWorkerHomeAccess("zvorygin-htaf,other")], ["zvorygin-htaf", "other"]);
  assert.deepEqual([...parseDutyWebUsers("pyash=htaf;alice=alice;bad user=oops")], [["pyash", "htaf"], ["alice", "alice"]]);
});

test("duties are private to their authenticated owner and permission scope changes only while idle", async () => {
  await withWorld(async (root) => {
    const created = await makeDuty(root);
    assert.equal(codingDutyOwner(created), "htaf");
    assert.deepEqual((await listCodingDuties(root, { ownerId: "alice" })).length, 0);
    assert.equal((await listCodingDuties(root, { ownerId: "htaf" })).length, 1);
    assert.equal(await claimCodingDutyMessage(root, "worker-a", { ownerId: "alice" }), null);
    await assert.rejects(() => setCodingDutyPermission(root, created.taskId, "home", {
      ownerId: "htaf",
      homeAllowed: true
    }), /work is active/u);
    assert.equal(await setCodingDutyPermission(root, created.taskId, "home", {
      ownerId: "alice",
      homeAllowed: true
    }), null);
    const claim = await claimCodingDutyMessage(root, "worker-a", { ownerId: "htaf" });
    await completeCodingDutyMessage(
      root,
      created.taskId,
      "worker-a",
      claim.message.id,
      claim.task.workSpec.codingDuty.claim.claimId,
      "Idle again.",
      { ownerId: "htaf", sessionText: "completed session\n" }
    );
    await assert.rejects(() => setCodingDutyPermission(root, created.taskId, "home", {
      ownerId: "htaf",
      homeAllowed: false
    }), /not configured/u);
    const changed = await setCodingDutyPermission(root, created.taskId, "home", {
      ownerId: "htaf",
      homeAllowed: true
    });
    assert.equal(changed.workSpec.codingDuty.permissionScope, "home");
    assert.equal(changed.taskId, created.taskId);
  });
});

test("interactive coding duties stay in WorkTask listings but not autonomous backlog supply", async () => {
  await withWorld(async (root) => {
    await makeDuty(root);
    await addWorkTask(root, {
      taskId: "roadmap-work-1",
      owner: "background",
      title: "Independent roadmap package",
      promptText: "Perform the independent work.",
      acceptanceText: "The independent work is checked."
    });
    assert.deepEqual((await listWorkTasks(root)).map((task) => task.taskId).sort(), ["duty-test-1", "roadmap-work-1"]);
    assert.deepEqual(
      (await listAutonomousWorkTasks(root)).map((task) => task.taskId),
      ["roadmap-work-1"]
    );
  });
});
