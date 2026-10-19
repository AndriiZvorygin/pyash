import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { clearRefineries, getRefinery } from "../program/bridge/refinery.mjs";
import { normalizeSimulationContract, simulateRefinery } from "../program/bridge/refinery_simulation.mjs";
import { forget } from "../program/remember/index.mjs";

function contract(overrides = {}) {
  return {
    artificial: true,
    seed: 1,
    startTick: 0,
    parallelCapacity: 2,
    waitingCapacity: 1,
    scheduleNewspaper: true,
    ...overrides
  };
}

function refinery(stages) {
  return {
    name: "flow",
    order: stages.map(stage => stage.name),
    platforms: new Map(stages.map(stage => [stage.name, {
      deps: stage.deps ?? [],
      actionSentence: {
        mood: "do",
        be: "write",
        su: { name: stage.name },
        during: { num: stage.duration },
        ...(stage.timebox === undefined ? {} : { atmost: { num: stage.timebox } })
      },
      runtimeActionSentence: null,
      outputContract: null
    }]))
  };
}

function recordsFor(stages, overrides = {}) {
  return simulateRefinery({
    name: "flow",
    refinery: refinery(stages),
    contract: contract(overrides)
  }).records;
}

test("an explicit empty from ve name creates a second root", async () => {
  forget();
  clearRefineries();
  for (const line of [
    "su name flow be refinery def",
    "su name first ob text \"first\" be write do",
    "su name second from ve name ob text \"second\" be write do",
    "su name child from name second ob text \"child\" be write do",
    "prah"
  ]) {
    await interpret(parse(line));
  }
  assert.deepEqual(getRefinery("flow").platforms.get("second").deps, []);
  assert.deepEqual(getRefinery("flow").platforms.get("child").deps, ["second"]);
});

test("same seed and workload produce byte-identical schedule records", () => {
  const stages = [
    { name: "alpha", duration: 2 },
    { name: "beta", duration: 1 },
    { name: "gamma", duration: 3 },
    { name: "delta", duration: 1 }
  ];
  const first = JSON.stringify(recordsFor(stages));
  const second = JSON.stringify(recordsFor(stages));
  assert.equal(first, second);
});

test("a different seed changes a genuine scheduling tie outcome", () => {
  const stages = [
    { name: "alpha", duration: 1 },
    { name: "beta", duration: 1 },
    { name: "gamma", duration: 1 }
  ];
  const starts = seed => recordsFor(stages, { seed, parallelCapacity: 1, waitingCapacity: 2 })
    .filter(record => record.be === "schedule start")
    .map(record => record.su.name);
  assert.notDeepEqual(starts(1), starts(12345));
});

test("wide roots deny each excess admission once with stable schedule crowded evidence", () => {
  const records = recordsFor([
    { name: "alpha", duration: 1 },
    { name: "beta", duration: 1 },
    { name: "gamma", duration: 1 },
    { name: "delta", duration: 1 }
  ]);
  const crowded = records.filter(record => record.be === "schedule crowded");
  assert.equal(crowded.length, 1);
  assert.equal(crowded[0].ob.text, "schedule crowded");
  assert.equal(new Set(crowded.map(record => record.su.name)).size, crowded.length);
  assert.deepEqual(crowded.map(record => record.by.num), [crowded[0].by.num]);
});

test("parallel capacity bounds multi-item waiting promotion", () => {
  const records = recordsFor([
    { name: "alpha", duration: 2 },
    { name: "beta", duration: 2 },
    { name: "gamma", duration: 2 },
    { name: "delta", duration: 2 }
  ], { parallelCapacity: 1, waitingCapacity: 3 });
  const active = new Set();
  const starts = [];
  for (const record of records) {
    if (record.be === "schedule finish") active.delete(record.su.name);
    if (record.be !== "schedule start") continue;
    assert.equal(active.size, 0);
    active.add(record.su.name);
    starts.push(record.during.num);
  }
  assert.equal(starts.length, 4);
  assert.deepEqual(starts, [0, 2, 4, 6]);
});

test("schedule records are gated while simulation faults remain visible", () => {
  const records = recordsFor([
    { name: "slow", duration: 3, timebox: 1 },
    { name: "child", deps: ["slow"], duration: 1 }
  ], { scheduleNewspaper: false });
  assert.deepEqual(records.map(record => record.ob.text), ["platform timebox", "platform cancel"]);
  assert.equal(records.every(record => record.be === "error"), true);
});

test("completion at exactly the deadline wins and a later completion emits platform timebox", () => {
  const onDeadline = recordsFor([{ name: "exact", duration: 2, timebox: 2 }]);
  assert.equal(onDeadline.some(record => record.be === "platform timebox"), false);
  assert.equal(onDeadline.some(record => record.be === "schedule finish" && record.su.name === "exact"), true);

  const afterDeadline = recordsFor([{ name: "late", duration: 3, timebox: 2 }]);
  const timeout = afterDeadline.find(record => record.su.name === "late" && record.be === "error");
  assert.equal(timeout.ob.text, "platform timebox");
});

test("pending descendants cancel in UTF-8 order while an independent branch finishes", () => {
  const records = recordsFor([
    { name: "slow", duration: 3, timebox: 1 },
    { name: "child é", deps: ["slow"], duration: 1 },
    { name: "child a", deps: ["slow"], duration: 1 },
    { name: "independent", duration: 4 }
  ]);
  const cancels = records
    .filter(record => record.be === "error" && record.ob.text === "platform cancel")
    .map(record => record.su.name);
  assert.deepEqual(cancels, ["child a", "child é"]);
  assert.equal(records.some(record => record.be === "schedule finish" && record.su.name === "independent"), true);
});

test("artificial mode never invokes a simulated platform action", async () => {
  let calls = 0;
  await import("../program/bridge/refinery.mjs").then(async ({ clearRefineries, startRefinery, recordPlatform, endRefinery, runRefinery }) => {
    clearRefineries();
    startRefinery("spy");
    recordPlatform({ su: { name: "never run" }, mood: "do", be: "write", during: { num: 1 } });
    endRefinery("spy");
    await runRefinery({
      name: "spy",
      interpret: async () => { calls += 1; },
      checkpointEnabled: false,
      simulation: contract({ scheduleNewspaper: false })
    });
  });
  assert.equal(calls, 0);
});

test("invalid artificial conduct values produce one canonical defect", () => {
  const invalid = [
    { seed: -1 },
    { parallelCapacity: 0 },
    { waitingCapacity: -1 },
    { startTick: -1 },
    { startTick: 0.5 }
  ];
  for (const change of invalid) {
    assert.throws(
      () => normalizeSimulationContract({ ...contract(), ...change }),
      error => error?.sentence?.su?.name === "artificial conduct defective"
        && error?.sentence?.ob?.text === "artificial conduct defective"
    );
  }
  for (const timing of [{ duration: 0 }, { timebox: 0 }]) {
    assert.throws(
      () => recordsFor([{ name: "bad timing", duration: timing.duration ?? 1, timebox: timing.timebox }]),
      error => error?.sentence?.su?.name === "artificial conduct defective"
        && error?.sentence?.ob?.text === "artificial conduct defective"
    );
  }
});
