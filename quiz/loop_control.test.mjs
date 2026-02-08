import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("loop supports continue and depart controls", async () => {
  forget();

  await run("exists su name hits ob num 0 be number ya");
  await run("exists su name sum ob num 0 be number ya");
  await run("su name walker fromindex num 0 toindex num 0 be ceremony def");
  await run("ob num 1 to name hits be plus do");
  await run("ob name hits from num 2 be equally then be continue do");
  await run("ob name hits from num 4 be equally then be depart do");
  await run("ob num 10 to name sum be plus do");
  await run("prah");

  await run("fromindex num 1 toindex num 9 be walker do");

  assert.equal(remember("hits")?.ob?.num, 4);
  assert.equal(remember("sum")?.ob?.num, 20);
});

test("depart outside loop fails", async () => {
  forget();
  await assert.rejects(
    async () => run("be depart do"),
    (err) => err?.sentence?.su?.name === "loop control defective"
  );
});
