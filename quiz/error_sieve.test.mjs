import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("error sieve reduces to minimal failing sentence", async () => {
  forget();

  const program = [
    "exists su name foo ob text \"ok\" be text ya",
    "su name bar ob text \"bad\" be text ya"
  ].join("\n");

  await run(`exists su name source ob text quoted.pyash.${program}.pyash.quoted be text ya`);
  await run("ob name source to name text output be error sieve do");

  const out = remember("output")?.ob?.text ?? "";
  assert.equal(out.trim(), "su name bar ob text \"bad\" be text ya");
});
