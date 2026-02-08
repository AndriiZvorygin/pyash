import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("line tail returns last non-empty lines", async () => {
  forget();
  await run("ob text quoted.text.a\n\nb\n  \nc\n.text.quoted atmost num 2 to name text tail be line tail do");
  assert.equal(remember("tail")?.ob?.text, "b\nc");
});

test("cast parses bounded numeric value and returns hollow when out of range", async () => {
  forget();
  await run('ob text "score 0.84 ready" from num 0 become name num to name num score be cast do');
  assert.equal(remember("score")?.ob?.num, 0.84);

  await run('ob text "score 1.4 ready" from num 0 to num 1 become name num to name text bounded be cast do');
  assert.equal(remember("bounded")?.ob?.hollow, true);
});

test("guarantee passes on truth and fails on lie", async () => {
  forget();
  await run("ob bool truth be guarantee do");
  await assert.rejects(
    async () => run('ob bool lie fromtext text "must stay true" be guarantee do'),
    (err) => err?.sentence?.su?.name === "guarantee defective" && String(err?.sentence?.ob?.text ?? "").includes("must stay true")
  );
});
