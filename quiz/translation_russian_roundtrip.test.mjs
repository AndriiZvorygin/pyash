import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("translation Pyash -> Russian -> Pyash roundtrip", async () => {
  forget();

  const pyashProgram = [
    "su name collector ob num 5 be number ya",
    "ob num 2 to name collector be plus do"
  ].join("\\n");

  const toRussian = parse(
    `from text quoted.pyash.${pyashProgram}.pyash.quoted from state pyash to state russian to name russian_out be translation do`
  );
  const russianResult = await interpret(toRussian);
  const russianText = russianResult?.ob?.text ?? russianResult?.value?.text;
  assert.ok(russianText, "should produce russian text");

  const backToPyash = parse(
    `from text quoted.pyash.${russianText}.pyash.quoted from state russian to state pyash to name pyash_out be translation do`
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
