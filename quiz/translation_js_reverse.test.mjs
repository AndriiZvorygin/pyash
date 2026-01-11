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
  const out = result?.ob ?? result?.value;

  assert.ok(out?.sentences, "should return sentences array");
  const [decl, add, constDecl, assign] = out.sentences;
  assert.equal(decl.su.name, "alpha");
  assert.equal(decl.exists, true);
  assert.equal(decl.ob.num, 1);
  assert.equal(add.be, "add");
  assert.equal(add.ob.num, 2);
  assert.equal(add.to.name, "alpha");
  assert.equal(constDecl.be, "permanent text");
  assert.equal(constDecl.exists, true);
  assert.equal(assign.ob.num, 5);
  assert.match(out.text, /exists su name alpha ob num 1 be number ya/);
  assert.match(out.text, /ob num 2 to name alpha be plus do/);
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
  const out = result?.ob ?? result?.value;

  assert.ok(out?.sentences);
  const [, sub, mul, div] = out.sentences;
  assert.equal(sub.be, "subtract");
  assert.equal(sub.ob.num, 3);
  assert.equal(mul.be, "multiply");
  assert.equal(mul.ob.num, 2);
  assert.equal(div.be, "divide");
  assert.equal(div.ob.num, 5);
  assert.match(out.text, /ob num 3 to name total be subtract do/);
  assert.match(out.text, /ob num 2 to name total be multiply do/);
  assert.match(out.text, /ob num 5 to name total be divide do/);
});
