import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("discharge refinery removes refinery from registry", async () => {
  forget();
  await run("su name tmp refinery be refinery def");
  await run('su name stage ob text "ok" be text do');
  await run("prah");

  await run('be discharge as wo refinery ob text "tmp refinery" do');

  await assert.rejects(
    async () => run('ob text "in" from name tmp refinery to name text out be refinery do'),
    (err) => err?.sentence?.su?.name === "refinery defective"
  );
});

test("discharge refinery invalidates refinery and mind aliases bound to provider", async () => {
  forget();
  await run("su name review loop be refinery def");
  await run('su name draft ob text "ok" be text do');
  await run("prah");
  await run('exists su name helper be mind as name "review loop" ya');
  await run('exists su name helper refinery be refinery as name "review loop" ya');

  await run('be discharge as wo refinery ob text "review loop" do');

  assert.equal(remember("helper")?.be, "discharge");
  assert.equal(remember("helper refinery")?.be, "discharge");
  assert.equal(remember("helper")?.from?.name, "refinery");
  assert.equal(remember("helper refinery")?.from?.name, "refinery");
  await assert.rejects(
    async () => run('ob text "task" for name helper to name text out be write do'),
    (err) => err?.sentence?.su?.name === "unknown verb" || err?.sentence?.su?.name === "mind backend missing"
  );
  await assert.rejects(
    async () => run('ob text "task" for name helper refinery to name text out be write do'),
    (err) => err?.sentence?.su?.name === "unknown verb" || err?.sentence?.su?.name === "refinery defective"
  );
});
