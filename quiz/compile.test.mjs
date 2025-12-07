import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";

test("understand verb reads Pyash text and stores JSON", async () => {
  forget();

  const program = [
    "subj name alpha obj num 1 be number ya",
    "subj name beta obj num 2 be number ya"
  ].join("\n");

  // store input text and placeholder output
  await interpret(
    parse(`exists subj name input obj text "${program}" be text ya`)
  );
  await interpret(parse("subj name output be text ya"));

  const sentence = parse(
    "obj name input from state pyash to state JSON to name output be understand do"
  );
  const result = await interpret(sentence);

  const mem = allRemember();
  const out = mem.find(s => s.subj?.name === "output");

  assert.ok(result, "understand should return result");
  assert.ok(out, "understand should store to output");
  assert.ok(Array.isArray(out.obj?.sentences));
  assert.equal(out.obj.sentences.length, 2);
  assert.match(out.obj.text, /alpha/);

  const parsed = JSON.parse(out.obj.text);
  assert.equal(parsed[0].subj.name, "alpha");
});

test("understand can write parsed JSON to filename", async () => {
  forget();

  const program = [
    "subj name alpha obj num 1 be number ya",
    "subj name beta obj num 2 be number ya"
  ].join("\n");

  const outputFile = "quiz/sandpit/understand-output.json";
  await fs.rm(outputFile, { force: true });

  await interpret(
    parse(`subj name input obj text quoted.pyash.${program}.pyash.quoted be text ya`)
  );

  const sentence = parse(
    `obj name input from state pyash to filename "${outputFile}" be understand do`
  );

  const result = await interpret(sentence);
  assert.ok(result?.value?.text);

  const fileText = await fs.readFile(outputFile, "utf8");
  const parsed = JSON.parse(fileText);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].subj.name, "beta");

  await fs.rm(outputFile, { force: true });
});

test("understand can read from filename and write JSON to filename", async () => {
  forget();

  const inputFile = "quiz/sandpit/compile.txt";
  const outputFile = "quiz/sandpit/understand-output.json";
  await fs.rm(outputFile, { force: true });

  const sentence = parse(
    `from filename "${inputFile}" to filename "${outputFile}" be understand do`
  );

  const result = await interpret(sentence);
  assert.ok(result?.value?.text);

  const fileText = await fs.readFile(outputFile, "utf8");
  const parsed = JSON.parse(fileText);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].subj.name, "alpha");

  await fs.rm(outputFile, { force: true });
});

test("compile converts Pyash file to JavaScript file", async () => {
  forget();

  const inputFile = "quiz/sandpit/compile.txt";
  const outputFile = "quiz/sandpit/compile-output.js";
  await fs.rm(outputFile, { force: true });

  const sentence = parse(
    `from filename "${inputFile}" from state pyash to filename "${outputFile}" to state javascript be compile do`
  );

  const result = await interpret(sentence);
  assert.ok(result?.obj?.text ?? result?.value?.text);

  const fileText = await fs.readFile(outputFile, "utf8");
  assert.match(fileText, /let alpha = 1;/);
  assert.match(fileText, /let beta = 2;/);

  await fs.rm(outputFile, { force: true });
});

test("compile converts inline Pyash text to JavaScript text with const for permanent", async () => {
  forget();

  const program = "exists subj name alpha obj num 1 be permanent number ya\nexists subj name beta obj text hello be permanent text ya";
  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted become javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;
  assert.ok(js);
  assert.match(js, /const alpha = 1;/);
  assert.match(js, /const beta = \"hello\";/);
});

test("compile converts inline Pyash text to C text", async () => {
  forget();

  const program = "exists subj name alpha obj num 1 be number ya\nexists subj name beta obj text hello be permanent text ya";
  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state c to text output be compile do`
  );

  const result = await interpret(sentence);
  const c = result?.obj?.text ?? result?.value?.text;
  assert.ok(c, `compile returned: ${JSON.stringify(result)}`);
  assert.match(c, /double alpha = 1;/);
  assert.match(c, /const char \* beta = "hello";/);
});

test("compile converts inline Pyash text to C with reassignment", async () => {
  forget();

  const program = [
    "exists subj name alpha obj num 1 be number ya",
    "subj name alpha obj num 3 be number ya"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state c to text output be compile do`
  );

  const result = await interpret(sentence);
  const c = result?.obj?.text ?? result?.value?.text;
  assert.ok(c, `compile returned: ${JSON.stringify(result)}`);
  assert.match(c, /double alpha = 1;/);
  assert.match(c, /alpha = 3;/);
  assert.doesNotMatch(c, /double alpha = 3;/);
});

