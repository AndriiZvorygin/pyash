import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runExtractLearnPipelineResult } from "../command/extract_learn_pipeline_result.mjs";

test("extract_learn_pipeline_result returns marked final card when verbose chatter is present", async () => {
  const input = [
    "[learn pipeline] source chars: 18433",
    "[learn pipeline] chunk count: 2",
    "[learn pipeline] final result start",
    "SEED CONCEPT",
    "Humility opens shared service.",
    "",
    "[learn pipeline] final result end"
  ].join("\n");

  const stdout = runExtractLearnPipelineResult(input);
  assert.equal(stdout.trim(), "SEED CONCEPT\nHumility opens shared service.");
});

test("extract_learn_pipeline_result reads final card from file marker", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "learn-result-test-"));
  const filename = path.join(dir, "teaching.txt");
  await fs.writeFile(filename, "SEED CONCEPT\nHumility from file.\n", "utf8");

  const stdout = runExtractLearnPipelineResult(`[learn pipeline] chunk count: 10\nFINAL_RESULT_FILE: ${filename}\n`);
  assert.equal(stdout.trim(), "SEED CONCEPT\nHumility from file.");
});
