import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { runRefinery } from "../program/bridge/refinery.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("refinery resumes ratify gate with boolean decision + raw input", async () => {
  forget();
  await run("su name flow be refinery def");
  await run("su name gate ob text \"Approve?\" be command propose");
  await run("exists su name after ob num 1 be number ya");
  await run("prah");

  const firstResult = await runRefinery({ name: "flow", interpret });
  assert.equal(firstResult?.be, "ratify");
  assert.equal(firstResult?.mood, "do");
  const token = firstResult?.fromtext?.text;
  assert.ok(token);

  const results = [];
  await runRefinery({
    name: "flow",
    interpret,
    resume: { token, decision: "truth", raw: "y" },
    onResult: (res) => results.push(res)
  });

  const decision = results.find((res) => res?.be === "ratify" && res?.mood === "ya");
  assert.ok(decision);
  assert.equal(decision?.ob?.boolean, true);
  assert.equal(decision?.totext?.text, "y");
  assert.equal(decision?.fromtext?.text, token);

  const after = remember("after");
  assert.equal(after?.ob?.num, 1);
});
