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

  assert.match(moduleSource, /module manuscript semantic verify prompt/u);
  assert.match(moduleSource, /module manuscript semantic verdict prompt/u);
  assert.match(moduleSource, /module manuscript section verify/u);
  assert.match(moduleSource, /semantic defective/u);
  assert.match(moduleSource, /module manuscript current intent/u);
  assert.match(wrapperSource, /module_manuscript\.pya/u);
});

test("module manuscript semantic verifier trusts an explicit trailing PASS or FAIL line", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /module manuscript semantic review from text "\/\(\?:\^\|\\\\n\)\\\\s\*PASS\\\\s\*\$\/i" be resemble then/u);
  assert.match(moduleSource, /module manuscript semantic review from text "\/\(\?:\^\|\\\\n\)\\\\s\*FAIL\\\\s\*\$\/i" be resemble then/u);
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

test("module manuscript final word retries recompute the verify result on the rewritten section", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /module manuscript hook final verify retry stage/u);
  assert.match(moduleSource, /module manuscript promise final verify retry stage/u);
  assert.match(moduleSource, /module manuscript roadmap final verify retry stage/u);
  assert.match(moduleSource, /module manuscript segment one final verify retry stage/u);
  assert.match(moduleSource, /module manuscript segment two final verify retry stage/u);
  assert.match(moduleSource, /module manuscript segment three final verify retry stage/u);
  assert.match(moduleSource, /module manuscript recap final verify retry stage/u);
  assert.match(moduleSource, /module manuscript cta final verify retry stage/u);
});

test("module manuscript retry ceremonies do not short-circuit before fit retries run", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.doesNotMatch(moduleSource, /su name module manuscript hook retry[\s\S]*?ob name text module manuscript hook pass be equally from text true then be depart do/u);
  assert.doesNotMatch(moduleSource, /su name module manuscript promise retry[\s\S]*?ob name text module manuscript promise pass be equally from text true then be depart do/u);
  assert.doesNotMatch(moduleSource, /su name module manuscript roadmap retry[\s\S]*?ob name text module manuscript roadmap pass be equally from text true then be depart do/u);
  assert.doesNotMatch(moduleSource, /su name module manuscript recap retry[\s\S]*?ob name text module manuscript recap pass be equally from text true then be depart do/u);
  assert.doesNotMatch(moduleSource, /su name module manuscript cta retry[\s\S]*?ob name text module manuscript cta pass be equally from text true then be depart do/u);
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
  assert.match(moduleSource, /module manuscript roadmap semantic stage from text of ob of module manuscript roadmap source basis/u);
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
  assert.match(moduleSource, /to name map module manuscript hook semantic produce be module manuscript semantic pass do/u);
  assert.match(moduleSource, /su name module manuscript hook semantic defect text stage[\s\S]*?ob name text module manuscript hook pass be equally from text false then\s+su name module manuscript hook semantic guarantee stage/u);
  assert.match(moduleSource, /to name map module manuscript roadmap semantic produce be module manuscript semantic pass do/u);
  assert.match(moduleSource, /su name module manuscript roadmap semantic defect text stage[\s\S]*?ob name text module manuscript roadmap pass be equally from text false then\s+su name module manuscript roadmap semantic guarantee stage/u);
  assert.match(moduleSource, /to name map module manuscript segment one semantic produce be module manuscript semantic pass do/u);
  assert.match(moduleSource, /su name module manuscript segment one semantic defect text stage[\s\S]*?ob name text module manuscript segment one pass be equally from text false then\s+su name module manuscript segment one semantic guarantee stage/u);
  assert.match(moduleSource, /fromtext name module manuscript semantic defect text be guarantee do/u);
});

test("module manuscript segment two role verifier does not police overlap that distinctness already handles", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /for segment two tasks, fail only when the paragraph does not actually land a misunderstanding-plus-clarification reveal, or you can point to a materially clearer correction/u);
  assert.match(moduleSource, /Segment two must choose a misunderstanding family whose main claim, correction shape, and explanatory lane do not resemble the lane already used by segment one/u);
  assert.match(moduleSource, /A more specific correction nested inside the same broad field may pass only when it clearly sharpens into a materially different misuse, counterfeit, blockage, paradox, or correction than segment one used/u);
  assert.match(moduleSource, /Segment two must choose a misunderstanding family whose main claim, correction shape, and explanatory lane do not resemble what segment one already covered/u);
});

test("module manuscript segment one treats example and implication as optional add-ons", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /Optional add-ons:/u);
  assert.match(moduleSource, /You may use one small example from AFFAIRS OR ACTIVITIES/u);
  assert.match(moduleSource, /You may include one small immediate implication/u);
  assert.match(moduleSource, /Treat 92 words as the spoken target, not just the minimum/u);
  assert.match(moduleSource, /One light contrast phrase may remain when the paragraph's main move stays affirmative and system-establishing/u);
  assert.match(moduleSource, /[Ff]ail only when contrast becomes a repeated organizing frame or turns the segment into a correction/u);
  assert.match(moduleSource, /If you use an example, keep it brief and subordinate/u);
  assert.match(moduleSource, /Keep scarcity, domination, blockage, counterfeit, or misunderstanding language out of the paragraph's main establish move/u);
  assert.doesNotMatch(moduleSource, /give a simple example/u);
  assert.doesNotMatch(moduleSource, /Use exactly 4 complete sentences/u);
});

test("module manuscript recap retries regenerate with the recap model instead of the generic fit model", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /module manuscript recap retry draft stage ob name text module manuscript recap retry request for name module manuscript recap mind/u);
  assert.match(moduleSource, /module manuscript recap retry platform stage accordingto name module manuscript recap checks for name module manuscript recap mind/u);
  assert.doesNotMatch(moduleSource, /module manuscript recap retry draft stage ob name text module manuscript recap retry request for name module manuscript fit mind/u);
});

test("module manuscript segment one retry caps stay tight enough to curb overshoot", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /su name module manuscript segment one checks be series def[\s\S]*?su name word_max ob num 105 ya/u);
  assert.match(moduleSource, /su name module manuscript section verify accordingto name checks series for name platform mind from text request to name text output atleast num 0\.8 atmost num 0 fromindex num 1 toindex num 4 be ceremony def/u);
  assert.match(moduleSource, /module manuscript section verify run platform ob text of from of this among name module manuscript stage pass be verify platform do/u);
  assert.match(moduleSource, /module manuscript segment one platform stage accordingto name module manuscript segment one platform checks for name module manuscript segment one mind from text of ob of module manuscript segment one request to name text output atleast num 0\.8 atmost num 150 be module manuscript section verify do/u);
  assert.match(moduleSource, /Aim for about 90 words as the real spoken target, not merely the lower bound/u);
  assert.match(moduleSource, /for name module manuscript fit mind to name text output by num 0 atmost num 150 be write do/u);
  assert.match(moduleSource, /for name module manuscript segment one mind to name text output by num 0 atmost num 150 be write do/u);
});
