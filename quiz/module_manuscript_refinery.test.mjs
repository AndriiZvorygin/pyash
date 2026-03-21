import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runScript } from "./helpers/run_script.mjs";

const repoRoot = path.join(process.cwd());
const moduleFilename = path.join(repoRoot, "module", "module_manuscript.pya");
const wrapperFilename = path.join(repoRoot, "examples", "pyash", "refinery-module-manuscript-run.pya");

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

test("module manuscript module parses through the real trace reader", async () => {
  const { errors } = await runScript("command/read_pya_trace.mjs", ["module/module_manuscript.pya"]);
  assertNoUnexpectedErrors(errors);
});

test("module manuscript module stays importable from another pya file", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "module-manuscript-import-"));
  const importerFilename = path.join(tempRoot, "import_module_manuscript.pya");
  const importLine = `from filename "${moduleFilename}" ob name manuscript as wo module to name manuscript as wo module be import do\n`;

  await fs.writeFile(importerFilename, importLine, "utf8");
  const { errors } = await runScript("command/read_pya_trace.mjs", [importerFilename]);
  assertNoUnexpectedErrors(errors);
});

test("module manuscript wrapper points to promoted module path", async () => {
  const wrapperSource = await fs.readFile(wrapperFilename, "utf8");
  assert.match(wrapperSource, /module_manuscript\.pya/u);
});

test("module manuscript uses single scored semantic verifier in stage flow", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /module manuscript scored semantic score prompt/u);
  assert.match(moduleSource, /Scoring dimensions:\n- source faithfulness\n- role and task fit\n- progression beyond PRIOR only when PRIOR is actually provided/u);
  assert.match(moduleSource, /Source faithfulness rubric:/u);
  assert.match(moduleSource, /Role and task fit rubric:/u);
  assert.match(moduleSource, /Progression and distinctness rubric:/u);
  assert.match(moduleSource, /Tie-break policy:/u);
  assert.match(moduleSource, /module manuscript stage contract run platform .* atleast num 0\.8 .* atmost num of name module manuscript stage contract cap/u);
  assert.match(moduleSource, /module manuscript hook scored checkpoint stage/u);
  assert.match(moduleSource, /module manuscript promise scored checkpoint stage/u);
  assert.match(moduleSource, /module manuscript roadmap scored checkpoint stage/u);
  assert.match(moduleSource, /module manuscript segment one scored checkpoint stage/u);
  assert.match(moduleSource, /module manuscript segment two scored checkpoint stage/u);
  assert.match(moduleSource, /module manuscript segment three scored checkpoint stage/u);
  assert.match(moduleSource, /module manuscript recap scored checkpoint stage/u);
  assert.match(moduleSource, /module manuscript cta scored checkpoint stage/u);
  assert.doesNotMatch(moduleSource, /be module manuscript source thrust do/u);
  assert.doesNotMatch(moduleSource, /be module manuscript role pass do/u);
  assert.doesNotMatch(moduleSource, /be module manuscript distinct pass do/u);
});
