import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

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
