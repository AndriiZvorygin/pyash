import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, allRemember } from "../program/remember/index.mjs";

test("translation from Pyash text to English text", async () => {
  forget();

  const program = "subj name alpha obj num 1 be number ya\nsubj name beta obj text hello be permanent text ya";
  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted from state pyash to state english to name output be translation do`
  );

  const result = await interpret(sentence);
  const translation = result?.obj?.text ?? result?.value?.text;

  assert.ok(translation);
  assert.match(translation, /alpha is number 1/);
  assert.match(translation, /beta is permanent text "hello"/);

  const mem = allRemember();
  const output = mem.find(s => s.subj?.name === "output");
  assert.ok(output);
  assert.equal(output.be, "english");
});

test("translation from Pyash conditional to English", async () => {
  forget();

  const program = [
    "subj name total obj num 0 be number ya",
    "obj num 3 be tiny from num 5 then obj num 1 to name total be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted from state pyash to state english to name output be translation do`
  );

  const result = await interpret(sentence);
  const translation = result?.obj?.text ?? result?.value?.text;

  assert.ok(translation);
  assert.match(translation, /if 3 is tiny from 5 then do add 1 to total/);
});
