import test from "node:test";
import assert from "node:assert/strict";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile converts inline Pyash text to C text", async () => {
  forget();

  const program = "exists su name alpha ob num 1 be number ya\nexists su name beta ob text hello be permanent text ya";
  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state c to text output be compile do`
  );

  const result = await interpret(sentence);
  const c = result?.ob?.text ?? result?.value?.text;
  assert.ok(c, `compile returned: ${JSON.stringify(result)}`);
  assert.match(c, /double alpha = 1;/);
  assert.match(c, /char beta\[PYA_TEXT_CAP\] = "hello";/);
});

test("compile converts inline Pyash text to C with reassignment", async () => {
  forget();

  const program = [
    "exists su name alpha ob num 1 be number ya",
    "exists su name alpha ob num 3 be number ya"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state c to text output be compile do`
  );

  const result = await interpret(sentence);
  const c = result?.ob?.text ?? result?.value?.text;
  assert.ok(c, `compile returned: ${JSON.stringify(result)}`);
  assert.match(c, /double alpha = 1;/);
  assert.match(c, /alpha = 3;/);
  assert.doesNotMatch(c, /double alpha = 3;/);
});

test("compile emits C if-statement for tiny then", async () => {
  forget();

  const program = [
    "exists su name total ob num 0 be number ya",
    "ob num 3 be tiny from num 5 then ob num 1 to name total be plus do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state c to text output be compile do`
  );

  const result = await interpret(sentence);
  const c = result?.ob?.text ?? result?.value?.text;

  assert.ok(c);
  assert.match(c, /double total = 0;/);
  assert.match(c, /if\s*\(\(3\)\s*<\s*\(5\)\)\s*\{\s*total = total \+ 1;/s);
});
