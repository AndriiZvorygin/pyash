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

test("verify platform supports not_prefix_of check with named reference text", async () => {
  forget();

  await run("exists su name promise out ob text \"True power arises when you choose service over control.\" be text ya");

  await run("su name draft maker ob text task to name text draft out be ceremony def");
  await run("ob text \"True power arises when you choose service\" to name text draft out be text do");
  await run("prah");

  await run("su name pass verifier ob text packet to name text verdict be ceremony def");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await run("su name checks be series def");
  await run("su name not_prefix_of ob name text promise out ya");
  await run("prah");

  await assert.rejects(
    () => run("ob text \"task\" for name draft maker among name pass verifier accordingto name checks fromindex num 1 toindex num 1 to name text result be verify platform do"),
    /verify platform defective: retries exhausted/
  );
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

test("verify platform runs deterministic checks before invoking verifier models", async () => {
  forget();

  await run("exists su name verifier count ob num 0 be number ya");

  await run("su name draft maker ob text task to name text draft out be ceremony def");
  await run("ob text \"too many words here.\" to name text draft out be text do");
  await run("prah");

  await run("su name counting verifier ob text packet to name text verdict be ceremony def");
  await run("ob num 1 to name verifier count be plus do");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await run("su name checks be series def");
  await run("su name word_max ob num 1 ya");
  await run("prah");

  await assert.rejects(
    () => run("ob text \"task\" for name draft maker among name counting verifier accordingto name checks fromindex num 1 toindex num 2 to name text result be verify platform do"),
    /verify platform defective: retries exhausted/
  );

  assert.equal(remember("verifier count")?.ob?.num, 0);
  assert.equal(remember("verify platform last verifier")?.ob?.map?.rows?.length ?? 0, 0);
  assert.match(String(remember("verify platform last checks")?.ob?.map?.rows?.[0]?.detail ?? ""), /words=/u);
});

test("verify platform output can be piped into a command within the same ceremony", async () => {
  forget();

  await run("su name platform ob text task to name text draft out be ceremony def");
  await run("ob text quoted.text.line one\\nline two.text.quoted to name text draft out be text do");
  await run("prah");

  await run("su name pass verifier ob text packet to name text verdict be ceremony def");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await run("su name helper for name platform from text request to name text result be ceremony def");
  await run("  su name verify stage ob text of from of this among name pass verifier be verify platform do");
  await run("  ob text \"node command/normalize_escaped_newlines.mjs\" fromtext name result to name text result be command do");
  await run("  su name result ret");
  await run("prah");

  await run("for name platform from text \"task\" to name text output be helper do");
  assert.equal(remember("output")?.ob?.text, "line one\nline two");
});

test("verify platform firehose deterministic failures never invoke verifiers", async () => {
  forget();

  await run("exists su name verifier count ob num 0 be number ya");
  await run("exists su name draft count ob num 0 be number ya");

  await run("su name draft maker ob text task to name text draft out be ceremony def");
  await run("ob num 1 to name draft count be plus do");
  await run('ob text "this candidate is intentionally long and always fails deterministic word cap checks." to name text draft out be text do');
  await run("prah");

  await run("su name counting verifier ob text packet to name text verdict be ceremony def");
  await run("ob num 1 to name verifier count be plus do");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await run("su name checks be series def");
  await run("su name word_max ob num 3 ya");
  await run("prah");

  await assert.rejects(
    () => run("ob text \"task\" for name draft maker among name counting verifier accordingto name checks fromindex num 1 toindex num 25 to name text result be verify platform do"),
    /verify platform defective: retries exhausted/
  );

  assert.equal(remember("draft count")?.ob?.num, 25);
  assert.equal(remember("verifier count")?.ob?.num, 0);
  assert.equal(remember("verify platform attempts used")?.ob?.num, 25);
  assert.equal(remember("verify platform stop reason")?.ob?.text, "max retries");
});

test("verify platform firehose calls verifier only after deterministic checks pass", async () => {
  forget();

  await run("exists su name verifier count ob num 0 be number ya");
  await run("exists su name draft count ob num 0 be number ya");

  await run("su name draft maker ob text task to name text draft out be ceremony def");
  await run("ob num 1 to name draft count be plus do");
  await run("ob name draft count be tiny from num 10 then ob text \"this candidate is intentionally long and fails until late retry.\" to name text draft out be text do");
  await run("ob name draft count be giant from num 9 then ob text \"ok.\" to name text draft out be text do");
  await run("prah");

  await run("su name counting verifier ob text packet to name text verdict be ceremony def");
  await run("ob num 1 to name verifier count be plus do");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await run("su name checks be series def");
  await run("su name word_max ob num 1 ya");
  await run("prah");

  await run("ob text \"task\" for name draft maker among name counting verifier accordingto name checks fromindex num 1 toindex num 20 to name text result be verify platform do");

  assert.equal(remember("result")?.ob?.text, "ok.");
  assert.equal(remember("draft count")?.ob?.num, 10);
  assert.equal(remember("verifier count")?.ob?.num, 1);
  assert.equal(remember("verify platform attempts used")?.ob?.num, 10);
  assert.equal(remember("verify platform stop reason")?.ob?.text, "pass");
});

test("verify platform variant firehose uses latest candidate not stale historical output", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = JSON.stringify([
    "BAD_COPY_ALPHA tiny.",
    "BAD_COPY_BETA words are enough now.",
    "GOOD_COPY_GAMMA words are enough now."
  ]);

  try {
    forget();

    await run("exists su name verifier count ob num 0 be number ya");
    await run("exists su name draft maker be mind as name \"fixture-draft\" fromtext text \"fixture\" ya");

    await run("su name latest only verifier ob text packet to name text verdict be ceremony def");
    await run("ob num 1 to name verifier count be plus do");
    await run("ob text FAIL to name text verdict be text do");
    await run("ob name verifier count be giant from num 1 then ob text PASS to name text verdict be text do");
    await run("prah");

    await run("su name checks be series def");
    await run("su name word_min ob num 4 ya");
    await run("prah");

    await run("ob text \"task\" for name draft maker among name latest only verifier accordingto name checks fromindex num 1 toindex num 5 to name text result be verify platform do");

    assert.equal(remember("result")?.ob?.text, "GOOD_COPY_GAMMA words are enough now.");
    assert.equal(remember("verifier count")?.ob?.num, 2);
    assert.equal(remember("verify platform attempts used")?.ob?.num, 3);
    assert.equal(remember("verify platform stop reason")?.ob?.text, "pass");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("verify platform source carries generator atmost support for mind calls", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("../program/verbs/verify_platform.mjs", import.meta.url), "utf8"));

  assert.match(source, /call\.atmost = \{ num: Number\(maxTokens\) \};/u);
  assert.match(source, /const generationAtmost = Number\.isFinite\(rawGenerationAtmost\) && rawGenerationAtmost > 0/u);
  assert.match(source, /maxTokens: generationAtmost/u);
});

test("verify platform inherits missing fields from the ceremony evoke sentence", async () => {
  forget();

  await run("su name alpha ob text task to name text draft out be ceremony def");
  await run(`ob text quoted.text.alpha line one
alpha line two
alpha line three
alpha line four.text.quoted to name text draft out be text do`);
  await run("prah");

  await run("su name pass verifier ob text packet to name text verdict be ceremony def");
  await run("ob text PASS to name text verdict be text do");
  await run("prah");

  await run("su name checks be series def");
  await run("su name line_count_min ob num 4 ya");
  await run("su name line_count_max ob num 4 ya");
  await run("prah");

  await run("su name helper accordingto name checks for name platform from text request atleast num 0.8 atmost num 9 fromindex num 1 toindex num 1 to name text result be ceremony def");
  await run("  su name inner ob text of from of this among name pass verifier be verify platform do");
  await run("  su name inner ret");
  await run("prah");

  await run("su name first from text \"x\" for name alpha accordingto name checks to name text output atleast num 0.8 atmost num 9 fromindex num 1 toindex num 1 be helper do");
  assert.match(String(remember("output")?.ob?.text ?? ""), /^alpha line one/mu);
});
