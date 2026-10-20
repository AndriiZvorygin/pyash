import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acceptCodingDuty,
  addCodingDutyMessage,
  claimCodingDutyMessage,
  completeCodingDutyMessage,
  createCodingDuty,
  dutyWorkerTokenMatches,
  failCodingDutyMessage,
  listCodingDuties,
  parseDutyRepositories,
  parseDutyWorkerTokens,
  readCodingDuty,
  readDutySessionText
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
