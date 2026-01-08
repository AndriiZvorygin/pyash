import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile converts inline Pyash text to JavaScript text with const for permanent", async () => {
  forget();

  const program = "exists su name alpha ob num 1 be permanent number ya\nexists su name beta ob text hello be permanent text ya";
  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted become javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;
  assert.ok(js);
  assert.match(js, /const alpha = \{[\s\S]*su:\s*\{\s*name:\s*"alpha"\s*\}[\s\S]*ob:\s*\{\s*num:\s*1/s);
  assert.match(js, /let beta = \{[\s\S]*su:\s*\{\s*name:\s*"beta"\s*\}[\s\S]*ob:\s*\{\s*text:\s*"hello"/s);
});

test("compile emits JS for simple add", async () => {
  forget();

  const program = [
    "exists su name collector ob num 0 be number ya",
    "ob num 2 to name collector be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let collector = \{[\s\S]*su:\s*\{\s*name:\s*"collector"\s*\}[\s\S]*ob:\s*\{\s*num:\s*0/s);
  assert.match(js, /collector\.ob\.num = \(collector\.ob\.num \?\? 0\) \+ 2;/);
});

test("compile reassigns without redeclaring when name already exists", async () => {
  forget();

  const program = [
    "exists su name alpha ob num 1 be number ya",
    "su name alpha ob num 2 be number ya"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let alpha = \{[\s\S]*su:\s*\{\s*name:\s*"alpha"\s*\}[\s\S]*ob:\s*\{\s*num:\s*1/s);
  assert.match(js, /alpha = \{[\s\S]*su:\s*\{\s*name:\s*"alpha"[\s\S]*ob:\s*\{\s*num:\s*2/s);
});

test("compile emits console.log for write text", async () => {
  forget();

  const program = [
    "ob text hello be write do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text ?? "";

  assert.match(js, /console\.log\("hello"\);/);
});

test("compile emits console.log for write name using variable reference", async () => {
  forget();

  const program = [
    "exists su name alpha ob text hi be text ya",
    "ob name alpha be write do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text ?? "";

  assert.match(js, /let alpha = \{[\s\S]*su:\s*\{\s*name:\s*"alpha"\s*\}[\s\S]*ob:\s*\{\s*text:\s*"hi"/);
  assert.match(js, /console\.log\(alpha\.ob\?\.(ve\?\.\w+\s*\?\?\s*)?alpha\.ob\?\.(text|num)[^)]*\);/);
});

test("compile emits JS for simple multiply and divide", async () => {
  forget();

  const program = [
    "exists su name collector ob num 10 be number ya",
    "ob num 3 to name collector be multiply do",
    "ob num 2 to name collector be divide do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let collector = \{[\s\S]*su:\s*\{\s*name:\s*"collector"\s*\}[\s\S]*ob:\s*\{\s*num:\s*10/s);
  assert.match(js, /collector\.ob\.num = \(collector\.ob\.num \?\? 0\) \* 3;/);
  assert.match(js, /collector\.ob\.num = \(collector\.ob\.num \?\? 0\) \/ 2;/);
});

test("compile emits JS for text concatenation via add", async () => {
  forget();

  const program = [
    "exists su name message ob text hi be text ya",
    "ob text there to name message be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text ?? "";

  assert.match(js, /message\.ob\.text = \(message\.ob\.text \?\? \"\"\) \+ \"there\";/);
});

test("compile emits JS ceremony with no params", async () => {
  forget();

  const program = [
    "su name noop be ceremony def",
    "su name noop be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /function\s+be_noop\(sentence\)[\s\S]*return\s*sentence;/);
});

test("compile emits JS ceremony with param and body", async () => {
  forget();

  const program = [
    "exists su name bucket ob num 0 be number ya",
    "su name add two to name num bucket be ceremony def",
    "ob num 2 to name bucket be add do",
    "su name add two be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let bucket = \{ su: \{ name: "bucket" \}, ob: \{ num: 0 \}/);
  assert.match(js, /function\s+be_add_two_to_name_num\(sentence\)[\s\S]*bucket\.ob\.num\s*=\s*\(bucket\.ob\.num\s*\?\?\s*0\)\s*\+\s*2;/s);
  assert.match(js, /return\s+sentence\s*;/);
});

test("compiled ceremony function can be invoked (JS)", async () => {
  forget();

  const program = [
    "exists su name bucket ob num 0 be number ya",
    "su name add two be ceremony def",
    "ob num 2 to num of ob of this be add do",
    "su name add two be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;

  const sandbox = { remember: name => ({ su: { name }, ob: { num: 0 } }) };
  vm.createContext(sandbox);
  const unwrapped = js
    .replace(/^quoted\.javascript\.\n?/, "")
    .replace(/\.javascript\.quoted\s*$/, "");
  vm.runInContext(unwrapped, sandbox);

  assert.equal(typeof sandbox.be_add_two, "function");
  const r = sandbox.be_add_two({ ob: { num: 0 }, to: { num: 0, name: "bucket" } });
  assert.equal(r.ob?.num ?? r.to?.num, 2);
});

test("compile emits JS ceremony mutating this.ob.num via genitive", async () => {
  forget();

  const program = [
    "su name bump be ceremony def",
    "ob num 2 to num of ob of this be add do",
    "su name bump be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /function\s+be_bump\(sentence\)[\s\S]*sentence\.ob = sentence\.ob\?\.(ob\?\.)?ob \?\? sentence\.ob \?\? \{\}/);
  assert.doesNotMatch(js, /const target = remember/, "this-genitive should not introduce remember");
  assert.match(js, /return sentence;/);
});

test("compile emits JS if-statement for tiny then", async () => {
  forget();

  const program = [
    "exists su name total ob num 0 be number ya",
    "ob num 3 be tiny from num 5 then ob num 1 to name total be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let total = \{[\s\S]*su:\s*\{\s*name:\s*"total"\s*\}[\s\S]*ob:\s*\{\s*num:\s*0/s);
  assert.match(js, /total\.ob\.num = \(total\.ob\.num \?\? 0\) \+ 1;/);
});

test("compile emits JS if-statement for giant then subtract", async () => {
  forget();

  const program = [
    "exists su name total ob num 10 be number ya",
    "ob num 7 be giant from num 5 then ob num 2 to name total be subtract do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let total = \{[\s\S]*name:\s*"total"[\s\S]*num:\s*10/s);
  assert.match(js, /total\.ob\.num = \(total\.ob\.num \?\? 0\) - 2;/);
});

test("compile emits JS if-statement for equally then multiply", async () => {
  forget();

  const program = [
    "exists su name total ob num 5 be number ya",
    "ob num 5 be equally from num 5 then ob num 2 to name total be multiply do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let total = \{[\s\S]*name:\s*"total"[\s\S]*num:\s*5/s);
  assert.match(js, /total\.ob\.num = \(total\.ob\.num \?\? 0\) \* 2;/);
});

test("compile emits nested conditionals", async () => {
  forget();

  const program = [
    "exists su name counter ob num 0 be number ya",
    "ob num 2 be tiny from num 3 then ob num 4 be giant from num 1 then ob num 1 to name counter be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let counter = \{[\s\S]*name:\s*"counter"[\s\S]*num:\s*0/s);
  assert.match(js, /counter\.ob\.num = \(counter\.ob\.num \?\? 0\) \+ 1;/);
});

test("compile leaves TODO for malformed conditional without consequence", async () => {
  forget();

  const program = [
    "ob num 1 be tiny from num 2 ya"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /TODO: .*\"be\":\"tiny\"/);
});
