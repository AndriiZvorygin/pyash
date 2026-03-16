import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

  const { stdout, status, stderr, error } = spawnSync("node", ["command/extract_learn_pipeline_result.mjs"], {
    cwd: "/workplace",
    input,
    encoding: "utf8"
  });
  assert.equal(error, undefined);
  assert.equal(status, 0, stderr);

  assert.equal(stdout.trim(), "SEED CONCEPT\nHumility opens shared service.");
});

test("extract_learn_pipeline_result reads final card from file marker", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "learn-result-test-"));
  const filename = path.join(dir, "teaching.txt");
  await fs.writeFile(filename, "SEED CONCEPT\nHumility from file.\n", "utf8");

  const { stdout, status, stderr, error } = spawnSync("node", ["command/extract_learn_pipeline_result.mjs"], {
    cwd: "/workplace",
    input: `[learn pipeline] chunk count: 10\nFINAL_RESULT_FILE: ${filename}\n`,
    encoding: "utf8"
  });
  assert.equal(error, undefined);
  assert.equal(status, 0, stderr);

  assert.equal(stdout.trim(), "SEED CONCEPT\nHumility from file.");
});

test("extract_learn_pipeline_result falls back to the last full schema block in noisy verbose output", () => {
  const input = [
    "exists su name noisy run be start ya",
    "SEED CONCEPT",
    "Old partial thing",
    "",
    "CARDINAL TRAINING SENTENCE",
    "Old sentence",
    "",
    "exists su name another line ya",
    "SEED CONCEPT",
    "Humility keeps us teachable.",
    "",
    "CARDINAL TRAINING SENTENCE",
    "We practice humility together in ordinary service.",
    "",
    "ORTHOGONAL FEATURES",
    "- Shared seeking keeps pride small.",
    "",
    "AFFAIRS OR ACTIVITIES",
    "- We listen before speaking.",
    "",
    "CAUSATIVE AND CONSEQUENCE",
    "- When we release pride, clarity grows.",
    "",
    "CARDINAL SCENES AND IDIOMS",
    "- rough stone shaped by love",
    "",
    "BRIEF MEMORY PHRASES",
    "- Humility steadies the path"
  ].join("\n");

  const { stdout, status, stderr, error } = spawnSync("node", ["command/extract_learn_pipeline_result.mjs"], {
    cwd: "/workplace",
    input,
    encoding: "utf8"
  });
  assert.equal(error, undefined);
  assert.equal(status, 0, stderr);
  assert.equal(stdout.trim(), [
    "SEED CONCEPT",
    "Humility keeps us teachable.",
    "",
    "CARDINAL TRAINING SENTENCE",
    "We practice humility together in ordinary service.",
    "",
    "ORTHOGONAL FEATURES",
    "- Shared seeking keeps pride small.",
    "",
    "AFFAIRS OR ACTIVITIES",
    "- We listen before speaking.",
    "",
    "CAUSATIVE AND CONSEQUENCE",
    "- When we release pride, clarity grows.",
    "",
    "CARDINAL SCENES AND IDIOMS",
    "- rough stone shaped by love",
    "",
    "BRIEF MEMORY PHRASES",
    "- Humility steadies the path"
  ].join("\n"));
});
