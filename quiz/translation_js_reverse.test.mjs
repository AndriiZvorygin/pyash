import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("translation from JavaScript text back to Pyash sentences (assignments + math)", async () => {
  forget();

  const jsText = [
    "let alpha = 1;",
    "alpha = alpha + 2;",
    'const beta = "hi";',
    "alpha = 5;"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.javascript.${jsText}.javascript.quoted from state javascript to state pyash to name output be translation do`
  );

  const result = await interpret(sentence);
  const out = result?.obj ?? result?.value;

  assert.ok(out?.sentences, "should return sentences array");
  const [decl, add, constDecl, assign] = out.sentences;
  assert.equal(decl.subj.name, "alpha");
  assert.equal(decl.exists, true);
  assert.equal(decl.obj.num, 1);
  assert.equal(add.be, "add");
  assert.equal(add.obj.num, 2);
  assert.equal(add.to.name, "alpha");
  assert.equal(constDecl.be, "permanent text");
  assert.equal(constDecl.exists, true);
  assert.equal(assign.obj.num, 5);
  assert.match(out.text, /exists subj name alpha obj num 1 be number ya/);
  assert.match(out.text, /obj num 2 to name alpha be add do/);
});

test("translation from JavaScript math assignments covers compound ops", async () => {
  forget();

  const jsText = [
    "let total = 10;",
    "total -= 3;",
    "total = total * 2;",
    "total /= 5;"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.javascript.${jsText}.javascript.quoted from state javascript to state pyash to name output be translation do`
  );

  const result = await interpret(sentence);
  const out = result?.obj ?? result?.value;

  assert.ok(out?.sentences);
  const [, sub, mul, div] = out.sentences;
  assert.equal(sub.be, "subtract");
  assert.equal(sub.obj.num, 3);
  assert.equal(mul.be, "multiply");
  assert.equal(mul.obj.num, 2);
  assert.equal(div.be, "divide");
  assert.equal(div.obj.num, 5);
  assert.match(out.text, /obj num 3 to name total be subtract do/);
  assert.match(out.text, /obj num 2 to name total be multiply do/);
  assert.match(out.text, /obj num 5 to name total be divide do/);
});
