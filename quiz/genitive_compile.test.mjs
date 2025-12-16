import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { buildProgram } from "../program/program.mjs";
import { transpileProgram } from "../program/verbs/exchange/compile.mjs";

test("compile uses genitive num of obj of this without remember", async () => {
  const program = [
    "exists subj name bucket obj num 1 be number ya",
    "subj name bump be ceremony def",
    "obj num 2 to num of obj of this be add do",
    "subj name bump be ceremony prah",
    "subj name evoker obj name bucket be bump do",
    "obj name bucket be say do"
  ].join("\n");

  const js = transpileProgram(buildProgram(program).sentences, { lang: "javascript" })
    .replace(/^quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  assert.doesNotMatch(js, /remember\(sentence\.to/);
  assert.match(js, /sentence\.obj\.num = \(sentence\.obj\.num \?\? 0\) \+ 2/);

  const logs = [];
  const sandbox = { console: { log: v => logs.push(v) } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(js, sandbox);

  assert.equal(logs.at(-1)?.obj?.num ?? logs.at(-1), 3);
});

test("compile uses genitive this ti obj ti num without remember", async () => {
  const program = [
    "exists subj name bucket obj num 1 be number ya",
    "subj name bump be ceremony def",
    "obj num 2 to this ti obj ti num be add do",
    "subj name bump be ceremony prah",
    "subj name evoker obj name bucket be bump do",
    "obj name bucket be say do"
  ].join("\n");

  const js = transpileProgram(buildProgram(program).sentences, { lang: "javascript" })
    .replace(/^quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  assert.doesNotMatch(js, /remember\(sentence\.to/);
  assert.match(js, /sentence\.obj\.num = \(sentence\.obj\.num \?\? 0\) \+ 2/);

  const logs = [];
  const sandbox = { console: { log: v => logs.push(v) } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(js, sandbox);

  assert.equal(logs.at(-1)?.obj?.num ?? logs.at(-1), 3);
});
