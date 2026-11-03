import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyCodingSaddlePlanAction,
  clearCodingSaddlePlan,
  formatCodingSaddlePlan,
  readCodingSaddlePlan,
  saddlePlanPath,
  updateCodingSaddlePlan
} from "../program/agent/coding_saddle_plan.mjs";

test("coding saddle plans persist in Pyash sentences and are isolated by session", async () => {
  const agentHouse = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-plan-"));
  const firstPath = saddlePlanPath({ agentHouse, sessionName: "project-a" });
  const secondPath = saddlePlanPath({ agentHouse, sessionName: "project-b" });
  try {
    assert.notEqual(firstPath, secondPath);
    assert.deepEqual(await readCodingSaddlePlan(firstPath), { objective: "", steps: [] });

    const created = await updateCodingSaddlePlan(firstPath, {
      action: "create",
      objective: "Add streaming and verify it",
      steps: [
        { title: "Trace the current response path" },
        { title: "Implement incremental rendering", status: "in progress" }
      ]
    });
    assert.equal(created.steps[1].status, "in_progress");
    assert.match(await fs.readFile(firstPath, "utf8"), /^su name coding saddle plan objective/m);
    assert.deepEqual(await readCodingSaddlePlan(firstPath), created);

    const completed = await updateCodingSaddlePlan(firstPath, {
      action: "update_step",
      id: "step-001",
      status: "done",
      evidence: "node --test quiz/coding_saddle_plan.test.mjs passed"
    });
    assert.equal(completed.steps[0].status, "done");
    assert.match(formatCodingSaddlePlan(completed), /evidence: node --test/u);
    assert.deepEqual(await readCodingSaddlePlan(secondPath), { objective: "", steps: [] });

    await clearCodingSaddlePlan(firstPath);
    assert.deepEqual(await readCodingSaddlePlan(firstPath), { objective: "", steps: [] });
  } finally {
    await fs.rm(agentHouse, { recursive: true, force: true });
  }
});

test("coding saddle plans reject unsupported state and completion without evidence", () => {
  assert.throws(() => applyCodingSaddlePlanAction({}, {
    action: "create",
    objective: "Do the work",
    steps: [{ title: "Unverified step", status: "done" }]
  }), /needs evidence/u);
  assert.throws(() => applyCodingSaddlePlanAction({}, {
    action: "create",
    objective: "Do the work",
    steps: []
  }), /between 1 and 12/u);
  assert.throws(() => applyCodingSaddlePlanAction({}, {
    action: "update_step",
    id: "step-001",
    status: "done"
  }), /does not exist/u);
});
