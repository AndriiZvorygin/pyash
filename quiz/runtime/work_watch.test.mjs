import test from "node:test";
import assert from "node:assert/strict";

import { createWorkWatchRenderer, renderWorkEvent } from "../../program/runtime/work/watch.mjs";

test("watch renderer presents explicit lifecycle evidence without protocol noise", async () => {
  const output = [];
  const watch = createWorkWatchRenderer({ write: (line) => output.push(line) });
  await watch({
    type: "capacity",
    at: "2026-08-08T12:00:00.000Z",
    capacity: { usedPercent: 37 },
    admitted: true,
    reason: "capacity above reserve"
  });
  await watch({
    type: "plan-completed",
    at: "2026-08-08T12:00:01.000Z",
    summary: "Add one parity assertion.",
    workOrder: "Update the test and run node --test."
  });
  await watch({
    type: "review-completed",
    at: "2026-08-08T12:00:02.000Z",
    decision: "ACCEPT",
    explanation: "The focused test passes."
  });
  assert.match(output[0], /CAPACITY.*37%.*admitted/);
  assert.match(output.join("\n"), /SOL PLAN/);
  assert.match(output.join("\n"), /Update the test/);
  assert.match(output.join("\n"), /SOL REVIEW ACCEPT/);
  assert.doesNotMatch(output.join("\n"), /item\/agentMessage\/delta|jsonrpc/);
  assert.deepEqual(renderWorkEvent({ type: "accepted", at: "bad", title: "task", explanation: "done" }), [
    "[--:--:--] ACCEPTED   task",
    "  rationale:",
    "    done"
  ]);
});
