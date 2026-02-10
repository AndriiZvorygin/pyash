import test from "node:test";
import assert from "node:assert/strict";

import {
  summarizeParityStatus,
  selectParityFixCandidates,
  computeParityDelta
} from "../program/agent/parity_cycle.mjs";

test("selectParityFixCandidates returns run-success but backend-red files", () => {
  const status = {
    details: {
      "examples/ok.pya": {
        run: { status: "success" },
        runjs: { status: "success" },
        runc: { status: "success" }
      },
      "examples/js-red.pya": {
        run: { status: "success" },
        runjs: { status: "failed" },
        runc: { status: "success" }
      },
      "examples/c-red.pya": {
        run: { status: "success" },
        runjs: { status: "success" },
        runc: { status: "timeout" }
      },
      "examples/run-red.pya": {
        run: { status: "failed" },
        runjs: { status: "failed" },
        runc: { status: "failed" }
      }
    }
  };

  const out = selectParityFixCandidates(status);
  assert.deepEqual(out, ["examples/c-red.pya", "examples/js-red.pya"]);
});

test("computeParityDelta marks improvement when red drops", () => {
  const before = { parity: { green: ["a"], red: ["b", "c"] } };
  const after = { parity: { green: ["a", "b"], red: ["c"] } };
  const delta = computeParityDelta(before, after);
  assert.equal(delta.improved, true);
  assert.equal(delta.regressed, false);
  assert.equal(delta.delta.parityRed, -1);
  assert.equal(delta.delta.parityGreen, 1);
});

test("summarizeParityStatus returns zero-safe counts", () => {
  const summary = summarizeParityStatus({});
  assert.equal(summary.parityGreen, 0);
  assert.equal(summary.parityRed, 0);
  assert.equal(summary.runFailures, 0);
});
