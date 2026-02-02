import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("success sieve reduces to minimal passing sentence", async () => {
  forget();

  const program = [
    "exists su name foo ob text \"ok\" be text ya",
    "exists su name bar ob text \"ok\" be text ya"
  ].join("\n");

  await run(`exists su name source ob text quoted.pyash.${program}.pyash.quoted be text ya`);
  await run("ob name source to name text output be success sieve do");

  const out = remember("output")?.ob?.text ?? "";
  assert.equal(out.trim(), "exists su name bar ob text \"ok\" be text ya");
});

test("success sieve uses verifier verdict to keep original program", async () => {
  forget();

  await run("su name always fail ob name text source to name text verdict be ceremony def");
  await run("ob text \"FAIL\" be text do");
  await run("su name always fail be ceremony prah");

  const program = [
    "exists su name foo ob text \"ok\" be text ya",
    "exists su name bar ob text \"ok\" be text ya"
  ].join("\n");

  await run(`exists su name source ob text quoted.pyash.${program}.pyash.quoted be text ya`);
  await run("ob name source from name always fail to name text output be success sieve do");

  const out = remember("output")?.ob?.text ?? "";
  assert.equal(out.trim(), program);
});

test("success sieve can shrink using verifier verdict", async () => {
  forget();

  await run("su name always pass ob name text source to name text verdict be ceremony def");
  await run("ob text \"PASS\" be text do");
  await run("su name always pass be ceremony prah");

  const program = [
    "exists su name foo ob text \"ok\" be text ya",
    "exists su name bar ob text \"ok\" be text ya"
  ].join("\n");

  await run(`exists su name source ob text quoted.pyash.${program}.pyash.quoted be text ya`);
  await run("ob name source from name always pass to name text output be success sieve do");

  const out = remember("output")?.ob?.text ?? "";
  assert.equal(out.trim(), "exists su name bar ob text \"ok\" be text ya");
});
