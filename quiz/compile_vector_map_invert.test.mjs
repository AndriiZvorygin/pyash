import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { buildProgram } from "../program/program.mjs";
import { transpileProgram } from "../program/verbs/exchange/compile.mjs";

test("compile at all invert emits runnable JS that flips vector values", async () => {
  const source = await fs.readFile("examples/pyash/compile-vector-invert-once.txt", "utf8");
  const program = buildProgram(source);
  const js = transpileProgram(program.sentences, { lang: "javascript" });

  const sandbox = {
    console: { log: () => {} },
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(js, sandbox);

  const out = sandbox.out;
  assert.ok(out?.obj?.ve?.values, "out vector should be produced");
  const values = Array.isArray(out.obj.ve.values) ? out.obj.ve.values : Array.from(out.obj.ve.values || []);
  assert.equal(values[0], -1);
  assert.equal(values[1], 2);
  assert.equal(values[2], -3);
});
