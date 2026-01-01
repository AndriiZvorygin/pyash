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
  const out = result?.ob ?? result?.value;

  assert.ok(out?.sentences, "should return sentences array");
  assert.equal(out.sentences[0].su.name, "collector");
  assert.equal(out.sentences[0].ob.num, 5);
  assert.equal(out.sentences[1].be, "subtract");
  assert.equal(out.sentences[1].ob.num, 2);
  assert.equal(out.sentences[1].mood, "do");
  assert.equal(out.sentences[1].from.name, "collector");
});

test("translation from English conditional back to Pyash sentences", async () => {
  forget();

  const englishText = [
    "total is number 0.",
    "if 3 is tiny from 5 then do add 1 to total."
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${englishText}.pyash.quoted from state english to state pyash to name output be translation do`
  );

  const result = await interpret(sentence);
  const out = result?.ob ?? result?.value;

  assert.ok(out?.sentences, "should return sentences array");
  const cond = out.sentences[1];
  assert.equal(cond.be, "tiny");
  assert.equal(cond.ob.num, 3);
  assert.equal(cond.from.num, 5);
  assert.equal(cond.mood, "do");
  assert.equal(cond.consequence?.be, "add");
  assert.equal(cond.consequence?.to?.name, "total");
  assert.match(out.text, /su name total ob num 0 be number ya/);
  assert.match(out.text, /ob num 3 from num 5 be tiny then ob num 1 to name total be add do/);
});
