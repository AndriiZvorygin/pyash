import test from "node:test";
import assert from "node:assert/strict";

import { runParityGate } from "../command/parity_gate.mjs";
import { BACKENDS } from "../program/library/parity/backends.mjs";
import { CASES } from "../program/library/parity/cases.mjs";

test("declared parity corpus holds", async () => {
  const report = await runParityGate();
  for (const result of report.results) {
    assert.ok(
      result.ok,
      `${result.family}/${result.name}: ${JSON.stringify(result.backends)}`
    );
  }
});

test("every parity case declares known backends and a comparison", () => {
  assert.ok(CASES.length > 0);
  for (const testCase of CASES) {
    assert.ok(testCase.backends.length > 0, testCase.name);
    for (const backend of testCase.backends) {
      assert.ok(BACKENDS.includes(backend), `${testCase.name}: ${backend}`);
    }
    assert.ok(
      testCase.expected === "same" || testCase.known,
      `${testCase.name}: a pinned case needs a known-divergence reason`
    );
  }
});
