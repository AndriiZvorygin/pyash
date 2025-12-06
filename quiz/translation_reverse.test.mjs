import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("translation from English text back to Pyash sentences", async () => {
  forget();

  const englishText = [
    'collector is number 5.',
    'do subtract 2 from collector.'
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${englishText}.pyash.quoted from state english to state pyash to name output be translation do`
  );

  const result = await interpret(sentence);
  const out = result?.obj ?? result?.value;

  assert.ok(out?.sentences, "should return sentences array");
  assert.equal(out.sentences[0].subj.name, "collector");
  assert.equal(out.sentences[0].obj.num, 5);
  assert.equal(out.sentences[1].be, "subtract");
  assert.equal(out.sentences[1].obj.num, 2);
  assert.equal(out.sentences[1].mood, "do");
  assert.equal(out.sentences[1].from.name, "collector");
});
