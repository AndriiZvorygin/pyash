import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runScript } from "./helpers/run_script.mjs";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

const repoRoot = path.join(process.cwd());
const moduleFilename = path.join(repoRoot, "module", "module_manuscript_scored.pya");
const wrapperFilename = path.join(repoRoot, "examples", "pyash", "refinery-module-manuscript-scored-run.pya");
const execFileAsync = promisify(execFile);

async function run(line) {
  return interpret(parse(line));
}

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
  assert.match(moduleSource, /module manuscript scored history from name map checkpoint to name series history/u);
  assert.match(moduleSource, /module manuscript scored history from name map first with name map second to name series history/u);
  assert.match(moduleSource, /module manuscript scored settle from name map checkpoint with name series history to name map state/u);
  assert.match(moduleSource, /module manuscript scored collect pair from name map first with name map second to name map state/u);
  assert.match(moduleSource, /module manuscript scored promote from name map checkpoint with name map state to name map nextstate/u);
  assert.match(moduleSource, /module manuscript scored semantic score from text source with text candidate to name map produce/u);
  assert.match(moduleSource, /"candidate":"","review":"","score":0,"passing":"false","attempt":0,"attempt_name":"","best":"false"/u);
  assert.match(moduleSource, /"best_attempt":"","current_attempt":"","best_score":0,"passing":"false","candidate":"","review":"","score":0,"history":""/u);
  assert.match(moduleSource, /module manuscript scored checkpoint attempt slot ob attempt of checkpoint be nickname/u);
  assert.match(moduleSource, /module manuscript scored checkpoint attempt name slot ob attempt_name of checkpoint be nickname/u);
  assert.match(moduleSource, /su name module manuscript scored attempt row ob name module manuscript scored history checkpoint attempt name by num of name module manuscript scored history checkpoint attempt be text ya/u);
  assert.match(moduleSource, /module manuscript scored history first attempt name/u);
  assert.match(moduleSource, /module manuscript scored history second attempt name/u);
  assert.match(moduleSource, /module manuscript scored state history slot ob history of state be nickname/u);
  assert.match(moduleSource, /module manuscript scored promote history slot ob history of nextstate be nickname/u);
  assert.match(moduleSource, /ob text of attempt_name of map of from of this to name module manuscript scored promote current attempt slot be text do/u);
  assert.match(moduleSource, /ob num of score of map of from of this to name module manuscript scored promote score slot be plus do/u);
  assert.match(moduleSource, /ob text "history" to name module manuscript scored promote history slot be text do/u);
  assert.match(moduleSource, /ob text of attempt_name of map of from of this to name module manuscript scored promote best attempt slot be text do/u);
  assert.match(moduleSource, /ob num of score of map of from of this to name module manuscript scored promote best score slot be plus do/u);
  assert.match(moduleSource, /module manuscript scored collect pair best attempt slot/u);
  assert.match(moduleSource, /ob text of attempt_name of map of from of this to name module manuscript scored collect pair best attempt slot be text do/u);
  assert.match(moduleSource, /ob num of score of map of from of this to name module manuscript scored collect pair best score slot be plus do/u);
  assert.match(moduleSource, /ob text "history" to name module manuscript scored collect pair history slot be text do/u);
  assert.match(moduleSource, /module manuscript scored score line from num 0 to num 1 become name num to name num module manuscript scored score be cast do/u);
  assert.ok(moduleSource.includes('module manuscript scored score line from text "/^\\\\s*PASS\\\\b/i" be resemble then'));
  assert.ok(moduleSource.includes('module manuscript scored score line from text "/^\\\\s*FAIL\\\\b/i" be resemble then'));
  assert.match(moduleSource, /module manuscript scored semantic request for name module manuscript scored semantic score mind/u);
  assert.match(moduleSource, /module manuscript scored semantic candidate slot ob candidate of produce be nickname/u);
  assert.match(moduleSource, /module manuscript scored semantic review slot ob review of produce be nickname/u);
  assert.match(moduleSource, /module manuscript scored semantic score line from num 0 to num 1 become name num to name num module manuscript scored semantic score be cast do/u);
  assert.ok(moduleSource.includes('module manuscript scored semantic score line from text "/^\\\\s*PASS\\\\b/i" be resemble then'));
  assert.ok(moduleSource.includes('module manuscript scored semantic score line from text "/^\\\\s*FAIL\\\\b/i" be resemble then'));
  assert.match(moduleSource, /If the candidate is source-faithful and plausibly does the stage job, score at least 0\.8/u);
  assert.match(moduleSource, /exists su name module manuscript scored checkpoint be export ya/u);
  assert.match(moduleSource, /exists su name module manuscript scored history be export ya/u);
  assert.match(moduleSource, /exists su name module manuscript scored collect pair be export ya/u);
  assert.match(moduleSource, /exists su name module manuscript scored promote be export ya/u);
  assert.match(moduleSource, /exists su name module manuscript scored semantic score be export ya/u);
  assert.match(moduleSource, /exists su name module manuscript scored settle be export ya/u);
});

