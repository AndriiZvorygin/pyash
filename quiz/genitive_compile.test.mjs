import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { buildProgram } from "../program/program.mjs";
import { transpileProgram } from "../program/verbs/exchange/compile.mjs";

test("compile uses genitive num of ob of this without remember", async () => {
  const program = [
    "exists su name bucket ob num 1 be number ya",
    "su name bump be ceremony def",
    "ob num 2 to num of ob of this be plus do",
    "su name bump be ceremony prah",
    "su name evoker ob name bucket be bump do",
    "ob name bucket be write do"
  ].join("\n");

  const js = transpileProgram(buildProgram(program).sentences, { lang: "javascript" })
    .replace(/^quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  assert.doesNotMatch(js, /remember\(sentence\.to/);
  assert.match(js, /sentence\.ob\.num = \(sentence\.ob\.num \?\? 0\) \+ 2/);

  const logs = [];
  const sandbox = { console: { log: v => logs.push(v) } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(js, sandbox);

  assert.equal(logs.at(-1)?.ob?.num ?? logs.at(-1), 3);
});

test("compile uses genitive this ti ob ti num without remember", async () => {
  const program = [
    "exists su name bucket ob num 1 be number ya",
    "su name bump be ceremony def",
    "ob num 2 to this ti ob ti num be plus do",
    "su name bump be ceremony prah",
    "su name evoker ob name bucket be bump do",
    "ob name bucket be write do"
  ].join("\n");

  const js = transpileProgram(buildProgram(program).sentences, { lang: "javascript" })
    .replace(/^quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  assert.doesNotMatch(js, /remember\(sentence\.to/);
  assert.match(js, /sentence\.ob\.num = \(sentence\.ob\.num \?\? 0\) \+ 2/);

  const logs = [];
  const sandbox = { console: { log: v => logs.push(v) } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(js, sandbox);

  assert.equal(logs.at(-1)?.ob?.num ?? logs.at(-1), 3);
});
