import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile ceremony loop to javascript and run", async () => {
  forget();

  const pyash = [
    "exists subj name counter obj num 0 be number ya",
    "subj name loop_body to name num target fromindex num 0 be ceremony def",
    "obj num 1 to name counter be add do",
    "subj name loop_body be ceremony prah",
    "to name counter fromindex num 3 be loop_body do",
    "obj name counter be write do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.obj?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, {
    console: {
      log: (...args) => logs.push(args.join(" "))
    }
  });

  assert.deepEqual(logs.map(String), ["3"]);
});

test("compile loop: def to-name differs from call to-name", async () => {
  forget();

  const pyash = [
    "exists subj name alpha obj num 0 be number ya",
    // Definition binds to name bucket, but the caller invokes with to name alpha.
    "subj name inc_loop to name num bucket fromindex num 0 be ceremony def",
    "obj num 1 to name alpha be add do",
    "subj name inc_loop be ceremony prah",
    "to name alpha fromindex num 3 be inc_loop do",
    "obj name alpha be write do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.obj?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, { console: { log: (...args) => logs.push(args.join(" ")) } });
  assert.deepEqual(logs.map(String), ["3"]);
});

test("compile loop can mutate a vector (invert element) each iteration", async () => {
  forget();

  const pyash = [
    "exists subj name counter obj num 0 be number ya",
    "exists subj name doors obj ve num 2 2 be vector ya",
    "subj name flip_first to name num bucket fromindex num 0 be ceremony def",
    "obj name doors at num 0 be invert do",
    "subj name flip_first be ceremony prah",
    "to name counter fromindex num 3 be flip_first do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.obj?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);

  const doors = sandbox.doors ?? sandbox.globalThis?.doors;
  assert.deepEqual(Array.from(doors?.obj?.ve?.values ?? []), [-2, 2]);
});

test("compile loop can invert boolean vector at num of fromindex of this", async () => {
  forget();

  const pyash = [
    "exists subj name outside obj num 0 be number ya",
    "exists subj name switches obj ve bool truth lie truth be vector ya",
    "subj name flip_index to name num bucket fromindex num 0 be ceremony def",
    "obj name switches at num of fromindex of this be invert do",
    "subj name flip_index be ceremony prah",
    "to name outside fromindex num 2 toindex num -1 be flip_index do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.obj?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);

  const switches = sandbox.switches ?? sandbox.globalThis?.switches;
  assert.deepEqual(Array.from(switches?.obj?.ve?.values ?? []), ["lie", "truth", "lie"]);
});

test("compile loop can apply a conditional update per iteration", async () => {
  forget();

  const pyash = [
    "exists subj name values obj ve num 1 2 3 4 be vector ya",
    "subj name flip even to name num bucket fromindex num 0 be ceremony def",
    "obj this ti fromindex from num 2 to name mod be remains do",
    "obj name mod be equally from num 0 then obj name values at num of fromindex of this be invert do",
    "subj name flip even be ceremony prah",
    "to name outside fromindex num 0 toindex num 4 be flip even do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.obj?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);

  const vec = sandbox.values ?? sandbox.globalThis?.values;
  assert.deepEqual(Array.from(vec?.obj?.ve?.values ?? []), [-1, 2, -3, 4]);
});

test("compile loop stops at toindex when ascending", async () => {
  forget();

  const pyash = [
    "exists subj name counter obj num 0 be number ya",
    "subj name inc fromindex num 0 be ceremony def",
    "obj num 1 to name counter be add do",
    "subj name inc be ceremony prah",
    "fromindex num 1 toindex num 4 be inc do",
    "obj name counter be write do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.obj?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, { console: { log: (...args) => logs.push(args.join(" ")) } });
  assert.deepEqual(logs.map(String), ["3"]);
});

test("compile loop stops at toindex when descending", async () => {
  forget();

  const pyash = [
    "exists subj name counter obj num 0 be number ya",
    "subj name inc fromindex num 0 be ceremony def",
    "obj num 1 to name counter be add do",
    "subj name inc be ceremony prah",
    "fromindex num 4 toindex num 1 be inc do",
    "obj name counter be write do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.obj?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, { console: { log: (...args) => logs.push(args.join(" ")) } });
  assert.deepEqual(logs.map(String), ["3"]);
});

test.todo("compile loop can perform 10-doors toggle (squares end open) using at all + by pass");

test("compile loop can perform 10-doors toggle (squares end open) using nested loops only", async () => {
  forget();

  const pyash = [
    "exists subj name doors obj ve bool lie lie lie lie lie lie lie lie lie lie be vector ya",
    "subj name toggle door by num 0 fromindex num 0 be ceremony def",
    "subj name doorNum obj this fromindex be number ya",
    "obj num 1 to name doorNum be add do",
    "obj name doorNum from num of obj of by of this to name rem be remains do",
    "obj name rem be equally from num 0 then obj name doors at num of fromindex of this be invert do",
    "subj name toggle door be ceremony prah",
    "subj name process pass fromindex num 0 be ceremony def",
    "subj name pass obj this fromindex be number ya",
    "by name pass fromindex num 0 toindex num 10 be toggle door do",
    "subj name process pass be ceremony prah",
    "fromindex num 1 toindex num 11 be process pass do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.obj?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);

  const doors = sandbox.doors ?? sandbox.globalThis?.doors;
  assert.deepEqual(Array.from(doors?.obj?.ve?.values ?? []), ["truth", "lie", "lie", "truth", "lie", "lie", "lie", "lie", "truth", "lie"]);
});
