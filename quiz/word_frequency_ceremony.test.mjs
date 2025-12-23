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

  await run("exists subj name words obj ve text one two two be vector ya");
  await run("subj name wordmap be map def");
  await run("prah");

  await run("subj name word frequency obj text token be ceremony def");
  await run("subj text of obj of this obj num 1 to name wordmap be add do");
  await run("prah");

  await run("obj name words at all be word frequency do");

  const map = remember("wordmap");
  assert.equal(map?.be, "map");
  assert.equal(map?.obj?.map?.one?.num, 1);
  assert.equal(map?.obj?.map?.two?.num, 2);
});
