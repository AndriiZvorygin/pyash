import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { runRefinery } from "../program/bridge/refinery.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("refinery exports platform output by declared to name handle", async () => {
  forget();

  await run("su name flow be refinery def");
  await run('su name stage ob text "hello" to name publish be text do');
  await run("prah");

  const res = await run("from name flow be refinery do");
  assert.notEqual(res?.be, "error");
  assert.equal(remember("publish")?.ob?.text, "hello");
});

test("refinery wraps raw thrown errors as pyash error sentences", async () => {
  forget();

  await run("su name flow be refinery def");
  await run('su name stage ob text "hello" be text do');
  await run("prah");

  const res = await runRefinery({
    name: "flow",
    interpret: async () => {
      throw new Error("boom");
    }
  });
  assert.equal(res?.be, "error");
  assert.equal(res?.mood, "ya");
  assert.equal(res?.su?.name, "platform defective");
  assert.match(String(res?.ob?.text ?? ""), /boom/);
});
