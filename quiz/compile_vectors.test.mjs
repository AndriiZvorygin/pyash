import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget } from "../program/remember/index.mjs";

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