test("module manuscript scored promote keeps the higher-scored attempt as best", async () => {
  forget();

  await run('from filename "./module/module_manuscript_scored.pya" ob name manuscript as wo module to name scored be import do');
  await run('ob text quoted.text.{"candidate":"first candidate","review":"first review","score":0.62,"passing":"false","attempt":1,"attempt_name":"attempt 1","best":"false"}.text.quoted to name map first be import do');
  await run('ob text quoted.text.{"best_attempt":"attempt 0","current_attempt":"attempt 0","best_score":0.51,"passing":"false","candidate":"old candidate","review":"old review","score":0.51,"history":"history row"}.text.quoted to name map state be import do');

  await run("from name map first to name map nextstate with name map state be module manuscript scored module manuscript scored promote do");

  const out = remember("nextstate")?.ob?.map ?? {};
  assert.equal(out.best_attempt?.ob?.text ?? out.best_attempt?.text, "attempt 1");
  assert.equal(out.current_attempt?.ob?.text ?? out.current_attempt?.text, "attempt 1");
  assert.equal(out.candidate?.ob?.text ?? out.candidate?.text, "first candidate");
  assert.equal(out.review?.ob?.text ?? out.review?.text, "first review");
  assert.equal(out.history?.ob?.text ?? out.history?.text, "history");
});

test("module manuscript scored collect pair builds history and promotes best", async () => {
  forget();

  await run('from filename "./module/module_manuscript_scored.pya" ob name manuscript as wo module to name scored be import do');
  await run('ob text quoted.text.{"candidate":"first candidate","review":"first review","score":0.71,"passing":"false","attempt":1,"attempt_name":"attempt 1","best":"false"}.text.quoted to name map first be import do');
  await run('ob text quoted.text.{"candidate":"second candidate","review":"second review","score":0.86,"passing":"true","attempt":2,"attempt_name":"attempt 2","best":"false"}.text.quoted to name map second be import do');

  await run("from name map second to name map state with name map first be module manuscript scored module manuscript scored collect pair do");

  const out = remember("state")?.ob?.map ?? {};
  assert.equal(out.best_attempt?.ob?.text ?? out.best_attempt?.text, "attempt 2");
  assert.equal(out.current_attempt?.ob?.text ?? out.current_attempt?.text, "attempt 2");
  assert.equal(out.candidate?.ob?.text ?? out.candidate?.text, "second candidate");
  assert.equal(out.review?.ob?.text ?? out.review?.text, "second review");
  assert.equal(out.history?.ob?.text ?? out.history?.text, "history");
});

