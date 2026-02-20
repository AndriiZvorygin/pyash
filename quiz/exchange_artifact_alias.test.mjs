import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { clearExchangeRecorder, recordArtifact, setExchangeRecorder, setExchangeRunId } from "../program/bridge/exchange.mjs";

test("recordArtifact run aliases keep meaningful basename and extension", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-exchange-alias-"));
  const recorded = [];
  setExchangeRecorder({ record: (s) => recorded.push(s), runRoot });
  setExchangeRunId("run-001");
  try {
    const bytes = Buffer.from("demo-bytes", "utf8");
    const sentence = recordArtifact({
      locator: "examples/out/love-teaching.wav",
      producer: "exchange",
      bytes
    });
    assert.equal(sentence?.su?.name, "artifact-0");
    const aliasPath = path.join(runRoot, "artifacts", "run-001", "artifact-0-love-teaching.wav");
    const stat = await fs.stat(aliasPath);
    assert.ok(stat.size > 0);
  } finally {
    clearExchangeRecorder();
  }
});
