import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("word frequency ceremony counts tokens into map", async () => {
  forget();

  await run("exists su name words ob ve text one two two be vector ya");
  await run("su name wordmap be map def");
  await run("prah");

  await run("su name word frequency ob text token be ceremony def");
  await run("su text of ob of this ob num 1 to name wordmap be add do");
  await run("prah");

  await run("ob name words at all be word frequency do");

  const map = remember("wordmap");
  assert.equal(map?.be, "map");
  assert.equal(map?.ob?.map?.one?.ob?.num, 1);
  assert.equal(map?.ob?.map?.two?.ob?.num, 2);
});
