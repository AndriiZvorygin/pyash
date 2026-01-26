import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("translation Pyash -> French -> Pyash roundtrip", async () => {
  forget();

  const pyashProgram = [
    "su name collector ob num 5 be number ya",
    "ob num 2 to name collector be plus do"
  ].join("\\n");

  const toFrench = parse(
    `from text quoted.pyash.${pyashProgram}.pyash.quoted from state pyash to state french to name french_out be translation do`
  );
  const frenchResult = await interpret(toFrench);
  const frenchText = frenchResult?.ob?.text ?? frenchResult?.value?.text;
  assert.ok(frenchText, "should produce french text");

  const backToPyash = parse(
    `from text quoted.pyash.${frenchText}.pyash.quoted from state french to state pyash to name pyash_out be translation do`
  );
  const pyashResult = await interpret(backToPyash);
  const sentences = pyashResult?.ob?.sentences ?? pyashResult?.value?.sentences;
  assert.ok(Array.isArray(sentences), "roundtrip should yield sentences array");
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0].su?.name, "collector");
  assert.equal(sentences[0].ob?.num, 5);
  assert.equal(sentences[1].be, "plus");
  assert.equal(sentences[1].ob?.num, 2);
  assert.equal(sentences[1].to?.name, "collector");
});
