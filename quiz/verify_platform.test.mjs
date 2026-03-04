import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("verify platform retries until deterministic checks pass", async () => {
  forget();

  await run("exists su name draft count ob num 0 be number ya");
  await run("su name draft maker ob text task to name text draft out be ceremony def");
  await run("ob num 1 to name draft count be plus do");
  await run("ob name draft count be equally from num 1 then ob text \"short.\" to name text draft out be text do");
  await run("ob name draft count be equally from num 2 then ob text \"this\" to name text draft out be text do");
  await run("prah");

  await run("su name pass verifier ob text packet to name text verdict be ceremony def");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await run("su name checks be series def");
  await run("su name must_match_pattern ob text \"^this$\" ya");
  await run("prah");

  await run("ob text \"task\" for name draft maker among name pass verifier accordingto name checks fromindex num 1 toindex num 3 to name text result be verify platform do");

  assert.equal(remember("result")?.ob?.text, "this");
  assert.equal(remember("verify platform attempts used")?.ob?.num, 2);
  assert.equal(remember("verify platform stop reason")?.ob?.text, "pass");
});

test("verify platform fails when any verifier in among name series fails", async () => {
  forget();

  await run("su name draft maker ob text task to name text draft out be ceremony def");
  await run("ob text \"stable candidate.\" to name text draft out be text do");
  await run("prah");

  await run("su name pass verifier ob text packet to name text verdict be ceremony def");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await run("su name fail verifier ob text packet to name text verdict be ceremony def");
  await run("ob text FAIL to name text verdict be text do");
  await run("prah");

  await run("su name verifier series be series def");
  await run("su name pass verifier ob text \"\" be text ya");
  await run("su name fail verifier ob text \"\" be text ya");
  await run("prah");

  await assert.rejects(
    () => run("ob text \"task\" for name draft maker among name verifier series fromindex num 1 toindex num 1 to name text result be verify platform do"),
    /verify platform defective: retries exhausted/
  );
});

test("verify platform accepts among ve name shorthand", async () => {
  forget();

  await run("su name draft maker ob text task to name text draft out be ceremony def");
  await run("ob text \"candidate text.\" to name text draft out be text do");
  await run("prah");

  await run("su name one ob text packet to name text verdict be ceremony def");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await run("su name two ob text packet to name text verdict be ceremony def");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await run("ob text \"task\" for name draft maker among ve name one two fromindex num 1 toindex num 1 to name text result be verify platform do");
  assert.equal(remember("result")?.ob?.text, "candidate text.");
  assert.equal(remember("verify platform stop reason")?.ob?.text, "pass");
});

test("verify platform score gate applies atleast threshold", async () => {
  forget();

  await run("su name draft maker ob text task to name text draft out be ceremony def");
  await run("ob text \"candidate text.\" to name text draft out be text do");
  await run("prah");

  await run("su name score verifier ob text packet to name text verdict be ceremony def");
  await run("ob text \"0.5\" to name text verdict be text do");
  await run("prah");

  await assert.rejects(
    () => run("ob text \"task\" for name draft maker among name score verifier atleast num 0.8 fromindex num 1 toindex num 1 to name text result be verify platform do"),
    /verify platform defective: retries exhausted/
  );
});

test("verify platform accepts qualified deterministic check names", async () => {
  forget();

  await run("su name draft maker ob text task to name text draft out be ceremony def");
  await run("ob text \"ok\" to name text draft out be text do");
  await run("prah");

  await run("su name pass verifier ob text packet to name text verdict be ceremony def");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await run("su name checks be series def");
  await run("su name module internal must_match_pattern ob text \"^ok$\" ya");
  await run("prah");

  await run("ob text \"task\" for name draft maker among name pass verifier accordingto name checks fromindex num 1 toindex num 1 to name text result be verify platform do");
  assert.equal(remember("result")?.ob?.text, "ok");
  assert.equal(remember("verify platform stop reason")?.ob?.text, "pass");
});

test("verify platform treats generator platform errors as retryable", async () => {
  forget();

  await run("su name pass verifier ob text packet to name text verdict be ceremony def");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await assert.rejects(
    () => run("ob text \"task\" for name missing generator among name pass verifier fromindex num 1 toindex num 2 to name text result be verify platform do"),
    /verify platform defective: retries exhausted/
  );

  assert.equal(remember("verify platform attempts used")?.ob?.num, 2);
  assert.equal(remember("verify platform stop reason")?.ob?.text, "max retries");
});

test("verify platform supports line_count_min and line_count_max checks", async () => {
  forget();

  await run("su name draft maker ob text task to name text draft out be ceremony def");
  await run("ob text quoted.text.line one\nline two.text.quoted to name text draft out be text do");
  await run("prah");

  await run("su name pass verifier ob text packet to name text verdict be ceremony def");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await run("su name checks be series def");
  await run("su name line_count_min ob num 2 ya");
  await run("su name line_count_max ob num 2 ya");
  await run("prah");

  await run("ob text \"task\" for name draft maker among name pass verifier accordingto name checks fromindex num 1 toindex num 1 to name text result be verify platform do");
  assert.equal(remember("result")?.ob?.text, "line one\nline two");
  assert.equal(remember("verify platform stop reason")?.ob?.text, "pass");
});
