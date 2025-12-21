import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";

import { buildProgram } from "../program/program.mjs";
import { transpileProgram } from "../program/verbs/exchange/compile.mjs";
import { doorsExpectedLiteral } from "./doors_loop_expected.mjs";

test("compile JS: 100 doors nested loops", async () => {
  const source = await fs.readFile("examples/pyash/doors-loop-100.pya", "utf8");
  const program = buildProgram(source);
  const js = transpileProgram(program.sentences, { lang: "javascript" });

  const logs = [];
  const sandbox = { console: { log: (...args) => logs.push(args[0]) } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(js, sandbox);

  const out = logs.at(-1);
  assert.equal(String(out), doorsExpectedLiteral(100));
});
