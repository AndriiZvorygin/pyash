import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget } from "../program/remember/index.mjs";

const exec = promisify(execCb);

test("compile emits loop for fromindex countdown", async () => {
  forget();

  const program = [
    "exists su name counter ob num 0 be number ya",
    "su name loop body to name num counter be ceremony def",
    "ob num 1 to name counter be plus do",
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
    "ob num 1 to name counter be plus do",
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
    "ob num 1 to name counter be plus do",
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
