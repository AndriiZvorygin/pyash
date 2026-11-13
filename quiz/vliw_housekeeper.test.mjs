import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHousekeeperVliwBatchEvaluator } from "../program/library/vliw/housekeeper.mjs";
import { evolveVliwFunctionThroughHousekeeper } from "../program/library/vliw/evolution.mjs";
import { scoreVliwFunction } from "../program/library/vliw/functions.mjs";
import { runGpuWorkerOnce } from "../program/runtime/gpu/worker.mjs";
import { readGpuHandleStatus } from "../program/runtime/gpu/handle_status.mjs";

const batch = {
  schemaVersion: 1,
  slots: ["left", "right", "sum"],
  inputSlots: ["left", "right"],
  outputSlot: "sum",
  cases: [
    { values: { left: 2, right: 3 }, expected: 5 },
    { values: { left: 12, right: 8 }, expected: 20 }
  ],
  candidates: [{
    id: "candidate-001",
    instructions: [{ op: "plus", target: "sum", left: "left", right: "right" }]
  }]
};

function scoresFor(payload) {
  return payload.candidates.map((candidate) => ({
    id: candidate.id,
    ...scoreVliwFunction({
      schemaVersion: 1,
      name: "housekeeper test function",
      slots: payload.slots,
      inputSlots: payload.inputSlots,
      outputSlot: payload.outputSlot,
      instructions: candidate.instructions
    }, payload.cases)
  }));
}

test("VLIW batch evaluator queues a durable Housekeeper job and returns its result", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-vliw-housekeeper-"));
  const worldRoot = path.join(root, "world");
  const submitted = [];
  let workerRan = false;
  const evaluator = createHousekeeperVliwBatchEvaluator({
    worldRoot,
    pollIntervalMs: 10,
    timeoutMs: 1000,
    makeHandleId: () => "vliw-test-batch",
    sleep: async () => {
      if (workerRan) return;
      workerRan = true;
      await runGpuWorkerOnce({
        worldRoot,
        adapter: {
          async submitJob(job) {
            submitted.push(job);
            return { remoteJobId: "housekeeper-vliw-test" };
          },
          async getJobStatus() {
            return {
              status: "success",
              message: "scored by Housekeeper",
              result: { schemaVersion: 1, scores: scoresFor(batch) },
              finishedAt: new Date().toISOString()
            };
          }
        },
        maxPolls: 1
      });
    }
  });

  const scores = await evaluator(batch);
  assert.equal(workerRan, true);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].runtimeName, "vliw");
  assert.equal(submitted[0].profileName, "vliw-batch-evaluator");
  assert.equal(submitted[0].jobSpec.kind, "vliw-batch-evaluate");
  assert.equal(submitted[0].jobSpec.resourceRequest.vramRequiredMb, 64);
  assert.deepEqual(submitted[0].jobSpec.payload, batch);
  assert.equal(scores[0].id, "candidate-001");
  assert.equal(scores[0].incorrectCount, 0);
  assert.equal((await readGpuHandleStatus(worldRoot, "vliw-test-batch")).status, "success");
});

test("VLIW evolution routes every training and held-out batch through Housekeeper", async () => {
  const submittedBatches = [];
  const trainingCases = [{ values: { left: 1, right: 4 }, expected: 5 }];
  const heldoutCases = [{ values: { left: 30, right: 12 }, expected: 42 }];
  const result = await evolveVliwFunctionThroughHousekeeper({
    template: {
      schemaVersion: 1,
      name: "number plus",
      slots: ["left", "right", "sum"],
      inputSlots: ["left", "right"],
      outputSlot: "sum"
    },
    trainingCases,
    heldoutCases,
    populationSize: 6,
    generations: 2,
    seed: 8,
    housekeeper: {
      makeHandleId: () => `vliw-test-${submittedBatches.length}`,
      async submitDuty(call) {
        const jobSpec = JSON.parse(call.ob.text);
        submittedBatches.push(jobSpec.payload);
      },
      async readStatus(_worldRoot, handleId) {
        const payload = submittedBatches[Number(handleId.split("-").at(-1))];
        return {
          status: "success",
          result: JSON.stringify({ schemaVersion: 1, scores: scoresFor(payload) })
        };
      }
    }
  });

  assert.equal(result.validated, true);
  assert.ok(submittedBatches.length >= 2);
  assert.ok(submittedBatches.every((submitted) => submitted.schemaVersion === 1));
  assert.deepEqual(submittedBatches.at(-1).cases, heldoutCases);
});

test("VLIW evaluator surfaces a failed Housekeeper handle instead of scoring locally", async () => {
  const evaluator = createHousekeeperVliwBatchEvaluator({
    worldRoot: "/tmp/vliw-housekeeper-failure-test",
    makeHandleId: () => "vliw-failed-batch",
    async submitDuty(call) {
      const jobSpec = JSON.parse(call.ob.text);
      assert.equal(jobSpec.kind, "vliw-batch-evaluate");
      assert.equal(jobSpec.resourceRequest.vramRequiredMb, 64);
    },
    async readStatus() {
      return { status: "fail", error: "CUDA device unavailable" };
    }
  });

  await assert.rejects(evaluator(batch), /VLIW Housekeeper job vliw-failed-batch failed: CUDA device unavailable/u);
});
