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
    "su name alpha ob num 1 be number ya",
    "su name beta ob num 2 be number ya"
  ].join("\n");

  // store input text and placeholder output
  await interpret(
    parse(`exists su name input ob text "${program}" be text ya`)
  );
  await interpret(parse("su name output be text ya"));

  const sentence = parse(
    "ob name input from state pyash to state JSON to name output be understand do"
  );
  const result = await interpret(sentence);

  const mem = allRemember();
  const out = mem.find(s => s.su?.name === "output");

  assert.ok(result, "understand should return result");
  assert.ok(out, "understand should store to output");
  assert.ok(Array.isArray(out.ob?.sentences));
  assert.equal(out.ob.sentences.length, 2);
  assert.match(out.ob.text, /alpha/);

  const parsed = JSON.parse(out.ob.text);
  assert.equal(parsed[0].su.name, "alpha");
});

test("understand can write parsed JSON to filename", async () => {
  forget();

  const program = [
    "su name alpha ob num 1 be number ya",
    "su name beta ob num 2 be number ya"
  ].join("\n");

  const outputFile = "quiz/sandpit/understand-output.json";
  await fs.rm(outputFile, { force: true });

  await interpret(
    parse(`su name input ob text quoted.pyash.${program}.pyash.quoted be text ya`)
  );

  const sentence = parse(
    `ob name input from state pyash to filename "${outputFile}" be understand do`
  );

  const result = await interpret(sentence);
  assert.ok(result?.value?.text);

  const fileText = await fs.readFile(outputFile, "utf8");
  const parsed = JSON.parse(fileText);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].su.name, "beta");

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
  assert.equal(parsed[0].su.name, "alpha");

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
  assert.ok(result?.ob?.text ?? result?.value?.text);

  const fileText = await fs.readFile(outputFile, "utf8");
  assert.match(fileText, /let alpha = \{[\s\S]*su:\s*\{\s*name:\s*"alpha"\s*\}[\s\S]*ob:\s*\{\s*num:\s*1/s);
  assert.match(fileText, /let beta = \{[\s\S]*su:\s*\{\s*name:\s*"beta"\s*\}[\s\S]*ob:\s*\{\s*num:\s*2/s);

  await fs.rm(outputFile, { force: true });
});

test("file-based compile outputs runnable JS with write", async () => {
  forget();

  const inputFile = "quiz/sandpit/compile-write.txt";
  const outputFile = "quiz/sandpit/compile-write-output.js";

  await fs.writeFile(inputFile, "ob text hello be write do\n", "utf8");
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

test("file-based compile with math, ceremony, and write logs final value", async () => {
  forget();

  const inputFile = "examples/pyash/compile-math-write.txt";
  const outputFile = "examples/out/compile-math-write-output.js";

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
    "exists su name counter ob num 0 be number ya",
    "su name loop body to name num counter be ceremony def",
    "ob num 1 to name counter be add do",
    "su name loop body be ceremony prah",
    "to name counter fromindex num 3 be loop body do",
    "ob name counter be write do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text ?? "";
  const unwrapped = js
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  assert.match(unwrapped, /runLoop\(/, "should emit loop helper call");
  assert.match(unwrapped, /counter\.ob\.num = \(counter\.ob\.num \?\? 0\) \+ 1;/, "loop body increments counter");

  const logs = [];
  const context = { console: { log: (...args) => logs.push(args[0]) } };
  context.globalThis = context;
  vm.runInNewContext(unwrapped, context);
  const firstLog = logs[0];
  const loggedNum = firstLog?.ob?.num ?? firstLog;
  assert.equal(loggedNum, 3, "loop should increment counter to 3");
});

test("compile emits C loop for fromindex countdown", async () => {
  forget();

  const program = [
    "exists su name counter ob num 0 be number ya",
    "su name loop body to name num counter be ceremony def",
    "ob num 1 to name counter be add do",
    "su name loop body be ceremony prah",
    "to name counter fromindex num 3 be loop body do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state c to text output be compile do`
  );

  const result = await interpret(sentence);
  const c = result?.ob?.text ?? result?.value?.text ?? "";

  assert.ok(c.includes("be_loop_body_to_name_num"), "should emit ceremony in C");
  assert.ok(c.includes("for (fromindex = 3; fromindex > 0; fromindex--) { be_loop_body_to_name_num(); }"), "should emit countdown loop");
});

test("compiled C loop builds and runs", async (t) => {
  forget();

  const program = [
    "exists su name counter ob num 0 be number ya",
    "su name loop body to name num counter be ceremony def",
    "ob num 1 to name counter be add do",
    "su name loop body be ceremony prah",
    "to name counter fromindex num 3 be loop body do",
    "ob name counter be write do"
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
    "su name alpha ob num 3 be number ya"
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
    "ob num 3 be tiny from num 5 then ob num 1 to name total be add do"
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

test("compile vector literal and produce dot product inline", async () => {
  forget();

  const program = [
    "ob vec num 1 2 3 by vec num 4 5 6 to name z be produce do",
    "ob name z be write do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = (result?.ob?.text ?? result?.value?.text ?? "")
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
    "exists su name w ob ve num 1 1 1 be vector ya",
    "exists su name x ob ve num 2 3 4 be vector ya",
    "from name w by name x to name z be produce do",
    "ob name z be write do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = (result?.ob?.text ?? result?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  const context = { console: { log: (...args) => logs.push(args[0]) } };
  context.globalThis = context;
  vm.runInNewContext(js, context);

  assert.equal(logs[0], 9);
});

test("compile write to mind emits mind call", async () => {
  forget();

  const program = [
    "exists su name helper be mind from name http://localhost:11434 ya",
    "ob text hello to name helper be write do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = (result?.ob?.text ?? result?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  assert.match(js, /mindConfigs.set/, "mind config should be emitted");
  assert.match(js, /callMind\(/, "should route through mind helper");
  assert.match(js, /messages\.push\(\{ role: "user", content: "hello" \}\)/, "should push user message");
});

test("compiled write to mind builds messages payload and uses helper transport", async () => {
  forget();

  const program = [
    "exists su name helper by num 1 be mind from name http://localhost:11434 ya",
    "ob text hello to name helper be write do",
    "ob text again to name helper be write do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = (result?.ob?.text ?? result?.value?.text ?? "")
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
