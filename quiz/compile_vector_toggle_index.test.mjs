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
  let values = [];
  if (Array.isArray(out)) {
    values = JSON.parse(JSON.stringify(out));
  } else if (typeof out === "string") {
    const tokens = out.split(/\s+/).filter(Boolean);
    const veIndex = tokens.indexOf("ve");
    if (veIndex !== -1 && tokens.length > veIndex + 1) {
      const afterType = tokens.slice(veIndex + 2);
      const stop = afterType.findIndex((tok) => ["be", "subj", "obj", "to", "from", "then", "ya", "do", "ret"].includes(tok));
      values = stop === -1 ? afterType : afterType.slice(0, stop);
    }
  }
  assert.deepEqual(values, ["truth", "truth", "truth"]);
});
