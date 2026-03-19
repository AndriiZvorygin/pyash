import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
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

  assert.match(moduleSource, /module manuscript segment two final verify pass/u);
  assert.match(moduleSource, /module manuscript recap final verify pass/u);
  assert.match(moduleSource, /module manuscript cta final verify pass/u);
  assert.doesNotMatch(moduleSource, /ob text of pass of module manuscript segment two final verify to name text module manuscript segment two pass be text do/u);
  assert.doesNotMatch(moduleSource, /ob text of pass of module manuscript recap final verify to name text module manuscript recap pass be text do/u);
  assert.doesNotMatch(moduleSource, /ob text of pass of module manuscript cta final verify to name text module manuscript cta pass be text do/u);
});
