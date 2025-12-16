import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";

import { buildProgram } from "../program/program.mjs";
import { transpileProgram } from "../program/verbs/exchange/compile.mjs";

test("compile toggles vector element and logs updated values", async () => {
  const source = await fs.readFile("examples/pyash/compile-vector-toggle-index.txt", "utf8");
  const program = buildProgram(source);
  const js = transpileProgram(program.sentences, { lang: "javascript" });

  const logs = [];
  const sandbox = { console: { log: (...args) => logs.push(args[0]) } };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(js, sandbox);

  assert.ok(logs.length >= 1, "should log at least once");
  const out = logs.at(-1);
  const values = Array.isArray(out) ? JSON.parse(JSON.stringify(out)) : [];
  assert.deepEqual(values, ["truth", "truth", "truth"]);
});
