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

test("module manuscript module wires semantic verifiers into the module flow", async () => {
  const [moduleSource, wrapperSource] = await Promise.all([
    fs.readFile(moduleFilename, "utf8"),
    fs.readFile(wrapperFilename, "utf8")
  ]);

  assert.match(moduleSource, /module manuscript source thrust verify prompt/u);
  assert.match(moduleSource, /module manuscript role verify prompt/u);
  assert.match(moduleSource, /module manuscript distinct verify prompt/u);
  assert.match(moduleSource, /module manuscript section verify/u);
  assert.match(moduleSource, /source thrust defective/u);
  assert.match(moduleSource, /role defective/u);
  assert.match(moduleSource, /distinct defective/u);
  assert.match(moduleSource, /module manuscript current intent/u);
  assert.match(wrapperSource, /module_manuscript\.pya/u);
});

test("module manuscript final word checks do not overwrite semantic pass state", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /module manuscript hook final verify pass/u);
  assert.match(moduleSource, /module manuscript promise final verify pass/u);
  assert.match(moduleSource, /module manuscript roadmap final verify pass/u);
  assert.match(moduleSource, /module manuscript segment one final verify pass/u);
  assert.match(moduleSource, /module manuscript segment two final verify pass/u);
  assert.match(moduleSource, /module manuscript segment three final verify pass/u);
  assert.match(moduleSource, /module manuscript recap final verify pass/u);
  assert.match(moduleSource, /module manuscript cta final verify pass/u);
  assert.doesNotMatch(moduleSource, /ob text of pass of module manuscript hook final verify to name text module manuscript hook pass be text do/u);
  assert.doesNotMatch(moduleSource, /ob text of pass of module manuscript promise final verify to name text module manuscript promise pass be text do/u);
  assert.doesNotMatch(moduleSource, /ob text of pass of module manuscript roadmap final verify to name text module manuscript roadmap pass be text do/u);
  assert.doesNotMatch(moduleSource, /ob text of pass of module manuscript segment one final verify to name text module manuscript segment one pass be text do/u);
  assert.doesNotMatch(moduleSource, /ob text of pass of module manuscript segment two final verify to name text module manuscript segment two pass be text do/u);
  assert.doesNotMatch(moduleSource, /ob text of pass of module manuscript segment three final verify to name text module manuscript segment three pass be text do/u);
  assert.doesNotMatch(moduleSource, /ob text of pass of module manuscript recap final verify to name text module manuscript recap pass be text do/u);
  assert.doesNotMatch(moduleSource, /ob text of pass of module manuscript cta final verify to name text module manuscript cta pass be text do/u);
});

test("module manuscript verifier flow short-circuits explicit fail analyses before verdict model fallback", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /candidate fails\|fails because\|drifts from the source/u);
  assert.match(moduleSource, /candidate fails\|fails because\|fails\? \(the\|this\) \(task\|role\|requirement\|contract\) because\|misses \(its\|the\) role\|violates/u);
  assert.match(moduleSource, /candidate fails\|fails because\|fails\? \(the\|this\) \(task\|role\|requirement\|contract\) because\|mostly repeats\|restates the prior section/u);
  assert.match(moduleSource, /module manuscript role review atmost num 1 to name text module manuscript role review line be line tail do/u);
  assert.match(moduleSource, /module manuscript distinct review atmost num 1 to name text module manuscript distinct review line be line tail do/u);
  assert.match(moduleSource, /module manuscript source thrust review atmost num 1 to name text module manuscript source thrust review line be line tail do/u);
});

test("module manuscript roadmap is derived from finished segments rather than raw source", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /module manuscript roadmap source basis begin/u);
  assert.match(moduleSource, /module manuscript roadmap role stage from text of ob of module manuscript roadmap source basis/u);
  assert.doesNotMatch(moduleSource, /module manuscript roadmap request source header stage/u);
  assert.match(moduleSource, /sound forward-looking, as a preview of what comes next/u);
  assert.match(moduleSource, /we will see, you will see, or what changes next/u);
  assert.match(moduleSource, /Make it sound forward-looking rather than like a summary of completed points/u);
});

test("module manuscript stage guarantees are gated by section pass flags", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /ob text "false" to name text module manuscript hook pass be text do/u);
  assert.match(moduleSource, /ob text "false" to name text module manuscript roadmap pass be text do/u);
  assert.match(moduleSource, /ob text "false" to name text module manuscript segment one pass be text do/u);
  assert.match(moduleSource, /to name map module manuscript hook sources produce be module manuscript source thrust do/u);
  assert.match(moduleSource, /to name map module manuscript hook roles produce be module manuscript role pass do/u);
  assert.match(moduleSource, /ob name text module manuscript hook pass be equally from text false then\s+ob text of passing of module manuscript hook roles produce be equally from text false then/u);
  assert.match(moduleSource, /to name map module manuscript roadmap sources produce be module manuscript source thrust do/u);
  assert.match(moduleSource, /to name map module manuscript roadmap roles produce be module manuscript role pass do/u);
  assert.match(moduleSource, /ob name text module manuscript roadmap pass be equally from text false then\s+ob text of passing of module manuscript roadmap roles produce be equally from text false then/u);
  assert.match(moduleSource, /to name map module manuscript segment one sources produce be module manuscript source thrust do/u);
  assert.match(moduleSource, /to name map module manuscript segment one roles produce be module manuscript role pass do/u);
  assert.match(moduleSource, /ob name text module manuscript segment one pass be equally from text false then\s+ob text of passing of module manuscript segment one roles produce be equally from text false then/u);
});

test("module manuscript segment two role verifier does not police overlap that distinctness already handles", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /for segment two tasks, fail only when the paragraph does not actually land a misunderstanding-plus-clarification reveal, or you can point to a materially clearer correction/u);
  assert.match(moduleSource, /a more specific correction nested inside the same broad misunderstanding field may still pass/u);
  assert.match(moduleSource, /do not fail merely because the reveal stays inside the same broad contrast cluster as segment one/u);
});

test("module manuscript segment one treats example and implication as optional add-ons", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /Optional add-ons:/u);
  assert.match(moduleSource, /You may use one small example from AFFAIRS OR ACTIVITIES/u);
  assert.match(moduleSource, /You may include one small immediate implication/u);
  assert.match(moduleSource, /If you use an example, keep it brief and subordinate/u);
  assert.match(moduleSource, /Keep scarcity, domination, blockage, counterfeit, or misunderstanding language out of the paragraph's main establish move/u);
  assert.doesNotMatch(moduleSource, /give a simple example/u);
  assert.doesNotMatch(moduleSource, /Use exactly 4 complete sentences/u);
});
