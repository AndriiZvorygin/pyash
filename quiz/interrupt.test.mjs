import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  beginActiveMindRun,
  consumeMindInterrupt,
  currentMindInterruptSignal,
  hasActiveMindRun,
  requestMindInterrupt,
  runWithMindInterruptSignal
} from "../program/agent/interrupt.mjs";

test("mind interrupt aborts the registered active turn and is consumed from its project world", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mind-interrupt-"));
  const worldRoot = path.join(root, "world");
  const agentHouse = path.join(worldRoot, "house", "project-coding-saddle");
  const agentName = "coding saddle";
  const controller = new AbortController();

  try {
    const finish = await beginActiveMindRun({ worldRoot, agentName, controller });
    assert.equal(hasActiveMindRun({ worldRoot, agentName }), true);
    await runWithMindInterruptSignal({ signal: controller.signal }, async () => {
      assert.equal(currentMindInterruptSignal(), controller.signal);
      await Promise.resolve();
      assert.equal(currentMindInterruptSignal(), controller.signal);
    });

    const request = await requestMindInterrupt({ worldRoot, agentName, source: "coding saddle", reason: "test" });
    assert.equal(request.requested, true);
    assert.equal(controller.signal.aborted, true);
    assert.equal(request.abortedRuns, 1);

    const consumed = await consumeMindInterrupt({ agentHouse, agentName });
    assert.match(consumed.text, /mind interrupt/u);
    assert.equal(await consumeMindInterrupt({ agentHouse, agentName }), null);
    await finish();
    assert.equal(hasActiveMindRun({ worldRoot, agentName }), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
