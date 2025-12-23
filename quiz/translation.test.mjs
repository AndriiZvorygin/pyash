import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, allRemember } from "../program/remember/index.mjs";

test("translation from Pyash text to English text", async () => {
  forget();

  const program = "su name alpha ob num 1 be number ya\nsubj name beta ob text hello be permanent text ya";
  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted from state pyash to state english to name output be translation do`
  );

  const result = await interpret(sentence);
  const translation = result?.ob?.text ?? result?.value?.text;

  assert.ok(translation);
  assert.match(translation, /alpha is number 1/);
  assert.match(translation, /beta is permanent text "hello"/);

  const mem = allRemember();
  const output = mem.find(s => s.su?.name === "output");
  assert.ok(output);
  assert.equal(output.be, "english");
});

test("translation from Pyash conditional to English", async () => {
  forget();

  const program = [
    "su name total ob num 0 be number ya",
    "ob num 3 be tiny from num 5 then ob num 1 to name total be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted from state pyash to state english to name output be translation do`
  );

  const result = await interpret(sentence);
  const translation = result?.ob?.text ?? result?.value?.text;

  assert.ok(translation);
  assert.match(translation, /if 3 is tiny from 5 then do add 1 to total/);
});

test("translation Pyash -> English -> Pyash roundtrip", async () => {
  forget();

  const pyashProgram = [
    "su name alpha ob num 1 be number ya",
    "ob num 2 to name alpha be add do"
  ].join("\\n");

  // Pyash -> English
  const toEnglish = parse(
    `from text quoted.pyash.${pyashProgram}.pyash.quoted from state pyash to state english to name english_out be translation do`
  );
  const englishResult = await interpret(toEnglish);
  const englishText = englishResult?.ob?.text ?? englishResult?.value?.text;
  assert.ok(englishText, "should produce english text");

  // English -> Pyash
  const backToPyash = parse(
    `from text quoted.pyash.${englishText}.pyash.quoted from state english to state pyash to name pyash_out be translation do`
  );
  const pyashResult = await interpret(backToPyash);
  const sentences = pyashResult?.ob?.sentences ?? pyashResult?.value?.sentences;
  assert.ok(Array.isArray(sentences), "roundtrip should yield sentences array");
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0].su?.name, "alpha");
  assert.equal(sentences[0].ob?.num, 1);
  assert.equal(sentences[1].be, "add");
  assert.equal(sentences[1].ob?.num, 2);
  assert.equal(sentences[1].to?.name, "alpha");
});
