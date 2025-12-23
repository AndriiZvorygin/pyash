import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile ceremony loop to javascript and run", async () => {
  forget();

  const pyash = [
    "exists su name counter ob num 0 be number ya",
    "su name loop_body to name num target fromindex num 0 be ceremony def",
    "ob num 1 to name counter be add do",
    "su name loop_body be ceremony prah",
    "to name counter fromindex num 3 be loop_body do",
    "ob name counter be write do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.ob?.text ?? result?.value?.text ?? "";
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
    "exists su name alpha ob num 0 be number ya",
    // Definition binds to name bucket, but the caller invokes with to name alpha.
    "su name inc_loop to name num bucket fromindex num 0 be ceremony def",
    "ob num 1 to name alpha be add do",
    "su name inc_loop be ceremony prah",
    "to name alpha fromindex num 3 be inc_loop do",
    "ob name alpha be write do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.ob?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, { console: { log: (...args) => logs.push(args.join(" ")) } });
  assert.deepEqual(logs.map(String), ["3"]);
});

test("compile loop can mutate a vector (invert element) each iteration", async () => {
  forget();

  const pyash = [
    "exists su name counter ob num 0 be number ya",
    "exists su name doors ob ve num 2 2 be vector ya",
    "su name flip_first to name num bucket fromindex num 0 be ceremony def",
    "ob name doors at num 0 be invert do",
    "su name flip_first be ceremony prah",
    "to name counter fromindex num 3 be flip_first do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.ob?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);

  const doors = sandbox.doors ?? sandbox.globalThis?.doors;
  assert.deepEqual(Array.from(doors?.ob?.ve?.values ?? []), [-2, 2]);
});

test("compile loop can invert boolean vector at num of fromindex of this", async () => {
  forget();

  const pyash = [
    "exists su name outside ob num 0 be number ya",
    "exists su name switches ob ve bool truth lie truth be vector ya",
    "su name flip_index to name num bucket fromindex num 0 be ceremony def",
    "ob name switches at num of fromindex of this be invert do",
    "su name flip_index be ceremony prah",
    "to name outside fromindex num 2 toindex num -1 be flip_index do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.ob?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);

  const switches = sandbox.switches ?? sandbox.globalThis?.switches;
  assert.deepEqual(Array.from(switches?.ob?.ve?.values ?? []), ["lie", "truth", "lie"]);
});

test("compile loop can apply a conditional update per iteration", async () => {
  forget();

  const pyash = [
    "exists su name values ob ve num 1 2 3 4 be vector ya",
    "su name flip even to name num bucket fromindex num 0 be ceremony def",
    "ob this ti fromindex from num 2 to name mod be remains do",
    "ob name mod be equally from num 0 then ob name values at num of fromindex of this be invert do",
    "su name flip even be ceremony prah",
    "to name outside fromindex num 0 toindex num 4 be flip even do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.ob?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);

  const vec = sandbox.values ?? sandbox.globalThis?.values;
  assert.deepEqual(Array.from(vec?.ob?.ve?.values ?? []), [-1, 2, -3, 4]);
});

test("compile loop stops at toindex when ascending", async () => {
  forget();

  const pyash = [
    "exists su name counter ob num 0 be number ya",
    "su name inc fromindex num 0 be ceremony def",
    "ob num 1 to name counter be add do",
    "su name inc be ceremony prah",
    "fromindex num 1 toindex num 4 be inc do",
    "ob name counter be write do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.ob?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, { console: { log: (...args) => logs.push(args.join(" ")) } });
  assert.deepEqual(logs.map(String), ["3"]);
});

test("compile loop stops at toindex when descending", async () => {
  forget();

  const pyash = [
    "exists su name counter ob num 0 be number ya",
    "su name inc fromindex num 0 be ceremony def",
    "ob num 1 to name counter be add do",
    "su name inc be ceremony prah",
    "fromindex num 4 toindex num 1 be inc do",
    "ob name counter be write do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.ob?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, { console: { log: (...args) => logs.push(args.join(" ")) } });
  assert.deepEqual(logs.map(String), ["3"]);
});

test.todo("compile loop can perform 10-doors toggle (squares end open) using at all + by pass");

test("compile loop can perform 10-doors toggle (squares end open) using nested loops only", async () => {
  forget();

  const pyash = [
    "exists su name doors ob ve bool lie lie lie lie lie lie lie lie lie lie be vector ya",
    "su name toggle door by num 0 fromindex num 0 be ceremony def",
    "su name doorNum ob this fromindex be number ya",
    "ob num 1 to name doorNum be add do",
    "ob name doorNum from num of ob of by of this to name rem be remains do",
    "ob name rem be equally from num 0 then ob name doors at num of fromindex of this be invert do",
    "su name toggle door be ceremony prah",
    "su name process pass fromindex num 0 be ceremony def",
    "su name pass ob this fromindex be number ya",
    "by name pass fromindex num 0 toindex num 10 be toggle door do",
    "su name process pass be ceremony prah",
    "fromindex num 1 toindex num 11 be process pass do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.ob?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);

  const doors = sandbox.doors ?? sandbox.globalThis?.doors;
  assert.deepEqual(Array.from(doors?.ob?.ve?.values ?? []), ["truth", "lie", "lie", "truth", "lie", "lie", "lie", "lie", "truth", "lie"]);
});