test("compile emits C if-statement for tiny then", async () => {
  forget();

  const program = [
    "exists subj name total obj num 0 be number ya",
    "obj num 3 be tiny from num 5 then obj num 1 to name total be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state c to text output be compile do`
  );

  const result = await interpret(sentence);
  const c = result?.obj?.text ?? result?.value?.text;

  assert.ok(c);
  assert.match(c, /double total = 0;/);
  assert.match(c, /if\s*\(3 < 5\)\s*\{\s*total = total \+ 1;/s);
});

test("compile emits JS for simple add", async () => {
  forget();

  const program = [
    "exists subj name collector obj num 0 be number ya",
    "obj num 2 to name collector be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let collector = 0;/);
  assert.match(js, /collector = collector \+ 2;/);
});

test("compile reassigns without redeclaring when name already exists", async () => {
  forget();

  const program = [
    "exists subj name alpha obj num 1 be number ya",
    "subj name alpha obj num 2 be number ya"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let alpha = 1;/);
  assert.match(js, /alpha = 2;/);
  assert.doesNotMatch(js, /let alpha = 2;/);
});

test("compile emits JS for simple multiply and divide", async () => {
  forget();

  const program = [
    "exists subj name collector obj num 10 be number ya",
    "obj num 3 to name collector be multiply do",
    "obj num 2 to name collector be divide do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let collector = 10;/);
  assert.match(js, /collector = collector \* 3;/);
  assert.match(js, /collector = collector \/ 2;/);
});

test("compile emits JS ceremony with no params", async () => {
  forget();

  const program = [
    "subj name noop be ceremony def",
    "subj name noop be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /function\s+noop\(sentence\)[\s\S]*return\s*sentence;/);
});

test("compile emits JS ceremony with param and body", async () => {
  forget();

  const program = [
    "exists subj name bucket obj num 0 be number ya",
    "subj name add two to name bucket be ceremony def",
    "obj num 2 to name bucket be add do",
    "subj name add two be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let bucket = 0;/);
  assert.match(js, /function\s+add_two\(sentence\)[\s\S]*sentence\.to\?.num = \(sentence\.to\?.num \?\? 0\) \+ 2;[\s\S]*return sentence;/);
});

test("compile emits JS ceremony mutating this.obj.num via genitive", async () => {
  forget();

  const program = [
    "exists subj name bump obj num of obj of this be number ya", // ignored; placeholder
    "subj name bump be ceremony def",
    "obj num 2 to num of obj of this be add do",
    "subj name bump be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /function\s+bump\(sentence\)[\s\S]*sentence\.obj\?.num = \(sentence\.obj\?.num \?\? 0\) \+ 2;[\s\S]*return sentence;/);
});

test("compile emits JS if-statement for tiny then", async () => {
  forget();

  const program = [
    "exists subj name total obj num 0 be number ya",
    "obj num 3 be tiny from num 5 then obj num 1 to name total be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let total = 0;/);
  assert.match(js, /if\s*\(3 < 5\)\s*\{\s*total = total \+ 1;/s);
});

test("compile emits JS if-statement for giant then subtract", async () => {
  forget();

  const program = [
    "exists subj name total obj num 10 be number ya",
    "obj num 7 be giant from num 5 then obj num 2 to name total be subtract do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let total = 10;/);
  assert.match(js, /if\s*\(7 > 5\)\s*\{\s*total = total - 2;/s);
});

test("compile emits JS if-statement for equally then multiply", async () => {
  forget();

  const program = [
    "exists subj name total obj num 5 be number ya",
    "obj num 5 be equally from num 5 then obj num 2 to name total be multiply do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let total = 5;/);
  assert.match(js, /if\s*\(5 === 5\)\s*\{\s*total = total \* 2;/s);
});

test("compile emits nested conditionals", async () => {
  forget();

  const program = [
    "exists subj name counter obj num 0 be number ya",
    "obj num 2 be tiny from num 3 then obj num 4 be giant from num 1 then obj num 1 to name counter be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /let counter = 0;/);
  assert.match(js, /if\s*\(2 < 3\)\s*{\s*if\s*\(4 > 1\)\s*{\s*counter = counter \+ 1;/s);
});

test("compile leaves TODO for malformed conditional without consequence", async () => {
  forget();

  const program = [
    "obj num 1 be tiny from num 2 ya"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;

  assert.ok(js);
  assert.match(js, /TODO: .*\"be\":\"tiny\"/);
});
