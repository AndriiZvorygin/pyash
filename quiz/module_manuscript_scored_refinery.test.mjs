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

  assert.match(moduleSource, /module manuscript scored checkpoint from text candidate with text review by num trying as text attempt name to name map checkpoint/u);
  assert.match(moduleSource, /module manuscript scored checkpoint from name text candidate with text review by num trying as text attempt name to name map checkpoint/u);
  assert.match(moduleSource, /module manuscript scored history from name map checkpoint to name series history/u);
  assert.match(moduleSource, /module manuscript scored state from name map checkpoint with name series history to name map state/u);
  assert.match(moduleSource, /module manuscript scored semantic score from text source with text candidate to name map produce/u);
  assert.match(moduleSource, /"candidate":"","review":"","score":0,"passing":"false","attempt":0,"attempt name":"","best":"false"/u);
  assert.match(moduleSource, /"best attempt":"","current attempt":"","best score":0,"passing":"false","candidate":"","review":"","score":0,"history":""/u);
  assert.match(moduleSource, /to attempt of checkpoint be plus do/u);
  assert.match(moduleSource, /to attempt name of checkpoint be text do/u);
  assert.match(moduleSource, /su name module manuscript scored attempt row ob text of attempt name of from of this by num of attempt of from of this be text ya/u);
  assert.match(moduleSource, /to history of state be text do/u);
  assert.match(moduleSource, /module manuscript scored score line from num 0 to num 1 become name num to name num module manuscript scored score be cast do/u);
  assert.match(moduleSource, /module manuscript scored semantic request for name module manuscript scored semantic score mind/u);
  assert.match(moduleSource, /by num 1 as text "attempt 1" to name map produce be module manuscript scored checkpoint do/u);
  assert.match(moduleSource, /If the candidate is source-faithful and plausibly does the stage job, score at least 0\.8/u);
  assert.match(moduleSource, /exists su name module manuscript scored checkpoint be export ya/u);
  assert.match(moduleSource, /exists su name module manuscript scored history be export ya/u);
  assert.match(moduleSource, /exists su name module manuscript scored semantic score be export ya/u);
  assert.match(moduleSource, /exists su name module manuscript scored state be export ya/u);
});