test("module manuscript scored fixture mind review supports deterministic score extraction", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "Source-faithful and stage-fit with clear progression.\n0.86";

  try {
    forget();
    await run('from filename "./module/module_manuscript_scored.pya" ob name manuscript as wo module to name scored be import do');
    await run('ob text "score this candidate" to name text request be text do');
    await run("ob name text request for name mind to name text review by num 0 atmost num 320 be write do");
    await run("ob name text review atmost num 1 to name text score line be line tail do");
    await run("ob name text score line from num 0 to num 1 become name num to name num score be cast do");

    assert.equal(remember("review")?.ob?.text, "Source-faithful and stage-fit with clear progression.\n0.86");
    assert.equal(remember("score line")?.ob?.text, "0.86");
    assert.equal(remember("score")?.ob?.num, 0.86);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("module manuscript scored section verify retries hook generation until deterministic hook checks pass", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = JSON.stringify([
    "Too short",
    "True power opens your hidden potential."
  ]);

  try {
    forget();
    await run('from filename "./module/module_manuscript_scored.pya" ob name manuscript as wo module to name scored be import do');
    await run('ob text "ROLE:\\nHook centered on tension or truth.\\n\\nTARGET_WORDS:\\n6-8\\n\\nGOAL_WORDS:\\n7\\n\\nDRAFT:\\nToo short" to name text hook request be text do');
    await run("su name hook section verify stage accordingto name module manuscript scored internal module manuscript hook checks for name module manuscript scored internal module manuscript hook fit mind from text of ob of hook request to name text output be module manuscript section verify do");
    await run("su name hook retry verify stage be verify as wo word count atleast num 6 atmost num 8 from name text output to name map hook retry verify do");

    assert.equal(remember("output")?.ob?.text, "True power opens your hidden potential.");
    assert.equal(remember("hook retry verify")?.ob?.map?.pass, true);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("module manuscript scored retry flow does not short-circuit pass before platform checks", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.doesNotMatch(
    moduleSource,
    /module manuscript hook retry draft verify[\s\S]{0,260}module manuscript hook pass be text do/u
  );
  assert.doesNotMatch(
    moduleSource,
    /module manuscript promise retry draft stage[\s\S]{0,260}module manuscript promise pass be text do/u
  );
  assert.doesNotMatch(
    moduleSource,
    /module manuscript roadmap retry draft stage[\s\S]{0,260}module manuscript roadmap pass be text do/u
  );
  assert.doesNotMatch(
    moduleSource,
    /module manuscript segment one retry draft stage[\s\S]{0,260}module manuscript segment one pass be text do/u
  );
  assert.doesNotMatch(
    moduleSource,
    /module manuscript recap retry draft stage[\s\S]{0,260}module manuscript recap pass be text do/u
  );
  assert.doesNotMatch(
    moduleSource,
    /module manuscript cta retry draft stage[\s\S]{0,260}module manuscript cta pass be text do/u
  );

  assert.match(moduleSource, /module manuscript hook retry platform stage accordingto name module manuscript hook checks/u);
  assert.match(moduleSource, /module manuscript promise retry platform stage accordingto name module manuscript promise checks/u);
  assert.match(moduleSource, /module manuscript roadmap retry platform stage accordingto name module manuscript roadmap checks/u);
  assert.match(moduleSource, /module manuscript segment one retry platform stage accordingto name module manuscript segment one checks/u);
  assert.match(moduleSource, /module manuscript recap retry platform stage accordingto name module manuscript recap checks/u);
  assert.match(moduleSource, /module manuscript cta retry platform stage accordingto name module manuscript cta checks/u);
});

test("module manuscript scored segment one retry adapts atmost from prior word count", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /module manuscript hook platform checks be series def[\s\S]*word_min ob num 6[\s\S]*word_max ob num 8/u);
  assert.match(moduleSource, /module manuscript segment one retry length stage be verify as wo word count atleast num 85 atmost num 105 from name text output to name map module manuscript segment one retry length do/u);
  assert.match(moduleSource, /ob num 112 to name num module manuscript segment one retry cap be plus do/u);
  assert.match(moduleSource, /ob num of words of module manuscript segment one retry length be giant from num 105 then ob num 104 to name num module manuscript segment one retry cap be plus do/u);
  assert.match(moduleSource, /ob num of words of module manuscript segment one retry length be tiny from num 85 then ob num 128 to name num module manuscript segment one retry cap be plus do/u);
  assert.match(moduleSource, /for name module manuscript fit mind to name text output by num 0 atmost num of name module manuscript segment one retry cap be write do/u);
  assert.match(moduleSource, /for name module manuscript segment one mind to name text output by num 0 atmost num of name module manuscript segment one retry cap be write do/u);
});

test("module manuscript scored fixture refinery run avoids unknown-verb wiring failures", async () => {
  const fixtureResponses = [
    "True power is an inherent capacity of the awakened self to direct will and attention in loving service. It is not borrowed from outside conditions but rises within consciousness as intelligent light and wisdom. This force becomes practical when desire, intention, and disciplined emotional clarity are aligned with love. In that alignment, people co-create circumstances with steadier coherence, clearer purpose, and greater responsibility for outcomes. The same current expands when shared, so service strengthens both the individual and the collective field at once.",
    "The candidate stays grounded in the source and preserves the same teaching meaning.\nPASS",
    "PASS",
    "The candidate fulfills the role by defining the system and explaining the mechanism in affirmative language.\nPASS",
    "PASS",
    "The candidate is source-faithful and role-fit for Segment 1.\n0.9"
  ];

  let stderr = "";
  try {
    await execFileAsync("node", [
      "command/run_pya_program.mjs",
      "--verbose",
      "examples/pyash/refinery-module-manuscript-scored-run.pya",
      "know/input/power-learnteaching.txt",
      "power"
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PYA_MIND_RESPONSE: JSON.stringify(fixtureResponses)
      }
    });
  } catch (error) {
    stderr = String(error?.stderr ?? "");
  }

  assert.doesNotMatch(stderr, /Unknown verb:\s*undefined/u);
  assert.match(stderr, /(verify platform defective|guarantee defective)/u);
});
