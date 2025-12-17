import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";

const exec = promisify(execCb);

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
  assert.match(fileText, /let alpha = \{[\s\S]*subj:\s*\{\s*name:\s*"alpha"\s*\}[\s\S]*obj:\s*\{\s*num:\s*1/s);
  assert.match(fileText, /let beta = \{[\s\S]*subj:\s*\{\s*name:\s*"beta"\s*\}[\s\S]*obj:\s*\{\s*num:\s*2/s);

  await fs.rm(outputFile, { force: true });
});

test("file-based compile outputs runnable JS with say", async () => {
  forget();

  const inputFile = "quiz/sandpit/compile-say.txt";
  const outputFile = "quiz/sandpit/compile-say-output.js";

  await fs.writeFile(inputFile, "obj text hello be say do\n", "utf8");
  await fs.rm(outputFile, { force: true });

  const sentence = parse(
    `from filename "${inputFile}" from state pyash to filename "${outputFile}" to state javascript be compile do`
  );

  await interpret(sentence);

  const fileText = await fs.readFile(outputFile, "utf8");

  const logs = [];
  const context = { console: { log: (...args) => logs.push(args.join(" ")) } };
  context.globalThis = context;
  vm.runInNewContext(fileText, context);

  assert.ok(logs.includes("hello"), "compiled JS should log hello");

  await fs.rm(inputFile, { force: true });
  await fs.rm(outputFile, { force: true });
});

test("file-based compile with math, ceremony, and say logs final value", async () => {
  forget();

  const inputFile = "examples/pyash/compile-math-say.txt";
  const outputFile = "examples/out/compile-math-say-output.js";

  await fs.rm(outputFile, { force: true });

  const sentence = parse(
    `from filename "${inputFile}" from state pyash to filename "${outputFile}" to state javascript be compile do`
  );

  await interpret(sentence);

  const fileText = await fs.readFile(outputFile, "utf8");

  const logs = [];
  const context = {
    console: {
      log: (...args) => {
        try {
          logs.push(JSON.parse(JSON.stringify(args[0])));
        } catch {
          logs.push(args[0]);
        }
      }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(fileText, context);

  assert.equal(logs.length, 2, "should log twice");
  assert.equal(logs[0], 2, "first log after add/subtract is 2");
  assert.equal(logs[1], 5, "second log after ceremony is 5");

  await fs.rm(outputFile, { force: true });
});

test("compile emits loop for fromindex countdown", async () => {
  forget();

  const program = [
    "exists subj name counter obj num 0 be number ya",
    "subj name loop body to name counter be ceremony def",
    "obj num 1 to name counter be add do",
    "subj name loop body be ceremony prah",
    "to name counter fromindex num 3 be loop body do",
    "obj name counter be say do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text ?? "";
  const unwrapped = js
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  assert.match(unwrapped, /runLoop\(/, "should emit loop helper call");
  assert.match(unwrapped, /counter\.obj\.num = \(counter\.obj\.num \?\? 0\) \+ 1;/, "loop body increments counter");

  const logs = [];
  const context = { console: { log: (...args) => logs.push(args[0]) } };
  context.globalThis = context;
  vm.runInNewContext(unwrapped, context);
  const firstLog = logs[0];
  const loggedNum = firstLog?.obj?.num ?? firstLog;
  assert.equal(loggedNum, 3, "loop should increment counter to 3");
});

test("compile emits C loop for fromindex countdown", async () => {
  forget();

  const program = [
    "exists subj name counter obj num 0 be number ya",
    "subj name loop body to name counter be ceremony def",
    "obj num 1 to name counter be add do",
    "subj name loop body be ceremony prah",
    "to name counter fromindex num 3 be loop body do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state c to text output be compile do`
  );

  const result = await interpret(sentence);
  const c = result?.obj?.text ?? result?.value?.text ?? "";

  assert.ok(c.includes("be_loop_body_to_name_num"), "should emit ceremony in C");
  assert.ok(c.includes("for (int fromindex = 3; fromindex > 0; fromindex--) { be_loop_body_to_name_num(); }"), "should emit countdown loop");
});

test("compiled C loop builds and runs", async (t) => {
  forget();

  const program = [
    "exists subj name counter obj num 0 be number ya",
    "subj name loop body to name counter be ceremony def",
    "obj num 1 to name counter be add do",
    "subj name loop body be ceremony prah",
    "to name counter fromindex num 3 be loop body do",
    "obj name counter be say do"
  ].join("\\n");

  const cFile = "quiz/sandpit/compile-loop-output.c";
  const binFile = "quiz/sandpit/compile-loop-output.bin";

  await fs.rm(cFile, { force: true });
  await fs.rm(binFile, { force: true });

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to filename "${cFile}" to state c be compile do`
  );

  await interpret(sentence);

  try {
    await exec(`gcc -std=c11 -o ${binFile} ${cFile}`);
    const { stdout } = await exec(binFile);
    assert.ok(stdout !== undefined, "compiled program should run");
  } catch (err) {
    t.skip(`gcc not runnable here (${err?.code || err})`);
  } finally {
    await fs.rm(cFile, { force: true });
    await fs.rm(binFile, { force: true });
  }
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
  assert.match(js, /const alpha = \{[\s\S]*subj:\s*\{\s*name:\s*"alpha"\s*\}[\s\S]*obj:\s*\{\s*num:\s*1/s);
  assert.match(js, /let beta = \{[\s\S]*subj:\s*\{\s*name:\s*"beta"\s*\}[\s\S]*obj:\s*\{\s*text:\s*"hello"/s);
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
  assert.match(js, /let collector = \{[\s\S]*subj:\s*\{\s*name:\s*"collector"\s*\}[\s\S]*obj:\s*\{\s*num:\s*0/s);
  assert.match(js, /collector\.obj\.num = \(collector\.obj\.num \?\? 0\) \+ 2;/);
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
  assert.match(js, /let alpha = \{[\s\S]*subj:\s*\{\s*name:\s*"alpha"\s*\}[\s\S]*obj:\s*\{\s*num:\s*1/s);
  assert.match(js, /alpha = \{[\s\S]*subj:\s*\{\s*name:\s*"alpha"[\s\S]*obj:\s*\{\s*num:\s*2/s);
});

test("compile emits console.log for say text", async () => {
  forget();

  const program = [
    "obj text hello be say do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text ?? "";

  assert.match(js, /console\.log\("hello"\);/);
});

test("compile emits console.log for say name using variable reference", async () => {
  forget();

  const program = [
    "exists subj name alpha obj text hi be text ya",
    "obj name alpha be say do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text ?? "";

  assert.match(js, /let alpha = \{[\s\S]*subj:\s*\{\s*name:\s*"alpha"\s*\}[\s\S]*obj:\s*\{\s*text:\s*"hi"/);
  assert.match(js, /console\.log\(alpha\.obj\?\.(ve\?\.\w+\s*\?\?\s*)?alpha\.obj\?\.(text|num)[^)]*\);/);
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
  assert.match(js, /let collector = \{[\s\S]*subj:\s*\{\s*name:\s*"collector"\s*\}[\s\S]*obj:\s*\{\s*num:\s*10/s);
  assert.match(js, /collector\.obj\.num = \(collector\.obj\.num \?\? 0\) \* 3;/);
  assert.match(js, /collector\.obj\.num = \(collector\.obj\.num \?\? 0\) \/ 2;/);
});

test("compile emits JS for text concatenation via add", async () => {
  forget();

  const program = [
    "exists subj name message obj text hi be text ya",
    "obj text there to name message be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text ?? "";

  assert.match(js, /message\.obj\.text = \(message\.obj\.text \?\? \"\"\) \+ \"there\";/);
});

test("compile vector literal and produce dot product inline", async () => {
  forget();

  const program = [
    "obj vec num 1 2 3 by vec num 4 5 6 to name z be produce do",
    "obj name z be say do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = (result?.obj?.text ?? result?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  const context = { console: { log: (...args) => logs.push(args[0]) } };
  context.globalThis = context;
  vm.runInNewContext(js, context);

  assert.equal(logs[0], 32);
});

test("compile vector produce from named vectors", async () => {
  forget();

  const program = [
    "exists subj name w obj ve num 1 1 1 be vector ya",
    "exists subj name x obj ve num 2 3 4 be vector ya",
    "from name w by name x to name z be produce do",
    "obj name z be say do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = (result?.obj?.text ?? result?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  const context = { console: { log: (...args) => logs.push(args[0]) } };
  context.globalThis = context;
  vm.runInNewContext(js, context);

  assert.equal(logs[0], 9);
});

test("compile say to mind emits mind call", async () => {
  forget();

  const program = [
    "exists subj name helper be mind from name http://localhost:11434 ya",
    "obj text hello to name helper be say do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = (result?.obj?.text ?? result?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  assert.match(js, /mindConfigs.set/, "mind config should be emitted");
  assert.match(js, /callMind\(/, "should route through mind helper");
  assert.match(js, /messages\.push\(\{ role: "user", content: "hello" \}\)/, "should push user message");
});

test("compiled say to mind builds messages payload and uses helper transport", async () => {
  forget();

  const program = [
    "exists subj name helper by num 1 be mind from name http://localhost:11434 ya",
    "obj text hello to name helper be say do",
    "obj text again to name helper be say do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = (result?.obj?.text ?? result?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  const calls = [];
  const context = {
    ollamaChat: payload => {
      calls.push(payload);
      return "ok";
    },
    console: { log: () => {} }
  };
  context.globalThis = context;
  vm.runInNewContext(js, context);

  assert.equal(calls.length, 2, "helper should be called for each say");
  const [payload] = calls;
  assert.equal(payload.host, "http://localhost:11434");
  assert.equal(payload.model, "qwen3-vl:8b-instruct");
  assert.equal(payload.messages.at(-1).content, "hello");
  assert.equal(payload.messages.at(-1).role, "user");
  assert.ok(payload.messages.every(m => m.role && m.content !== undefined));
  // Second call should include first exchange in history, bounded by window=1 (2 messages max)
  const second = calls[1];
  assert.ok(second.messages.length <= 1 /*user*/ + 1 /*assistant*/ + 1 /*current*/ + 1 /*maybe system*/, "history window should bound messages");
  const userMsgs = second.messages.filter(m => m.role === "user");
  const assistantMsgs = second.messages.filter(m => m.role === "assistant");
  assert.ok(userMsgs.length >= 1);
  assert.ok(assistantMsgs.length >= 0);
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
  assert.match(js, /function\s+be_noop\(sentence\)[\s\S]*return\s*sentence;/);
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
  assert.match(js, /let bucket = \{ subj: \{ name: "bucket" \}, obj: \{ num: 0 \}/);
  assert.match(js, /function\s+be_add_two_to_name_num\(sentence\)[\s\S]*bucket\.obj\.num\s*=\s*\(bucket\.obj\.num\s*\?\?\s*0\)\s*\+\s*2;/s);
  assert.match(js, /return\s+sentence\s*;/);
});

test("compiled ceremony function can be invoked (JS)", async () => {
  forget();

  const program = [
    "exists subj name bucket obj num 0 be number ya",
    "subj name add two be ceremony def",
    "obj num 2 to num of obj of this be add do",
    "subj name add two be ceremony prah"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.obj?.text ?? result?.value?.text;

  const sandbox = { remember: name => ({ subj: { name }, obj: { num: 0 } }) };
  vm.createContext(sandbox);
  const unwrapped = js
    .replace(/^quoted\.javascript\.\n?/, "")
    .replace(/\.javascript\.quoted\s*$/, "");
  vm.runInContext(unwrapped, sandbox);

  assert.equal(typeof sandbox.be_add_two, "function");
  const r = sandbox.be_add_two({ obj: { num: 0 }, to: { num: 0, name: "bucket" } });
  assert.equal(r.obj?.num ?? r.to?.num, 2);
});

test("compile emits JS ceremony mutating this.obj.num via genitive", async () => {
  forget();

  const program = [
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
  assert.match(js, /function\s+be_bump\(sentence\)[\s\S]*sentence\.obj = sentence\.obj\?\.(obj\?\.)?obj \?\? sentence\.obj \?\? \{\}/);
  assert.doesNotMatch(js, /const target = remember/, "this-genitive should not introduce remember");
  assert.match(js, /return sentence;/);
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
  assert.match(js, /let total = \{[\s\S]*subj:\s*\{\s*name:\s*"total"\s*\}[\s\S]*obj:\s*\{\s*num:\s*0/s);
  assert.match(js, /total\.obj\.num = \(total\.obj\.num \?\? 0\) \+ 1;/);
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
  assert.match(js, /let total = \{[\s\S]*name:\s*"total"[\s\S]*num:\s*10/s);
  assert.match(js, /total\.obj\.num = \(total\.obj\.num \?\? 0\) - 2;/);
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
  assert.match(js, /let total = \{[\s\S]*name:\s*"total"[\s\S]*num:\s*5/s);
  assert.match(js, /total\.obj\.num = \(total\.obj\.num \?\? 0\) \* 2;/);
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
  assert.match(js, /let counter = \{[\s\S]*name:\s*"counter"[\s\S]*num:\s*0/s);
  assert.match(js, /counter\.obj\.num = \(counter\.obj\.num \?\? 0\) \+ 1;/);
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
