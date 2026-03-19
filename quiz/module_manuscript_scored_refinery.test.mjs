import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { runScript } from "./helpers/run_script.mjs";

const repoRoot = path.join(process.cwd());
const moduleFilename = path.join(repoRoot, "module", "module_manuscript_scored.pya");
const wrapperFilename = path.join(repoRoot, "examples", "pyash", "refinery-module-manuscript-scored-run.pya");

function assertNoUnexpectedErrors(errors = []) {
  const unexpected = errors.filter((line) => {
    const text = String(line);
    return !text.startsWith("artifacts folder: ")
      && !text.startsWith("run start: ")
      && !text.startsWith("run end: ")
      && !text.startsWith("run duration: ");
  });
  assert.deepEqual(unexpected, []);
}

test("module manuscript scored module parses through the real trace reader", async () => {
  const { errors } = await runScript("command/read_pya_trace.mjs", ["module/module_manuscript_scored.pya"]);
  assertNoUnexpectedErrors(errors);
});

test("module manuscript scored wrapper imports the experimental module", async () => {
  const wrapperSource = await fs.readFile(wrapperFilename, "utf8");
  assert.match(wrapperSource, /module_manuscript_scored\.pya/u);
});

test("module manuscript scored module exports checkpoint-first helper ceremonies", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /module manuscript scored checkpoint from text candidate with text review to name map checkpoint/u);
  assert.match(moduleSource, /module manuscript scored checkpoint from name text candidate with text review to name map checkpoint/u);
  assert.match(moduleSource, /module manuscript scored semantic score from text source with text candidate to name map produce/u);
  assert.match(moduleSource, /"candidate":"","review":"","score":0,"passing":"false"/u);
  assert.match(moduleSource, /module manuscript scored score line from num 0 to num 1 become name num to name num module manuscript scored score be cast do/u);
  assert.match(moduleSource, /module manuscript scored semantic request for name module manuscript scored semantic score mind/u);
  assert.match(moduleSource, /If the candidate is source-faithful and plausibly does the stage job, score at least 0\.8/u);
  assert.match(moduleSource, /exists su name module manuscript scored checkpoint be export ya/u);
  assert.match(moduleSource, /exists su name module manuscript scored semantic score be export ya/u);
});
